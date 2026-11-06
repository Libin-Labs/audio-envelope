import test from 'node:test';
import assert from 'node:assert/strict';
import { AdsrEnvelope, ClockedAdsr } from '../dist/esm/index.js';

const config = {
  sampleRate: 1000,
  attackSeconds: 0.01,
  decaySeconds: 0.02,
  sustainLevel: 0.5,
  releaseSeconds: 0.03,
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);

function referenceLevel(k, releaseAt) {
  const A = 10;
  const D = 20;
  const S = 0.5;
  const R = 30;
  const held = (i) => (i < A ? i / A : i < A + D ? 1 - (1 - S) * ((i - A) / D) : S);
  if (releaseAt === undefined || k < releaseAt) return held(k);
  const from = held(releaseAt);
  const r = k - releaseAt;
  return r >= R ? 0 : from * (1 - r / R);
}

test('rejects malformed configuration and calls', () => {
  assert.throws(() => new AdsrEnvelope(null), TypeError);
  for (const sampleRate of [0, -1, Number.NaN, 2_000_000, '1']) {
    assert.throws(() => new AdsrEnvelope({ ...config, sampleRate }), RangeError);
  }
  for (const key of ['attackSeconds', 'decaySeconds', 'releaseSeconds']) {
    for (const value of [-1, Number.NaN, Infinity, 90_000, undefined]) {
      assert.throws(() => new AdsrEnvelope({ ...config, [key]: value }), RangeError);
    }
  }
  for (const sustainLevel of [-0.1, 1.1, Number.NaN, undefined]) {
    assert.throws(() => new AdsrEnvelope({ ...config, sustainLevel }), RangeError);
  }
  assert.throws(() => new AdsrEnvelope({ ...config, curve: 'log' }), TypeError);
  const e = new AdsrEnvelope(config);
  for (const n of [-1, 1.5, Number.NaN, Infinity]) assert.throws(() => e.advance(n), RangeError);
  assert.throws(() => e.render(11, 10), RangeError);
  assert.throws(() => e.gate('yes'), TypeError);
  assert.throws(() => new ClockedAdsr(config, 1), TypeError);
  assert.throws(() => new ClockedAdsr(config, () => Number.NaN), RangeError);
});

test('idle envelope is silent and noteOff is a no-op', () => {
  const e = new AdsrEnvelope(config);
  e.noteOff();
  assert.equal(e.phase, 'idle');
  assert.deepEqual(Array.from(e.render(3)), [0, 0, 0]);
});

test('full gate cycle matches closed-form reference per sample', () => {
  const e = new AdsrEnvelope(config);
  e.noteOn();
  const out = [];
  for (let k = 0; k < 120; k++) {
    if (k === 50) e.noteOff();
    out.push(e.next());
  }
  out.forEach((v, k) => near(v, referenceLevel(k, 50)));
  assert.equal(e.phase, 'idle');
  assert.equal(e.level, 0);
});

test('release during attack and decay starts from the current level', () => {
  for (const releaseAt of [4, 15]) {
    const e = new AdsrEnvelope(config);
    e.noteOn();
    e.advance(releaseAt);
    const before = e.level;
    e.noteOff();
    assert.equal(e.phase, 'release');
    near(e.next(), before);
    const rest = Array.from(e.render(40));
    assert.ok(rest.every((v, i) => i === 0 || v <= rest[i - 1] + 1e-12));
    assert.equal(e.phase, 'idle');
  }
});

test('advance equals repeated next, snapshots describe phase position', () => {
  const a = new AdsrEnvelope({ ...config, curve: 'exponential' });
  const b = new AdsrEnvelope({ ...config, curve: 'exponential' });
  a.noteOn();
  b.noteOn();
  for (const step of [3, 9, 1, 25, 7, 100]) {
    for (let i = 0; i < step; i++) b.next();
    near(a.advance(step), b.level);
    assert.equal(a.phase, b.phase);
    assert.deepEqual(a.snapshot(), b.snapshot());
  }
  const s = new AdsrEnvelope(config);
  s.noteOn();
  s.advance(4);
  assert.deepEqual(s.snapshot(), { phase: 'attack', level: 0.4, phaseIndex: 4, phaseLength: 10 });
});

test('zero-length phases jump and retrigger resumes from current level', () => {
  const e = new AdsrEnvelope({ ...config, attackSeconds: 0, decaySeconds: 0 });
  e.noteOn();
  assert.equal(e.phase, 'sustain');
  assert.equal(e.level, 0.5);
  e.noteOff();
  e.advance(15);
  const mid = e.level;
  assert.ok(mid > 0 && mid < 0.5);
  const r = new AdsrEnvelope(config);
  r.noteOn();
  r.advance(40);
  r.noteOff();
  r.advance(15);
  const level = r.level;
  r.noteOn();
  assert.equal(r.phase, 'attack');
  near(r.next(), level);
  r.advance(9);
  assert.equal(r.phase, 'decay');
});

test('exponential curve is bounded, monotonic and exact at phase ends', () => {
  const e = new AdsrEnvelope({ ...config, attackSeconds: 0.05, curve: 'exponential' });
  e.noteOn();
  const attack = Array.from(e.render(50));
  assert.ok(attack.every((v, i) => v >= 0 && v <= 1 && (i === 0 || v > attack[i - 1])));
  assert.ok(attack[25] > 0.5);
  assert.equal(e.level, 1);
  e.advance(20);
  assert.equal(e.level, 0.5);
  assert.equal(e.phase, 'sustain');
});

test('clocked envelope follows an injected fake clock and rejects time travel', () => {
  let now = 1000;
  const c = new ClockedAdsr(config, () => now);
  assert.equal(c.level(), 0);
  now += 5;
  c.noteOn();
  now += 5;
  near(c.level(), 0.5);
  now += 25;
  assert.equal(c.level(), 0.5);
  assert.equal(c.envelope.phase, 'sustain');
  c.noteOff();
  now += 15;
  near(c.level(), 0.25);
  now += 15.9;
  assert.equal(c.level(), 0);
  assert.equal(c.envelope.phase, 'idle');
  now -= 1;
  assert.throws(() => c.level(), RangeError);
});
