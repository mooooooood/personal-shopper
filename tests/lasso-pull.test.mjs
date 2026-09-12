import test from 'node:test';
import assert from 'node:assert/strict';
import {createLassoPuller} from '../app/static/lasso-pull.js';

const turn=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
  const calls=[],waiting=[],timers=new Map(),states=[],errors=[];let serial=0;
  const puller=createLassoPuller({
    send:(action,lassoId)=>{calls.push({action,lassoId});return new Promise((resolve,reject)=>waiting.push({resolve,reject}));},
    accept:state=>states.push(state),error:error=>errors.push(error.message),
    schedule:callback=>{const id=++serial;timers.set(id,callback);return id;},cancel:id=>timers.delete(id),
  });
  return {puller,calls,waiting,timers,states,errors};
}
test('releasing waits for the pending pull before stopping its lease',async()=>{
  const h=harness();h.puller.start(4);h.puller.stop();
  assert.deepEqual(h.calls,[{action:'pull',lassoId:4}]);
  assert.equal(h.puller.stopping,true);
  h.waiting.shift().resolve({ok:true,state:{revision:1}});await turn();
  assert.deepEqual(h.calls,[{action:'pull',lassoId:4},{action:'stop_pull',lassoId:4}]);
  h.waiting.shift().resolve({ok:true,state:{revision:2}});await turn();
  assert.equal(h.puller.stopping,false);assert.equal(h.timers.size,0);
  assert.deepEqual(h.states,[{revision:1},{revision:2}]);
});
test('holding renews with at most one request at a time and stops on settlement',async()=>{
  const h=harness();h.puller.start(7);assert.equal(h.puller.start(7),false);
  h.waiting.shift().resolve({ok:true});await turn();assert.equal(h.timers.size,1);
  const [id,callback]=h.timers.entries().next().value;h.timers.delete(id);callback();
  assert.equal(h.calls.length,2);
  h.puller.sync(null);h.waiting.shift().resolve({ok:true});await turn();
  assert.equal(h.puller.heldId,null);assert.equal(h.timers.size,0);
});
test('a failed renewal stops reeling and makes one best-effort stop request',async()=>{
  const h=harness();h.puller.start(2);h.waiting.shift().reject(new Error('offline'));await turn();
  assert.equal(h.puller.heldId,null);assert.equal(h.calls[1].action,'stop_pull');
  h.waiting.shift().reject(new Error('offline'));await turn();
  assert.equal(h.timers.size,0);assert.equal(h.calls.length,2);assert.equal(h.puller.stopping,false);
});
test('a rejected pull cannot continue or silently take over another rope',async()=>{
  const h=harness();h.puller.start(2);h.waiting.shift().resolve({ok:false,code:'not_yours'});await turn();
  assert.equal(h.puller.heldId,null);assert.equal(h.timers.size,0);assert.deepEqual(h.errors,['not_yours']);
});
