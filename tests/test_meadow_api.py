"""Shared world behavior through the actual HTTP routes and SQLite lifecycle."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx

from app import main
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
        old_epoch = released['state']['epoch']
        await self.lifecycle.__aexit__(None, None, None)
        self.lifecycle = main.app.router.lifespan_context(main.app)
        await self.lifecycle.__aenter__()
        restored = (await self.second.get('/api/meadow')).json()
        self.assertNotEqual(restored['epoch'], old_epoch)
        self.assertEqual([rabbit['id'] for rabbit in restored['basket']], [remaining_id])
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
