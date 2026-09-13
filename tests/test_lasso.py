"""Server-clock lasso pulls, shared ownership, wildlife races and save upgrades."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest

from app.meadow import Meadow, load_meadow, save_meadow
from tests.test_meadow import advance

OWNER = 'a' * 64
OTHER = 'b' * 64


def meadow(count=2):
    world = Meadow(seed=17, initial_count=count)
    for index, rabbit in enumerate(world.rabbits):
        rabbit.update(x=250 + index * 25, y=380, cooldown=999, _speed=0)
    world._next_encounter_in = 70
    return world


def pull_for(world, identity, seconds, owner=OWNER):
    for _ in range(round(seconds * 10)):
        world.pull_lasso(identity, owner)
        world.update(.1)
        Meadow.from_state(world.export_state())


class LassoTests(unittest.TestCase):
    def test_rope_reserves_rabbit_but_only_server_clock_can_complete_pull(self):
        world = meadow()
        rabbit = world.rabbits[0]
        rabbit.update(x=500, y=379)
        self.assertEqual(world.start_lasso(rabbit['id'], OWNER), 'lassoed')
        identity = world.lasso_for(OWNER)
        self.assertEqual(rabbit['state'], 'roped')
        self.assertEqual(len(world.basket), 0)
        advance(world, 2)
        self.assertEqual((rabbit['x'], rabbit['y']), (500, 379))
        for _ in range(200):
            self.assertEqual(world.pull_lasso(identity, OWNER), 'pulling')
        self.assertEqual(world.snapshot()['lassos'][0]['progress'], 0)
        pull_for(world, identity, 4.4)
        self.assertEqual(world.basket, [])
        pull_for(world, identity, .1)
        self.assertEqual([item['id'] for item in world.basket], [rabbit['id']])
        self.assertEqual((rabbit['x'], rabbit['y']), (500, 380))
        self.assertEqual(world.lassos, [])
        self.assertEqual(world.lasso_results[-1]['outcome'], 'caught')
        self.assertEqual(world.pull_lasso(identity, OWNER), 'lasso_gone')
        self.assertEqual(world.stop_lasso(identity, OWNER), 'lasso_gone')
        self.assertEqual(world.cancel_lasso(identity, OWNER), 'lasso_gone')

    def test_one_heartbeat_has_a_lease_and_stopping_preserves_progress(self):
        world = meadow()
        rabbit = world.rabbits[0]
        rabbit.update(x=50, y=380)
        world.start_lasso(rabbit['id'], OWNER)
        identity = world.lasso_for(OWNER)
        world.pull_lasso(identity, OWNER)
        advance(world, 2)
        self.assertAlmostEqual(rabbit['x'], 140)
        self.assertAlmostEqual(world.snapshot()['lassos'][0]['progress'], .2)
        self.assertFalse(world.snapshot()['lassos'][0]['pulling'])
        self.assertFalse(rabbit['moving'])
        pull_for(world, identity, .5)
        self.assertEqual(world.stop_lasso(identity, OWNER), 'pull_stopped')
        progress = world.snapshot()['lassos'][0]['progress']
        point = rabbit['x'], rabbit['y']
        advance(world, 3)
        self.assertEqual((rabbit['x'], rabbit['y']), point)
        self.assertEqual(world.snapshot()['lassos'][0]['progress'], progress)
        pull_for(world, identity, 4.3)
        self.assertEqual(len(world.basket), 1)

    def test_owners_cannot_steal_control_or_reserve_same_rabbit(self):
        world = meadow(count=10)
        self.assertEqual(world.start_lasso(999, OWNER), 'rabbit_gone')
        self.assertEqual(world.start_lasso(True, OWNER), 'rabbit_gone')
        world.start_lasso(1, OWNER)
        identity = world.lasso_for(OWNER)
        self.assertEqual(world.start_lasso(2, OWNER), 'player_busy')
        self.assertEqual(world.start_lasso(1, OTHER), 'rabbit_roped')
        before = world.export_state()
        for operation in (world.pull_lasso, world.stop_lasso, world.cancel_lasso):
            self.assertEqual(operation(identity, OTHER), 'not_yours')
        self.assertEqual(world.export_state(), before)
        for index in range(2, 9):
            self.assertEqual(world.start_lasso(index, f'{index:064x}'), 'lassoed')
        self.assertEqual(world.start_lasso(9, OTHER), 'lasso_limit')
        self.assertEqual(len(world.lassos), 8)
        Meadow.from_state(world.export_state())
        with self.assertRaises(ValueError):
            world.start_lasso(10, 'not-a-player-digest')

    def test_roping_interrupts_pair_but_rabbit_still_grows_and_ignores_carrots(self):
        world = meadow()
        first, second = world.rabbits
        first['cooldown'] = second['cooldown'] = 0
        world._pair_rabbits()
        self.assertEqual(len(world.pairs), 1)
        world.start_lasso(first['id'], OWNER)
        self.assertEqual(world.pairs, [])
        self.assertIsNone(second['partnerId'])
        first.update(age=29.5, adult=False, cooldown=0)
        point = first['x'], first['y']
        world.add_carrot(450, 400)
        advance(world, 1)
        self.assertTrue(first['adult'])
        self.assertEqual(first['state'], 'roped')
        self.assertEqual((first['x'], first['y']), point)
        self.assertEqual(world.pairs, [])
        Meadow.from_state(world.export_state())

    def test_both_animals_can_take_a_rabbit_during_pull_exactly_once(self):
        for kind in ('eagle', 'wolf'):
            with self.subTest(kind=kind):
                world = meadow(count=6)
                rabbit = world.rabbits[0]
                world.start_lasso(rabbit['id'], OWNER)
                identity = world.lasso_for(OWNER)
                pull_for(world, identity, 1)
                self.assertGreater(world.snapshot()['lassos'][0]['progress'], 0)
                world._start_encounter(kind)
                world.encounter.update(targetId=rabbit['id'], x=rabbit['x'], y=rabbit['y'],
                                       phase='chasing', remaining=8)
                world.update(.1)
                self.assertEqual(world.lassos, [])
                self.assertEqual(world.lasso_results[-1]['outcome'], 'stolen')
                self.assertEqual(world.encounter['carrying']['id'], rabbit['id'])
                self.assertEqual(world.basket, [])
                self.assertEqual(world.raided_count, 1)
                self.assertIsNone(world.catch(rabbit['id']))
                self.assertEqual(world.pull_lasso(identity, OWNER), 'lasso_gone')
                advance(world, 3)
                self.assertEqual(len(world.lasso_results), 1)
                Meadow.from_state(world.export_state())

    def test_basket_is_safe_after_completed_pull_and_last_two_are_protected(self):
        for count in (2, 6):
            world = meadow(count=count)
            rabbit = world.rabbits[0]
            world.start_lasso(rabbit['id'], OWNER)
            identity = world.lasso_for(OWNER)
            if count > 2:
                world._start_encounter('eagle')
                world.encounter.update(targetId=rabbit['id'])
                # Delay warning while pulling; arrival wins before chase begins.
                for _ in range(45):
                    world.encounter['remaining'] = 3
                    world.pull_lasso(identity, OWNER)
                    world.update(.1)
                self.assertEqual(world.encounter['phase'], 'leaving')
                self.assertIsNone(world.encounter['carrying'])
            else:
                self.assertFalse(world._start_encounter('wolf'))
                pull_for(world, identity, 4.5)
            self.assertEqual(world.basket[0]['id'], rabbit['id'])
            self.assertEqual(world.raided_count, 0)
            self.assertEqual(world.lasso_results[-1]['outcome'], 'caught')
            Meadow.from_state(world.export_state())

    def test_cancel_timeout_and_results_are_bounded_without_losing_rabbits(self):
        world = meadow()
        world.start_lasso(1, OWNER)
        identity = world.lasso_for(OWNER)
        self.assertEqual(world.cancel_lasso(identity, OWNER), 'lasso_cancelled')
        self.assertEqual(world.lasso_results[-1]['outcome'], 'cancelled')
        self.assertEqual(world.rabbits[0]['state'], 'idle')
        for _ in range(14):
            world.start_lasso(1, OWNER)
            world.cancel_lasso(world.lasso_for(OWNER), OWNER)
        self.assertEqual(len(world.lasso_results), 12)
        world.start_lasso(1, OWNER)
        advance(world, 24.9)
        self.assertEqual(len(world.lassos), 1)
        world.update(.1)
        self.assertEqual(world.lassos, [])
        self.assertEqual(world.lasso_results[-1]['outcome'], 'escaped')
        self.assertEqual(world.total_count, 2)
        self.assertEqual(world.basket, [])
        self.assertNotEqual(world.rabbits[0]['state'], 'roped')
        advance(world, 8.1)
        self.assertEqual(world.lasso_results, [])
        Meadow.from_state(world.export_state())

    def test_rope_routes_around_pond_at_bounded_speed(self):
        world = meadow()
        rabbit = world.rabbits[0]
        rabbit.update(x=960, y=100)
        world.start_lasso(rabbit['id'], OWNER)
        identity = world.lasso_for(OWNER)
        self.assertGreater(len(world.lassos[0]['_path']), 1)
        for _ in range(120):
            previous = {'x': rabbit['x'], 'y': rabbit['y']}
            world.pull_lasso(identity, OWNER)
            world.update(.1)
            self.assertTrue(world.is_safe_position(rabbit['x'], rabbit['y']))
            self.assertLessEqual(world._distance(previous, rabbit), 7.500001)
            Meadow.from_state(world.export_state())
            if not world.lassos:
                break
        self.assertEqual(world.basket[0]['id'], rabbit['id'])
        self.assertEqual((rabbit['x'], rabbit['y']), (500, 380))


class LassoPersistenceTests(unittest.TestCase):
    def test_json_and_sqlite_restore_owner_route_results_and_random_future(self):
        world = meadow(count=6)
        world.start_lasso(2, OTHER)
        world.cancel_lasso(world.lasso_for(OTHER), OTHER)
        world.start_lasso(1, OWNER)
        identity = world.lasso_for(OWNER)
        pull_for(world, identity, 1)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'site.sqlite3'
            load_meadow(path)
            save_meadow(path, world)
            restored = load_meadow(path)
        self.assertEqual(restored.export_state(), world.export_state())
        self.assertEqual(Meadow.from_state(json.loads(json.dumps(world.export_state()))).export_state(), world.export_state())
        for _ in range(120):
            world.pull_lasso(identity, OWNER)
            restored.pull_lasso(identity, OWNER)
            world.update(.1)
            restored.update(.1)
            self.assertEqual(world.export_state(), restored.export_state())

    def test_startup_pause_keeps_rope_and_progress_but_does_not_resume_it(self):
        world = meadow()
        world.start_lasso(1, OWNER)
        identity = world.lasso_for(OWNER)
        pull_for(world, identity, 1)
        restored = Meadow.from_state(world.export_state())
        restored.pause_lassos()
        progress = restored.snapshot()['lassos'][0]['progress']
        point = restored.rabbits[0]['x'], restored.rabbits[0]['y']
        advance(restored, 2)
        self.assertEqual(restored.lasso_for(OWNER), identity)
        self.assertEqual(restored.snapshot()['lassos'][0]['progress'], progress)
        self.assertEqual((restored.rabbits[0]['x'], restored.rabbits[0]['y']), point)
        self.assertFalse(restored.snapshot()['lassos'][0]['pulling'])
        pull_for(restored, identity, 3.5)
        self.assertEqual(len(restored.basket), 1)

    def test_legacy_v1_v2_preserve_existing_world_and_gain_empty_lassos(self):
        original = meadow(count=6)
        original.catch(1)
        original._start_encounter('wolf')
        original.receipts = [{'requestId': 'legacy', 'signature': 'catch:1', 'ok': True, 'code': 'caught'}]
        for version in (1, 2):
            legacy = original.export_state()
            legacy['version'] = version
            for key in ('lassos', 'lassoResults', 'nextLassoId'):
                legacy.pop(key)
            if version == 1:
                for key in ('encounter', 'raidedCount', 'nextEncounterId', 'nextEncounterIn'):
                    legacy.pop(key)
                for rabbit in legacy['rabbits'] + legacy['basket']:
                    rabbit.pop('coat')
            restored = Meadow.from_state(legacy)
            self.assertEqual(restored.total_count, original.total_count)
            self.assertEqual(restored.receipts, original.receipts)
            self.assertEqual(restored.pairs, original.pairs)
            self.assertEqual(restored.lassos, [])
            self.assertEqual(restored.lasso_results, [])
            self.assertEqual(restored.export_state()['version'], Meadow.schema_version)
            if version == 2:
                self.assertEqual(restored.encounter, original.encounter)
                self.assertEqual(restored.rabbits, original.rabbits)
                self.assertEqual(restored.basket, original.basket)
                self.assertEqual(restored._random.getstate(), original._random.getstate())
            else:
                self.assertTrue(all(rabbit['coat'] == 'white' for rabbit in restored.rabbits + restored.basket))

    def test_private_details_are_hidden_and_corrupt_lasso_graph_is_rejected(self):
        world = meadow()
        world.start_lasso(1, OWNER)
        world.pull_lasso(world.lasso_for(OWNER), OWNER)
        snapshot = world.snapshot()
        self.assertEqual(set(snapshot['lassos'][0]), {'id', 'rabbitId', 'seatId', 'anchorX', 'anchorY', 'remaining', 'progress', 'pulling', 'phase', 'castX', 'castY', 'castDuration', 'castElapsed'})
        self.assertNotIn(OWNER, json.dumps(snapshot))
        snapshot['lassos'][0]['rabbitId'] = 999
        self.assertEqual(world.lassos[0]['rabbitId'], 1)
        for change in (
            lambda s: s['lassos'][0].update(_owner='invalid'),
            lambda s: s['lassos'][0].update(_owner=7),
            lambda s: s['lassos'][0].update(rabbitId=999),
            lambda s: s['lassos'][0].update(_lease=100),
            lambda s: s['lassos'][0].update(_elapsed=1),
            lambda s: s['lassos'][0].update(_duration=1),
            lambda s: s['lassos'][0].update(_length=float('nan')),
            lambda s: s['lassos'][0].update(remaining=-1),
            lambda s: s['lassos'][0].update(anchorX=0),
            lambda s: s['lassos'][0].update(_path=[{'x': 825, 'y': 135}]),
            lambda s: s['lassos'][0].update(_path=[{'x': 450, 'y': 400}]),
            lambda s: s['lassos'][0].update(extra='unknown'),
            lambda s: s['lassos'].append(deepcopy(s['lassos'][0])),
            lambda s: s.update(lassos=[]),
            lambda s: s.update(nextLassoId=1),
            lambda s: s['rabbits'][0].update(state='idle'),
            lambda s: s['rabbits'][0].update(_path=[{'x': 500, 'y': 380}]),
            lambda s: s['rabbits'][1].update(state='roped'),
            lambda s: s.update(lassoResults=[{'id': 1, 'rabbitId': 1, 'outcome': 'caught', 'x': 500, 'y': 380, 'time': 0}]),
        ):
            state = world.export_state()
            change(state)
            with self.assertRaisesRegex(ValueError, 'Invalid persisted meadow state'):
                Meadow.from_state(state)


if __name__ == '__main__':
    unittest.main()
