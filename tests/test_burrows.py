"""Shared underground travel preserves identities, population and old saves."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest

from app.meadow import Meadow, load_meadow, save_meadow
from app.meadow_service import MeadowService
from tests.test_meadow import advance, wait_for
from tests.test_lasso import OWNER


def world_at_hole(seed=7, count=6):
    world = Meadow(seed, initial_count=count)
    for rabbit in world.rabbits:
        rabbit.update(cooldown=999, _burrowWait=40)
    world._next_encounter_in = 70
    rabbit = world.rabbits[0]
    rabbit.update(x=260, y=270)
    assert world._plan_burrow(rabbit)
    world.update(.1)
    assert rabbit['burrow']['phase'] == 'entering'
    return world, rabbit


class BurrowTests(unittest.TestCase):
    def test_enter_hide_emerge_preserves_rabbit_and_population(self):
        world, rabbit = world_at_hole()
        identity, coat, count = rabbit['id'], rabbit['coat'], world.total_count
        destination = world.burrows[rabbit['burrow']['exitId'] - 1]
        self.assertEqual(rabbit['burrowTrips'], 1)
        advance(world, .9)
        self.assertEqual(rabbit['burrow']['phase'], 'underground')
        self.assertEqual((rabbit['x'], rabbit['y']), (260,270))
        advance(world, 2)
        self.assertEqual(rabbit['burrow']['phase'], 'emerging')
        self.assertEqual((rabbit['x'], rabbit['y']), (destination['x'],destination['y']))
        advance(world, .9)
        self.assertIsNone(rabbit['burrow'])
        self.assertEqual((rabbit['id'],rabbit['coat'],world.total_count), (identity,coat,count))
        self.assertEqual(world.born_count, 0)
        self.assertEqual(world.basket, [])
        self.assertGreaterEqual(rabbit['_burrowWait'], 20)
        Meadow.from_state(world.export_state())

    def test_destinations_are_random_and_can_include_the_original_hole(self):
        destinations=set()
        for seed in range(40):
            world,rabbit=world_at_hole(seed)
            destinations.add(rabbit['burrow']['exitId'])
        self.assertEqual(destinations,{1,2,3,4,5})

    def test_free_rabbits_discover_holes_naturally_with_bounded_traffic(self):
        world=Meadow(9,initial_count=12)
        for rabbit in world.rabbits:rabbit.update(cooldown=999)
        world._next_encounter_in=70
        wait_for(world,lambda:any(rabbit['burrow'] for rabbit in world.rabbits),seconds=40)
        for _ in range(400):
            world.update(.1)
            travelling=sum(bool(rabbit['burrow'] or rabbit['_burrowTarget']) for rabbit in world.rabbits)
            self.assertLessEqual(travelling,3)
            Meadow.from_state(world.export_state())

    def test_burrow_rabbits_cannot_be_caught_paired_or_taken_by_either_predator(self):
        for kind in ('eagle','wolf'):
            world,rabbit=world_at_hole()
            rabbit['cooldown']=0
            self.assertEqual(world.cast_lasso(rabbit['id'],OWNER,1),'rabbit_hidden')
            self.assertIsNone(world.catch(rabbit['id']))
            world._pair_rabbits()
            self.assertIsNone(rabbit['pairId'])
            world._start_encounter(kind)
            world.encounter.update(targetId=rabbit['id'],phase='chasing',remaining=8,x=rabbit['x'],y=rabbit['y'])
            world.update(.1)
            self.assertEqual(world.encounter['phase'],'leaving')
            self.assertIsNone(world.encounter['carrying'])
            self.assertEqual(world.raided_count,0)
            Meadow.from_state(world.export_state())

    def test_casting_interrupts_the_walk_to_a_hole_and_roped_rabbits_stay_above_ground(self):
        world=Meadow(2,initial_count=3)
        rabbit=world.rabbits[0]
        rabbit.update(x=250,y=270,cooldown=999)
        world._next_encounter_in=70
        world._plan_burrow(rabbit)
        self.assertEqual(world.cast_lasso(rabbit['id'],OWNER,1,x=260,y=270),'lassoed')
        self.assertIsNone(rabbit['_burrowTarget'])
        self.assertFalse(world._plan_burrow(rabbit))
        advance(world,1.2)
        self.assertEqual(rabbit['state'],'roped')
        self.assertIsNone(rabbit['burrow'])
        rabbit['_burrowWait']=0
        advance(world,10)
        self.assertEqual(rabbit['state'],'roped')
        Meadow.from_state(world.export_state())

    def test_predator_leaves_if_only_two_surface_rabbits_remain_during_a_hunt(self):
        for kind in ('eagle', 'wolf'):
            world=Meadow(7,initial_count=3)
            for rabbit in world.rabbits:rabbit.update(cooldown=999)
            world._start_encounter(kind)
            target=next(r for r in world.rabbits if r['id']==world.encounter['targetId'])
            traveller=next(r for r in world.rabbits if r is not target)
            traveller.update(x=260,y=270)
            world._plan_burrow(traveller)
            world.encounter.update(phase='chasing',remaining=8,x=target['x'],y=target['y'])
            world.update(.1)
            self.assertIsNotNone(traveller['burrow'])
            self.assertEqual(world.encounter['phase'],'leaving')
            self.assertEqual(world.raided_count,0)
            self.assertEqual(len(world.rabbits),3)

    def test_every_phase_round_trips_sqlite_and_resumes_same_exit_and_future(self):
        for seconds in (0,1,3):
            world,rabbit=world_at_hole()
            advance(world,seconds)
            with tempfile.TemporaryDirectory() as directory:
                path=Path(directory)/'site.sqlite3'
                load_meadow(path);save_meadow(path,world)
                restored=load_meadow(path)
            self.assertEqual(restored.export_state(),world.export_state())
            for _ in range(50):
                world.update(.1);restored.update(.1)
                self.assertEqual(restored.export_state(),world.export_state())

    def test_v5_upgrade_keeps_existing_ropes_coats_and_basket(self):
        world=Meadow(2,initial_count=6)
        world.catch(1)
        world.start_lasso(2,OWNER,1)
        legacy=world.export_state();legacy['version']=5
        for rabbit in legacy['rabbits']+legacy['basket']:
            for key in ('burrow','burrowTrips','_burrowWait','_burrowTarget'):rabbit.pop(key)
        restored=Meadow.from_state(json.loads(json.dumps(legacy)))
        self.assertEqual(restored.world_id,world.world_id)
        self.assertEqual(restored.total_count,6)
        self.assertEqual(restored.basket[0]['id'],1)
        self.assertEqual(restored.lassos,world.lassos)
        self.assertTrue(all(rabbit['burrow'] is None for rabbit in restored.rabbits+restored.basket))

    def test_malformed_or_orphaned_travel_never_loads_or_overwrites_a_save(self):
        world,rabbit=world_at_hole()
        for mutate in (
            lambda r:r['burrow'].update(exitId=9),lambda r:r['burrow'].update(entryId=True),
            lambda r:r['burrow'].update(phase='unknown'),lambda r:r['burrow'].update(remaining=50),
            lambda r:r.update(x=500),lambda r:r.update(burrow=None),lambda r:r.update(state='idle'),
            lambda r:r.update(burrowTrips=-1),lambda r:r.update(_burrowTarget=1),
        ):
            state=world.export_state();mutate(state['rabbits'][0])
            with self.assertRaises(ValueError):Meadow.from_state(state)
        snapshot=world.snapshot();snapshot['burrows'][0]['x']=0
        self.assertEqual(world.burrows[0]['x'],260)
        # Public nested data must never permit a reader to mutate the world.
        snapshot['rabbits'][0]['burrow']['remaining']=999
        self.assertNotEqual(world.rabbits[0]['burrow']['remaining'],999)


class BurrowApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_visitors_share_journey_and_private_fields_are_not_exposed(self):
        service=MeadowService(Path('/unused-in-memory-test.sqlite3'))
        service.model,rabbit=world_at_hole()
        service._publish()
        first=await service.state(OWNER)
        second=await service.state('b'*64)
        self.assertEqual(first['rabbits'],second['rabbits'])
        self.assertEqual(first['burrows'],second['burrows'])
        self.assertNotIn('_burrow',json.dumps(first))
        await service._tick(.1,service.last_seen)
        self.assertGreater((await service.state())['rabbits'][0]['burrow']['remaining'],0)
