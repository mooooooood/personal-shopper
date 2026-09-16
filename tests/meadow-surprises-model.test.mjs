import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotBuffer } from '../app/static/meadow-model.js';

const rabbit = (id, extra = {}) => ({id, x:300 + id * 15, y:300,
  adult:true, age:40, moving:false, state:'idle', pairId:null, partnerId:null, burrow:null, ...extra});
const surprise = (extra = {}) => ({id:1, kind:'ufo', seed:1841, x:320, y:300,
  elapsed:2, duration:24, rabbitIds:[1], carrotIds:[], ...extra});
const snapshot = (revision, extra = {}) => ({epoch:'surprise-server', revision, time:revision,
  width:1000, height:600, rabbits:[rabbit(1),rabbit(2),rabbit(3),rabbit(4),rabbit(5)],
  basket:[], carrots:[], pairs:[], ...extra});

test('two visitors render the same server-selected surprise without rolling local events', () => {
  const first = createSnapshotBuffer(), second = createSnapshotBuffer();
  for (const buffer of [first,second]) {
    buffer.accept(snapshot(1,{surprise:surprise()}),0);
    buffer.accept(snapshot(2,{surprise:surprise({elapsed:3,rabbitIds:[2]})}),1000);
  }
  assert.deepEqual(first.sample(1500).surprise,second.sample(1500).surprise);
  assert.equal(first.sample(1500).surprise.elapsed,2.5);
  assert.deepEqual(first.sample(1500).surprise.rabbitIds,[2]);
  assert.deepEqual(first.sample(1500).rabbits.map(item=>item.id),[1,2,3,4,5]);
});

test('scene clocks interpolate with rabbit positions so a train never advances ahead of its riders', () => {
  const buffer = createSnapshotBuffer();
  buffer.accept(snapshot(1,{time:8,rabbits:[rabbit(1,{x:150,y:530})],
    surprise:surprise({kind:'train',elapsed:8})}),0);
  assert.equal(buffer.sample(500).surprise.elapsed,8);
  const before = buffer.sample(1000).surprise.elapsed;
  buffer.accept(snapshot(2,{time:9,rabbits:[rabbit(1,{x:220,y:530})],
    surprise:surprise({kind:'train',elapsed:9})}),1000);
  assert.equal(buffer.sample(1000).surprise.elapsed,before);
  for (const now of [1000,1250,1500,1750,2000,100000]) {
    const scene = buffer.sample(now);
    assert.equal(scene.surprise.elapsed,scene.time);
    assert.equal(scene.rabbits[0].x,150 + 70 * (scene.surprise.elapsed - 8));
  }
  assert.equal(buffer.sample(1250).surprise.elapsed,8.25);
  assert.equal(buffer.sample(100000).surprise.elapsed,9);
  assert.equal(buffer.sample(100000).surprise.kind,'train');
  assert.equal(buffer.sample(100000).basket.length,0);
  assert.equal(buffer.latest.surprise.elapsed,9);
});

test('late polling holds the confirmed scene and a delayed correction never rewinds it', () => {
  const buffer = createSnapshotBuffer();
  buffer.accept(snapshot(1,{surprise:surprise({elapsed:23.5})}),0);
  assert.equal(buffer.sample(30000).surprise.elapsed,23.5);
  buffer.accept(snapshot(2,{surprise:surprise({elapsed:23})}),30000);
  for (const now of [30000,30250,30500,31000,50000]) {
    assert.equal(buffer.sample(now).surprise.elapsed,23.5);
  }
  buffer.accept(snapshot(3,{surprise:null}),50000);
  assert.equal(buffer.sample(50000).surprise,null);
  assert.equal(buffer.sample(100000).surprise,null);
});

test('ending a visit or changing its identity applies immediately without cross-event blending', () => {
  const buffer = createSnapshotBuffer();
  buffer.accept(snapshot(1,{surprise:surprise({elapsed:18})}),0);
  buffer.accept(snapshot(2,{surprise:null}),1000);
  assert.equal(buffer.sample(1000).surprise,null);
  assert.equal(buffer.sample(100000).surprise,null);
  assert.equal(buffer.accept(snapshot(1,{surprise:surprise()}),1100),false);
  buffer.accept(snapshot(3,{surprise:surprise({id:2,kind:'pirates',elapsed:1,x:650})}),2000);
  assert.equal(buffer.sample(2000).surprise.elapsed,1);
  assert.equal(buffer.sample(2000).surprise.x,650);
  buffer.accept(snapshot(4,{surprise:surprise({id:2,kind:'king',elapsed:0})}),3000);
  assert.equal(buffer.sample(3000).surprise.elapsed,0);
  assert.equal(buffer.sample(3000).surprise.kind,'king');
});

test('restarted worlds reset visual clocks and old-world packets cannot restore an event', () => {
  const buffer = createSnapshotBuffer();
  buffer.accept(snapshot(9,{surprise:surprise({elapsed:20})}),0);
  buffer.accept(snapshot(0,{epoch:'new-world',surprise:surprise({elapsed:1})}),1000);
  assert.equal(buffer.sample(1000).surprise.elapsed,1);
  assert.equal(buffer.accept(snapshot(10,{surprise:surprise({elapsed:21})}),1100),false);
  assert.equal(buffer.sample(1100).surprise.elapsed,1);
});

