"""Flights stay authoritative, survive upgrades and never award a missed rabbit."""
from copy import deepcopy
import json
import tempfile
from pathlib import Path
import unittest

from app.meadow import Meadow, load_meadow, save_meadow
from app.meadow_service import MeadowService, valid_payload
from tests.test_lasso import meadow, OWNER, OTHER, pull_for
from tests.test_meadow import advance


class CastTests(unittest.TestCase):
    def test_rabbit_moves_during_flight_and_a_fixed_aim_can_miss(self):
        world = meadow(4)
        target = world.rabbits[0]
        target.update(_speed=100)
        world._move_toward(target, {'x': 500, 'y': 380})
        world.cast_lasso(1, OWNER, 1, x=250, y=380)
        identity = world.lasso_for(OWNER)
        world.pull_lasso(identity, OWNER)
        advance(world, .4)
        self.assertAlmostEqual(target['x'], 290)
        self.assertEqual(world.lassos[0]['phase'], 'casting')
        self.assertFalse(world.snapshot()['lassos'][0]['pulling'])
        self.assertEqual(world.snapshot()['lassos'][0]['progress'], 0)
        Meadow.from_state(world.export_state())
        advance(world, 1)
        self.assertEqual(world.lassos, [])
        result = world.lasso_results[-1]
        self.assertEqual((result['outcome'], result['x'], result['y']), ('missed', 250, 380))
        self.assertEqual(world.basket, [])
        self.assertEqual(target['state'], 'hopping')
        self.assertEqual(world.pull_lasso(identity, OWNER), 'lasso_gone')
        Meadow.from_state(world.export_state())

    def test_leading_a_hop_hooks_then_automatically_renewed_lease_brings_it_home(self):
        world = meadow(4)
        rabbit = world.rabbits[0]
        rabbit['_speed'] = 80
        world._move_toward(rabbit, {'x': 600, 'y': 380})
        world.cast_lasso(1, OWNER, 1, x=330, y=380)
        identity = world.lasso_for(OWNER)
        for _ in range(10):
            world.pull_lasso(identity, OWNER)
            world.update(.1)
            Meadow.from_state(world.export_state())
        self.assertEqual(world.lassos[0]['phase'], 'reeling')
        self.assertEqual(rabbit['state'], 'roped')
        self.assertGreater(rabbit['x'], 300)
        self.assertEqual(world.basket, [])
        pull_for(world, identity, 4.4)
        self.assertEqual(world.basket, [])
        pull_for(world, identity, .1)
        self.assertEqual(world.basket[0]['id'], 1)
        self.assertEqual(world.lasso_results[-1]['coat'], rabbit['coat'])

    def test_cast_reserves_one_rabbit_and_seat_without_stopping_or_cancelling_its_pair(self):
        world = meadow(4)
        world.rabbits[0]['cooldown'] = world.rabbits[1]['cooldown'] = 0
        world._pair_rabbits()
        before = deepcopy(world.rabbits[0])
        world.cast_lasso(1, OWNER, 1)
        self.assertEqual(world.rabbits[0], before)
        self.assertEqual(world.cast_lasso(1, OTHER, 2), 'rabbit_roped')
        self.assertEqual(world.cast_lasso(2, OWNER, 1), 'player_busy')
        self.assertEqual(world.cast_lasso(2, OTHER, 1), 'seat_busy')
        world.cancel_lasso(world.lasso_for(OWNER), OWNER)
        self.assertEqual(world.rabbits[0], before)
        self.assertEqual(len(world.pairs), 1)
        Meadow.from_state(world.export_state())

    def test_both_predators_can_take_a_target_before_the_loop_lands(self):
        for kind in ('eagle', 'wolf'):
            world = meadow(4)
            rabbit = world.rabbits[0]
            world.cast_lasso(1, OWNER, 1)
            world._start_encounter(kind)
            world.encounter.update(x=rabbit['x'], y=rabbit['y'], targetId=1, phase='chasing', remaining=8)
            world.update(.1)
            self.assertEqual(world.lassos, [])
            self.assertEqual(world.lasso_results[-1]['outcome'], 'stolen')
            self.assertEqual(world.encounter['carrying']['id'], 1)
            self.assertEqual(world.basket, [])
            Meadow.from_state(world.export_state())

    def test_flight_sqlite_restore_and_version_four_upgrade_preserve_the_world(self):
        world = meadow(4)
        world.cast_lasso(1, OWNER, 1)
        advance(world, .4)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'site.sqlite3'
            load_meadow(path)
            save_meadow(path, world)
            restored = load_meadow(path)
        self.assertEqual(restored.export_state(), world.export_state())
        restored.pause_lassos()
        advance(restored, .7)
        self.assertEqual(restored.lassos[0]['phase'], 'reeling')
        self.assertEqual(restored.lassos[0]['_elapsed'], 0)
        world = meadow(4)
        world.start_lasso(1, OWNER, 1)
        legacy = world.export_state()
        legacy['version'] = 4
        legacy.pop('worldId')
        for rope in legacy['lassos']:
            for key in ('phase', 'castX', 'castY', 'castDuration', 'castElapsed'):
                rope.pop(key)
        restored = Meadow.from_state(legacy)
        self.assertEqual(restored.rabbits, world.rabbits)
        self.assertEqual(restored.lassos[0]['phase'], 'reeling')
        self.assertEqual(Meadow.from_state(restored.export_state()).world_id, restored.world_id)

    def test_invalid_cast_fields_and_owner_results_cannot_load(self):
        world = meadow(4)
        world.cast_lasso(1, OWNER, 1)
        for changes in ({'phase':'unknown'}, {'castDuration':100}, {'castElapsed':2},
                        {'castX':825,'castY':135}, {'_elapsed':1}, {'phase':'reeling'}):
            state = world.export_state()
            state['lassos'][0].update(changes)
            with self.assertRaises(ValueError):
                Meadow.from_state(state)
        world.cancel_lasso(world.lasso_for(OWNER), OWNER)
        self.assertNotIn(OWNER, json.dumps(world.snapshot()))
        state = world.export_state()
        state['lassoResults'][0]['_owner'] = 'not-an-owner'
        with self.assertRaises(ValueError):
            Meadow.from_state(state)

    def test_http_aim_requires_both_finite_bounded_coordinates(self):
        base = {'action':'lasso','rabbitId':1,'requestId':'10c29982-0d79-42a5-91ad-7f10e6cb53ee'}
        self.assertTrue(valid_payload(base))
        self.assertTrue(valid_payload({**base,'x':500,'y':300}))
        for fields in ({'x':1}, {'x':True,'y':1}, {'x':float('nan'),'y':1},
                       {'x':1,'y':601}, {'x':1,'y':1,'phase':'reeling'}):
            self.assertFalse(valid_payload({**base,**fields}))


class JournalResultsTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_owner_receives_stable_catch_key_across_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'site.sqlite3'
            load_meadow(path)
            service = MeadowService(path)
            service.model = meadow(4)
            service.model.cast_lasso(1, OWNER, 1)
            identity = service.model.lasso_for(OWNER)
            pull_for(service.model, identity, 5.5)
            save_meadow(path, service.model)
            service._restore_seats()
            service._publish()
            state = await service.state(OWNER)
            result = state['myLassoResults'][0]
            self.assertEqual(result['outcome'], 'caught')
            self.assertEqual(result['coat'], service.model.basket[0]['coat'])
            self.assertEqual((await service.state(OTHER))['myLassoResults'], [])
            self.assertEqual((await service.state())['myLassoResults'], [])
            self.assertNotIn('myLassoResults', service.cached)
            for payload in (state, await service.state(OTHER)):
                self.assertNotIn(OWNER, json.dumps(payload))
            restored = MeadowService(path)
            restored.model = load_meadow(path)
            restored._restore_seats()
            restored._publish()
            self.assertEqual((await restored.state(OWNER))['myLassoResults'][0]['eventKey'], result['eventKey'])
