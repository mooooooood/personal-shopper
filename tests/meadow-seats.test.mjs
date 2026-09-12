import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotBuffer } from '../app/static/meadow-model.js';
import { seatActivity, seatResultMessage, recentSeatResult } from '../app/static/meadow-seats.js';

function world(revision=1){
  const seats=Array.from({length:8},(_,i)=>({id:i+1,x:i<4?90:910,y:230+(i%4)*65,
    occupied:true,online:true,lassoId:i+1,status:'pulling'}));
  return {epoch:'test',revision,time:revision,width:1000,height:600,carrots:[],pairs:[],basket:[],bornCount:0,
    rabbits:seats.map(seat=>({id:seat.id,x:500,y:320,moving:true,adult:true,coat:'cream'})),
    lassos:seats.map(seat=>({id:seat.id,rabbitId:seat.id,seatId:seat.id,anchorX:seat.x,anchorY:seat.y,
      progress:.2,remaining:20,pulling:true})),lassoResults:[],mySeatId:1,myLassoId:1,onlineCount:8,seats};
}
test('eight simultaneous pulls keep their own anchors, colours and per-seat progress associations',()=>{
  const buffer=createSnapshotBuffer();const first=world();buffer.accept(first,0);
  const next=world(2);
  next.rabbits.forEach((rabbit,i)=>{rabbit.x+=(i<4?-1:1)*100;});
  next.lassos.forEach((rope,i)=>{rope.progress=.3+i*.05;});
  buffer.accept(next,1000);const sample=buffer.sample(1500);
  assert.equal(sample.rabbits[0].x,450);assert.equal(sample.rabbits[7].x,550);
  for(const [i,seat] of sample.seats.entries()){
    assert.equal(sample.lassos[i].anchorX,seat.x);assert.equal(sample.lassos[i].anchorY,seat.y);
    assert.ok(seatActivity(seat,sample).includes(`${Math.round(sample.lassos[i].progress*100)}%`));
  }
  assert.deepEqual(first,world());
});
test('departing players disappear immediately and stale polls cannot bring them back online',()=>{
  const buffer=createSnapshotBuffer();buffer.accept(world(),0);
  const left=world(2);left.lassos=[];left.myLassoId=null;left.mySeatId=null;left.onlineCount=0;
  left.seats.forEach(seat=>Object.assign(seat,{occupied:false,online:false,lassoId:null,status:'empty'}));
  buffer.accept(left,1000);assert.equal(buffer.sample(1000).onlineCount,0);
  assert.ok(buffer.sample(1000).seats.every(seat=>seatActivity(seat,left)==='Open seat'));
  assert.equal(buffer.accept(world(),2000),false);assert.equal(buffer.latest.onlineCount,0);
});
test('an away owner keeps a reserved rope without displaying a fictional online visitor',()=>{
  const state=world();state.seats[0].online=false;state.seats[0].status='away';state.onlineCount=7;
  state.lassos[0].pulling=false;
  const buffer=createSnapshotBuffer();buffer.accept(state,0);
  assert.equal(seatActivity(state.seats[0],state),'Away · rope reserved');
  assert.equal(buffer.sample(3000).seats[0].lassoId,1);
});
test('results identify the correct seat and a snatched rabbit never appears in the basket',()=>{
  const buffer=createSnapshotBuffer();buffer.accept(world(),0);
  const next=world(2);next.rabbits.shift();next.lassos.shift();next.myLassoId=null;
  next.seats[0].lassoId=null;next.seats[0].status='ready';
  next.lassoResults=[{id:1,rabbitId:1,seatId:1,anchorX:90,anchorY:230,outcome:'stolen',x:460,y:305,time:2}];
  buffer.accept(next,1000);
  assert.equal(buffer.sample(1000).lassos.length,7);assert.equal(buffer.sample(1000).basket.length,0);
  assert.equal(seatActivity(next.seats[0],next),'Rabbit snatched away');
  assert.equal(seatResultMessage(next.lassoResults[0]),'Seat 01 lost a rabbit to wildlife.');
  assert.equal(recentSeatResult({...next,time:8},1),undefined);
});
test('corrupt seats, identities and endpoint mappings cannot replace a valid world',()=>{
  const buffer=createSnapshotBuffer();buffer.accept(world(),0);
  for(const change of [
    state=>state.seats.pop(),state=>state.seats[1].id=1,state=>state.seats[0].x=500,
    state=>state.onlineCount=20,state=>state.mySeatId=9,state=>state.mySeatId=2,
    state=>state.seats[0].occupied=false,state=>state.seats[0].status='empty',
    state=>state.seats[0].lassoId=2,state=>state.lassos[0].seatId=3,
    state=>state.lassos[0].anchorY=380,
  ]){
    const invalid=world(2);change(invalid);
    assert.throws(()=>buffer.accept(invalid,1000));assert.equal(buffer.latest.revision,1);
  }
});
test('a saved pre-seats rope can finish at the original basket under its reserved seat',()=>{
  const state=world();state.lassos[0].seatId=null;state.lassos[0].anchorX=500;state.lassos[0].anchorY=380;
  const buffer=createSnapshotBuffer();buffer.accept(state,0);
  assert.equal(buffer.sample(1000).mySeatId,1);assert.equal(buffer.sample(1000).lassos[0].anchorX,500);
});
