import test from 'node:test';
import assert from 'node:assert/strict';
import { surpriseRabbitPose, surpriseCarrotScale, SURPRISE_COPY } from '../app/static/meadow-surprises.js';

const rabbit={id:1,x:360,y:330,state:'idle',adult:true,burrow:null};
const event=(kind,elapsed=10)=>({id:3,kind,seed:45,x:500,y:300,duration:24,elapsed,rabbitIds:[1],carrotIds:[2]});

test('ten cosmetic scenes preserve shared data and release every pose on departure',()=>{
  assert.equal(Object.keys(SURPRISE_COPY).length,10);
  for(const kind of Object.keys(SURPRISE_COPY)){
    const e=event(kind),before=structuredClone(e),r=structuredClone(rabbit);
    for(let elapsed=0;elapsed<=24;elapsed+=.25){
      const pose=surpriseRabbitPose(r,{...e,elapsed});
      assert.ok(Number.isFinite(pose.lift)&&pose.lift>=0&&pose.lift<=80);
      assert.deepEqual(pose,surpriseRabbitPose(structuredClone(r),{...e,elapsed}));
    }
    assert.deepEqual(r,rabbit);assert.deepEqual(e,before);
    assert.deepEqual(surpriseRabbitPose(r,event(kind,24)),surpriseRabbitPose(r,null));
  }
});

test('rope, burrow, basket or withdrawn participation always prevents cosmetic lifting',()=>{
  for(const kind of Object.keys(SURPRISE_COPY)){
    for(const change of [{state:'roped'},{state:'basket'},{burrow:{phase:'entering'}},{id:9}]){
      const pose=surpriseRabbitPose({...rabbit,...change},event(kind));
      assert.equal(pose.lift,0);assert.equal(pose.bubble,false);assert.equal(pose.dance,false);
    }
  }
});

test('mushrooms and carriages lift only rabbits that actually reached them',()=>{
  assert.ok(surpriseRabbitPose(rabbit,event('mushrooms')).lift>0);
  assert.equal(surpriseRabbitPose({...rabbit,x:100},event('mushrooms')).lift,0);
  const passenger={...rabbit,x:210,y:530};
  assert.ok(surpriseRabbitPose(passenger,event('train')).lift>0);
  assert.equal(surpriseRabbitPose({...passenger,y:300},event('train')).lift,0);
  assert.equal(surpriseRabbitPose(rabbit,event('ghosts'),{reducedMotion:true}).lift,0);
});

test('giant carrots follow confirmed food identity, shrink, and return to ordinary size',()=>{
  const e=event('carrot_rain'),carrot={id:2,lifetime:18,remaining:18};
  assert.ok(surpriseCarrotScale(carrot,e)>surpriseCarrotScale({...carrot,remaining:9},e));
  assert.equal(surpriseCarrotScale({...carrot,id:4},e),1);
  assert.equal(surpriseCarrotScale(carrot,event('carrot_rain',24)),1);
  assert.equal(surpriseCarrotScale(carrot,null),1);
});
