import test from 'node:test';
import assert from 'node:assert/strict';
import { castPose } from '../app/static/meadow-cast.js';

const rope={anchorX:90,anchorY:230,castX:500,castY:300,castDuration:1,castElapsed:0};
test('flight leaves the assigned seat and lands exactly on the fixed aim point',()=>{
  const start=castPose(rope);assert.equal(start.x,90);assert.equal(start.y,212);
  const mid=castPose({...rope,castElapsed:.5});assert.ok(mid.lift>0);
  assert.equal(mid.x,295);
  const end=castPose({...rope,castElapsed:1});assert.equal(end.x,500);assert.ok(Math.abs(end.y-282)<1e-9);
  assert.equal(end.progress,1);
});
test('late snapshots clamp at landing without creating a hook or moving the rabbit',()=>{
  const late={...rope,castElapsed:20};const before=structuredClone(late);
  assert.deepEqual(castPose(late),castPose({...rope,castElapsed:1}));
  assert.deepEqual(late,before);assert.equal(castPose({...rope,castElapsed:-1}).progress,0);
});
test('portrait projection keeps the same world landing point and right-side seat',()=>{
  const end=castPose({...rope,anchorX:910,castElapsed:1},390,844);
  assert.equal(end.x,195);assert.ok(Math.abs(end.y-(422-18))<1e-9);
  assert.equal(end.start.x,354.9);
});
