"""Real HTTP visitors share eight seats without exposing their identities."""
import asyncio
from contextlib import suppress
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI
import httpx

from app.meadow import Meadow, load_meadow, save_meadow
from app.meadow_service import MeadowService, router


class SeatApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.path=Path(self.directory.name)/'meadow.sqlite3'
        self.now=100.0
        self.clock=patch('app.meadow_service.time',SimpleNamespace(monotonic=lambda:self.now))
        self.clock.start()
        self.service=MeadowService(self.path)
        await self.service.start()
        await self.stop_clock(self.service)
        world=self.service.model
        for i,rabbit in enumerate(world.rabbits):
            rabbit.update(x=490+i*2,y=325,cooldown=999,_speed=0)
        world._next_encounter_in=70
        self.service._publish()
        app=FastAPI();app.include_router(router);app.state.meadow=self.service
        self.app=app
        self.tokens=[str(uuid4()) for _ in range(9)]
        self.owners=[hashlib.sha256(token.encode()).hexdigest() for token in self.tokens]
        self.clients=[httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://testserver',
                     headers={'X-Meadow-Player':token,'X-Meadow-Client':'1'}) for token in self.tokens]

    async def asyncTearDown(self):
        for client in self.clients: await client.aclose()
        await self.service.close()
        self.clock.stop();self.directory.cleanup()

    async def stop_clock(self,service):
        service.task.cancel()
        with suppress(asyncio.CancelledError): await service.task
        service.task=None

    async def state(self,index=0):
        response=await self.clients[index].get('/api/meadow')
        self.assertEqual(response.status_code,200)
        return response.json()

    async def action(self,index,action,**fields):
        response=await self.clients[index].post('/api/meadow/actions',json={
            'action':action,'requestId':str(uuid4()),**fields})
        self.assertEqual(response.status_code,200,response.text)
        return response.json()

    async def test_eight_real_clients_share_pulls_on_one_ip_and_ninth_watches(self):
        for i in range(8): self.assertEqual((await self.state(i))['mySeatId'],i+1)
        watching=await self.state(8)
        self.assertIsNone(watching['mySeatId']);self.assertEqual(watching['onlineCount'],8)
        self.assertEqual((await self.action(8,'lasso',rabbitId=12))['code'],'meadow_full')
        # Advance the real limiter clock for normal distinct casts on one IP.
        for i in range(8):
            self.now+=.6
            result=await self.action(i,'lasso',rabbitId=i+1)
            self.assertEqual(result['code'],'lassoed')
            self.assertEqual(result['state']['lassos'][-1]['seatId'],i+1)
        for step in range(100):
            if step%6==0:
                for i in range(8):
                    rope=self.service.model.lasso_for(self.owners[i])
                    if rope is not None:
                        self.assertTrue((await self.action(i,'pull',lassoId=rope))['ok'])
            self.now+=.1
            await self.service._tick(.1,self.now)
            if step==12:
                observer=await self.state(8)
                self.assertEqual(len(observer['lassos']),8)
                self.assertTrue(all(rope['progress']>0 for rope in observer['lassos']))
                self.assertTrue(all(seat['status']=='pulling' for seat in observer['seats']))
                self.assertEqual(len({(rope['anchorX'],rope['anchorY']) for rope in observer['lassos']}),8)
            if not self.service.model.lassos: break
        observer=await self.state(8)
        self.assertEqual(len(observer['basket']),8)
        self.assertEqual(observer['lassos'],[])
        self.assertEqual({result['seatId'] for result in observer['lassoResults']},set(range(1,9)))
        self.assertEqual(len(load_meadow(self.path).basket),8)
        encoded=json.dumps(observer)
        for identity in self.tokens+self.owners: self.assertNotIn(identity,encoded)
        for key in ('owner','lastSeen','_owner'): self.assertNotIn(f'"{key}"',encoded)

    async def test_refresh_same_identity_reuses_seat_without_extra_presence_or_disk_writes(self):
        with patch('app.meadow_service.save_meadow') as save:
            first=await self.state()
            for _ in range(20):
                self.now+=.5
                again=await self.state()
                self.assertEqual(again['mySeatId'],first['mySeatId'])
                self.assertEqual(again['onlineCount'],1)
            save.assert_not_called()
        self.assertEqual(len(self.service.seat_presence),1)
        self.assertEqual(again['revision'],first['revision'])

    async def test_idle_presence_expires_and_a_waiting_visitor_gets_the_empty_seat(self):
        for i in range(8): await self.state(i)
        revision=(await self.state(8))['revision']
        self.now+=19
        for i in range(1,8): await self.state(i)
        self.now+=2
        await self.service._tick(.1,self.now)
        observer=await self.state(8)
        self.assertGreater(observer['revision'],revision)
        self.assertEqual(observer['mySeatId'],1)
        self.assertEqual(observer['onlineCount'],8)
        self.assertEqual(len(self.service.seat_presence),8)
        self.assertIsNone((await self.state(0))['mySeatId'])

    async def test_an_away_rope_reserves_its_seat_and_cannot_be_taken_over(self):
        for i in range(8): await self.state(i)
        roped=await self.action(0,'lasso',rabbitId=1)
        identity=roped['state']['myLassoId']
        self.now+=21
        for i in range(1,8): await self.state(i)
        observer=await self.state(8)
        self.assertIsNone(observer['mySeatId'])
        self.assertEqual(observer['seats'][0]['status'],'away')
        self.assertFalse(observer['seats'][0]['online'])
        self.assertEqual((await self.action(8,'pull',lassoId=identity))['code'],'not_yours')
        self.assertEqual((await self.state(0))['mySeatId'],1)
        await self.action(0,'cancel_lasso',lassoId=identity)
        self.now+=19
        for i in range(1,8): await self.state(i)
        self.now+=2
        self.assertEqual((await self.state(8))['mySeatId'],1)

    async def test_departed_owners_rope_expires_before_seat_is_reassigned(self):
        await self.state(0)
        await self.action(0,'lasso',rabbitId=1)
        for step in range(251):
            self.now+=.1
            if step%10==0: await self.state(1)
            await self.service._tick(.1,self.now)
        self.assertIsNone(self.service.model.lasso_for(self.owners[0]))
        self.assertEqual(self.service.model.lasso_results[-1]['outcome'],'escaped')
        self.assertEqual((await self.state(8))['mySeatId'],1)

    async def test_restart_restores_rope_seats_as_away_and_legacy_anchor_stays_put(self):
        for i in range(2): await self.state(i)
        await self.action(1,'lasso',rabbitId=2)
        await self.action(1,'pull',lassoId=self.service.model.lasso_for(self.owners[1]))
        self.service.model.start_lasso(3,self.owners[2])
        save_meadow(self.path,self.service.model)
        self.service.dirty=False
        await self.service.close()
        self.service=MeadowService(self.path);await self.service.start();await self.stop_clock(self.service)
        self.app.state.meadow=self.service
        self.assertTrue(all(rope['_lease']==0 for rope in self.service.model.lassos))
        self.assertEqual(self.service.cached['onlineCount'],0)
        self.assertEqual(self.service.cached['seats'][1]['status'],'away')
        returned=await self.state(1)
        self.assertEqual(returned['mySeatId'],2)
        self.assertEqual(returned['seats'][1]['status'],'casting')
        legacy=await self.state(2)
        rope=next(rope for rope in legacy['lassos'] if rope['id']==legacy['myLassoId'])
        self.assertIsNone(rope['seatId'])
        self.assertEqual((rope['anchorX'],rope['anchorY']),(500,380))
        self.assertIsNotNone(legacy['mySeatId'])

    async def test_identityless_reads_do_not_fill_seats_and_anchor_cannot_be_chosen_by_client(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app),base_url='http://testserver') as public:
            for token in ('','invalid'):
                result=(await public.get('/api/meadow',headers={'X-Meadow-Player':token})).json()
                self.assertEqual(result['onlineCount'],0);self.assertIsNone(result['mySeatId'])
            invalid=await public.post('/api/meadow/actions',headers={'X-Meadow-Client':'1','X-Meadow-Player':self.tokens[0]},
                json={'action':'lasso','requestId':str(uuid4()),'rabbitId':1,'seatId':8})
            self.assertEqual(invalid.status_code,422)
        self.assertEqual(self.service.seat_presence,{})

    async def test_presence_only_changes_advance_revision_and_public_snapshot_is_consistent(self):
        one=await self.state(0);two=await self.state(1);one_again=await self.state(0)
        self.assertGreater(two['revision'],one['revision'])
        self.assertEqual(one_again['seats'],two['seats'])
        self.assertEqual(one_again['revision'],two['revision'])
        self.now+=21
        await self.service._tick(.1,self.now)
        self.assertEqual(self.service.cached['onlineCount'],0)
        self.assertTrue(all(seat['status']=='empty' for seat in self.service.cached['seats']))
        self.assertGreater(self.service.cached['revision'],two['revision'])

    async def test_reassigning_a_ready_seat_changes_revision_even_when_online_count_stays_equal(self):
        first=await self.state(0)
        self.now+=21
        replacement=await self.state(1)
        self.assertEqual(replacement['seats'],first['seats'])
        self.assertEqual(replacement['onlineCount'],first['onlineCount'])
        self.assertGreater(replacement['revision'],first['revision'])
        self.assertEqual(replacement['mySeatId'],1)
        self.assertEqual(self.service._seat_for(self.owners[0]),None)


if __name__=='__main__': unittest.main()
