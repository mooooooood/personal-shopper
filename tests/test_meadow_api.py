"""Shared world behavior through the actual HTTP routes and SQLite lifecycle."""
import asyncio
from contextlib import suppress
import hashlib
import json
import time
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx

from app import main
from app.meadow import Meadow, load_meadow
from app.meadow_service import MeadowService


class SharedMeadowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / 'site.sqlite3'
        self.path_patch = patch('app.meadow_service.database_path', return_value=self.path)
        self.path_patch.start()
        self.lifecycle = main.app.router.lifespan_context(main.app)
        await self.lifecycle.__aenter__()
        self.first_token, self.second_token = str(uuid4()), str(uuid4())
        self.first = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://testserver',
                                       headers={'X-Meadow-Player': self.first_token})
        self.second = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://testserver',
                                        headers={'X-Meadow-Player': self.second_token})

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
        for rabbit in service.model.rabbits:
            rabbit['cooldown'] = 999
        service._publish()
        return service

    async def complete_lasso(self, rabbit_id):
        """Drive real actions and service ticks without waiting for wall time."""
        service = main.app.state.meadow
        service.ip_buckets.clear()
        service.global_bucket[0] = 20
        target = next(rabbit for rabbit in service.model.rabbits if rabbit['id'] == rabbit_id)
        target['_speed'] = 0  # Aim is stable for tests of settlement/persistence.
        response = await self.post('lasso', rabbitId=rabbit_id)
        self.assertEqual(response.json()['code'], 'lassoed')
        lasso_id = response.json()['state']['myLassoId']
        for step in range(270):
            if step % 6 == 0:
                # The accelerated test clock also replenishes the HTTP limiter.
                service.ip_buckets.clear()
                service.lease_buckets.clear()
                service.global_bucket[0] = 20
                pulled = await self.post('pull', lassoId=lasso_id)
                self.assertEqual(pulled.json()['code'], 'pulling')
            await service._tick(.1, time.monotonic())
            if not service.model.lassos:
                state = (await self.first.get('/api/meadow')).json()
                self.assertIn(rabbit_id, [rabbit['id'] for rabbit in state['basket']])
                return state
        self.fail('Rabbit did not reach the basket through timed pulling')

    def land_cast(self, service, lasso_id):
        """Finish the real flight before tests that specifically exercise pulling."""
        rope = next(item for item in service.model.lassos if item['id'] == lasso_id)
        target = next(rabbit for rabbit in service.model.rabbits if rabbit['id'] == rope['rabbitId'])
        target['_speed'] = 0
        while rope['phase'] == 'casting':
            self.publish_steps(service)
        self.assertEqual(rope['phase'], 'reeling')

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

    async def test_visitors_share_coats_and_lasso_release_preserves_them(self):
        await self.controlled_world()
        initial = (await self.first.get('/api/meadow')).json()
        coats = {rabbit['id']: rabbit['coat'] for rabbit in initial['rabbits']}
        self.assertTrue(set(coats.values()) <= {
            'white', 'cream', 'caramel', 'chocolate', 'silver', 'charcoal', 'ginger', 'spotted',
        })
        other = (await self.second.get('/api/meadow')).json()
        self.assertEqual({rabbit['id']: rabbit['coat'] for rabbit in other['rabbits']}, coats)
        rabbit_id = initial['rabbits'][0]['id']
        caught = await self.complete_lasso(rabbit_id)
        self.assertEqual(caught['basket'][0]['coat'], coats[rabbit_id])
        released = (await self.post('release', client=self.second)).json()
        rabbit = next(rabbit for rabbit in released['state']['rabbits'] if rabbit['id'] == rabbit_id)
        self.assertEqual(rabbit['coat'], coats[rabbit_id])

    async def test_visitors_share_wildlife_warning_capture_and_counter(self):
        for kind in ('eagle', 'wolf'):
            with self.subTest(kind=kind):
                service = await self.wildlife_world(kind)
                first = (await self.first.get('/api/meadow')).json()
                second = (await self.second.get('/api/meadow')).json()
                first = (await self.first.get('/api/meadow')).json()
                self.assertEqual({k:v for k,v in first.items() if k not in ('mySeatId','myLassoId')},
                                 {k:v for k,v in second.items() if k not in ('mySeatId','myLassoId')})
                self.assertEqual(first['encounter']['kind'], kind)
                self.assertEqual(first['encounter']['phase'], 'warning')
                target_id = first['encounter']['targetId']
                target = next(rabbit for rabbit in first['rabbits'] if rabbit['id'] == target_id)
                self.advance_until_leaving(service)
                first = (await self.first.get('/api/meadow')).json()
                second = (await self.second.get('/api/meadow')).json()
                self.assertEqual({k:v for k,v in first.items() if k not in ('mySeatId','myLassoId')},
                                 {k:v for k,v in second.items() if k not in ('mySeatId','myLassoId')})
                self.assertEqual(first['raidedCount'], 1)
                self.assertEqual(first['totalCount'], 11)
                self.assertNotIn(target_id, [rabbit['id'] for rabbit in first['rabbits'] + first['basket']])
                self.assertEqual(first['encounter']['carrying'], {
                    key: target[key] for key in ('id', 'coat', 'adult')
                })
                self.assertFalse(any(key.startswith('_') for key in first['encounter']))
                late_catch = (await self.post('lasso', client=self.second, rabbitId=target_id)).json()
                self.assertFalse(late_catch['ok'])
                self.assertEqual(late_catch['code'], 'rabbit_gone')
                self.assertEqual(late_catch['state']['raidedCount'], 1)
                self.assertEqual(late_catch['state']['basket'], [])

    async def test_visitor_lasso_target_can_be_stolen_during_wildlife_chase(self):
        for kind in ('eagle', 'wolf'):
            with self.subTest(kind=kind):
                service = await self.wildlife_world(kind)
                self.publish_steps(service, count=30)
                self.assertEqual(service.model.encounter['phase'], 'chasing')
                target_id = service.model.encounter['targetId']
                roped = await self.post('lasso', rabbitId=target_id)
                self.assertEqual(roped.status_code, 200)
                self.assertEqual(roped.json()['code'], 'lassoed')
                self.assertIn(target_id, [rabbit['id'] for rabbit in roped.json()['state']['rabbits']])
                self.advance_until_leaving(service)
                other = (await self.second.get('/api/meadow')).json()
                self.assertEqual(other['raidedCount'], 1)
                self.assertEqual(other['lassoResults'][-1]['outcome'], 'stolen')
                self.assertEqual(other['basket'], [])
                self.assertEqual(other['totalCount'], 11)
                self.assertIsNone((await self.first.get('/api/meadow')).json()['myLassoId'])

    async def test_failed_lasso_save_restores_active_wildlife_before_retry(self):
        service = await self.wildlife_world('wolf')
        self.publish_steps(service, count=30)
        before = service.model.export_state()
        target_id = service.model.encounter['targetId']
        request_id = str(uuid4())
        with patch('app.meadow_service.save_meadow', side_effect=OSError('disk full')):
            with self.assertLogs('app.meadow_service', level='ERROR'):
                failed = await self.post('lasso', rabbitId=target_id, request_id=request_id)
        self.assertEqual(failed.status_code, 503)
        self.assertEqual(service.model.export_state(), before)
        other = (await self.second.get('/api/meadow')).json()
        self.assertEqual(other['encounter']['phase'], 'chasing')
        self.assertIn(target_id, [rabbit['id'] for rabbit in other['rabbits']])
        retry = await self.post('lasso', rabbitId=target_id, request_id=request_id)
        self.assertEqual(retry.json()['code'], 'lassoed')
        self.publish_steps(service, count=120)
        self.assertEqual(service.model.raided_count, 1)
        self.assertEqual(service.model.basket, [])

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

    async def test_two_visitors_share_lasso_and_release(self):
        await self.controlled_world()
        initial = (await self.first.get('/api/meadow')).json()
        self.assertEqual(len(initial['rabbits']), 12)
        rabbit_id = initial['rabbits'][0]['id']
        await self.complete_lasso(rabbit_id)
        other = (await self.second.get('/api/meadow')).json()
        self.assertNotIn(rabbit_id, [rabbit['id'] for rabbit in other['rabbits']])
        self.assertIn(rabbit_id, [rabbit['id'] for rabbit in other['basket']])
        raced = await self.post('lasso', client=self.second, rabbitId=rabbit_id)
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
        duplicate = await self.post('carrot', x=500, y=300, request_id=request_id)
        self.assertTrue(first.json()['ok'])
        self.assertEqual(len(duplicate.json()['state']['carrots']), 1)
        conflict = await self.post('carrot', x=600, y=300, request_id=request_id)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()['code'], 'request_id_conflict')

    async def test_restart_preserves_world_and_successful_action_receipts(self):
        await self.controlled_world()
        initial = (await self.first.get('/api/meadow')).json()
        ids = [rabbit['id'] for rabbit in initial['rabbits'][:2]]
        for rabbit_id in ids:
            await self.complete_lasso(rabbit_id)
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
                failed = await self.post('lasso', rabbitId=rabbit_id, request_id=request_id)
        self.assertEqual(failed.status_code, 503)
        after = (await self.second.get('/api/meadow')).json()
        self.assertEqual(after['basket'], [])
        self.assertIn(rabbit_id, [rabbit['id'] for rabbit in after['rabbits']])
        retry = await self.post('lasso', rabbitId=rabbit_id, request_id=request_id)
        self.assertEqual(retry.json()['code'], 'lassoed')

    async def test_lasso_identity_and_ownership_are_private(self):
        service = await self.controlled_world()
        rabbit_id = service.model.rabbits[0]['id']
        request_id = str(uuid4())
        roped = await self.post('lasso', rabbitId=rabbit_id, request_id=request_id)
        state = roped.json()['state']
        lasso_id = state['myLassoId']
        self.assertIsInstance(lasso_id, int)
        self.assertEqual(state['basket'], [])
        self.assertEqual(state['lassos'][0]['rabbitId'], rabbit_id)
        second = (await self.second.get('/api/meadow')).json()
        self.assertEqual(second['lassos'], state['lassos'])
        self.assertIsNone(second['myLassoId'])
        self.assertNotIn('myLassoId', service.cached)
        for text in (roped.text, json.dumps(second)):
            self.assertNotIn(self.first_token, text)
            self.assertNotIn(hashlib.sha256(self.first_token.encode()).hexdigest(), text)
            self.assertNotIn('_owner', text)
        for action in ('pull', 'stop_pull', 'cancel_lasso'):
            denied = await self.post(action, client=self.second, lassoId=lasso_id)
            self.assertEqual(denied.json()['code'], 'not_yours')
            self.assertFalse(denied.json()['ok'])
        raced = await self.post('lasso', client=self.second, rabbitId=rabbit_id)
        self.assertEqual(raced.json()['code'], 'rabbit_roped')
        duplicate = await self.post('lasso', rabbitId=rabbit_id, request_id=request_id)
        self.assertEqual(duplicate.json()['state']['myLassoId'], lasso_id)
        self.assertEqual(len(service.model.lassos), 1)
        replay = await self.post('lasso', client=self.second, rabbitId=rabbit_id, request_id=request_id)
        self.assertEqual(replay.status_code, 409)

    async def test_lasso_requires_valid_private_player_header_and_catch_is_removed(self):
        await self.controlled_world()
        payload = {'action': 'lasso', 'rabbitId': 1, 'requestId': str(uuid4())}
        for token in ('', 'not-a-player', 'x' * 36):
            rejected = await self.first.post('/api/meadow/actions', json=payload, headers={
                'X-Meadow-Client': '1', 'X-Meadow-Player': token,
            })
            self.assertEqual(rejected.status_code, 403)
            self.assertEqual(rejected.json()['code'], 'player_header_required')
        anonymous = await self.first.get('/api/meadow', headers={'X-Meadow-Player': ''})
        self.assertEqual(anonymous.status_code, 200)
        self.assertIsNone(anonymous.json()['myLassoId'])
        old_catch = await self.post('catch', rabbitId=1)
        self.assertEqual(old_catch.status_code, 422)
        self.assertEqual((await self.first.get('/api/meadow')).json()['basket'], [])

    async def test_pull_requests_only_renew_lease_and_stop_pauses_progress(self):
        service = await self.controlled_world()
        roped = (await self.post('lasso', rabbitId=1)).json()
        lasso_id = roped['state']['myLassoId']
        pull_request = str(uuid4())
        with patch('app.meadow_service.save_meadow') as save:
            first = await self.post('pull', lassoId=lasso_id, request_id=pull_request)
            self.assertEqual(first.json()['code'], 'pulling')
            for _ in range(5):
                service.lease_buckets.clear()
                repeated = await self.post('pull', lassoId=lasso_id)
                self.assertEqual(repeated.json()['code'], 'pulling')
            duplicate = await self.post('pull', lassoId=lasso_id, request_id=pull_request)
            self.assertEqual(duplicate.json()['state']['lassos'][0]['progress'], 0)
            self.assertEqual(service.model.time, 0)
            self.assertEqual(service.model.basket, [])
            save.assert_not_called()
        self.land_cast(service, lasso_id)
        self.publish_steps(service, 6)
        progressed = service.model.snapshot()['lassos'][0]['progress']
        self.assertGreater(progressed, 0)
        service.lease_buckets.clear()
        stopped = await self.post('stop_pull', lassoId=lasso_id)
        self.assertEqual(stopped.json()['code'], 'pull_stopped')
        self.publish_steps(service, 20)
        self.assertEqual(service.model.snapshot()['lassos'][0]['progress'], progressed)
        duplicate = await self.post('pull', lassoId=lasso_id, request_id=pull_request)
        self.assertFalse(duplicate.json()['state']['lassos'][0]['pulling'])
        self.assertEqual(duplicate.json()['state']['lassos'][0]['progress'], progressed)

    async def test_restart_restores_lasso_but_needs_new_pull_lease(self):
        service = await self.controlled_world()
        start_request, pull_request = str(uuid4()), str(uuid4())
        roped = (await self.post('lasso', rabbitId=1, request_id=start_request)).json()
        lasso_id = roped['state']['myLassoId']
        self.land_cast(service, lasso_id)
        await self.post('pull', lassoId=lasso_id, request_id=pull_request)
        self.publish_steps(service, 6)
        progress = service.model.snapshot()['lassos'][0]['progress']
        await self.lifecycle.__aexit__(None, None, None)
        self.lifecycle = main.app.router.lifespan_context(main.app)
        await self.lifecycle.__aenter__()
        await self.stop_ticks()
        service = main.app.state.meadow
        restored = (await self.first.get('/api/meadow')).json()
        self.assertEqual(restored['myLassoId'], lasso_id)
        self.assertEqual(restored['lassos'][0]['progress'], progress)
        self.assertFalse(restored['lassos'][0]['pulling'])
        self.publish_steps(service, 6)
        self.assertEqual(service.model.snapshot()['lassos'][0]['progress'], progress)
        duplicate = await self.post('lasso', rabbitId=1, request_id=start_request)
        self.assertEqual(duplicate.json()['code'], 'lassoed')
        self.assertEqual(len(service.model.lassos), 1)
        # Transient lease receipts are deliberately not persisted across restart.
        resumed = await self.post('pull', lassoId=lasso_id, request_id=pull_request)
        self.assertTrue(resumed.json()['state']['lassos'][0]['pulling'])
        self.publish_steps(service, 6)
        self.assertGreater(service.model.snapshot()['lassos'][0]['progress'], progress)

    async def test_cancel_is_durable_and_old_pull_cannot_capture_rabbit(self):
        service = await self.controlled_world()
        roped = (await self.post('lasso', rabbitId=1)).json()
        lasso_id = roped['state']['myLassoId']
        await self.post('pull', lassoId=lasso_id)
        cancelled = await self.post('cancel_lasso', lassoId=lasso_id)
        state = cancelled.json()['state']
        self.assertEqual(cancelled.json()['code'], 'lasso_cancelled')
        self.assertIsNone(state['myLassoId'])
        self.assertEqual(state['lassoResults'][-1]['outcome'], 'cancelled')
        persisted = load_meadow(self.path)
        self.assertEqual(persisted.lassos, [])
        self.assertEqual(persisted.lasso_results[-1]['outcome'], 'cancelled')
        late_pull = await self.post('pull', lassoId=lasso_id)
        self.assertEqual(late_pull.json()['code'], 'lasso_gone')
        self.assertEqual(service.model.basket, [])

    async def test_fixed_aim_flight_is_public_and_missed_result_is_durable(self):
        service = await self.controlled_world()
        rabbit = service.model.rabbits[0]
        rabbit.update(x=250, y=380, _speed=100)
        service.model._move_toward(rabbit, {'x':500,'y':380})
        service._publish()
        cast = await self.post('lasso', rabbitId=1, x=250, y=380)
        self.assertEqual(cast.json()['code'], 'lassoed')
        rope = cast.json()['state']['lassos'][0]
        self.assertEqual(rope['phase'], 'casting')
        self.assertEqual((rope['castX'], rope['castY']), (250, 380))
        self.assertEqual(cast.json()['state']['seats'][0]['status'], 'casting')
        observer = (await self.second.get('/api/meadow')).json()
        self.assertEqual(observer['lassos'], cast.json()['state']['lassos'])
        for _ in range(12):
            await service._tick(.1, time.monotonic())
        state = (await self.first.get('/api/meadow')).json()
        self.assertEqual(state['lassoResults'][-1]['outcome'], 'missed')
        self.assertEqual(state['myLassoResults'][-1]['outcome'], 'missed')
        self.assertEqual(state['basket'], [])
        self.assertIn(1, [item['id'] for item in state['rabbits']])
        self.assertEqual((await self.second.get('/api/meadow')).json()['myLassoResults'], [])
        self.assertEqual(load_meadow(self.path).lasso_results[-1]['outcome'], 'missed')
        self.assertNotIn('_owner', json.dumps(state))

    async def test_completed_capture_is_durable_before_any_poll_sees_it(self):
        service = await self.controlled_world()
        completed = await self.complete_lasso(1)
        self.assertEqual(completed['lassoResults'][-1]['outcome'], 'caught')
        self.assertEqual(completed['myLassoResults'][-1]['coat'], completed['basket'][0]['coat'])
        self.assertEqual((await self.second.get('/api/meadow')).json()['myLassoResults'], [])
        self.assertEqual([rabbit['id'] for rabbit in completed['basket']], [1])
        persisted = load_meadow(self.path)
        self.assertEqual([rabbit['id'] for rabbit in persisted.basket], [1])
        self.assertEqual(persisted.lassos, [])
        self.assertEqual(persisted.lasso_results[-1]['outcome'], 'caught')
        self.assertFalse(service.dirty)

    async def test_failed_capture_checkpoint_rolls_back_and_retries_without_false_success(self):
        service = await self.controlled_world()
        rabbit = service.model.rabbits[0]
        anchor = service.model.seat_anchors[0]
        rabbit.update(x=anchor['x'] - 10, y=anchor['y'])
        service._publish()
        roped = (await self.post('lasso', rabbitId=rabbit['id'])).json()
        lasso_id = roped['state']['myLassoId']
        self.land_cast(service, lasso_id)
        for step in range(44):
            if step % 6 == 0:
                service.ip_buckets.clear()
                service.lease_buckets.clear()
                service.global_bucket[0] = 20
                await self.post('pull', lassoId=lasso_id)
            await service._tick(.1, time.monotonic())
        before = service.model.export_state()
        revision = service.revision
        now = time.monotonic()
        with patch('app.meadow_service.save_meadow', side_effect=OSError('disk full')):
            with self.assertLogs('app.meadow_service', level='ERROR'):
                await service._tick(.1, now)
        self.assertEqual(service.model.export_state(), before)
        self.assertEqual(service.revision, revision)
        state = (await self.second.get('/api/meadow')).json()
        self.assertEqual(state['basket'], [])
        self.assertEqual(state['lassoResults'], [])
        self.assertEqual(len(state['lassos']), 1)
        await service._tick(.1, now + 1)
        self.assertEqual(service.model.export_state(), before)
        await service._tick(.1, now + 5)
        state = (await self.second.get('/api/meadow')).json()
        self.assertEqual(state['lassoResults'][-1]['outcome'], 'caught')
        self.assertEqual([rabbit['id'] for rabbit in load_meadow(self.path).basket], [1])

    async def test_stolen_lasso_result_is_checkpointed_immediately(self):
        service = await self.wildlife_world('wolf')
        target_id = service.model.encounter['targetId']
        await self.post('lasso', rabbitId=target_id)
        for _ in range(120):
            await service._tick(.1, time.monotonic())
            if service.model.lasso_results:
                break
        self.assertEqual(service.model.lasso_results[-1]['outcome'], 'stolen')
        restored = load_meadow(self.path)
        self.assertEqual(restored.raided_count, 1)
        self.assertEqual(restored.lasso_results[-1]['outcome'], 'stolen')
        self.assertEqual(restored.lassos, [])
        self.assertEqual(restored.basket, [])

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
            {'action': 'catch', 'rabbitId': 1}, {'action': 'lasso', 'rabbitId': -1},
            {'action': 'lasso', 'rabbitId': '1'}, {'action': 'pull', 'lassoId': True},
            {'action': 'stop_pull', 'lassoId': 0}, {'action': 'cancel_lasso', 'lassoId': 2**53},
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

    async def test_players_sharing_an_ip_can_pull_every_600ms(self):
        service = await self.controlled_world()
        clients = (self.first, self.second)
        with patch('app.meadow_service.time') as clock:
            clock.monotonic.return_value = 1000
            service.global_bucket = [20.0, 1000]
            ropes = []
            for rabbit, client in zip(service.model.rabbits[:2], clients):
                state = (await self.post('lasso', client=client, rabbitId=rabbit['id'])).json()['state']
                ropes.append(state['myLassoId'])
            for step in range(20):
                clock.monotonic.return_value = 1000 + step * .6
                for client, lasso_id in zip(clients, ropes):
                    response = await self.post('pull', client=client, lassoId=lasso_id)
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(response.json()['code'], 'pulling')
            self.assertEqual(len(service.ip_buckets), 1)
            self.assertEqual(len(service.lease_buckets), 2)
            self.assertEqual(service.model.time, 0)  # Heartbeats never advance the world.
            self.assertEqual(service.model.basket, [])

    async def test_unowned_rope_heartbeats_cannot_bypass_ip_limit_with_new_tokens(self):
        service = await self.controlled_world()
        state = (await self.post('lasso', rabbitId=1)).json()['state']
        lasso_id = state['myLassoId']
        service.ip_buckets.clear()
        with patch('app.meadow_service.time') as clock:
            clock.monotonic.return_value = 1000
            service.global_bucket = [20.0, 1000]
            for attempt in range(9):
                response = await self.first.post('/api/meadow/actions', headers={
                    'X-Meadow-Client': '1', 'X-Meadow-Player': str(uuid4()),
                }, json={'action': 'pull', 'lassoId': lasso_id, 'requestId': str(uuid4())})
                self.assertEqual(response.status_code, 200 if attempt < 8 else 429)
                self.assertEqual(response.json()['code'], 'not_yours' if attempt < 8 else 'rate_limited')
            self.assertEqual(len(service.lease_buckets), 0)
            self.assertEqual(len(service.ip_buckets), 1)

    async def test_lease_owner_and_global_limits_still_apply(self):
        service = await self.controlled_world()
        state = (await self.post('lasso', rabbitId=1)).json()['state']
        lasso_id = state['myLassoId']
        with patch('app.meadow_service.time') as clock:
            clock.monotonic.return_value = 1000
            service.global_bucket = [20.0, 1000]
            for attempt in range(5):
                response = await self.post('pull', lassoId=lasso_id)
                self.assertEqual(response.status_code, 200 if attempt < 4 else 429)
            service.lease_buckets.clear()
            service.global_bucket = [0.0, 1000]
            response = await self.post('pull', lassoId=lasso_id)
            self.assertEqual(response.status_code, 429)
            self.assertFalse(service.model.snapshot()['lassos'][0]['progress'])

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

    def test_many_past_rope_owners_have_bounded_heartbeat_memory(self):
        service = MeadowService(Path('unused.sqlite3'))
        for index in range(3000):
            service._allow_action('shared-ip', lease_owner=f'{index:064x}')
        self.assertLessEqual(len(service.lease_buckets), 1024)


if __name__ == '__main__':
    unittest.main()
