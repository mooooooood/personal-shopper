import test from 'node:test';
import assert from 'node:assert/strict';
import { rabbitIdleFrame } from '../app/static/rabbit-art.js';

const rabbit={id:17,state:'idle',moving:false,motionAmount:0,pairId:null,burrow:null};

test('idle details agree across viewers without changing shared rabbit data',()=>{
  const other=structuredClone(rabbit),before=structuredClone(rabbit);
  const poses=Array.from({length:180},(_,i)=>rabbitIdleFrame(rabbit,i/10));
  assert.deepEqual(poses,Array.from({length:180},(_,i)=>rabbitIdleFrame(other,i/10)));
  assert.deepEqual(rabbit,before);
  assert.ok(poses.includes(0)&&poses.includes(5)&&poses.includes(7)&&poses.includes(9));
  assert.notDeepEqual(poses,Array.from({length:180},(_,i)=>rabbitIdleFrame({...rabbit,id:18},i/10)));
});

test('movement, shared interactions and wildlife immediately override idle details',()=>{
  for(const override of [
    {moving:true},{motionAmount:.1},{state:'roped'},{state:'basket'},
    {pairId:1},{burrow:{phase:'emerging'}},{cosmeticIdle:false},
  ])for(let time=0;time<18;time+=.5)
    assert.equal(rabbitIdleFrame({...rabbit,...override},time),0);
});

test('reduced motion and explicit drawing overrides keep the normal still pose',()=>{
  for(let time=0;time<18;time+=.5){
    assert.equal(rabbitIdleFrame(rabbit,time,{reducedMotion:true}),0);
    assert.equal(rabbitIdleFrame(rabbit,time,{idle:false}),0);
  }
});
