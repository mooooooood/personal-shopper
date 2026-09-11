"""Shared world behavior through the actual HTTP routes and SQLite lifecycle."""
import asyncio
from contextlib import suppress
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx

from app import main
from app.meadow import Meadow
from app.meadow_service import MeadowService


class SharedMeadowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / 'site.sqlite3'
        self.path_patch = patch('app.meadow_service.database_path', return_value=self.path)
        self.path_patch.start()
        self.lifecycle = main.app.router.lifespan_context(main.app)
        await self.lifecycle.__aenter__()
        self.first = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://testserver')
        self.second = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://testserver')

    async def asyncTearDown(self):
        await self.first.aclose()
        await self.second.aclose()
        await self.lifecycle.__aexit__(None, None, None)
        self.path_patch.stop()
        self.directory.cleanup()

    async def post(self, action, client=None, request_id=None, **fields):
        return await (client or self.first).post('/api/meadow/actions', headers={'X-Meadow-Client': '1'}, json={
            'action': action, 'requestId': request_id or str(uuid4()), **fields,
        })

    async def stop_ticks(self):
        service = main.app.state.meadow
        service.task.cancel()
        with suppress(asyncio.CancelledError):
            await service.task
        service.task = None
        return service

    async def controlled_world(self, seed=17):
        """Stop wall-clock ticks so event/action ordering is reproducible."""
        service = main.app.state.meadow
        if service.task is not None:
            await self.stop_ticks()
        service.model = Meadow(seed=seed)
        service._publish()
        return service

    @staticmethod
    def publish_steps(service, count=1):
        for _ in range(count):
            service.model.update(.1)
        service.revision += 1
        service.dirty = True
        service._publish()

    async def wildlife_world(self, kind):
        service = await self.controlled_world()
        for rabbit in service.model.rabbits:
            rabbit['_speed'] = 0
            rabbit['cooldown'] = 999
        self.assertTrue(service.model._start_encounter(kind=kind))
        self.publish_steps(service, count=0)
        return service

    def advance_until_leaving(self, service):
        for _ in range(120):
            self.publish_steps(service)
            if service.model.encounter['phase'] == 'leaving':
                return
        self.fail('The wildlife did not finish its chase within the bounded event duration')

    async def test_visitors_share_coats_and_catch_release_preserves_them(self):
        await self.controlled_world()
        initial = (await self.first.get('/api/meadow')).json()
        coats = {rabbit['id']: rabbit['coat'] for rabbit in initial['rabbits']}
        self.assertTrue(set(coats.values()) <= {
            'white', 'cream', 'caramel', 'chocolate', 'silver', 'charcoal', 'ginger', 'spotted',
        })
        other = (await self.second.get('/api/meadow')).json()
        self.assertEqual({rabbit['id']: rabbit['coat'] for rabbit in other['rabbits']}, coats)
        rabbit_id = initial['rabbits'][0]['id']
        caught = (await self.post('catch', rabbitId=rabbit_id)).json()
        self.assertEqual(caught['state']['basket'][0]['coat'], coats[rabbit_id])
        released = (await self.post('release', client=self.second)).json()
        rabbit = next(rabbit for rabbit in released['state']['rabbits'] if rabbit['id'] == rabbit_id)
        self.assertEqual(rabbit['coat'], coats[rabbit_id])

    async def test_visitors_share_wildlife_warning_capture_and_counter(self):
        for kind in ('eagle', 'wolf'):
            with self.subTest(kind=kind):
                service = await self.wildlife_world(kind)
                first = (await self.first.get('/api/meadow')).json()
                second = (await self.second.get('/api/meadow')).json()
                self.assertEqual(first, second)
                self.assertEqual(first['encounter']['kind'], kind)
                self.assertEqual(first['encounter']['phase'], 'warning')
                target_id = first['encounter']['targetId']
                target = next(rabbit for rabbit in first['rabbits'] if rabbit['id'] == target_id)
                self.advance_until_leaving(service)
                first = (await self.first.get('/api/meadow')).json()
                second = (await self.second.get('/api/meadow')).json()
                self.assertEqual(first, second)
                self.assertEqual(first['raidedCount'], 1)
                self.assertEqual(first['totalCount'], 11)
                self.assertNotIn(target_id, [rabbit['id'] for rabbit in first['rabbits'] + first['basket']])
                self.assertEqual(first['encounter']['carrying'], {
                    key: target[key] for key in ('id', 'coat', 'adult')
                })
                self.assertFalse(any(key.startswith('_') for key in first['encounter']))
                late_catch = (await self.post('catch', client=self.second, rabbitId=target_id)).json()
                self.assertFalse(late_catch['ok'])
                self.assertEqual(late_catch['code'], 'rabbit_gone')
                self.assertEqual(late_catch['state']['raidedCount'], 1)
                self.assertEqual(late_catch['state']['basket'], [])

    async def test_visitor_catch_saves_target_during_wildlife_chase(self):
        for kind in ('eagle', 'wolf'):
            with self.subTest(kind=kind):
                service = await self.wildlife_world(kind)
                self.publish_steps(service, count=30)
                self.assertEqual(service.model.encounter['phase'], 'chasing')
                target_id = service.model.encounter['targetId']
                caught = await self.post('catch', rabbitId=target_id)
                self.assertEqual(caught.status_code, 200)
                self.assertEqual(caught.json()['code'], 'caught')
                self.publish_steps(service, count=120)
                other = (await self.second.get('/api/meadow')).json()
                self.assertEqual(other['raidedCount'], 0)
                self.assertIsNone(other['encounter'])
                self.assertEqual([rabbit['id'] for rabbit in other['basket']], [target_id])
                self.assertEqual(other['totalCount'], 12)

    async def test_failed_catch_save_restores_active_wildlife_before_retry(self):
        service = await self.wildlife_world('wolf')
        self.publish_steps(service, count=30)
        before = service.model.export_state()
        target_id = service.model.encounter['targetId']
        request_id = str(uuid4())
        with patch('app.meadow_service.save_meadow', side_effect=OSError('disk full')):
            with self.assertLogs('app.meadow_service', level='ERROR'):
                failed = await self.post('catch', rabbitId=target_id, request_id=request_id)
        self.assertEqual(failed.status_code, 503)
        self.assertEqual(service.model.export_state(), before)
        other = (await self.second.get('/api/meadow')).json()
        self.assertEqual(other['encounter']['phase'], 'chasing')
        self.assertIn(target_id, [rabbit['id'] for rabbit in other['rabbits']])
        retry = await self.post('catch', rabbitId=target_id, request_id=request_id)
        self.assertEqual(retry.json()['code'], 'caught')
        self.publish_steps(service, count=120)
        self.assertEqual(service.model.raided_count, 0)
        self.assertEqual([rabbit['id'] for rabbit in service.model.basket], [target_id])

    async def test_restart_preserves_active_wildlife_and_carried_rabbit(self):
        for phase in ('warning', 'chasing', 'leaving'):
            with self.subTest(phase=phase):
                service = await self.wildlife_world('eagle')
                if phase == 'chasing':
                    self.publish_steps(service, count=30)
                elif phase == 'leaving':
                    self.advance_until_leaving(service)
                saved = (await self.post('carrot', x=500, y=300)).json()['state']
                self.assertEqual(saved['encounter']['phase'], phase)
                await self.lifecycle.__aexit__(None, None, None)
                self.lifecycle = main.app.router.lifespan_context(main.app)
                await self.lifecycle.__aenter__()
                await self.stop_ticks()
                restored = (await self.second.get('/api/meadow')).json()
                self.assertNotEqual(restored['epoch'], saved['epoch'])
                self.assertEqual(restored['encounter'], saved['encounter'])
                self.assertEqual(restored['raidedCount'], saved['raidedCount'])
                self.assertEqual(restored['rabbits'], saved['rabbits'])
                self.assertEqual(restored['totalCount'], saved['totalCount'])

    async def test_two_visitors_share_catch_and_release(self):
        initial = (await self.first.get('/api/meadow')).json()
        self.assertEqual(len(initial['rabbits']), 12)
        rabbit_id = initial['rabbits'][0]['id']
        caught = await self.post('catch', rabbitId=rabbit_id)
        self.assertEqual(caught.status_code, 200)
        self.assertEqual(caught.json()['code'], 'caught')
        other = (await self.second.get('/api/meadow')).json()
        self.assertNotIn(rabbit_id, [rabbit['id'] for rabbit in other['rabbits']])
        self.assertIn(rabbit_id, [rabbit['id'] for rabbit in other['basket']])
        raced = await self.post('catch', client=self.second, rabbitId=rabbit_id)
        self.assertFalse(raced.json()['ok'])
        self.assertEqual(raced.json()['code'], 'rabbit_gone')
        released = await self.post('release', client=self.second)
        self.assertEqual(released.json()['code'], 'released')
        final = (await self.first.get('/api/meadow')).json()
        self.assertIn(rabbit_id, [rabbit['id'] for rabbit in final['rabbits']])
        self.assertEqual(final['basket'], [])

    async def test_duplicate_action_is_idempotent_and_conflict_rejected(self):
        request_id = str(uuid4())
        first = await self.post('carrot', x=500, y=300, request_id=request_id)
        duplicate = await self.post('carrot', client=self.second, x=500, y=300, request_id=request_id)
        self.assertTrue(first.json()['ok'])
        self.assertEqual(len(duplicate.json()['state']['carrots']), 1)
        conflict = await self.post('carrot', x=600, y=300, request_id=request_id)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()['code'], 'request_id_conflict')

    async def test_restart_preserves_world_and_successful_action_receipts(self):
        initial = (await self.first.get('/api/meadow')).json()
        ids = [rabbit['id'] for rabbit in initial['rabbits'][:2]]
        for rabbit_id in ids:
            await self.post('catch', rabbitId=rabbit_id)
        request_id = str(uuid4())
        released = (await self.post('release', request_id=request_id)).json()
        remaining_id = released['state']['basket'][0]['id']
        saved_coats = {
            rabbit['id']: rabbit['coat']
            for rabbit in released['state']['rabbits'] + released['state']['basket']
        }
        old_epoch = released['state']['epoch']
        await self.lifecycle.__aexit__(None, None, None)
        self.lifecycle = main.app.router.lifespan_context(main.app)
        await self.lifecycle.__aenter__()
        restored = (await self.second.get('/api/meadow')).json()
        self.assertNotEqual(restored['epoch'], old_epoch)
        self.assertEqual([rabbit['id'] for rabbit in restored['basket']], [remaining_id])
        self.assertEqual({
            rabbit['id']: rabbit['coat'] for rabbit in restored['rabbits'] + restored['basket']
        }, saved_coats)
        duplicate = (await self.post('release', request_id=request_id)).json()
        self.assertTrue(duplicate['ok'])
        self.assertEqual([rabbit['id'] for rabbit in duplicate['state']['basket']], [remaining_id])

    async def test_failed_write_rolls_back_and_can_retry(self):
        state = (await self.first.get('/api/meadow')).json()
        rabbit_id = state['rabbits'][0]['id']
        request_id = str(uuid4())
        with patch('app.meadow_service.save_meadow', side_effect=OSError('disk full')):
            with self.assertLogs('app.meadow_service', level='ERROR'):
                failed = await self.post('catch', rabbitId=rabbit_id, request_id=request_id)
        self.assertEqual(failed.status_code, 503)
        after = (await self.second.get('/api/meadow')).json()
        self.assertEqual(after['basket'], [])
        self.assertIn(rabbit_id, [rabbit['id'] for rabbit in after['rabbits']])
        retry = await self.post('catch', rabbitId=rabbit_id, request_id=request_id)
        self.assertEqual(retry.json()['code'], 'caught')

    async def test_origin_header_and_content_type_protection(self):
        payload = {'action': 'release', 'requestId': str(uuid4())}
        response = await self.first.post('/api/meadow/actions', json=payload)
        self.assertEqual(response.status_code, 403)
        for origin in ['https://other.example', 'null', 'http://testserver.evil', 'http://testserver/path']:
            response = await self.first.post('/api/meadow/actions', json=payload, headers={
                'X-Meadow-Client': '1', 'Origin': origin,
            })
            self.assertEqual(response.status_code, 403, origin)
        response = await self.first.post('/api/meadow/actions', content=json.dumps(payload), headers={
            'X-Meadow-Client': '1', 'Content-Type': 'text/plain',
        })
        self.assertEqual(response.status_code, 415)
        response = await self.first.post('/api/meadow/actions', json=payload, headers={
            'X-Meadow-Client': '1', 'Origin': 'http://testserver',
        })
        self.assertEqual(response.status_code, 200)

    async def test_invalid_actions_and_public_reset_are_rejected(self):
        cases = [
            {'action': 'reset'}, {'action': 'pause'}, {'action': 'catch', 'rabbitId': True},
            {'action': 'catch', 'rabbitId': -1}, {'action': 'catch', 'rabbitId': '1'},
            {'action': 'carrot', 'x': 1001, 'y': 100}, {'action': 'carrot', 'x': False, 'y': 100},
            {'action': 'carrot', 'x': 10**400, 'y': 100}, {'action': 'release', 'extra': 1},
        ]
        for fields in cases:
            response = await self.first.post('/api/meadow/actions', headers={'X-Meadow-Client': '1'}, json={
                'requestId': str(uuid4()), **fields,
            })
            self.assertEqual(response.status_code, 422, fields)
        response = await self.first.post('/api/meadow/actions', headers={
            'X-Meadow-Client': '1', 'Content-Type': 'application/json',
        }, content='{"action":"carrot","requestId":"' + str(uuid4()) + '","x":NaN,"y":100}')
        self.assertEqual(response.status_code, 422)
        response = await self.first.post('/api/meadow/actions', headers={
            'X-Meadow-Client': '1', 'Content-Type': 'application/json',
        }, content='x' * 1025)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(len((await self.first.get('/api/meadow')).json()['rabbits']), 12)

    async def test_polling_and_action_replies_cannot_be_cached(self):
        response = await self.first.get('/api/meadow')
        self.assertEqual(response.headers['cache-control'], 'no-store')
        state = response.json()
        self.assertIsInstance(state['revision'], int)
        self.assertIsInstance(state['epoch'], str)
        self.assertIn("default-src 'self'", response.headers['content-security-policy'])
        response = await self.post('release')
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(response.json()['code'], 'basket_empty')

    async def test_actions_are_rate_limited_but_polling_still_works(self):
        for _ in range(8):
            self.assertEqual((await self.post('release')).status_code, 200)
        rejected = await self.post('release')
        self.assertEqual(rejected.status_code, 429)
        self.assertEqual(rejected.headers['retry-after'], '1')
        self.assertEqual((await self.second.get('/api/meadow')).status_code, 200)

    async def test_corrupt_save_is_preserved_and_api_returns_unavailable(self):
        await self.lifecycle.__aexit__(None, None, None)
        with patch('app.meadow_service.load_meadow', side_effect=ValueError('corrupt save')):
            with self.assertLogs('app.meadow_service', level='ERROR'):
                self.lifecycle = main.app.router.lifespan_context(main.app)
                await self.lifecycle.__aenter__()
        self.assertEqual((await self.first.get('/api/meadow')).status_code, 503)
        self.assertEqual((await self.first.get('/')).status_code, 200)
        self.assertEqual((await self.post('release')).status_code, 503)


class RateLimitMemoryTests(unittest.TestCase):
    def test_many_ip_addresses_have_bounded_memory(self):
        service = MeadowService(Path('unused.sqlite3'))
        for index in range(3000):
            service._allow_action('visitor-' + str(index))
        self.assertLessEqual(len(service.ip_buckets), 1024)


if __name__ == '__main__':
    unittest.main()
