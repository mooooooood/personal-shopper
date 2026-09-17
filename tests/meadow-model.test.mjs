import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotBuffer, toWorldPoint } from '../app/static/meadow-model.js';

const snapshot = (revision, rabbits, extra = {}) => ({epoch:'server-a', revision, time:revision,
  width:1000, height:600, maxRabbits:60, bornCount:0, rabbits, basket:[], carrots:[], pairs:[], ...extra});
const rabbit = (id, x, y=100) => ({id, x, y, moving:true, adult:true, age:40});

test('interpolation follows server positions without advancing beyond the latest snapshot', () => {
  const buffer = createSnapshotBuffer();
  buffer.accept(snapshot(1,[rabbit(1,100)]),0);
  buffer.accept(snapshot(2,[rabbit(1,200)]),1000);
  assert.equal(buffer.sample(1500).rabbits[0].x,150);
  assert.equal(buffer.sample(3000).rabbits[0].x,200);
  assert.equal(buffer.sample(100000).time,2);
});
test('a stopped server rabbit still uses its legs while completing displayed movement', () => {
  const buffer = createSnapshotBuffer();
  buffer.accept(snapshot(1,[rabbit(1,100)]),0);
  const stopped = {...rabbit(1,200),moving:false};
  buffer.accept(snapshot(2,[stopped]),1000);
  const halfway = buffer.sample(1500).rabbits[0];
  assert.equal(halfway.x,150);
  assert.equal(halfway.moving,false);
  assert.equal(halfway.motionAmount,1);
  assert.ok(halfway.hopProgress >= 0 && halfway.hopProgress < 1);
  assert.ok(buffer.sample(1950).rabbits[0].motionAmount < halfway.motionAmount);
  assert.equal(buffer.sample(2000).rabbits[0].motionAmount,0);
  assert.equal(buffer.sample(100000).rabbits[0].motionAmount,0);
});
test('motion settles continuously without walking beyond the last received position', () => {
  const buffer = createSnapshotBuffer();
  buffer.accept(snapshot(1,[rabbit(1,100)]),0);
  assert.equal(buffer.sample(500).rabbits[0].motionAmount,0);
  buffer.accept(snapshot(2,[rabbit(1,200)]),1000);
  assert.equal(buffer.sample(1000).rabbits[0].motionAmount,0);
  const before = buffer.sample(1550).rabbits[0];
  buffer.accept(snapshot(3,[rabbit(1,250)]),1550);
  const after = buffer.sample(1550).rabbits[0];
  assert.equal(after.x,before.x);
  assert.equal(after.hopProgress,before.hopProgress);
  assert.equal(after.motionAmount,before.motionAmount);
  assert.ok(buffer.sample(2549).rabbits[0].motionAmount < .001);
  assert.equal(buffer.sample(2550).rabbits[0].motionAmount,0);
  assert.equal(buffer.sample(10000).rabbits[0].x,250);
});
test('catch and birth membership update immediately and do not generate local rabbits', () => {
  const buffer=createSnapshotBuffer();
  buffer.accept(snapshot(1,[rabbit(1,10),rabbit(2,20)]),0);
  buffer.accept(snapshot(2,[rabbit(2,30),rabbit(3,40)],{basket:[rabbit(1,10)],bornCount:1}),1000);
  assert.deepEqual(buffer.sample(1000).rabbits.map(r=>r.id),[2,3]);
  assert.equal(buffer.sample(100000).rabbits.length,2);
  assert.equal(buffer.sample(100000).basket.length,1);
});
test('late polling responses cannot undo a newer action response', () => {
  const buffer=createSnapshotBuffer();
  buffer.accept(snapshot(5,[rabbit(1,10)]),0);
  assert.equal(buffer.accept(snapshot(4,[rabbit(2,20)]),1),false);
  assert.equal(buffer.accept(snapshot(5,[rabbit(2,20)]),2),false);
  assert.equal(buffer.latest.rabbits[0].id,1);
});
test('a server restart is accepted while delayed responses from the old server are ignored', () => {
  const buffer=createSnapshotBuffer();
  buffer.accept(snapshot(100,[rabbit(1,10)]),0);
  buffer.accept(snapshot(0,[rabbit(1,50)],{epoch:'server-b'}),1000);
  assert.equal(buffer.sample(1000).rabbits[0].x,50);
  assert.equal(buffer.accept(snapshot(101,[rabbit(1,20)]),1100),false);
});
test('sampling never mutates received authoritative state', () => {
  const state=snapshot(1,[rabbit(1,100)]);
  const before=structuredClone(state), buffer=createSnapshotBuffer();
  buffer.accept(state,0);
  buffer.sample(100).rabbits[0].x=999;
  assert.deepEqual(state,before);
});
test('portrait and landscape clicks address the same canonical map', () => {
  assert.deepEqual(toWorldPoint(195,422,390,844),{x:500,y:300});
  assert.deepEqual(toWorldPoint(640,450,1280,900),{x:500,y:300});
  assert.deepEqual(toWorldPoint(-3,10000,390,844),{x:0,y:600});
});
test('invalid or unbounded snapshots fail without replacing the current world', () => {
  const buffer=createSnapshotBuffer();
  buffer.accept(snapshot(1,[rabbit(1,100)]),0);
  for(const bad of [snapshot(2,[rabbit(1,NaN)]),snapshot(2,Array.from({length:61},(_,i)=>rabbit(i,1))),{...snapshot(2,[]),width:500}]) {
    assert.throws(()=>buffer.accept(bad,100));
    assert.equal(buffer.latest.revision,1);
  }
});

