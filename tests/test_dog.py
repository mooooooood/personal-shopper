"""The shared pet dog scares rabbits without becoming another predator."""
from pathlib import Path
import tempfile
import unittest

from app.meadow import Meadow, load_meadow, save_meadow
from tests.test_lasso import OWNER
from tests.test_meadow import advance


def quiet_world(count=8, seed=12):
    world = Meadow(seed, initial_count=count)
    for rabbit in world.rabbits:
        rabbit.update(cooldown=999, _burrowWait=40, _wait=3)
    world._next_encounter_in = 70
    return world


class DogTests(unittest.TestCase):
    def test_one_dog_runs_for_exactly_twenty_seconds_then_can_be_released_again(self):
        world = quiet_world()
        self.assertEqual(world.release_dog(1), 'dog_released')
        self.assertEqual((world.dog['x'], world.dog['y']), (90, 230))
        self.assertEqual(world.release_dog(5), 'dog_busy')
        self.assertEqual(world.dog['id'], 1)
        advance(world, 19.9)
        self.assertIsNotNone(world.dog)
        self.assertAlmostEqual(world.dog['remaining'], .1)
        world.update(.1)
        self.assertIsNone(world.dog)
        self.assertEqual(world.release_dog(5), 'dog_released')
        self.assertEqual((world.dog['id'], world.dog['direction']), (2, -1))

    def test_nearby_rabbit_runs_away_instead_of_following_a_carrot(self):
        world = quiet_world(count=1)
        rabbit = world.rabbits[0]
        rabbit.update(x=170, y=230)
        world.add_carrot(120, 230)
        world.release_dog(1)
        world.update(.1)
        self.assertGreater(rabbit['x'], 170)
        self.assertTrue(rabbit['moving'])
        self.assertIsNone(rabbit['_carrotId'])
        self.assertGreater(rabbit['_path'][-1]['x'], rabbit['x'])

    def test_rope_basket_and_underground_rabbits_are_undisturbed(self):
        world = quiet_world(count=4)
        roped, basket, hidden, free = world.rabbits[:]
        roped.update(x=180, y=230)
        basket.update(x=170, y=240)
        hidden.update(x=260, y=270)
        free.update(x=250, y=260)
        world.start_lasso(roped['id'], OWNER, 1)
        world.catch(basket['id'])
        world._plan_burrow(hidden)
        world.update(.1)
        world.release_dog(1)
        world.update(.1)
        self.assertEqual((roped['x'], roped['y'], roped['state']), (180, 230, 'roped'))
        self.assertEqual(roped['_path'], [])
        self.assertEqual(basket['state'], 'basket')
        self.assertEqual(hidden['burrow']['phase'], 'entering')
        self.assertFalse(hidden['moving'])
        self.assertEqual(world.total_count, 4)
        self.assertEqual(world.raided_count, 0)
        Meadow.from_state(world.export_state())

    def test_scare_interrupts_a_pair_without_orphaning_either_rabbit(self):
        world = quiet_world(count=2)
        for i, rabbit in enumerate(world.rabbits):
            rabbit.update(x=180 + i * 20, y=230, cooldown=0)
        world._pair_rabbits()
        self.assertEqual(len(world.pairs), 1)
        world.release_dog(1)
        world.update(.1)
        self.assertEqual(world.pairs, [])
        self.assertTrue(all(rabbit['pairId'] is None and rabbit['partnerId'] is None
                            for rabbit in world.rabbits))
        self.assertEqual(world.total_count, 2)
        Meadow.from_state(world.export_state())

    def test_dog_and_fleeing_rabbits_stay_on_land_without_losses(self):
        world = quiet_world(count=8)
        for i, rabbit in enumerate(world.rabbits):
            rabbit.update(**world._safe_point(710 + i * 28, 175 + i * 9))
        identities = {rabbit['id'] for rabbit in world.rabbits}
        world.release_dog(5)
        for _ in range(200):
            world.update(.1)
            if world.dog:
                self.assertTrue(world.is_safe_position(world.dog['x'], world.dog['y']))
            self.assertTrue(all(world.is_safe_position(rabbit['x'], rabbit['y']) for rabbit in world.rabbits))
            Meadow.from_state(world.export_state())
        self.assertEqual({rabbit['id'] for rabbit in world.rabbits}, identities)
        self.assertEqual(world.raided_count, 0)
        self.assertEqual(world.basket, [])

    def test_active_dog_round_trips_sqlite_and_continues_identically(self):
        world = quiet_world()
        world.release_dog(3)
        advance(world, 3.7)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'site.sqlite3'
            load_meadow(path)
            save_meadow(path, world)
            restored = load_meadow(path)
        self.assertEqual(restored.export_state(), world.export_state())
        for _ in range(180):
            world.update(.1)
            restored.update(.1)
            self.assertEqual(restored.export_state(), world.export_state())
        self.assertIsNone(restored.dog)

    def test_a_dog_near_natural_burrow_arrivals_never_leaves_an_orphaned_destination(self):
        world = Meadow(0, initial_count=40)
        advance(world, 10)
        world.release_dog(1)
        for _ in range(200):
            world.update(.1)
            Meadow.from_state(world.export_state())
        self.assertIsNone(world.dog)

    def test_all_legacy_versions_upgrade_without_replacing_rabbits_or_basket(self):
        world = quiet_world()
        world.catch(1)
        for version in range(1, 7):
            with self.subTest(version=version):
                legacy = world.export_state()
                legacy.update(version=version)
                for key in ('dog', 'nextDogId'):
                    legacy.pop(key)
                if version < 6:
                    for rabbit in legacy['rabbits'] + legacy['basket']:
                        for key in ('burrow', 'burrowTrips', '_burrowTarget', '_burrowWait'):
                            rabbit.pop(key)
                if version < 3:
                    for key in ('lassos', 'lassoResults', 'nextLassoId'):
                        legacy.pop(key)
                if version == 1:
                    for key in ('encounter', 'raidedCount', 'nextEncounterId', 'nextEncounterIn'):
                        legacy.pop(key)
                    for rabbit in legacy['rabbits'] + legacy['basket']:
                        rabbit.pop('coat')
                restored = Meadow.from_state(legacy)
                self.assertEqual(restored.world_id, world.world_id)
                self.assertEqual(restored.total_count, 8)
                self.assertEqual(restored.basket[0]['id'], 1)
                self.assertEqual([rabbit['id'] for rabbit in restored.rabbits], list(range(2, 9)))
                self.assertIsNone(restored.dog)
                self.assertEqual(restored._next_dog_id, 1)
                self.assertEqual(restored.export_state()['version'], Meadow.schema_version)

    def test_public_dog_is_a_copy_and_invalid_saved_dogs_are_rejected(self):
        world = quiet_world()
        world.release_dog(1)
        public = world.snapshot()['dog']
        self.assertEqual(set(public), {'id', 'x', 'y', 'direction', 'remaining', 'moving'})
        public['remaining'] = 999
        self.assertEqual(world.dog['remaining'], 20)
        for mutate in (
            lambda dog: dog.update(remaining=21), lambda dog: dog.update(remaining=0),
            lambda dog: dog.update(remaining=float('nan')), lambda dog: dog.update(direction=True),
            lambda dog: dog.update(x=825, y=135), lambda dog: dog.update(id=2),
            lambda dog: dog.update(moving=True), lambda dog: dog.update(_routeIn=-1),
            lambda dog: dog.update(_scareIn=8), lambda dog: dog.update(kind='wolf'),
            lambda dog: dog.update(x=650, y=135, moving=True, _path=[{'x': 960, 'y': 135}]),
        ):
            state = world.export_state()
            mutate(state['dog'])
            with self.assertRaises(ValueError):
                Meadow.from_state(state)
