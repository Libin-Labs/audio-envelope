# @lp-labs/audio-envelope

A deterministic ADSR envelope generator whose state advances by counted samples or by an injected millisecond clock. Catalog identity 486; standalone package version 1.0.0.
No runtime, peer, or sibling dependencies. Node >=18, ESM and CommonJS with declarations.

## Install

```sh
npm install @lp-labs/audio-envelope
```

## Quickstart (runnable JavaScript)

```js
import assert from 'node:assert/strict';
import { AdsrEnvelope, ClockedAdsr } from '@lp-labs/audio-envelope';
const config = {
  sampleRate: 1000,
  attackSeconds: 0.01,
  decaySeconds: 0.02,
  sustainLevel: 0.5,
  releaseSeconds: 0.03,
};
const envelope = new AdsrEnvelope(config);
envelope.noteOn();
assert.equal(envelope.next(), 0);
envelope.advance(9);
assert.equal(envelope.level, 1);
envelope.advance(20);
assert.equal(envelope.phase, 'sustain');
envelope.noteOff();
envelope.advance(30);
assert.equal(envelope.phase, 'idle');

let now = 0;
const clocked = new ClockedAdsr(config, () => now);
clocked.noteOn();
now = 5;
assert.equal(clocked.level(), 0.5);
```

## Configuration and errors

`AdsrConfig`: `sampleRate` (positive, at most 1000000), `attackSeconds`, `decaySeconds`, `releaseSeconds` (each 0..86400, converted with `Math.round(seconds * sampleRate)` samples) and `sustainLevel` (0..1). `curve` is `linear` (default) or `exponential` (progress shaped by `1 - (1 - p)^3`, fast then slow). A zero-length phase is skipped instantly.

Phases: `idle`, `attack` (current level to 1), `decay` (1 to sustain), `sustain`, `release` (current level to 0). `noteOn()` always starts a new attack from the current level (retrigger without a click); `noteOff()` releases from the current level during attack, decay or sustain and is a no-op while idle or releasing. `next()` returns the level for the current sample and then advances one sample; `advance(n)` skips n whole samples in O(phases) and returns the new level; `render(frames, maxFrames)` returns a Float32Array; `snapshot()` returns an immutable state record; `reset()` returns to idle.

`ClockedAdsr(config, clock)` converts elapsed milliseconds from the injected clock into whole samples (`floor(elapsedMs * sampleRate / 1000)` since construction, so no drift) before each `level()`, `noteOn()` or `noteOff()`. The clock is supplied by the caller, for example `() => performance.now()` or a fake in tests.

Errors: `TypeError` for a non-object config, unknown curve, non-function clock or non-boolean gate; `RangeError` for out-of-range numbers, negative or fractional sample counts, exceeded `maxFrames` and a clock that is non-finite or moves backwards.

## Complete public declarations

Every runtime export and public type is shown below. This is the complete emitted declaration surface.

```ts
export type EnvelopePhase = 'idle' | 'attack' | 'decay' | 'sustain' | 'release';
export type EnvelopeCurve = 'linear' | 'exponential';
export type MillisecondClock = () => number;
export interface AdsrConfig {
  sampleRate: number;
  attackSeconds: number;
  decaySeconds: number;
  sustainLevel: number;
  releaseSeconds: number;
  curve?: EnvelopeCurve;
}
export interface EnvelopeState {
  readonly phase: EnvelopePhase;
  readonly level: number;
  readonly phaseIndex: number;
  readonly phaseLength: number;
}
export declare const MAX_SAMPLE_RATE = 1000000;
export declare const MAX_PHASE_SECONDS = 86400;
export declare const DEFAULT_MAX_RENDER_FRAMES = 16777216;
export declare class AdsrEnvelope {
  #private;
  readonly sampleRate: number;
  readonly sustainLevel: number;
  readonly curve: EnvelopeCurve;
  constructor(config: AdsrConfig);
  get phase(): EnvelopePhase;
  get level(): number;
  snapshot(): EnvelopeState;
  noteOn(): void;
  noteOff(): void;
  gate(on: boolean): void;
  reset(): void;
  next(): number;
  advance(samples: number): number;
  render(frames: number, maxFrames?: number): Float32Array;
}
export declare class ClockedAdsr {
  #private;
  readonly envelope: AdsrEnvelope;
  constructor(config: AdsrConfig, clock: MillisecondClock);
  level(): number;
  noteOn(): void;
  noteOff(): void;
}
```

## Performance, boundaries and limitations

Only the envelope shape is produced: there is no oscillator, audio graph, Web Audio or browser dependency, and no velocity, hold stage, loop or multi-segment envelope. Level is always within [0, 1], state is a handful of numbers (bounded), and the same calls always produce the same values. Rounding phase durations to whole samples means sub-sample timing is not represented; `ClockedAdsr` quantises time to whole samples and drops sub-sample remainders only by flooring the running total. Cost per sample is O(1); `advance` is O(1) per phase boundary crossed. `render` returns single-precision samples.

## Development

```sh
npm ci --offline
npm run build
npm run typecheck
npm test
npm run format:check
```

The offline install requires the locked development dependencies already in the npm cache.
Build emits separate ESM/CJS and declarations; type checks include bare-package .mts/.cts consumers with negative cases.
Runtime tests import only the single-quoted standalone dist entry and also run against installed offline tarballs.
No build artifacts or development dependencies are required at runtime.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