const encounter = (id, x, extra = {}) => ({id, x, y:300, kind:'eagle', phase:'chasing',
  direction:1, targetId:1, remaining:5, carrying:null, ...extra});

test('coats come from the server and survive interpolation and basket transfers', () => {
  const buffer=createSnapshotBuffer();
  const coloured={...rabbit(1,100),coat:'spotted'};
  buffer.accept(snapshot(1,[coloured]),0);
  buffer.accept(snapshot(2,[{...coloured,x:200}]),1000);
  assert.equal(buffer.sample(1500).rabbits[0].coat,'spotted');
  buffer.accept(snapshot(3,[],{basket:[coloured]}),2000);
  assert.equal(buffer.sample(500000).basket[0].coat,'spotted');
  assert.equal(buffer.sample(500000).rabbits.length,0);
});
test('wildlife movement is interpolated and never invents a capture', () => {
  const buffer=createSnapshotBuffer();
  buffer.accept(snapshot(1,[rabbit(1,500)],{encounter:encounter(1,100)}),0);
  buffer.accept(snapshot(2,[rabbit(1,500)],{encounter:encounter(1,300)}),1000);
  assert.equal(buffer.sample(1500).encounter.x,200);
  assert.equal(buffer.sample(500000).encounter.x,300);
  assert.equal(buffer.sample(500000).encounter.carrying,null);
  assert.equal(buffer.sample(500000).rabbits.length,1);
});
test('wildlife countdowns interpolate within a phase but never predict a phase change', () => {
  const buffer=createSnapshotBuffer();
  buffer.accept(snapshot(1,[],{encounter:encounter(1,100,{phase:'warning',remaining:3})}),0);
  buffer.accept(snapshot(2,[],{encounter:encounter(1,100,{phase:'warning',remaining:2})}),1000);
  assert.equal(buffer.sample(1500).encounter.remaining,2.5);
  assert.equal(buffer.sample(100000).encounter.remaining,2);
  assert.equal(buffer.sample(100000).encounter.phase,'warning');
  buffer.accept(snapshot(3,[],{encounter:encounter(1,100,{phase:'chasing',remaining:7})}),2000);
  assert.equal(buffer.sample(2000).encounter.remaining,7);
  assert.equal(buffer.sample(2000).encounter.phase,'chasing');
});
test('a shared capture immediately removes the rabbit and renders its saved coat with the animal', () => {
  const buffer=createSnapshotBuffer();
  buffer.accept(snapshot(1,[{...rabbit(1,500),coat:'ginger'}],{encounter:encounter(1,490)}),0);
  const event=encounter(1,500,{phase:'leaving',carrying:{id:1,coat:'ginger',adult:true}});
  buffer.accept(snapshot(2,[],{encounter:event,raidedCount:1}),1000);
  assert.equal(buffer.sample(1000).rabbits.length,0);
  assert.equal(buffer.sample(1000).encounter.carrying.coat,'ginger');
  assert.equal(buffer.sample(1000).raidedCount,1);
  assert.equal(buffer.accept(snapshot(1,[rabbit(1,500)]),1100),false);
  buffer.accept(snapshot(3,[],{encounter:null,raidedCount:1}),2000);
  assert.equal(buffer.sample(2000).encounter,null);
});
test('new visits and server epochs never interpolate from an unrelated predator', () => {
  const buffer=createSnapshotBuffer();
  buffer.accept(snapshot(1,[],{encounter:encounter(1,100)}),0);
  buffer.accept(snapshot(2,[],{encounter:encounter(2,800,{kind:'wolf'})}),1000);
  assert.equal(buffer.sample(1000).encounter.x,800);
  buffer.accept(snapshot(0,[],{epoch:'server-b',encounter:encounter(2,300)}),2000);
  assert.equal(buffer.sample(2000).encounter.x,300);
});
test('invalid coats and wildlife payloads cannot replace a good snapshot', () => {
  const buffer=createSnapshotBuffer();
  buffer.accept(snapshot(1,[rabbit(1,100)]),0);
  for(const extra of [
    {rabbits:[{...rabbit(1,100),coat:'unknown'}]},
    {encounter:encounter(1,Infinity)}, {encounter:encounter(1,300,{kind:'lion'})},
    {encounter:encounter(1,300,{phase:'invalid'})},
    {encounter:encounter(1,300,{carrying:{id:1,coat:'unknown',adult:true}})},
    {raidedCount:-1},
  ]) {
    assert.throws(()=>buffer.accept(snapshot(2,[],extra),1000));
    assert.equal(buffer.latest.revision,1);
  }
});

