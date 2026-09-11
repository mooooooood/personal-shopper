// The server owns rabbit coats and wildlife events as well as movement.
// This module only smooths received snapshots; it never rolls a random event.
const coats = new Set(['white','cream','caramel','chocolate','silver','charcoal','ginger','spotted']);
function validCoat(rabbit) { return rabbit.coat === undefined || coats.has(rabbit.coat); }
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
    return { ...latest, time, encounter, rabbits: latest.rabbits.map(rabbit => {
      const old = previous.get(rabbit.id);
      // A server rabbit may already be at rest while its previous movement is
      // still reaching the screen. Animate that real displacement, not moving
      // alone, then settle before reaching the final received position.
      const travelling = old && Math.hypot(rabbit.x - old.x, rabbit.y - old.y) > .01;
      const priorMotion = Math.max(0, Math.min(1, old?.motionAmount || 0));
      const motionAmount = travelling
        ? (priorMotion + (1 - priorMotion) * smooth(progress / .14)) * (1 - smooth((progress - .80) / .20))
        : priorMotion * (1 - smooth(progress / .20));
      return { ...rabbit,
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
