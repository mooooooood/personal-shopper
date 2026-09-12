"""Eight independent lasso destinations in the same server-owned meadow."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest

from app.meadow import Meadow, load_meadow, save_meadow


def owner(seat_id):
    return f'{seat_id:064x}'


def meadow(count=12):
    world = Meadow(seed=83, initial_count=count)
    for index, rabbit in enumerate(world.rabbits):
        rabbit.update(x=480 + index * 5, y=320, cooldown=999, _speed=0)
    world._next_encounter_in = 70
    return world


def pull_everyone(world, ticks=1):
    for _ in range(ticks):
        for lasso in list(world.lassos):
            world.pull_lasso(lasso['id'], lasso['_owner'])
        world.update(.1)
        Meadow.from_state(world.export_state())


class SeatLassoTests(unittest.TestCase):
    def test_eight_visitors_pull_to_their_own_destination_on_one_clock(self):
        world = meadow()
        rabbit_ids = [rabbit['id'] for rabbit in world.rabbits[:8]]
        for seat_id, rabbit_id in enumerate(rabbit_ids, 1):
            self.assertEqual(world.start_lasso(rabbit_id, owner(seat_id), seat_id), 'lassoed')
        self.assertEqual(len(world.lassos), 8)
        for rope, anchor in zip(world.snapshot()['lassos'], Meadow.seat_anchors):
            self.assertEqual(rope['seatId'], anchor['seatId'])
            self.assertEqual((rope['anchorX'], rope['anchorY']), (anchor['x'], anchor['y']))
            self.assertNotIn('_owner', rope)
        pull_everyone(world, 10)
        self.assertEqual(len(world.rabbits), 12)
        self.assertTrue(all(rope['progress'] > 0 for rope in world.snapshot()['lassos']))
        for _ in range(100):
            pull_everyone(world)
            if not world.lassos:
                break
        self.assertEqual(world.total_count, 12)
        self.assertEqual(len(world.basket), 8)
        self.assertEqual(len(world.rabbits), 4)
        self.assertEqual(len(world.lasso_results), 8)
        for rabbit_id, anchor in zip(rabbit_ids, Meadow.seat_anchors):
            rabbit = next(rabbit for rabbit in world.basket if rabbit['id'] == rabbit_id)
            result = next(result for result in world.lasso_results if result['rabbitId'] == rabbit_id)
            self.assertEqual((rabbit['x'], rabbit['y']), (anchor['x'], anchor['y']))
            self.assertEqual(result['seatId'], anchor['seatId'])
            self.assertEqual(result['outcome'], 'caught')
            self.assertEqual((result['anchorX'], result['anchorY']), (anchor['x'], anchor['y']))

    def test_rabbit_owner_and_seat_are_reserved_without_affecting_other_seats(self):
        world = meadow()
        self.assertEqual(world.start_lasso(1, owner(1), 1), 'lassoed')
        before = world.export_state()
        self.assertEqual(world.start_lasso(1, owner(2), 2), 'rabbit_roped')
        self.assertEqual(world.start_lasso(2, owner(2), 1), 'seat_busy')
        self.assertEqual(world.start_lasso(2, owner(1), 2), 'player_busy')
        self.assertEqual(world.export_state(), before)
        self.assertEqual(world.start_lasso(2, owner(2), 2), 'lassoed')
        self.assertEqual(world.cancel_lasso(world.lasso_for(owner(1)), owner(1)), 'lasso_cancelled')
        self.assertEqual(world.start_lasso(3, owner(3), 1), 'lassoed')
        self.assertEqual({rope['seatId'] for rope in world.lassos}, {1, 2})
        Meadow.from_state(world.export_state())

    def test_bad_seat_ids_cannot_supply_coordinates_or_mutate_world(self):
        world = meadow()
        before = world.export_state()
        for seat_id in (False, True, 0, -1, 9, 1.0, '1', {'x': 500, 'y': 380}):
            with self.subTest(seat_id=seat_id):
                with self.assertRaisesRegex(ValueError, 'invalid lasso seat'):
                    world.start_lasso(1, owner(1), seat_id)
                self.assertEqual(world.export_state(), before)

    def test_every_seat_routes_around_water_without_jumps(self):
        for anchor in Meadow.seat_anchors:
            with self.subTest(seat_id=anchor['seatId']):
                world = meadow()
                rabbit = world.rabbits[0]
                rabbit.update(x=960, y=100)
                world.start_lasso(rabbit['id'], owner(1), anchor['seatId'])
                if anchor['seatId'] <= 4:
                    self.assertGreater(len(world.lassos[0]['_path']), 1)
                for _ in range(180):
                    previous = {'x': rabbit['x'], 'y': rabbit['y']}
                    pull_everyone(world)
                    self.assertTrue(world.is_safe_position(rabbit['x'], rabbit['y']))
                    self.assertLessEqual(world._distance(previous, rabbit), 7.500001)
                    if not world.lassos:
                        break
                self.assertEqual([rabbit['id'] for rabbit in world.basket], [1])
                self.assertEqual((rabbit['x'], rabbit['y']), (anchor['x'], anchor['y']))

    def test_stolen_result_identifies_victim_seat_without_cancelling_other_pulls(self):
        for kind in ('eagle', 'wolf'):
            with self.subTest(kind=kind):
                world = meadow()
                world.start_lasso(1, owner(1), 1)
                world.start_lasso(2, owner(8), 8)
                pull_everyone(world, 10)
                victim = world.rabbits[0]
                other_progress = world.snapshot()['lassos'][1]['progress']
                world._start_encounter(kind)
                world.encounter.update(targetId=victim['id'], x=victim['x'], y=victim['y'],
                                       phase='chasing', remaining=8)
                pull_everyone(world)
                self.assertEqual(len(world.lassos), 1)
                self.assertEqual(world.lassos[0]['seatId'], 8)
                self.assertGreater(world.snapshot()['lassos'][0]['progress'], other_progress)
                self.assertEqual(world.lasso_results[-1]['seatId'], 1)
                self.assertEqual(world.lasso_results[-1]['outcome'], 'stolen')
                self.assertEqual((world.lasso_results[-1]['anchorX'], world.lasso_results[-1]['anchorY']), (90, 230))
                self.assertEqual(world.encounter['carrying']['id'], victim['id'])
                self.assertEqual(world.raided_count, 1)
                for _ in range(100):
                    pull_everyone(world)
                    if not world.lassos:
                        break
                self.assertEqual([rabbit['id'] for rabbit in world.basket], [2])
                self.assertEqual(world.lasso_results[-1]['seatId'], 8)
                self.assertEqual(world.lasso_results[-1]['outcome'], 'caught')


class SeatPersistenceTests(unittest.TestCase):
    def test_sqlite_and_json_keep_independent_routes_and_random_future(self):
        world = meadow()
        for seat_id in range(1, 9):
            world.start_lasso(seat_id, owner(seat_id), seat_id)
        pull_everyone(world, 14)
        world.cancel_lasso(world.lasso_for(owner(3)), owner(3))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'seats.sqlite3'
            load_meadow(path)
            save_meadow(path, world)
            restored = load_meadow(path)
        self.assertEqual(restored.export_state(), world.export_state())
        self.assertEqual(Meadow.from_state(json.loads(json.dumps(world.export_state()))).export_state(), world.export_state())
        for _ in range(100):
            pull_everyone(world)
            pull_everyone(restored)
            self.assertEqual(restored.export_state(), world.export_state())

    def test_v3_legacy_rope_and_results_keep_original_anchor_and_route(self):
        world = meadow()
        world.start_lasso(1, owner(1))
        world.cancel_lasso(world.lasso_for(owner(1)), owner(1))
        world.start_lasso(2, owner(2))
        pull_everyone(world, 13)
        expected = world.export_state()
        legacy = deepcopy(expected)
        legacy['version'] = 3
        for lasso in legacy['lassos']:
            lasso.pop('seatId')
        for result in legacy['lassoResults']:
            for key in ('seatId', 'anchorX', 'anchorY'):
                result.pop(key)
        restored = Meadow.from_state(legacy)
        self.assertEqual(restored.export_state(), expected)
        self.assertEqual(restored.snapshot()['lassos'][0]['seatId'], None)
        self.assertEqual((restored.lassos[0]['anchorX'], restored.lassos[0]['anchorY']), (500, 380))
        for _ in range(40):
            pull_everyone(restored)
            pull_everyone(world)
            self.assertEqual(restored.export_state(), world.export_state())
        self.assertEqual((restored.basket[0]['x'], restored.basket[0]['y']), (500, 380))

    def test_v4_rejects_missing_mismatched_or_duplicate_seats(self):
        world = meadow()
        world.start_lasso(1, owner(1), 1)
        world.start_lasso(2, owner(2), 2)
        world.start_lasso(3, owner(3), 3)
        world.cancel_lasso(world.lasso_for(owner(3)), owner(3))
        for change in (
            lambda s: s['lassos'][0].pop('seatId'),
            lambda s: s['lassos'][0].update(seatId=True),
            lambda s: s['lassos'][0].update(seatId=9),
            lambda s: s['lassos'][0].update(seatId=None),
            lambda s: s['lassos'][0].update(anchorX=910),
            lambda s: s['lassos'][0]['_path'][-1].update(x=500, y=380),
            lambda s: s['lassos'][1].update(seatId=1, anchorX=90, anchorY=230),
            lambda s: s['lassoResults'][0].pop('seatId'),
            lambda s: s['lassoResults'][0].pop('anchorX'),
            lambda s: s['lassoResults'][0].update(seatId=False),
            lambda s: s['lassoResults'][0].update(seatId=8),
            lambda s: s['lassoResults'][0].update(anchorY=425),
        ):
            state = world.export_state()
            change(state)
            with self.assertRaisesRegex(ValueError, 'Invalid persisted meadow state'):
                Meadow.from_state(state)
        # An internally coherent second rope still cannot occupy the same seat.
        duplicate = world.export_state()
        duplicate['lassos'][1].update(seatId=1, anchorX=90, anchorY=230)
        rope = duplicate['lassos'][1]
        rabbit = duplicate['rabbits'][1]
        rope['_path'] = [{'x': 90, 'y': 230}]
        rope['_length'] = world._distance(rabbit, rope['_path'][0])
        rope['_duration'] = max(4.5, rope['_length'] / 75)
        with self.assertRaisesRegex(ValueError, 'duplicate lasso seat'):
            Meadow.from_state(duplicate)


if __name__ == '__main__':
    unittest.main()
