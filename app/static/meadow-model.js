// The server owns the rabbits. This module only smooths received snapshots.
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

  function sample(now) {
    if (!latest) return null;
    const progress = Math.max(0, Math.min(1, (now - receivedAt) / duration));
    const previous = new Map((start?.rabbits || []).map(rabbit => [rabbit.id, rabbit]));
    const time = start ? start.time + (latest.time - start.time) * progress : latest.time;
    return { ...latest, time, rabbits: latest.rabbits.map(rabbit => {
      const old = previous.get(rabbit.id);
      return { ...rabbit,
        x: old ? old.x + (rabbit.x - old.x) * progress : rabbit.x,
        y: old ? old.y + (rabbit.y - old.y) * progress : rabbit.y,
        hopProgress: rabbit.moving ? (time / 0.48 + rabbit.id * 0.13) % 1 : 0,
      };
    }) };
  }

  function accept(state, now) {
    if (!state || typeof state.epoch !== 'string' || !Number.isSafeInteger(state.revision)
      || !Number.isFinite(state.time) || state.width !== 1000 || state.height !== 600
      || !Array.isArray(state.rabbits) || !Array.isArray(state.basket)
      || !Array.isArray(state.carrots) || !Array.isArray(state.pairs)
      || state.rabbits.length + state.basket.length > 60
      || state.carrots.length > 6 || !state.rabbits.every(rabbit =>
        Number.isSafeInteger(rabbit.id) && Number.isFinite(rabbit.x) && Number.isFinite(rabbit.y))) {
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
