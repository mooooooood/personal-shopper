import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotBuffer } from '../app/static/meadow-model.js';
import { burrowPose, drawBurrowRabbit } from '../app/static/meadow-burrows.js';

const burrows=[{id:1,x:260,y:270},{id:2,x:540,y:205},{id:3,x:760,y:350},{id:4,x:340,y:440},{id:5,x:660,y:460}];
const rabbit=(phase=null,remaining=.9)=>({id:1,x:phase==='emerging'?760:260,y:phase==='emerging'?350:270,
  adult:true,age:40,coat:'ginger',moving:false,state:phase?'burrow':'idle',burrowTrips:1,
  burrow:phase?{entryId:1,exitId:3,phase,remaining}:null});
const snapshot=(revision,r,extra={})=>({epoch:'burrow-server',revision,time:revision,width:1000,height:600,
  maxRabbits:60,bornCount:0,burrows,rabbits:[r],basket:[],carrots:[],pairs:[],...extra});

test('a rabbit sinks ears-last, remains hidden underground, and rises ears-first',()=>{
  assert.equal(burrowPose(rabbit('entering',.9)).depth,0);
  assert.equal(burrowPose(rabbit('entering',.45)).depth,.5);
  assert.equal(burrowPose(rabbit('entering',0)).visible,false);
  assert.equal(burrowPose(rabbit('underground',2)).visible,false);
  assert.equal(burrowPose(rabbit('emerging',.9)).visible,false);
  assert.equal(burrowPose(rabbit('emerging',.45)).depth,.5);
  assert.equal(burrowPose(rabbit('emerging',0)).depth,0);
  assert.deepEqual(burrowPose(rabbit()),{visible:true,depth:0,opacity:1});
});
test('reduced motion uses a fade with no vertical travel',()=>{
  assert.deepEqual(burrowPose(rabbit('entering',.45),true),{visible:true,depth:0,opacity:.5});
  assert.equal(burrowPose(rabbit('underground',2),true).visible,false);
});
test('underground rabbits never reach the sprite painter',()=>{
  let painted=0;
  drawBurrowRabbit(null,rabbit('underground',1),2,()=>painted++);
  assert.equal(painted,0);
  drawBurrowRabbit(null,rabbit(),2,()=>painted++);
  assert.equal(painted,1);
});
test('shared exit changes never interpolate a rabbit across the meadow',()=>{
  const first=createSnapshotBuffer(),second=createSnapshotBuffer();
  for(const buffer of [first,second]){
    buffer.accept(snapshot(1,rabbit('underground',.1)),0);
    buffer.accept(snapshot(2,rabbit('emerging',.9)),1000);
    const display=buffer.sample(1200).rabbits[0];
    assert.equal(display.x,760);assert.equal(display.y,350);
    assert.equal(display.motionAmount,0);assert.equal(display.coat,'ginger');
    assert.equal(buffer.sample(1200).rabbits.length,1);
  }
  assert.deepEqual(first.sample(1200),second.sample(1200));
});
test('a whole journey missed between polls still snaps to the confirmed exit',()=>{
  const buffer=createSnapshotBuffer();
  buffer.accept(snapshot(1,{...rabbit(),burrowTrips:0}),0);
  buffer.accept(snapshot(2,{...rabbit(),x:760,y:350}),6000);
  assert.equal(buffer.sample(6000).rabbits[0].x,760);
  buffer.accept(snapshot(3,{...rabbit(),x:800,y:350,moving:true}),7000);
  assert.equal(buffer.sample(7500).rabbits[0].x,780);
});
test('animation can finish its current phase but cannot invent an exit or mutate server data',()=>{
  const state=snapshot(1,rabbit('underground',1));
  const original=structuredClone(state),buffer=createSnapshotBuffer();
  buffer.accept(state,0);
  const late=buffer.sample(100000);
  assert.equal(late.rabbits[0].burrow.phase,'underground');
  assert.equal(late.rabbits[0].burrow.remaining,0);
  assert.equal(late.rabbits[0].x,260);assert.equal(late.basket.length,0);
  late.rabbits[0].burrow.exitId=4;
  assert.deepEqual(state,original);
});
test('malformed and conflicting burrow snapshots preserve the last good world',()=>{
  const buffer=createSnapshotBuffer();buffer.accept(snapshot(1,rabbit()),0);
  for(const change of [
    s=>s.burrows.pop(),s=>s.burrows[1].id=1,s=>s.burrows[0].x=NaN,
    s=>s.rabbits[0].burrow.exitId=9,s=>s.rabbits[0].burrow.phase='flying',
    s=>s.rabbits[0].burrow.remaining=3,s=>s.rabbits[0].burrowTrips=-1,
    s=>s.rabbits[0].x=500,s=>s.rabbits[0].moving=true,s=>s.rabbits[0].burrow=null,
    s=>s.basket.push(s.rabbits.pop()),
    s=>s.lassos=[{id:1,rabbitId:1,anchorX:100,anchorY:100,progress:0,remaining:20,pulling:false}],
  ]){
    const bad=structuredClone(snapshot(2,rabbit('entering',.9)));change(bad);
    assert.throws(()=>buffer.accept(bad,1000));assert.equal(buffer.latest.revision,1);
  }
});
