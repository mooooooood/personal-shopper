import test from "node:test";
import assert from "node:assert/strict";
import { createMeadow, createSeededRandom } from "../app/static/meadow-model.js";

function advance(model, seconds, dt = 0.05) {
  for (let elapsed = 0; elapsed < seconds - 0.000001; elapsed += dt) model.update(Math.min(dt, seconds - elapsed));
}

function waitUntil(model, condition, seconds = 30) {
  for (let elapsed = 0; elapsed < seconds && !condition(); elapsed += 0.05) model.update(0.05);
  assert.ok(condition(), `Condition was not reached after ${seconds} seconds`);
}

test("the default meadow starts with 12 adults and deterministic safe positions", () => {
  const model = createMeadow();
  assert.equal(model.rabbits.length, 12);
  assert.deepEqual(model.snapshot(), createMeadow().snapshot());
  assert.ok(model.rabbits.every((rabbit) => rabbit.adult && model.isSafePosition(rabbit.x, rabbit.y)));
  assert.notDeepEqual(createMeadow({ random: createSeededRandom(1) }).snapshot(), createMeadow({ random: createSeededRandom(2) }).snapshot());
});

test("adult partners meet, show affection, and produce a baby before it grows up", () => {
  const model = createMeadow();
  waitUntil(model, () => model.pairs.some((pair) => pair.phase === "nesting"), 18);
  const pair = model.pairs.find((item) => item.phase === "nesting");
  const parents = [pair.firstId, pair.secondId].map((id) => model.rabbits.find((rabbit) => rabbit.id === id));
  assert.ok(parents.every((rabbit) => rabbit.state === "nesting" && rabbit.partnerId));
  assert.ok(Math.hypot(parents[0].x - parents[1].x, parents[0].y - parents[1].y) < 30);
  waitUntil(model, () => model.bornCount > 0, 4);
  assert.ok(model.time >= 12 && model.time <= 20, `First birth was at ${model.time}s`);
  const event = model.consumeEvents().find((item) => item.type === "birth");
  const baby = model.rabbits.find((rabbit) => rabbit.id === event.rabbitId);
  assert.equal(baby.adult, false);
  assert.equal(baby.age, 0);
  assert.ok(parents.every((rabbit) => !rabbit.pairId && rabbit.cooldown > 0));
  advance(model, 29);
  assert.equal(baby.adult, false);
  advance(model, 1.1);
  assert.equal(baby.adult, true);
});

test("catching one partner cancels that pair and cannot catch both at once", () => {
  const model = createMeadow({ initialCount: 2, seed: 42 });
  waitUntil(model, () => model.pairs.some((pair) => pair.phase === "nesting"), 25);
  const pair = model.pairs[0];
  const first = model.rabbits.find((rabbit) => rabbit.id === pair.firstId);
  const second = model.rabbits.find((rabbit) => rabbit.id === pair.secondId);
  assert.equal(model.catchAt(first.x, first.y, 100).id, first.id);
  assert.equal(model.basket.length, 1);
  assert.equal(model.rabbits.length, 1);
  assert.equal(model.pairs.length, 0);
  assert.equal(second.partnerId, null);
  assert.equal(second.pairId, null);
  advance(model, 12);
  assert.equal(model.bornCount, 0);
  assert.equal(model.releaseOne(825, 135).id, first.id);
  assert.ok(model.isSafePosition(first.x, first.y));
  assert.equal(model.basket.length, 0);
  assert.equal(model.rabbits.length, 2);
});

test("birth reservations and basket storage respect the total population cap", () => {
  const model = createMeadow({ initialCount: 12, maxRabbits: 15 });
  waitUntil(model, () => model.totalCount === 15, 35);
  assert.equal(model.bornCount, 3);
  const captured = model.rabbits.slice(0, 6);
  for (const rabbit of captured) model.catchAt(rabbit.x, rabbit.y, 1);
  assert.equal(model.basket.length, 6);
  advance(model, 90);
  assert.equal(model.totalCount, 15);
  assert.equal(model.bornCount, 3);
  assert.equal(model.pairs.length, 0);
  while (model.basket.length) assert.ok(model.releaseOne());
  assert.equal(model.rabbits.length, 15);
  assert.equal(model.releaseOne(), null);
  advance(model, 40);
  assert.equal(model.totalCount, 15);
});

test("carrots attract rabbits, have a six-item limit, and expire", () => {
  const model = createMeadow({ initialCount: 1, seed: 3 });
  const rabbit = model.rabbits[0];
  const carrot = model.addCarrot(rabbit.x > 500 ? rabbit.x - 120 : rabbit.x + 120, rabbit.y);
  const before = Math.hypot(rabbit.x - carrot.x, rabbit.y - carrot.y);
  advance(model, 2.5);
  assert.ok(Math.hypot(rabbit.x - carrot.x, rabbit.y - carrot.y) < before / 2);
  for (let index = 0; index < 5; index += 1) assert.ok(model.addCarrot(825, 135));
  assert.equal(model.addCarrot(100, 100), null);
  assert.equal(model.carrots.length, 6);
  assert.ok(model.carrots.every((item) => model.isSafePosition(item.x, item.y)));
  advance(model, 20);
  assert.equal(model.carrots.length, 0);
});

