"""Deterministic harmless surprises share the existing persisted meadow clock."""
import asyncio
from contextlib import suppress
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from app.meadow import Meadow, load_meadow, save_meadow
from app.meadow_service import MeadowService
from tests.test_lasso import OWNER
from tests.test_meadow import advance


def quiet_world(count=12, seed=10):
    world = Meadow(seed, initial_count=count)
    for rabbit in world.rabbits:
        rabbit.update(cooldown=999, _burrowWait=40, _wait=3)
    world._next_encounter_in = 70
    world._next_surprise_in = 65
    return world


class SurpriseTests(unittest.TestCase):
    def test_shuffle_bag_shows_all_ten_once_and_never_overlaps_wildlife(self):
        world = quiet_world()
        kinds = []
        for _ in range(20):
            self.assertTrue(world._start_surprise())
            kinds.append(world.surprise['kind'])
            self.assertFalse(world._start_surprise())
            self.assertFalse(world._start_encounter('wolf'))
            world._advance_surprise(24)
        self.assertEqual(set(kinds[:10]), set(world.surprise_kinds))
        self.assertEqual(set(kinds[10:]), set(world.surprise_kinds))
        self.assertTrue(world._start_encounter('eagle'))
        self.assertFalse(world._start_surprise('rain'))

    def test_scheduling_waits_for_wildlife_and_event_lasts_exactly_24_seconds(self):
        world = quiet_world()
        world._next_surprise_in = .1
        world._start_encounter('wolf')
        world._advance_surprise(.1)
        self.assertIsNone(world.surprise)
        self.assertEqual(world._next_surprise_in, .1)
        world.encounter = None
        world.update(.1)
        self.assertIsNotNone(world.surprise)
        advance(world, 23.9)
        self.assertIsNotNone(world.surprise)
        world.update(.1)
        self.assertIsNone(world.surprise)
        self.assertTrue(35 <= world._next_surprise_in <= 65)
        self.assertGreaterEqual(world._next_encounter_in, 11.9)

    def test_public_copy_has_no_internal_fields_and_same_world_is_deterministic(self):
        world = quiet_world()
        world._start_surprise('ufo')
        public = world.snapshot()['surprise']
        self.assertEqual(set(public), {'id', 'kind', 'seed', 'x', 'y', 'elapsed', 'duration', 'rabbitIds', 'carrotIds'})
        public['rabbitIds'].clear()
        self.assertEqual(len(world.surprise['rabbitIds']), 1)
        restored = Meadow.from_state(world.export_state())
        for _ in range(250):
            world.update(.1)
            restored.update(.1)
            self.assertEqual(restored.export_state(), world.export_state())

    def test_all_event_types_keep_safe_routes_and_survive_each_checkpoint(self):
        for kind in Meadow.surprise_kinds:
            with self.subTest(kind=kind):
                world = quiet_world(count=20)
                world._start_surprise(kind)
                ids = {rabbit['id'] for rabbit in world.rabbits}
                for _ in range(240):
                    world.update(.1)
                    self.assertTrue(all(world.is_safe_position(rabbit['x'], rabbit['y']) for rabbit in world.rabbits))
                    Meadow.from_state(world.export_state())
                self.assertIsNone(world.surprise)
                self.assertEqual(ids, {rabbit['id'] for rabbit in world.rabbits})
                self.assertEqual(world.raided_count, 0)

    def test_participants_that_hop_into_dog_range_are_released_before_checkpoint(self):
        world = Meadow(8, initial_count=30)
        for step in range(600):
            if step % 250 == 0:
                world.release_dog(1)
            world.update(.1)
            Meadow.from_state(world.export_state())

    def test_real_carrot_rain_respects_capacity_and_never_replays_a_milestone(self):
        world = quiet_world(count=0)
        for i in range(5):
            world.add_carrot(100 + i * 20, 100)
        world._start_surprise('carrot_rain')
        advance(world, 4)
        self.assertEqual(len(world.carrots), 6)
        self.assertEqual(len(world.surprise['carrotIds']), 1)
        carrot_id = world.surprise['carrotIds'][0]
        self.assertEqual((world.carrots[-1]['x'], world.carrots[-1]['y']), (360, 250))
        restored = Meadow.from_state(world.export_state())
        advance(restored, 7)
        self.assertEqual(restored.surprise['carrotIds'], [carrot_id])
        self.assertEqual(len(restored.carrots), 6)

    def test_carrot_rain_creates_three_and_parade_leaves_one_real_gift(self):
        for kind, seconds, count in (('carrot_rain', 10, 3), ('king', 20, 1)):
            with self.subTest(kind=kind):
                world = quiet_world(count=0)
                world._start_surprise(kind)
                advance(world, seconds)
                self.assertEqual(len(world.carrots), count)
                self.assertEqual(len(world.surprise['carrotIds']), count)

    def test_cast_catch_and_dog_release_participants_immediately(self):
        for action in ('cast', 'catch', 'dog'):
            with self.subTest(action=action):
                world = quiet_world(count=1)
                rabbit = world.rabbits[0]
                rabbit.update(x=170, y=230)
                world._start_surprise('ufo')
                self.assertEqual(world.surprise['rabbitIds'], [rabbit['id']])
                if action == 'cast':
                    world.cast_lasso(rabbit['id'], OWNER, 1)
                elif action == 'catch':
                    world.catch(rabbit['id'])
                else:
                    world.release_dog(1)
                self.assertEqual(world.surprise['rabbitIds'], [])
                Meadow.from_state(world.export_state())

    def test_pair_burrow_basket_and_reserved_rabbits_are_never_selected(self):
        world = quiet_world(count=7)
        paired = world.rabbits[:2]
        for rabbit in paired:
            rabbit.update(cooldown=0)
        world._pair_rabbits()
        world.catch(3)
        world._plan_burrow(world.rabbits[2])
        world.cast_lasso(5, OWNER, 1)
        world._start_surprise('king')
        self.assertEqual(set(world.surprise['rabbitIds']), {6, 7})
        for rabbit in world.rabbits[-2:]:
            rabbit.update(cooldown=0, _burrowWait=0)
        world._pair_rabbits()
        self.assertEqual(len(world.pairs), 1)
        self.assertFalse(world._plan_burrow(world.rabbits[-1]))

    def test_train_parade_and_flee_change_real_ground_positions(self):
        for kind in ('train', 'king'):
            world = quiet_world(count=1)
            rabbit = world.rabbits[0]
            rabbit.update(x=150, y=530 if kind == 'train' else 400)
            world._start_surprise(kind)
            advance(world, 18)
            self.assertGreater(rabbit['x'], 600)
        world = quiet_world(count=1)
        rabbit = world.rabbits[0]
        rabbit.update(x=530, y=280)
        world._start_surprise('hero')
        world.surprise['elapsed'] = 2.9
        world.update(.1)
        self.assertGreater(rabbit['x'], 530)

    def test_train_passengers_follow_carriage_centers_and_mushrooms_stay_fixed(self):
        world = quiet_world(count=3)
        for i, rabbit in enumerate(world.rabbits):
            rabbit.update(x=100 + i * 20, y=530)
        world._start_surprise('train')
        advance(world, 16)
        for i, identity in enumerate(world.surprise['rabbitIds']):
            rabbit = next(item for item in world.rabbits if item['id'] == identity)
            self.assertAlmostEqual(rabbit['x'], 150 + 700 * .8 - 80 - 62 * i, delta=8)
            self.assertEqual(rabbit['y'], 530)
        world = quiet_world(count=3)
        world._start_surprise('mushrooms')
        advance(world, 12)
        for i, identity in enumerate(world.surprise['rabbitIds']):
            rabbit = next(item for item in world.rabbits if item['id'] == identity)
            self.assertEqual((rabbit['x'], rabbit['y']), world.surprise_mushrooms[i])

    def test_hold_releases_without_teleport_and_game_can_still_catch(self):
        world = quiet_world(count=1)
        world._start_surprise('ufo')
        advance(world, 5.1)
        rabbit = world.rabbits[0]
        before = rabbit['x'], rabbit['y']
        advance(world, 5)
        self.assertEqual((rabbit['x'], rabbit['y']), before)
        self.assertEqual(world.start_lasso(rabbit['id'], OWNER, 1), 'lassoed')
        self.assertEqual(world.surprise['rabbitIds'], [])
        world.catch(rabbit['id'])
        self.assertEqual(world.basket[0]['id'], rabbit['id'])

    def test_schema7_upgrade_preserves_identity_database_and_random_stream(self):
        world = quiet_world()
        world.catch(1)
        legacy = world.export_state()
        legacy['version'] = 7
        for key in ('surprise', 'nextSurpriseId', 'nextSurpriseIn', 'surpriseQueue'):
            legacy.pop(key)
        restored = Meadow.from_state(legacy)
        for key in legacy:
            if key != 'version':
                self.assertEqual(restored.export_state()[key], legacy[key])
        self.assertIsNone(restored.surprise)
        self.assertEqual(restored.export_state()['version'], 8)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'site.sqlite3'
            load_meadow(path)
            restored._start_surprise('king')
            advance(restored, 9)
            save_meadow(path, restored)
            self.assertEqual(load_meadow(path).export_state(), restored.export_state())

    def test_invalid_surprise_fields_and_cross_references_fail_closed(self):
        world = quiet_world()
        world._start_surprise('ufo')
        bad_values = (
            ('kind', 'unknown'), ('elapsed', 24), ('elapsed', float('nan')), ('duration', 25),
            ('seed', -1), ('seed', True), ('id', 99), ('x', 825), ('rabbitIds', [999]),
            ('rabbitIds', [1, 1]), ('rabbitIds', [True]), ('carrotIds', [1]), ('_routeIn', 1),
            ('_milestone', 1),
        )
        for key, value in bad_values:
            with self.subTest(key=key, value=value):
                state = world.export_state()
                state['surprise'][key] = value
                if key == 'x':
                    state['surprise']['y'] = 135
                with self.assertRaises(ValueError):
                    Meadow.from_state(state)
        for key, value in (('surpriseQueue', ['rain', 'rain']), ('surpriseQueue', ['unknown']),
                           ('nextSurpriseIn', -1), ('nextSurpriseId', 1)):
            state = world.export_state()
            state[key] = value
            with self.assertRaises(ValueError):
                Meadow.from_state(state)


class SurpriseServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / 'meadow.sqlite3'
        self.now = 100.0
        self.clock = patch('app.meadow_service.time', SimpleNamespace(monotonic=lambda: self.now))
        self.clock.start()
        self.service = MeadowService(self.path)
        await self.service.start()
        self.service.task.cancel()
        with suppress(asyncio.CancelledError):
            await self.service.task
        self.service.task = None
        self.service.model = quiet_world()
        self.service.last_seen = self.now
        self.service._publish()

    async def asyncTearDown(self):
        await self.service.close()
        self.clock.stop()
        self.directory.cleanup()

    async def tick(self, count=1):
        for _ in range(count):
            self.now += .1
            await self.service._tick(.1, self.now)

    async def test_start_and_end_are_durable_before_visitors_see_them(self):
        self.service.model._next_surprise_in = .1
        await self.tick()
        persisted = load_meadow(self.path)
        self.assertEqual(persisted.surprise, self.service.model.surprise)
        first = await self.service.state('a' * 64)
        second = await self.service.state('b' * 64)
        self.assertNotEqual(first['mySeatId'], second['mySeatId'])
        self.assertEqual(first['surprise'], second['surprise'])
        self.service.last_seen = float('-inf')
        await self.tick(240)
        self.assertIsNone(self.service.model.surprise)
        self.assertIsNone(load_meadow(self.path).surprise)
        stopped = self.service.model.time
        await self.tick(10)
        self.assertEqual(self.service.model.time, stopped)

    async def test_start_save_failure_rolls_back_world_queue_and_unpublished_event(self):
        self.service.model._next_surprise_in = .1
        before = self.service.model.export_state()
        revision = self.service.revision
        with patch.object(self.service, '_save', AsyncMock(side_effect=OSError('disk full'))):
            with self.assertLogs('app.meadow_service', level='ERROR'):
                await self.tick()
        self.assertEqual(self.service.model.export_state(), before)
        self.assertIsNone((await self.service.state())['surprise'])
        self.assertEqual(self.service.revision, revision)

    async def test_end_save_failure_keeps_previous_shared_event_until_retry(self):
        self.service.model._start_surprise('rain')
        self.service.model.surprise['elapsed'] = 23.9
        self.service._publish()
        before = self.service.model.export_state()
        with patch.object(self.service, '_save', AsyncMock(side_effect=OSError('disk full'))):
            with self.assertLogs('app.meadow_service', level='ERROR'):
                await self.tick()
        self.assertEqual(self.service.model.export_state(), before)
        self.assertIsNotNone((await self.service.state())['surprise'])
        self.now += 5
        await self.tick()
        self.assertIsNone(self.service.model.surprise)
        self.assertIsNone(load_meadow(self.path).surprise)

    async def test_gift_checkpoint_rolls_back_before_new_carrot_is_published(self):
        self.service.model._start_surprise('king')
        self.service.model.surprise['elapsed'] = 19.9
        self.service._publish()
        before = self.service.model.export_state()
        with patch.object(self.service, '_save', AsyncMock(side_effect=OSError('disk full'))):
            with self.assertLogs('app.meadow_service', level='ERROR'):
                await self.tick()
        self.assertEqual(self.service.model.export_state(), before)
        self.assertEqual((await self.service.state())['carrots'], [])


if __name__ == '__main__':
    unittest.main()
