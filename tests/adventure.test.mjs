import test from 'node:test';
import assert from 'node:assert/strict';
import {makeAdventure,inquiry,parseSaved} from '../app/static/adventure-data.js';
test('all nine journeys produce a matching mission and inquiry',()=>{
 const missions=new Set();
 for(let world=0;world<3;world++)for(let level=0;level<3;level++){
  const a=makeAdventure(world,level,'人民币 1,000 元以内');
  missions.add(a.mission);assert.ok(inquiry(a).includes(a.gear));assert.ok(inquiry(a).includes(a.levelName));assert.ok(inquiry(a).includes('人民币 1,000 元以内'));
 }
 assert.equal(missions.size,9);
});
test('saved data is bounded and corrupted or stale data is ignored',()=>{
 for(const raw of ['null','bad','{}','{"version":1,"world":99,"level":0}','{"version":1,"world":0,"level":"0"}','{"version":2,"world":0,"level":0}'])assert.equal(parseSaved(raw),null);
 assert.deepEqual(parseSaved('{"version":1,"world":2,"level":1}'),{world:2,level:1});
 assert.throws(()=>makeAdventure(-1,0));assert.throws(()=>makeAdventure(0,.5));
});
