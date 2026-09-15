// The server owns rabbit coats and wildlife events as well as movement.
// This module only smooths received snapshots; it never rolls a random event.
import { validSeats } from './meadow-seats.js?v=meadow16';
const coats = new Set(['white','cream','caramel','chocolate','silver','charcoal','ginger','spotted']);
function validCoat(rabbit) { return rabbit.coat === undefined || coats.has(rabbit.coat); }
const identity=value=>Number.isSafeInteger(value)&&value>0;
const between=(value,low,high)=>Number.isFinite(value)&&value>=low&&value<=high;
function validBurrows(state) {
  const holes=state.burrows??[];
  if(!Array.isArray(holes)||(state.burrows!==undefined&&holes.length!==5)
    ||!holes.every(hole=>identity(hole.id)&&hole.id<=5&&between(hole.x,28,972)&&between(hole.y,28,572))
    ||new Set(holes.map(hole=>hole.id)).size!==holes.length)return false;
  const rabbits=[...state.rabbits,...state.basket];
  if(rabbits.filter(rabbit=>rabbit.burrow!=null).length>3)return false;
  return rabbits.every(rabbit=>{
    if(rabbit.burrowTrips!==undefined&&(!Number.isSafeInteger(rabbit.burrowTrips)||rabbit.burrowTrips<0))return false;
    const trip=rabbit.burrow;
    if(trip==null)return rabbit.state!=='burrow';
    const durations={entering:.9,underground:2,emerging:.9};
    if(rabbit.state!=='burrow'||rabbit.moving||rabbit.pairId!=null||!rabbit.burrowTrips
      ||!(trip.phase in durations)||!between(trip.remaining,0,durations[trip.phase])
      ||!holes.some(hole=>hole.id===trip.entryId)||!holes.some(hole=>hole.id===trip.exitId)
      ||state.basket.some(item=>item.id===rabbit.id)||(state.lassos||[]).some(rope=>rope.rabbitId===rabbit.id))return false;
    const hole=holes.find(hole=>hole.id===(trip.phase==='emerging'?trip.exitId:trip.entryId));
    return rabbit.x===hole.x&&rabbit.y===hole.y;
  });
}
function validFlight(rope) {
  if(rope.phase===undefined)return true; // A pre-flight server snapshot.
  return ['casting','reeling'].includes(rope.phase)
    && between(rope.castX,0,1000)&&between(rope.castY,0,600)
    && between(rope.castDuration,0,1.2)&&between(rope.castElapsed,0,rope.castDuration)
    && (rope.phase!=='casting'||(rope.castDuration>=.8&&rope.progress===0&&!rope.pulling));
}
function validLassos(state) {
  const ropes=state.lassos??[],results=state.lassoResults??[];
  return Array.isArray(ropes)&&ropes.length<=8&&Array.isArray(results)&&results.length<=12
    && ropes.every(rope=>identity(rope.id)&&identity(rope.rabbitId)
      && between(rope.anchorX,0,1000)&&between(rope.anchorY,0,600)
      && between(rope.progress,0,1)&&between(rope.remaining,0,25)&&typeof rope.pulling==='boolean'&&validFlight(rope)
      &&state.rabbits.some(rabbit=>rabbit.id===rope.rabbitId))
    && new Set(ropes.map(rope=>rope.id)).size===ropes.length
    && new Set(ropes.map(rope=>rope.rabbitId)).size===ropes.length
    && (state.myLassoId==null||ropes.some(rope=>rope.id===state.myLassoId))
    && results.every(result=>identity(result.id)&&identity(result.rabbitId)
      &&['caught','stolen','escaped','cancelled','missed'].includes(result.outcome)
      &&between(result.x,0,1000)&&between(result.y,0,600)&&between(result.time,0,Infinity));
}
function validDog(dog) {
  return dog == null || (identity(dog.id)
    && between(dog.x,28,972) && between(dog.y,28,572)
    && between(dog.remaining,0,20) && [-1,1].includes(dog.direction)
    && typeof dog.moving==='boolean');
}
function validEncounter(event) {
  return event == null || (Number.isSafeInteger(event.id) && event.id > 0
    && ['eagle','wolf'].includes(event.kind) && ['warning','chasing','leaving'].includes(event.phase)
    && Number.isFinite(event.x) && event.x >= 0 && event.x <= 1000
    && Number.isFinite(event.y) && event.y >= 0 && event.y <= 600
    && Number.isFinite(event.remaining) && event.remaining >= 0
    && [-1,1].includes(event.direction)
    && (event.carrying == null || (Number.isSafeInteger(event.carrying.id)
      && validCoat(event.carrying) && typeof event.carrying.adult === 'boolean')));
}
export function createSeededRandom(seed = 20260910) {
  let value = typeof seed === "number" ? seed >>> 0 : 2166136261;
  if (typeof seed !== "number") {
    for (const character of String(seed)) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSnapshotBuffer(duration = 1000) {
  let latest = null, start = null, receivedAt = 0;
  const retiredEpochs = new Set();
  const smooth = value => { const x = Math.max(0, Math.min(1, value)); return x * x * (3 - 2 * x); };

  function sample(now) {
    if (!latest) return null;
    const progress = Math.max(0, Math.min(1, (now - receivedAt) / duration));
    const previous = new Map((start?.rabbits || []).map(rabbit => [rabbit.id, rabbit]));
    const time = start ? start.time + (latest.time - start.time) * progress : latest.time;
    let encounter = latest.encounter ? {...latest.encounter} : null;
    const priorEvent = start?.encounter;
    if (encounter && priorEvent?.id === encounter.id) {
      encounter.x = priorEvent.x + (encounter.x - priorEvent.x) * progress;
      encounter.y = priorEvent.y + (encounter.y - priorEvent.y) * progress;
      if (priorEvent.phase === encounter.phase) {
        encounter.remaining = priorEvent.remaining + (encounter.remaining - priorEvent.remaining) * progress;
      }
    }
    let dog=latest.dog?{...latest.dog}:null;
    const priorDog=start?.dog;
    if(dog && priorDog?.id===dog.id){
      dog.x=priorDog.x+(dog.x-priorDog.x)*progress;
      dog.y=priorDog.y+(dog.y-priorDog.y)*progress;
      dog.remaining=priorDog.remaining+(dog.remaining-priorDog.remaining)*progress;
    }
    const priorRopes=new Map((start?.lassos||[]).map(rope=>[rope.id,rope]));
    const lassos=(latest.lassos||[]).map(rope=>{
      const prior=priorRopes.get(rope.id);
      return {...rope,progress:prior?prior.progress+(rope.progress-prior.progress)*progress:rope.progress,
        // Animate only the flight already authorized by the server. Reaching
        // the fixed point never locally hooks a rabbit or decides a result.
        castElapsed:rope.phase==='casting'?Math.min(rope.castDuration,rope.castElapsed+Math.max(0,now-receivedAt)/1000):rope.castElapsed,
        remaining:prior?prior.remaining+(rope.remaining-prior.remaining)*progress:rope.remaining};
    });
    return { ...latest, time, encounter, dog, lassos, rabbits: latest.rabbits.map(rabbit => {
      const prior = previous.get(rabbit.id);
      // A complete underground trip can happen between two polls. The saved
      // trip counter also prevents a cross-map glide when those phases are missed.
      const crossedBurrow=prior&&((prior.burrowTrips??0)!==(rabbit.burrowTrips??0)||prior.burrow||rabbit.burrow);
      const old=crossedBurrow?null:prior;
      const burrow=rabbit.burrow?{...rabbit.burrow,
        remaining:Math.max(0,rabbit.burrow.remaining-Math.max(0,now-receivedAt)/1000)}:rabbit.burrow;
      // A server rabbit may already be at rest while its previous movement is
      // still reaching the screen. Animate that real displacement, not moving
      // alone, then settle before reaching the final received position.
      const travelling = old && Math.hypot(rabbit.x - old.x, rabbit.y - old.y) > .01;
      const priorMotion = Math.max(0, Math.min(1, old?.motionAmount || 0));
      const motionAmount = travelling
        ? (priorMotion + (1 - priorMotion) * smooth(progress / .14)) * (1 - smooth((progress - .80) / .20))
        : priorMotion * (1 - smooth(progress / .20));
      return { ...rabbit, burrow,
        x: old ? old.x + (rabbit.x - old.x) * progress : rabbit.x,
        y: old ? old.y + (rabbit.y - old.y) * progress : rabbit.y,
        motionAmount,
        hopProgress: ((time / 0.48 + rabbit.id * 0.13) % 1 + 1) % 1,
      };
    }) };
  }

  function accept(state, now) {
    if (!state || typeof state.epoch !== 'string' || !Number.isSafeInteger(state.revision)
      || !Number.isFinite(state.time) || state.width !== 1000 || state.height !== 600
      || !Array.isArray(state.rabbits) || !Array.isArray(state.basket)
      || !Array.isArray(state.carrots) || !Array.isArray(state.pairs)
      || state.rabbits.length + state.basket.length > 60
      || state.carrots.length > 6 || ![...state.rabbits,...state.basket].every(rabbit =>
        Number.isSafeInteger(rabbit.id) && Number.isFinite(rabbit.x) && Number.isFinite(rabbit.y) && validCoat(rabbit))
      || !validEncounter(state.encounter)
      || !validDog(state.dog)
      || !validLassos(state)
      || !validBurrows(state)
      || !validSeats(state)
      || (state.raidedCount !== undefined && (!Number.isSafeInteger(state.raidedCount) || state.raidedCount < 0))) {
      throw new Error('Invalid meadow snapshot');
    }
    if (retiredEpochs.has(state.epoch)) return false;
    if (latest?.epoch === state.epoch && state.revision <= latest.revision) return false;
    const sameWorld = latest?.epoch === state.epoch;
    start = sameWorld ? sample(now) : null;
    if (latest && !sameWorld) {
      retiredEpochs.add(latest.epoch);
      if (retiredEpochs.size > 8) retiredEpochs.delete(retiredEpochs.values().next().value);
    }
    latest = state;
    receivedAt = now;
    return true;
  }
  return { accept, sample, get latest() { return latest; } };
}

export function toWorldPoint(x, y, width, height) {
  return { x: Math.max(0, Math.min(1000, x / width * 1000)),
    y: Math.max(0, Math.min(600, y / height * 600)) };
}
