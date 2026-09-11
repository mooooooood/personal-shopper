// The meadow runs entirely in the browser. Times are in seconds, coordinates
// are in the logical map space, and the caller controls when time advances.
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

export function createMeadow(options = {}) {
  const sourceRandom = options.random ?? createSeededRandom(options.seed);
  const random = () => {
    const value = sourceRandom();
    return Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0.5;
  };
  let width = Math.max(240, options.width ?? 1000);
  let height = Math.max(160, options.height ?? 600);
  const maxRabbits = Math.max(0, Math.floor(options.maxRabbits ?? 60));
  const initialCount = Math.max(0, Math.min(maxRabbits, Math.floor(options.initialCount ?? 12)));
  const adultAge = options.adultAge ?? 30;
  const nestingDuration = options.nestingDuration ?? 2.8;
  let scale = Math.min(width / 1000, height / 600);
  let margin = 28 * scale;
  let pond = { x: width * 0.825, y: height * 0.225, rx: width * 0.1 + 14 * scale, ry: height * (58 / 600) + 14 * scale };
  const rabbits = [];
  const carrots = [];
  const basket = [];
  const pairs = [];
  const events = [];
  let nextRabbitId = 1;
  let nextCarrotId = 1;
  let nextPairId = 1;
  let pairCheck = 0;
  let time = 0;
  let bornCount = 0;

  const between = (low, high) => low + (high - low) * random();
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const totalCount = () => rabbits.length + basket.length;
  const emit = (type, detail = {}) => {
    events.push({ type, time, ...detail });
    // A caller that never reads feedback should not accumulate memory forever.
    if (events.length > 100) events.shift();
  };

  function safePoint(x, y) {
    const point = {
      x: Math.max(margin, Math.min(width - margin, Number.isFinite(x) ? x : between(margin, width - margin))),
      y: Math.max(margin, Math.min(height - margin, Number.isFinite(y) ? y : between(margin, height - margin))),
    };
    const dx = (point.x - pond.x) / pond.rx;
    const dy = (point.y - pond.y) / pond.ry;
    const radius = Math.hypot(dx, dy);
    if (radius < 1.015) {
      const angle = radius > 0.0001 ? Math.atan2(dy, dx) : Math.PI;
      point.x = pond.x + Math.cos(angle) * pond.rx * 1.02;
      point.y = pond.y + Math.sin(angle) * pond.ry * 1.02;
    }
    return point;
  }

  function isSafePosition(x, y) {
    return Number.isFinite(x) && Number.isFinite(y)
      && x >= margin - 0.001 && x <= width - margin + 0.001
      && y >= margin - 0.001 && y <= height - margin + 0.001
      && ((x - pond.x) / pond.rx) ** 2 + ((y - pond.y) / pond.ry) ** 2 >= 0.9999;
  }

  function segmentClear(a, b) {
    const ax = (a.x - pond.x) / pond.rx;
    const ay = (a.y - pond.y) / pond.ry;
    const dx = (b.x - a.x) / pond.rx;
    const dy = (b.y - a.y) / pond.ry;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0;
    return (ax + dx * t) ** 2 + (ay + dy * t) ** 2 >= 1;
  }

  // These waypoints are just outside the pond. A tiny visibility graph avoids
  // rabbits cutting across water or becoming stuck at its edge.
  let pondWaypoints = [];
  function rebuildGeometry() {
    scale = Math.min(width / 1000, height / 600);
    margin = 28 * scale;
    pond = { x: width * 0.825, y: height * 0.225, rx: width * 0.1 + 14 * scale, ry: height * (58 / 600) + 14 * scale };
    pondWaypoints = Array.from({ length: 16 }, (_, index) => {
      const angle = index * Math.PI / 8;
      return { x: pond.x + Math.cos(angle) * pond.rx * 1.06, y: pond.y + Math.sin(angle) * pond.ry * 1.06 };
    }).filter((point) => isSafePosition(point.x, point.y));
  }
  rebuildGeometry();

  function routeTo(start, destination) {
    if (segmentClear(start, destination)) return [destination];
    const nodes = [start, destination, ...pondWaypoints];
    const costs = nodes.map(() => Infinity);
    const previous = nodes.map(() => -1);
    const visited = new Set();
    costs[0] = 0;
    for (let pass = 0; pass < nodes.length; pass += 1) {
      let current = -1;
      for (let index = 0; index < nodes.length; index += 1) {
        if (!visited.has(index) && (current < 0 || costs[index] < costs[current])) current = index;
      }
      if (current < 0 || !Number.isFinite(costs[current])) break;
      if (current === 1) {
        const path = [];
        for (let index = 1; index !== 0; index = previous[index]) path.unshift({ ...nodes[index] });
        return path;
      }
      visited.add(current);
      for (let index = 1; index < nodes.length; index += 1) {
        if (visited.has(index) || !segmentClear(nodes[current], nodes[index])) continue;
        const cost = costs[current] + distance(nodes[current], nodes[index]);
        if (cost < costs[index]) {
          costs[index] = cost;
          previous[index] = current;
        }
      }
    }
    return [];
  }

  function moveToward(rabbit, target) {
    rabbit._path = routeTo(rabbit, safePoint(target.x, target.y));
    rabbit.moving = rabbit._path.length > 0;
    if (!rabbit.pairId) rabbit.state = rabbit.moving ? "hopping" : "idle";
  }

  function makeRabbit(x, y, adult = false) {
    const point = safePoint(x, y);
    return {
      id: nextRabbitId++, ...point, age: adult ? adultAge + between(3, 25) : 0,
      adult, state: "idle", moving: false, hopProgress: 0, pairProgress: 0,
      direction: random() < 0.5 ? -1 : 1, partnerId: null, pairId: null,
      cooldown: adult ? between(9, 13) : between(3, 6),
      _wait: between(0.1, 1.5), _speed: between(65, 92) * scale,
      _path: [], _carrotId: null,
    };
  }

  function settle(rabbit) {
    rabbit.state = "idle";
    rabbit.moving = false;
    rabbit.hopProgress = 0;
    rabbit.pairProgress = 0;
    rabbit.partnerId = null;
    rabbit.pairId = null;
    rabbit._path = [];
    rabbit._carrotId = null;
    rabbit._wait = between(0.4, 1.5);
  }

  function endPair(pair, interrupted = false) {
    const index = pairs.indexOf(pair);
    if (index >= 0) pairs.splice(index, 1);
    for (const id of [pair.firstId, pair.secondId]) {
      const rabbit = rabbits.find((item) => item.id === id);
      if (!rabbit) continue;
      settle(rabbit);
      rabbit.cooldown = interrupted ? between(5, 8) : between(18, 26);
    }
  }

  function pairRabbits() {
    let vacancies = maxRabbits - totalCount() - pairs.length;
    if (vacancies <= 0) return;
    const eligible = rabbits.filter((rabbit) => rabbit.adult && rabbit.cooldown <= 0 && !rabbit.pairId);
    while (eligible.length > 1 && vacancies > 0) {
      let nearest = Infinity;
      let firstIndex = 0;
      let secondIndex = 1;
      for (let first = 0; first < eligible.length; first += 1) {
        for (let second = first + 1; second < eligible.length; second += 1) {
          const gap = distance(eligible[first], eligible[second]);
          if (gap < nearest) [nearest, firstIndex, secondIndex] = [gap, first, second];
        }
      }
      const second = eligible.splice(secondIndex, 1)[0];
      const first = eligible.splice(firstIndex, 1)[0];
      const point = safePoint((first.x + second.x) / 2, (first.y + second.y) / 2);
      const pair = { id: nextPairId++, firstId: first.id, secondId: second.id, ...point, phase: "approaching", progress: 0, elapsed: 0 };
      pairs.push(pair);
      for (const [rabbit, partner] of [[first, second], [second, first]]) {
        rabbit.pairId = pair.id;
        rabbit.partnerId = partner.id;
        rabbit.state = "pairing";
        rabbit._carrotId = null;
        moveToward(rabbit, safePoint(point.x + (rabbit === first ? -11 : 11) * scale, point.y));
      }
      vacancies -= 1;
    }
  }

  function advanceMovement(rabbit, dt) {
    let movement = rabbit._speed * dt * (rabbit.adult ? 1 : 0.72);
    const wasMoving = rabbit._path.length > 0;
    while (movement > 0 && rabbit._path.length) {
      const next = rabbit._path[0];
      const gap = distance(rabbit, next);
      if (Math.abs(next.x - rabbit.x) > 0.01) rabbit.direction = next.x > rabbit.x ? 1 : -1;
      if (gap <= movement) {
        rabbit.x = next.x;
        rabbit.y = next.y;
        rabbit._path.shift();
        movement -= gap;
      } else {
        rabbit.x += (next.x - rabbit.x) / gap * movement;
        rabbit.y += (next.y - rabbit.y) / gap * movement;
        movement = 0;
      }
    }
    rabbit.moving = rabbit._path.length > 0;
    rabbit.hopProgress = rabbit.moving ? (rabbit.hopProgress + dt / 0.48) % 1 : 0;
    if (wasMoving && !rabbit.moving && !rabbit.pairId) {
      rabbit.state = "idle";
      rabbit._wait = between(0.5, 2.2);
    }
  }

  function update(dt) {
    // No wall clock or catch-up: a stalled/hidden tab cannot create a sudden
    // population explosion. The UI normally calls this with 1/30 or 1/60.
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.1);
    time += dt;
    for (let index = carrots.length - 1; index >= 0; index -= 1) {
      carrots[index].remaining -= dt;
      if (carrots[index].remaining <= 0) carrots.splice(index, 1);
    }
    for (const rabbit of basket) {
      rabbit.age += dt;
      rabbit.adult = rabbit.age >= adultAge;
    }
    for (const rabbit of rabbits) {
      rabbit.age += dt;
      rabbit.adult = rabbit.age >= adultAge;
      if (rabbit.adult) rabbit.cooldown = Math.max(0, rabbit.cooldown - dt);
      if (!rabbit.pairId) {
        const carrot = carrots.reduce((nearest, item) => distance(rabbit, item) < 330 * scale && (!nearest || distance(rabbit, item) < distance(rabbit, nearest)) ? item : nearest, null);
        if (carrot && rabbit._carrotId !== carrot.id) {
          rabbit._carrotId = carrot.id;
          moveToward(rabbit, safePoint(carrot.x + between(-15, 15) * scale, carrot.y + between(-12, 12) * scale));
        } else if (!carrot) rabbit._carrotId = null;
        if (!rabbit.moving) {
          rabbit._wait -= dt;
          if (carrot && distance(rabbit, carrot) < 32 * scale) {
            carrot.remaining -= dt * 0.2;
          } else if (rabbit._wait <= 0) {
            moveToward(rabbit, safePoint(rabbit.x + between(-145, 145) * scale, rabbit.y + between(-105, 105) * scale));
          }
        }
      }
      advanceMovement(rabbit, dt);
    }
    for (const pair of [...pairs]) {
      const first = rabbits.find((rabbit) => rabbit.id === pair.firstId);
      const second = rabbits.find((rabbit) => rabbit.id === pair.secondId);
      if (!first || !second) {
        endPair(pair, true);
        continue;
      }
      if (pair.phase === "approaching" && !first.moving && !second.moving) {
        pair.phase = "nesting";
        first.state = second.state = "nesting";
      }
      if (pair.phase === "nesting") {
        pair.elapsed += dt;
        pair.progress = Math.min(1, pair.elapsed / nestingDuration);
        first.pairProgress = second.pairProgress = pair.progress;
        if (pair.elapsed >= nestingDuration) {
          if (totalCount() < maxRabbits) {
            const baby = makeRabbit(pair.x, pair.y + 15 * scale);
            rabbits.push(baby);
            bornCount += 1;
            emit("birth", { rabbitId: baby.id, parentIds: [pair.firstId, pair.secondId], x: baby.x, y: baby.y });
          }
          endPair(pair);
        }
      }
    }
    pairCheck -= dt;
    if (pairCheck <= 0) {
      pairRabbits();
      pairCheck = 0.5;
    }
  }

  function addCarrot(x, y) {
    if (carrots.length >= 6) {
      emit("limit", { scope: "carrots" });
      return null;
    }
    const carrot = { id: nextCarrotId++, ...safePoint(x, y), remaining: 18, lifetime: 18 };
    carrots.push(carrot);
    emit("carrot", { carrotId: carrot.id, x: carrot.x, y: carrot.y });
    return carrot;
  }

  function catchAt(x, y, radius = 32) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || radius < 0) return null;
    const rabbit = rabbits.reduce((nearest, item) => distance(item, { x, y }) <= radius && (!nearest || distance(item, { x, y }) < distance(nearest, { x, y })) ? item : nearest, null);
    if (!rabbit) return null;
    const pair = pairs.find((item) => item.id === rabbit.pairId);
    if (pair) endPair(pair, true);
    rabbits.splice(rabbits.indexOf(rabbit), 1);
    settle(rabbit);
    rabbit.state = "basket";
    basket.push(rabbit);
    emit("catch", { rabbitId: rabbit.id, x: rabbit.x, y: rabbit.y });
    return rabbit;
  }

  function releaseOne(x, y) {
    if (!basket.length || rabbits.length >= maxRabbits) return null;
    const rabbit = basket.shift();
    Object.assign(rabbit, safePoint(x, y));
    settle(rabbit);
    rabbit.cooldown = Math.max(rabbit.cooldown, 5);
    rabbits.push(rabbit);
    emit("release", { rabbitId: rabbit.id, x: rabbit.x, y: rabbit.y });
    return rabbit;
  }

  function resize(newWidth, newHeight) {
    if (!Number.isFinite(newWidth) || !Number.isFinite(newHeight) || newWidth <= 0 || newHeight <= 0) return false;
    newWidth = Math.max(240, newWidth);
    newHeight = Math.max(160, newHeight);
    if (newWidth === width && newHeight === height) return false;
    const ratioX = newWidth / width;
    const ratioY = newHeight / height;
    const oldScale = scale;
    // Existing paths and meetings were planned around the old pond. Let those
    // partners rest and meet again, without losing any animals or advancing time.
    for (const pair of [...pairs]) endPair(pair, true);
    width = newWidth;
    height = newHeight;
    rebuildGeometry();
    for (const rabbit of [...rabbits, ...basket]) {
      Object.assign(rabbit, safePoint(rabbit.x * ratioX, rabbit.y * ratioY));
      rabbit._speed *= scale / oldScale;
      const wasInBasket = rabbit.state === "basket";
      settle(rabbit);
      if (wasInBasket) rabbit.state = "basket";
    }
    for (const carrot of carrots) Object.assign(carrot, safePoint(carrot.x * ratioX, carrot.y * ratioY));
    // Feedback waiting for the next render should appear in the resized world.
    for (const event of events) {
      if (Number.isFinite(event.x) && Number.isFinite(event.y)) {
        Object.assign(event, safePoint(event.x * ratioX, event.y * ratioY));
      }
    }
    pairCheck = 0.5;
    return true;
  }

  function reset() {
    rabbits.length = carrots.length = basket.length = pairs.length = events.length = 0;
    nextRabbitId = nextCarrotId = nextPairId = 1;
    time = bornCount = pairCheck = 0;
    for (let index = 0; index < initialCount; index += 1) rabbits.push(makeRabbit(undefined, undefined, true));
  }

  function snapshot() {
    const publicRabbit = ({ _path, _speed, _wait, _carrotId, ...rabbit }) => ({ ...rabbit });
    return {
      width, height, maxRabbits, time, bornCount,
      rabbits: rabbits.map(publicRabbit), basket: basket.map(publicRabbit),
      carrots: carrots.map((carrot) => ({ ...carrot })), pairs: pairs.map((pair) => ({ ...pair })),
    };
  }

  reset();
  return {
    get width() { return width; },
    get height() { return height; },
    maxRabbits, adultAge, rabbits, carrots, basket, pairs,
    get time() { return time; },
    get bornCount() { return bornCount; },
    get totalCount() { return totalCount(); },
    update, addCarrot, catchAt, releaseOne, resize, reset, snapshot, isSafePosition,
    consumeEvents() { return events.splice(0); },
  };
}
