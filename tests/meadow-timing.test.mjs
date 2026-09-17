import test from 'node:test';
import assert from 'node:assert/strict';
import {createPollTiming} from '../app/static/meadow-timing.js';

test('constant 200 ms requests keep one-second starts instead of adding latency each poll', () => {
  const timing = createPollTiming();
  let start = 0;
  for (let index = 0; index < 12; index++) {
    const reply = start + 200;
    const result = timing.complete(timing.begin(start), reply);
    assert.equal(result.delay, 800);
    assert.ok(result.interpolationDuration >= 1250);
    assert.ok(result.interpolationDuration <= 1450);
    assert.equal(reply + result.delay, (index + 1) * 1000);
    start = reply + result.delay;
  }
});

test('first response reserves an RTT and arrival-jitter allowance', () => {
  const timing = createPollTiming();
  assert.deepEqual(timing.complete(timing.begin(0), 200), {
    delay: 800, interpolationDuration: 1450,
  });
});

test('variable latency expands immediately and a recent spike decays gradually', () => {
  const timing = createPollTiming();
  timing.complete(timing.begin(0), 200);
  const spike = timing.complete(timing.begin(1000), 1700);
  assert.equal(spike.delay, 300);
  assert.equal(spike.interpolationDuration, 1750); // 1500 ms between replies + cushion.
  let previous = spike.interpolationDuration;
  for (let start = 2000; start <= 15000; start += 1000) {
    const result = timing.complete(timing.begin(start), start + 200);
    assert.ok(result.interpolationDuration <= previous);
    assert.ok(previous - result.interpolationDuration <= 100);
    assert.ok(result.interpolationDuration >= 1250);
    if (start <= 6000) assert.equal(result.interpolationDuration, 1750);
    previous = result.interpolationDuration;
  }
  assert.equal(previous, 1250);
});

test('slow successful requests are bounded and never schedule catch-up bursts', () => {
  const timing = createPollTiming();
  let start = 0;
  for (const latency of [1500, 2200, 4000, 9000]) {
    const reply = start + latency;
    const result = timing.complete(timing.begin(start), reply);
    assert.equal(result.delay, 100);
    assert.ok(result.interpolationDuration >= 1000);
    assert.ok(result.interpolationDuration <= 2500);
    start = reply + result.delay;
  }
});

test('a long hidden or failed-connection gap resets stale estimates on return', () => {
  const timing = createPollTiming();
  timing.complete(timing.begin(0), 2000);
  assert.equal(timing.complete(timing.begin(2100), 4100).interpolationDuration, 2500);
  assert.deepEqual(timing.complete(timing.begin(20000), 20200), {
    delay: 800, interpolationDuration: 1450,
  });
});

test('invalid or backwards clock input cannot poison subsequent healthy polling', () => {
  for (const [start, reply] of [[NaN, 2000], [2000, Infinity], [3000, 2500], [-1, 1000], [500, 900]]) {
    const timing = createPollTiming();
    timing.complete(timing.begin(0), 1000);
    assert.deepEqual(timing.complete(timing.begin(start), reply), {
      delay: 1000, interpolationDuration: 1250,
    });
    assert.deepEqual(timing.complete(timing.begin(10000), 10200), {
      delay: 800, interpolationDuration: 1450,
    });
  }
});

test('custom cadence retains hard animation bounds and a minimum network breather', () => {
  const timing = createPollTiming(500);
  assert.deepEqual(timing.complete(timing.begin(0), 50), {
    delay: 450, interpolationDuration: 1000,
  });
  assert.deepEqual(timing.complete(timing.begin(500), 2000), {
    delay: 100, interpolationDuration: 2200,
  });
  for (const interval of [0, -1, 99, NaN, Infinity]) {
    assert.throws(() => createPollTiming(interval), RangeError);
  }
});

test('explicit reset discards a modal or failed-poll cadence before the next healthy response', () => {
  const timing = createPollTiming();
  assert.equal(timing.complete(timing.begin(0), 2000).interpolationDuration, 2500);
  timing.reset();
  assert.deepEqual(timing.complete(timing.begin(2100), 2300), {
    delay: 800, interpolationDuration: 1450,
  });
  timing.reset();
  timing.reset();
  assert.deepEqual(timing.complete(timing.begin(2400), 2400), {
    delay: 1000, interpolationDuration: 1250,
  });
});
