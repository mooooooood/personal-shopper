import test from 'node:test';
import assert from 'node:assert/strict';
import { getRabbitPose } from '../app/static/rabbit-pose.js';

const hopping = phase => getRabbitPose({id:3, moving:true, hopProgress:phase}, 10);

test('a hop crouches, pushes off, lifts, lands on the forepaws, and recovers', () => {
  const crouch = hopping(.13), push = hopping(.24), flight = hopping(.47);
  const reach = hopping(.66), landing = hopping(.78), recovery = hopping(0);
  assert.equal(crouch.lift,0);
  assert.ok(crouch.stretchY < .95);
  assert.ok(push.hindReach < -.9);
  assert.ok(push.lift > 0 && push.lift < flight.lift);
  assert.ok(flight.lift > 10);
  assert.ok(reach.foreReach > .9);
  assert.equal(landing.lift,0);
  assert.ok(landing.stretchY < .95);
  assert.equal(recovery.lift,0);
  assert.equal(recovery.stretchY,1);
});

test('all pose channels are continuous at keyframes and at the cycle boundary', () => {
  for (const phase of [0,.13,.24,.47,.66,.78,.89,1]) {
    const left = hopping(phase - 1e-7), right = hopping(phase + 1e-7);
    for (const key of Object.keys(left)) {
      assert.ok(Math.abs(left[key] - right[key]) < .0001, `${key} jumps at ${phase}`);
    }
  }
  assert.deepEqual(hopping(0),hopping(1));
});

test('resting rabbits breathe and twitch without levitating or walking', () => {
  const poses = Array.from({length:160},(_,i)=>getRabbitPose({id:17,moving:false,hopProgress:.47},i/10));
  for (const pose of poses) {
    assert.equal(pose.lift,0);
    assert.equal(pose.foreReach,0);
    assert.equal(pose.hindReach,0);
    assert.equal(pose.stretchX,1);
    assert.equal(pose.stretchY,1);
    assert.ok(pose.breath >= .986 && pose.breath <= 1.014);
  }
  assert.ok(new Set(poses.map(pose=>pose.breath)).size > 100);
  assert.ok(poses.some(pose=>Math.abs(pose.earTilt) > .01));
  assert.ok(poses.some(pose=>Math.abs(pose.noseTwitch) > .01));
});

test('motionAmount settles the entire gait and allows movement after a server stop', () => {
  const full = getRabbitPose({id:1,moving:false,motionAmount:1,hopProgress:.47},3);
  const half = getRabbitPose({id:1,moving:false,motionAmount:.5,hopProgress:.47},3);
  const stopped = getRabbitPose({id:1,moving:true,motionAmount:0,hopProgress:.47},3);
  assert.equal(full.lift,12);
  assert.equal(half.lift,6);
  assert.equal(stopped.lift,0);
  assert.equal(stopped.foreReach,0);
  assert.equal(stopped.hindReach,0);
});

test('poses are deterministic, individual, finite for extreme input, and do not mutate rabbits', () => {
  const rabbit = {id:23, moving:true, hopProgress:.47, motionAmount:.8, coat:'ginger'};
  const before = structuredClone(rabbit);
  assert.deepEqual(getRabbitPose(rabbit,42),getRabbitPose(rabbit,42));
  assert.notDeepEqual(getRabbitPose({...rabbit,id:24},42),getRabbitPose(rabbit,42));
  assert.deepEqual(rabbit,before);
  for (const time of [0,-1,1e308,-1e308,NaN,Infinity,-Infinity]) {
    for (const hopProgress of [0,1,-10,1e308,NaN,Infinity]) {
      for (const id of [1,1e308,NaN]) {
        const pose = getRabbitPose({id,moving:true,hopProgress,motionAmount:Infinity},time);
        assert.ok(Object.values(pose).every(Number.isFinite));
        assert.ok(pose.lift >= 0 && pose.lift <= 12);
      }
    }
  }
  assert.ok(Object.values(getRabbitPose(null,NaN)).every(Number.isFinite));
});