const rope=(id,rabbitId,progress=0)=>({id,rabbitId,anchorX:500,anchorY:380,progress,remaining:20,pulling:true});
test('a confirmed flight animates to its fixed aim without predicting a hook',()=>{
  const buffer=createSnapshotBuffer();
  const flight={...rope(1,1),phase:'casting',castX:500,castY:300,castDuration:1,castElapsed:0,pulling:false};
  buffer.accept(snapshot(1,[rabbit(1,300)],{lassos:[flight],myLassoId:1}),0);
  const halfway=buffer.sample(500);assert.equal(halfway.lassos[0].castElapsed,.5);
  assert.equal(halfway.lassos[0].progress,0);assert.equal(halfway.rabbits[0].x,300);
  const late=buffer.sample(10000);assert.equal(late.lassos[0].castElapsed,1);
  assert.equal(late.lassos[0].phase,'casting');assert.equal(late.basket.length,0);
  assert.equal(flight.castElapsed,0);
  for(const change of [{castDuration:0},{castElapsed:2},{castX:NaN},{phase:'imaginary'},{pulling:true}]){
    assert.throws(()=>buffer.accept(snapshot(2,[rabbit(1,300)],{lassos:[{...flight,...change}]}),2000));
  }
});
test('a lasso keeps its rabbit on grass while progress and position interpolate',()=>{
  const buffer=createSnapshotBuffer();
  buffer.accept(snapshot(1,[rabbit(1,300)],{lassos:[rope(8,1,.1)],myLassoId:8}),0);
  buffer.accept(snapshot(2,[rabbit(1,400)],{lassos:[rope(8,1,.5)],myLassoId:8}),1000);
  const midway=buffer.sample(1500);
  assert.equal(midway.rabbits[0].x,350);assert.ok(Math.abs(midway.lassos[0].progress-.3)<1e-10);
  assert.equal(midway.basket.length,0);assert.equal(buffer.sample(100000).lassos[0].progress,.5);
});
test('a predator settlement clears the rope immediately and cannot be undone by an old poll',()=>{
  const buffer=createSnapshotBuffer();
  buffer.accept(snapshot(1,[rabbit(1,300)],{lassos:[rope(8,1,.8)],myLassoId:8}),0);
  const result={id:8,rabbitId:1,outcome:'stolen',x:450,y:350,time:2};
  buffer.accept(snapshot(2,[],{lassos:[],lassoResults:[result],myLassoId:null}),1000);
  assert.equal(buffer.sample(1000).lassos.length,0);assert.equal(buffer.sample(1000).basket.length,0);
  assert.equal(buffer.latest.lassoResults[0].outcome,'stolen');
  assert.equal(buffer.accept(snapshot(1,[rabbit(1,300)],{lassos:[rope(8,1,.8)],myLassoId:8}),1500),false);
});
test('invalid, duplicate, and orphaned ropes never replace good shared state',()=>{
  const buffer=createSnapshotBuffer();buffer.accept(snapshot(1,[rabbit(1,300)]),0);
  for(const extra of [{lassos:[rope(1,99)]},{lassos:[rope(1,1),rope(2,1)]},
    {lassos:[rope(1,1,2)]},{lassos:[rope(1,1)],myLassoId:2},
    {lassoResults:[{id:1,rabbitId:1,outcome:'invalid',x:100,y:100,time:1}]}]){
    assert.throws(()=>buffer.accept(snapshot(2,[rabbit(1,300)],extra),1000));
    assert.equal(buffer.latest.revision,1);
  }
});