test('accepted and rendered participant collections never share mutable input arrays', () => {
  const state = snapshot(1,{surprise:surprise({kind:'king',carrotIds:[9]})});
  const buffer = createSnapshotBuffer();
  buffer.accept(state,0);
  state.surprise.rabbitIds.push(2);
  state.surprise.carrotIds.push(10);
  state.surprise.elapsed = 19;
  const displayed = buffer.sample(500);
  assert.deepEqual(displayed.surprise.rabbitIds,[1]);
  assert.deepEqual(displayed.surprise.carrotIds,[9]);
  assert.equal(displayed.surprise.elapsed,2);
  displayed.surprise.rabbitIds.push(3);
  displayed.surprise.carrotIds.push(11);
  assert.deepEqual(buffer.sample(600).surprise.rabbitIds,[1]);
  assert.deepEqual(buffer.sample(600).surprise.carrotIds,[9]);
  assert.deepEqual(buffer.latest.surprise.rabbitIds,[1]);
});

test('legacy snapshots without surprise and explicit empty scenes remain readable', () => {
  const buffer = createSnapshotBuffer();
  assert.equal(buffer.accept(snapshot(1),0),true);
  assert.equal(buffer.sample(500).surprise,null);
  assert.equal(buffer.accept(snapshot(2,{surprise:null}),1000),true);
  assert.equal(buffer.sample(1500).surprise,null);
});

test('all ten kinds accept their bounded server participants and historical carrot identities', () => {
  const limits = {hero:[0,0],pirates:[1,0],ufo:[1,0],carrot_rain:[0,3],rain:[0,0],
    mushrooms:[3,0],train:[3,0],dinosaur:[0,0],ghosts:[4,0],king:[5,1]};
  for (const [kind,[rabbits,carrots]] of Object.entries(limits)) {
    const buffer = createSnapshotBuffer();
    const event = surprise({kind,rabbitIds:Array.from({length:rabbits},(_,i)=>i+1),
      carrotIds:Array.from({length:carrots},(_,i)=>i+50)});
    assert.equal(buffer.accept(snapshot(1,{surprise:event}),0),true,kind);
    assert.deepEqual(buffer.sample(100).surprise.carrotIds,event.carrotIds);
    assert.throws(()=>buffer.accept(snapshot(2,{surprise:{...event,rabbitIds:[...event.rabbitIds,6]}}),1000));
    assert.throws(()=>buffer.accept(snapshot(2,{surprise:{...event,carrotIds:[...event.carrotIds,90]}}),1000));
  }
});

test('malformed surprise fields preserve the latest valid shared world', () => {
  const buffer = createSnapshotBuffer();
  buffer.accept(snapshot(1,{surprise:surprise()}),0);
  const patches = [{id:0},{id:1.5},{kind:'dragon'},{kind:'toString'},{seed:-1},
    {seed:2147483648},{seed:.5},{seed:'4'},{x:NaN},{x:1001},{y:-1},
    {duration:25},{duration:'24'},{elapsed:24},{elapsed:-.1},{elapsed:Infinity},
    {rabbitIds:null},{rabbitIds:[1,1]},{rabbitIds:[0]},{rabbitIds:['1']},
    {rabbitIds:[1.5]},{rabbitIds:[99]},{rabbitIds:[Number.MAX_SAFE_INTEGER+1]},
    {carrotIds:null},{carrotIds:[1]},{kind:'carrot_rain',rabbitIds:[],carrotIds:[3,3]},
    {kind:'carrot_rain',rabbitIds:[],carrotIds:[0]}];
  for (const patch of patches) {
    assert.throws(()=>buffer.accept(snapshot(2,{surprise:surprise(patch)}),1000));
    assert.equal(buffer.latest.revision,1);
  }
  for (const event of [false,true,1,'ufo',[],{}]) {
    assert.throws(()=>buffer.accept(snapshot(2,{surprise:event}),1000));
    assert.equal(buffer.latest.revision,1);
  }
});

test('rabbits reserved for a rope, a burrow, or pairing cannot also participate in a surprise', () => {
  const buffer = createSnapshotBuffer();
  buffer.accept(snapshot(1,{surprise:surprise()}),0);
  for (const extra of [
    {rabbits:[rabbit(2)],basket:[rabbit(1,{state:'basket'})]},
    {rabbits:[rabbit(1,{pairId:1})]},
    {rabbits:[rabbit(1,{partnerId:2})]},
    {rabbits:[rabbit(1,{state:'burrow'})]},
    {rabbits:[rabbit(1,{state:'roped'})]},
    {rabbits:[rabbit(1,{state:'pairing'})]},
    {lassos:[{id:1,rabbitId:1,anchorX:90,anchorY:230,progress:0,remaining:20,pulling:true}]},
    {encounter:{id:1,kind:'eagle',phase:'warning',x:50,y:100,remaining:3,direction:1,carrying:null}},
  ]) {
    assert.throws(()=>buffer.accept(snapshot(2,{surprise:surprise(),...extra}),1000));
    assert.equal(buffer.latest.revision,1);
  }
});

test('capture or dog release removes a participant immediately while other scene visitors remain', () => {
  const buffer = createSnapshotBuffer();
  buffer.accept(snapshot(1,{surprise:surprise({kind:'train',rabbitIds:[1,2]})}),0);
  buffer.accept(snapshot(2,{surprise:surprise({kind:'train',rabbitIds:[2],elapsed:3}),
    rabbits:[rabbit(2)],basket:[rabbit(1,{state:'basket'})],
    dog:{id:1,x:320,y:300,remaining:20,direction:1,moving:true}}),1000);
  assert.deepEqual(buffer.sample(1000).surprise.rabbitIds,[2]);
  assert.equal(buffer.sample(1000).rabbits.length,1);
  assert.equal(buffer.sample(1000).basket.length,1);
  assert.equal(buffer.sample(1000).dog.id,1);
});