test("all movements, births, and releases stay in bounds and out of the pond", () => {
  const model = createMeadow({ seed: "pond routes", initialCount: 24 });
  for (let step = 0; step < 3600; step += 1) {
    if (step % 200 === 0) model.addCarrot(step % 400 === 0 ? 700 : 960, 135);
    if (step % 400 === 0) {
      const rabbit = model.rabbits[0];
      model.catchAt(rabbit.x, rabbit.y, 1);
      model.releaseOne(step % 800 === 0 ? 825 : -100, step % 800 === 0 ? 135 : 10000);
    }
    model.update(0.05);
    assert.ok(model.rabbits.every((rabbit) => model.isSafePosition(rabbit.x, rabbit.y)), `Unsafe position at step ${step}`);
    assert.ok(model.totalCount <= 60);
    const pairedIds = model.pairs.flatMap((pair) => [pair.firstId, pair.secondId]);
    assert.equal(new Set(pairedIds).size, pairedIds.length);
  }
});

test("time only advances on small explicit updates and snapshots are independent", () => {
  const model = createMeadow();
  const before = model.snapshot();
  for (const dt of [0, -1, NaN, Infinity]) model.update(dt);
  assert.deepEqual(model.snapshot(), before);
  model.update(600);
  assert.equal(model.time, 0.1);
  assert.equal(model.bornCount, 0);
  before.rabbits[0].x = -1000;
  assert.ok(model.rabbits[0].x >= 0);
  model.addCarrot(500, 500);
  assert.equal(model.consumeEvents()[0].type, "carrot");
  assert.deepEqual(model.consumeEvents(), []);
  model.reset();
  assert.equal(model.time, 0);
  assert.equal(model.bornCount, 0);
  assert.equal(model.rabbits.length, 12);
  assert.equal(model.carrots.length, 0);
  assert.equal(model.basket.length, 0);
});

test("resizing an active family preserves rabbits, baskets, carrots, and elapsed time", () => {
  const model = createMeadow();
  waitUntil(model, () => model.bornCount > 0 && model.pairs.length > 0, 22);
  const baby = model.rabbits.find((rabbit) => !rabbit.adult);
  assert.ok(model.catchAt(baby.x, baby.y, 1));
  model.addCarrot(150, 120);
  model.addCarrot(825, 135);
  assert.ok(model.pairs.length > 0);

  function identity(snapshot) {
    return {
      time: snapshot.time, bornCount: snapshot.bornCount,
      rabbits: snapshot.rabbits.map(({ id, age, adult }) => ({ id, age, adult })),
      basket: snapshot.basket.map(({ id, age, adult }) => ({ id, age, adult })),
      carrots: snapshot.carrots.map(({ id, remaining, lifetime }) => ({ id, remaining, lifetime })),
    };
  }

  const before = model.snapshot();
  for (const [width, height] of [[459, 993], [1440, 820], [240, 160], [1000, 600]]) {
    assert.equal(model.resize(width, height), true);
    assert.equal(model.width, width);
    assert.equal(model.height, height);
    assert.deepEqual(identity(model.snapshot()), identity(before));
    assert.equal(model.pairs.length, 0);
    assert.ok([...model.rabbits, ...model.basket, ...model.carrots].every((item) => model.isSafePosition(item.x, item.y)));
    assert.ok(model.rabbits.every((rabbit) => !rabbit.pairId && !rabbit.partnerId && !rabbit.moving));
    assert.ok(model.basket.every((rabbit) => rabbit.state === "basket"));
    const sameSize = model.snapshot();
    assert.equal(model.resize(width, height), false);
    assert.deepEqual(model.snapshot(), sameSize);
  }
  assert.equal(model.consumeEvents().filter((event) => event.type === "birth").length, before.bornCount);
  assert.ok(model.releaseOne(825, 135));
  const priorBirths = model.bornCount;
  waitUntil(model, () => model.bornCount > priorBirths, 25);
  assert.ok(model.rabbits.every((rabbit) => model.isSafePosition(rabbit.x, rabbit.y)));
});

test("repeated orientation changes rebuild safe routes without resetting the meadow", () => {
  const model = createMeadow({ seed: "rotating meadow" });
  for (const [width, height] of [[430, 920], [1200, 680], [320, 1000], [1600, 480]]) {
    const time = model.time;
    const count = model.totalCount;
    model.resize(width, height);
    assert.equal(model.time, time);
    assert.equal(model.totalCount, count);
    for (let step = 0; step < 800; step += 1) {
      if (step % 250 === 0) model.addCarrot(width * (step % 500 === 0 ? 0.69 : 0.96), height * 0.225);
      model.update(0.05);
      assert.ok(model.rabbits.every((rabbit) => model.isSafePosition(rabbit.x, rabbit.y)));
      assert.ok(model.totalCount <= model.maxRabbits);
    }
  }
  const before = model.snapshot();
  for (const dimensions of [[NaN, 500], [500, Infinity], [-100, 500], [500, 0]]) {
    assert.equal(model.resize(...dimensions), false);
    assert.deepEqual(model.snapshot(), before);
  }
  model.resize(1, 1);
  assert.equal(model.width, 240);
  assert.equal(model.height, 160);
  assert.ok(model.rabbits.every((rabbit) => model.isSafePosition(rabbit.x, rabbit.y)));
});
