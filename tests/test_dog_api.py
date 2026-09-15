"""Real HTTP dog actions share one durable twenty-second event."""
import asyncio
from contextlib import suppress
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI
import httpx

from app.meadow import load_meadow
from app.meadow_service import MeadowService, router


class DogApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / 'meadow.sqlite3'
        self.now = 100.0
        self.clock = patch('app.meadow_service.time', SimpleNamespace(monotonic=lambda: self.now))
        self.clock.start()
        self.service = MeadowService(self.path)
        await self.start_without_clock()
        for rabbit in self.service.model.rabbits:
            rabbit.update(cooldown=999, _burrowWait=40)
        self.service.model._next_encounter_in = 70
        self.service._publish()
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.state.meadow = self.service
        self.clients = [httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app),
                        base_url='http://testserver', headers={
                            'X-Meadow-Player': str(uuid4()), 'X-Meadow-Client': '1'}) for _ in range(9)]

    async def asyncTearDown(self):
        for client in self.clients:
            await client.aclose()
        await self.service.close()
        self.clock.stop()
        self.directory.cleanup()

    async def start_without_clock(self):
        await self.service.start()
        self.service.task.cancel()
        with suppress(asyncio.CancelledError):
            await self.service.task
        self.service.task = None

    async def release(self, index=0, request_id=None, **extra):
        return await self.clients[index].post('/api/meadow/actions', json={
            'action': 'dog', 'requestId': request_id or str(uuid4()), **extra})

    async def tick(self, steps):
        for _ in range(steps):
            self.now += .1
            await self.service._tick(.1, self.now)

    async def restart(self):
        await self.service.close()
        self.service = MeadowService(self.path)
        self.app.state.meadow = self.service
        await self.start_without_clock()

    async def test_two_visitors_see_one_dog_and_busy_does_not_extend_lifetime(self):
        result = await self.release()
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['code'], 'dog_released')
        await self.tick(7)
        before = self.service.model.dog.copy()
        second = await self.release(1)
        self.assertFalse(second.json()['ok'])
        self.assertEqual(second.json()['code'], 'dog_busy')
        first_view = (await self.clients[0].get('/api/meadow')).json()['dog']
        second_view = (await self.clients[1].get('/api/meadow')).json()['dog']
        self.assertEqual(first_view, second_view)
        self.assertEqual(first_view['remaining'], before['remaining'])
        self.assertEqual(set(first_view), {'id', 'x', 'y', 'direction', 'remaining', 'moving'})
        self.assertEqual(load_meadow(self.path).dog, self.service.model.dog)

    async def test_success_and_busy_retries_remain_idempotent_after_expiry_and_restart(self):
        success_id, busy_id = str(uuid4()), str(uuid4())
        first = await self.release(request_id=success_id)
        retry = await self.release(request_id=success_id)
        self.assertEqual(first.json()['state']['dog'], retry.json()['state']['dog'])
        busy = await self.release(1, request_id=busy_id)
        self.assertEqual(busy.json()['code'], 'dog_busy')
        await self.tick(200)
        self.assertIsNone(self.service.model.dog)
        await self.restart()
        for index, request_id, code in ((0, success_id, 'dog_released'), (1, busy_id, 'dog_busy')):
            result = (await self.release(index, request_id=request_id)).json()
            self.assertEqual(result['code'], code)
            self.assertIsNone(result['state']['dog'])
        self.now += 1
        fresh = (await self.release()).json()
        self.assertEqual(fresh['state']['dog']['id'], 2)
        self.assertEqual(fresh['state']['dog']['remaining'], 20)

    async def test_active_dog_resumes_after_restart_and_finishes_without_visitors(self):
        await self.release()
        await self.tick(42)
        await self.restart()
        self.assertAlmostEqual(self.service.model.dog['remaining'], 15.8)
        self.assertEqual(self.service.last_seen, float('-inf'))
        await self.tick(158)
        self.assertIsNone(self.service.model.dog)
        self.assertIsNone(load_meadow(self.path).dog)
        stopped_at = self.service.model.time
        await self.tick(20)
        self.assertEqual(self.service.model.time, stopped_at)

    async def test_requires_player_and_available_seat_and_rejects_extra_fields(self):
        for client in self.clients[:8]:
            await client.get('/api/meadow')
        full = await self.release(8)
        self.assertEqual(full.json()['code'], 'meadow_full')
        self.assertIsNone(self.service.model.dog)
        for token in ('', 'not-a-uuid'):
            response = await self.clients[0].post('/api/meadow/actions',
                headers={'X-Meadow-Player': token}, json={'action': 'dog', 'requestId': str(uuid4())})
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json()['code'], 'player_header_required')
        malformed = await self.release(x=1, y=2)
        self.assertEqual(malformed.status_code, 422)

    async def test_owner_bound_request_ids_and_existing_rate_limit_apply(self):
        request_id = str(uuid4())
        await self.release(request_id=request_id)
        conflict = await self.release(1, request_id=request_id)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()['code'], 'request_id_conflict')
        statuses = [(await self.release()).status_code for _ in range(10)]
        self.assertIn(429, statuses)
        self.assertEqual(self.service.model._next_dog_id, 2)

    async def test_failed_save_rolls_back_release_and_expiry_then_allows_retry(self):
        request_id = str(uuid4())
        with patch('app.meadow_service.save_meadow', side_effect=OSError('test disk unavailable')):
            with self.assertLogs('app.meadow_service', level='ERROR'):
                result = await self.release(request_id=request_id)
        self.assertEqual(result.status_code, 503)
        self.assertIsNone(self.service.model.dog)
        self.assertNotIn(request_id, self.service.receipts)
        self.assertTrue((await self.release(request_id=request_id)).json()['ok'])
        await self.tick(199)
        with patch('app.meadow_service.save_meadow', side_effect=OSError('test disk unavailable')):
            with self.assertLogs('app.meadow_service', level='ERROR'):
                await self.tick(1)
        self.assertIsNotNone(self.service.model.dog)
        self.assertAlmostEqual(self.service.model.dog['remaining'], .1)
        self.now += 5
        await self.tick(1)
        self.assertIsNone(self.service.model.dog)
        self.assertIsNone(load_meadow(self.path).dog)
