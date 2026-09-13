import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaptureJournal,JOURNAL_COATS} from '../app/static/meadow-journal.js';

const world='735ed960-bb87-4e2b-91dd-d3ddf8b2de33';
const secondWorld='11f6c90a-8bce-4d69-a6ac-7a9fd01002e0';
const result=(id,coat='white',outcome='caught',extra={})=>({id,coat,outcome,eventKey:`${world}:${id}`,...extra});
const state=results=>({myLassoResults:results});
function memoryStorage(){
  const data=new Map();
  return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
}

test('only server-personalized successful catches stamp the journal',()=>{
  const journal=createCaptureJournal({playerId:'me',now:()=>1000});
  journal.accept({lassoResults:[result(1)],basket:[{coat:'white'}],mySeatId:1});
  journal.accept(state(['stolen','escaped','cancelled','missed'].map((outcome,i)=>result(i+2,'cream',outcome))));
  journal.accept(state([result(7,'imaginary'),{id:8,outcome:'caught',coat:'white'}]));
  assert.equal(journal.snapshot().count,0);
  assert.deepEqual(journal.accept(state([result(9,'ginger')])).map(item=>item.coat),['ginger']);
  assert.equal(journal.snapshot().count,1);
});

test('repeated polls, recatches, reloads and server epochs cannot award a coat twice',()=>{
  const storage=memoryStorage();let time=1000;
  const journal=createCaptureJournal({playerId:'me',storage,now:()=>time});
  journal.accept(state([result(1)]));time=2000;
  assert.deepEqual(journal.accept(state([result(1),result(2)])),[]);
  const reloaded=createCaptureJournal({playerId:'me',storage,now:()=>3000});
  assert.deepEqual(reloaded.accept({...state([result(1)]),epoch:'restarted'}),[]);
  assert.deepEqual(reloaded.accept(state([result(1,'white','caught',{eventKey:`${secondWorld}:1`})])),[]);
  assert.equal(reloaded.snapshot().coats[0].foundAt,1000);
  assert.equal(storage.data.size,1);
});

test('different player identities keep separate books in the same browser',()=>{
  const storage=memoryStorage();
  const alice=createCaptureJournal({playerId:'alice',storage,now:()=>1000});
  const bob=createCaptureJournal({playerId:'bob',storage,now:()=>2000});
  alice.accept(state([result(1,'cream')]));bob.refresh();
  assert.equal(bob.snapshot().count,0);
  bob.accept(state([result(2,'ginger')]));alice.refresh();
  assert.equal(alice.snapshot().count,1);assert.equal(bob.snapshot().count,1);
  assert.equal(alice.snapshot().coats.find(entry=>entry.coat==='ginger').unlocked,false);
});

test('tabs merge distinct coat stamps and retain the earliest same-coat discovery',()=>{
  const storage=memoryStorage();
  const first=createCaptureJournal({playerId:'me',storage,now:()=>1000});
  const second=createCaptureJournal({playerId:'me',storage,now:()=>2000});
  first.accept(state([result(1,'cream')]));second.accept(state([result(2,'ginger')]));
  first.refresh();assert.equal(first.snapshot().count,2);assert.equal(second.snapshot().count,2);
  const creamKey=[...storage.data.keys()].find(key=>key.endsWith('.cream'));
  storage.setItem(creamKey,JSON.stringify({version:1,coat:'cream',eventKey:`world:bad`,foundAt:3000}));
  first.refresh();second.refresh();
  assert.equal(second.snapshot().coats.find(entry=>entry.coat==='cream').foundAt,1000);
  storage.setItem(creamKey,JSON.stringify({version:1,coat:'cream',eventKey:`${world}:9`,foundAt:3000}));
  first.refresh();second.refresh();
  assert.equal(second.snapshot().coats.find(entry=>entry.coat==='cream').foundAt,1000);
});

test('bad storage records are ignored and a genuine catch repairs its stamp',()=>{
  const storage=memoryStorage();
  for(const [coat,value] of [['white','{broken'],['cream','null'],['silver',JSON.stringify({version:1,coat:'silver',eventKey:`${world}:1`,foundAt:'tomorrow'})],['ginger','x'.repeat(1000)]])storage.setItem(`meadow.journal.v1.me.${coat}`,value);
  const journal=createCaptureJournal({playerId:'me',storage,now:()=>1000});
  assert.equal(journal.snapshot().count,0);
  journal.accept(state([result(2,'white')]));
  assert.equal(createCaptureJournal({playerId:'me',storage}).snapshot().count,1);
});

test('blocked or full browser storage never stops play or duplicates a stamp',()=>{
  const unavailable={getItem(){throw new Error('blocked');},setItem(){throw new Error('full');}};
  const journal=createCaptureJournal({playerId:'me',storage:unavailable,now:()=>1000});
  journal.accept(state([result(1,'charcoal')]));
  assert.deepEqual(journal.accept(state([result(1,'charcoal')])),[]);
  assert.equal(journal.snapshot().persistent,false);assert.equal(journal.snapshot().count,1);
  const session=createCaptureJournal({playerId:'me'});session.accept(state([result(2)]));
  assert.equal(session.snapshot().persistent,false);assert.equal(session.snapshot().count,1);
});

test('all eight colours complete the book with fixed storage and immutable public snapshots',()=>{
  const storage=memoryStorage(),journal=createCaptureJournal({playerId:'me',storage,now:()=>1000});
  journal.accept(state(JOURNAL_COATS.map((entry,index)=>result(index+1,entry.coat))));
  for(let id=9;id<=1000;id++)journal.accept(state([result(id,JOURNAL_COATS[id%8].coat)]));
  const snapshot=journal.snapshot();
  assert.equal(snapshot.count,8);assert.equal(snapshot.total,8);assert.equal(storage.data.size,8);
  snapshot.coats[0].foundAt=9999;snapshot.coats.pop();
  assert.equal(journal.snapshot().coats.length,8);assert.equal(journal.snapshot().coats[0].foundAt,1000);
  assert.equal(journal.ownsStorageKey('meadow.journal.v1.me.white'),true);
  assert.equal(journal.ownsStorageKey('meadow.journal.v1.other.white'),false);
  assert.equal(journal.ownsStorageKey('meadow.journal.v1.me.unknown'),false);
});
