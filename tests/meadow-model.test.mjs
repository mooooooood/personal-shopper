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