const dog=(id,x,remaining=20)=>({id,x,y:300,remaining,direction:1,moving:true});
test('a shared dog interpolates authoritative movement and lifetime without predicting beyond snapshots',()=>{
  const buffer=createSnapshotBuffer();
  const initial=snapshot(1,[],{dog:dog(1,100)}),next=snapshot(2,[],{dog:dog(1,300,19)});
  buffer.accept(initial,0);buffer.accept(next,1000);
  assert.deepEqual(buffer.sample(1500).dog,{...dog(1,200,19.5)});
  assert.equal(buffer.sample(100000).dog.x,300);
  assert.equal(buffer.sample(100000).dog.remaining,19);
  buffer.sample(1500).dog.x=999;
  assert.equal(next.dog.x,300);
  buffer.accept(snapshot(3,[],{dog:null}),2000);
  assert.equal(buffer.sample(2000).dog,null);
});
test('new dog visits and restarted worlds do not glide from an earlier dog',()=>{
  const buffer=createSnapshotBuffer();
  buffer.accept(snapshot(1,[],{dog:dog(1,100)}),0);
  buffer.accept(snapshot(2,[],{dog:dog(2,800)}),1000);
  assert.equal(buffer.sample(1000).dog.x,800);
  buffer.accept(snapshot(0,[],{epoch:'server-b',dog:dog(2,400)}),2000);
  assert.equal(buffer.sample(2000).dog.x,400);
  assert.equal(buffer.accept(snapshot(3,[],{dog:dog(2,800)}),2100),false);
});
test('malformed dog data cannot replace the current shared world',()=>{
  const buffer=createSnapshotBuffer();buffer.accept(snapshot(1,[]),0);
  for(const patch of [{id:0},{x:NaN},{x:999},{y:-1},{remaining:21},{remaining:-1},{direction:0},{moving:'yes'}]){
    assert.throws(()=>buffer.accept(snapshot(2,[],{dog:{...dog(1,100),...patch}}),1000));
    assert.equal(buffer.latest.revision,1);
  }
});
