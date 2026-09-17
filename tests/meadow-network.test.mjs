import test from 'node:test';
import assert from 'node:assert/strict';
import {createSnapshotBuffer} from '../app/static/meadow-model.js';
import {createPollTiming} from '../app/static/meadow-timing.js';

const snapshot = (revision, time, extra = {}) => ({
  epoch:'network-test', revision, time, width:1000, height:600,
  rabbits:[{id:1,x:100+time*20,y:530,moving:true,adult:true}],
  basket:[], carrots:[], pairs:[],
  surprise:{id:1,kind:'train',seed:1,x:300,y:530,elapsed:time,duration:24,rabbitIds:[1],carrotIds:[]},
  ...extra,
});

function trace(latencies, withActions = false) {
  const buffer=createSnapshotBuffer(), timing=createPollTiming();
  const replies=latencies.map((latency,index)=>({at:index*1000+latency,start:index*1000,poll:true}));
  if(withActions)for(let at=650;at<latencies.length*1000-1000;at+=650)replies.push({at});
  replies.sort((a,b)=>a.at-b.at);
  let revision=0,last=null;
  const samples=[];
  for(let now=0;now<=(latencies.length-1)*1000;now+=25){
    while(replies.length&&replies[0].at<=now){
      const reply=replies.shift();
      const pacing=reply.poll?timing.complete(timing.begin(reply.start),reply.at):undefined;
      const before=buffer.sample(reply.at);
      buffer.accept(snapshot(++revision,reply.at/1000),reply.at,pacing);
      const after=buffer.sample(reply.at);
      if(before){
        assert.ok(Math.abs(after.time-before.time)<1e-9,'no clock jump when a reply arrives');
        assert.ok(Math.abs(after.rabbits[0].x-before.rabbits[0].x)<1e-9,'no position jump');
        assert.ok(Math.abs(after.rabbits[0].motionAmount-before.rabbits[0].motionAmount)<1e-9,'no gait reset');
      }
    }
    const state=buffer.sample(now);
    if(!state)continue;
    assert.ok(Math.abs(state.surprise.elapsed-state.time)<1e-9,'train shares the rabbit clock');
    assert.ok(Math.abs(state.rabbits[0].x-(100+state.time*20))<1e-8,'no carriage/rider drift');
    if(now>=2500&&last){
      assert.ok(state.time>last.time,`no frozen frame at ${now} ms`);
      assert.ok(state.rabbits[0].x>last.rabbits[0].x,`continuous travel at ${now} ms`);
      assert.ok(state.rabbits[0].motionAmount>.99,`no periodic gait dip at ${now} ms`);
    }
    samples.push(state);last=state;
  }
  return {buffer,samples};
}

test('200 ms remote latency no longer leaves a dead interval at every poll',()=>{
  trace(Array(12).fill(200));
});

test('ordinary reply jitter keeps rabbits and the train moving on one clock',()=>{
  trace([200,240,150,275,180,220,200,265,170,225,180,200]);
});

test('frequent player replies preserve the poll buffer and continuous motion',()=>{
  trace([200,240,150,275,180,220,200,265,170,225,180,200],true);
});

test('an exhausted buffer settles at confirmed positions and never invents an event result',()=>{
  const {buffer}=trace(Array(6).fill(200));
  const stopped=buffer.sample(100000);
  assert.equal(stopped.time,buffer.latest.time);
  assert.equal(stopped.rabbits[0].x,buffer.latest.rabbits[0].x);
  assert.equal(stopped.rabbits[0].motionAmount,0);
  assert.equal(stopped.surprise.elapsed,buffer.latest.surprise.elapsed);
  assert.equal(stopped.surprise.kind,'train');
  assert.deepEqual(stopped.basket,[]);
});

test('action replies do not silently reset a longer interpolation duration',()=>{
  const buffer=createSnapshotBuffer();
  buffer.accept(snapshot(1,1),0,{interpolationDuration:1800});
  buffer.accept(snapshot(2,2),1000);
  assert.equal(buffer.sample(1900).time,1.5);
  const before=buffer.sample(1900);
  buffer.accept(snapshot(3,3),1900);
  assert.equal(buffer.sample(1900).time,before.time);
  assert.equal(buffer.sample(2800).time,2.25);
  assert.equal(buffer.accept(snapshot(2,2),2900,{interpolationDuration:1000}),false);
  assert.equal(buffer.sample(2800).time,2.25);
});

test('capture and event removal stay immediate even with a long network buffer',()=>{
  const buffer=createSnapshotBuffer();
  buffer.accept(snapshot(1,1),0,{interpolationDuration:2500});
  buffer.accept(snapshot(2,2,{rabbits:[],basket:[{id:1,x:120,y:530,adult:true}],surprise:null}),1000);
  assert.equal(buffer.sample(1000).rabbits.length,0);
  assert.equal(buffer.sample(1000).basket.length,1);
  assert.equal(buffer.sample(1000).surprise,null);
  buffer.accept(snapshot(0,0,{epoch:'restarted'}),1100);
  assert.equal(buffer.sample(1100).time,0);
  assert.equal(buffer.accept(snapshot(3,3),1200),false);
});
