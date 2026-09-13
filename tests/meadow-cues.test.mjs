import test from 'node:test';
import assert from 'node:assert/strict';
import { wildlifeCueFrame } from '../app/static/meadow-cues.js';

const viewport = {width: 1000, height: 600};
const encounter = (kind, phase = 'warning', remaining = 3) => ({
  time: 42, rabbits: [{id: 7, x: 700, y: 350}],
  encounter: {id: 2, kind, phase, remaining, x: 28, y: 240, direction: 1, targetId: 7},
});

test('the same shared encounter produces the same cue with no local random clock', () => {
  const state = encounter('eagle');
  const original = structuredClone(state);
  const first = wildlifeCueFrame(state, viewport);
  assert.deepEqual(wildlifeCueFrame(structuredClone(state), viewport), first);
  assert.deepEqual(state, original);
  const later = encounter('eagle', 'warning', .5);
  assert.ok(wildlifeCueFrame(later, viewport).x > first.x);
  assert.equal(wildlifeCueFrame({...state, time: 900}, viewport).x, first.x);
});

test('cues are tied to actual wildlife phases and disappear when the event does', () => {
  assert.equal(wildlifeCueFrame({encounter: null}, viewport), null);
  assert.equal(wildlifeCueFrame(encounter('eagle', 'chasing', 8), viewport), null);
  assert.equal(wildlifeCueFrame(encounter('wolf', 'leaving'), viewport), null);
  const chasing = wildlifeCueFrame(encounter('wolf', 'chasing', 8), viewport);
  assert.equal(chasing.type, 'dust');
  assert.equal(chasing.x, 28); assert.equal(chasing.y, 240);
});

test('warning grass stays at the shared entry point across screen shapes', () => {
  const state = encounter('wolf');
  const desktop = wildlifeCueFrame(state, viewport);
  const portrait = wildlifeCueFrame(state, {width: 390, height: 844});
  assert.equal(desktop.x / 1000, portrait.x / 390);
  assert.equal(desktop.y / 600, portrait.y / 844);
  assert.equal(wildlifeCueFrame(encounter('wolf', 'warning', 0), viewport).x, desktop.x);
});

test('reduced motion retains a still warning without moving shadow or chase dust', () => {
  const options = {...viewport, reducedMotion: true};
  const early = wildlifeCueFrame(encounter('eagle'), options);
  const late = wildlifeCueFrame(encounter('eagle', 'warning', .1), options);
  assert.equal(early.x, late.x); assert.equal(early.y, late.y);
  assert.equal(early.opacity, late.opacity); assert.equal(early.time, 0);
  assert.equal(wildlifeCueFrame(encounter('wolf'), options).time, 0);
  assert.equal(wildlifeCueFrame(encounter('wolf', 'chasing', 8), options), null);
});
