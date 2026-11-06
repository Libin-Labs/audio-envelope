export type EnvelopePhase = 'idle' | 'attack' | 'decay' | 'sustain' | 'release';
export type EnvelopeCurve = 'linear' | 'exponential';
/** Returns the current time in milliseconds; must be finite and non-decreasing. */
export type MillisecondClock = () => number;

export interface AdsrConfig {
  sampleRate: number;
  attackSeconds: number;
  decaySeconds: number;
  /** 0..1 */
  sustainLevel: number;
  releaseSeconds: number;
  curve?: EnvelopeCurve;
}

export interface EnvelopeState {
  readonly phase: EnvelopePhase;
  readonly level: number;
  /** Samples already spent in the current ramp phase (0 for idle/sustain). */
  readonly phaseIndex: number;
  /** Total samples of the current ramp phase (0 for idle/sustain). */
  readonly phaseLength: number;
}

export const MAX_SAMPLE_RATE = 1_000_000;
export const MAX_PHASE_SECONDS = 86_400;
export const DEFAULT_MAX_RENDER_FRAMES = 16_777_216;

type RampPhase = 'attack' | 'decay' | 'release';

function seconds(name: string, value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_PHASE_SECONDS
  ) {
    throw new RangeError(`${name} must be a finite number from 0 to ${MAX_PHASE_SECONDS}`);
  }
  return value;
}

function count(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

/** Deterministic sample-counted ADSR. Level is always within [0, 1]; no wall clock is read. */
export class AdsrEnvelope {
  readonly sampleRate: number;
  readonly sustainLevel: number;
  readonly curve: EnvelopeCurve;
  readonly #lengths: Readonly<Record<RampPhase, number>>;
  #phase: EnvelopePhase = 'idle';
  #level = 0;
  #index = 0;
  #length = 0;
  #start = 0;
  #target = 0;

  constructor(config: AdsrConfig) {
    if (typeof config !== 'object' || config === null)
      throw new TypeError('config must be an object');
    const rate = config.sampleRate;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > MAX_SAMPLE_RATE) {
      throw new RangeError(`sampleRate must be a positive finite number up to ${MAX_SAMPLE_RATE}`);
    }
    const sustain = config.sustainLevel;
    if (typeof sustain !== 'number' || !Number.isFinite(sustain) || sustain < 0 || sustain > 1) {
      throw new RangeError('sustainLevel must be from 0 to 1');
    }
    const curve = config.curve ?? 'linear';
    if (curve !== 'linear' && curve !== 'exponential') throw new TypeError('unknown curve');
    this.sampleRate = rate;
    this.sustainLevel = sustain;
    this.curve = curve;
    this.#lengths = {
      attack: Math.round(seconds('attackSeconds', config.attackSeconds) * rate),
      decay: Math.round(seconds('decaySeconds', config.decaySeconds) * rate),
      release: Math.round(seconds('releaseSeconds', config.releaseSeconds) * rate),
    };
  }

  get phase(): EnvelopePhase {
    return this.#phase;
  }

  get level(): number {
    return this.#level;
  }

  snapshot(): EnvelopeState {
    const ramp = this.#phase === 'attack' || this.#phase === 'decay' || this.#phase === 'release';
    return {
      phase: this.#phase,
      level: this.#level,
      phaseIndex: ramp ? this.#index : 0,
      phaseLength: ramp ? this.#length : 0,
    };
  }

  /** Starts (or retriggers from the current level) the attack phase. */
  noteOn(): void {
    this.#begin('attack');
  }

  /** Starts release from the current level unless idle or already releasing. */
  noteOff(): void {
    if (this.#phase === 'attack' || this.#phase === 'decay' || this.#phase === 'sustain') {
      this.#begin('release');
    }
  }

  gate(on: boolean): void {
    if (typeof on !== 'boolean') throw new TypeError('gate expects a boolean');
    if (on) this.noteOn();
    else this.noteOff();
  }

  reset(): void {
    this.#phase = 'idle';
    this.#level = 0;
    this.#index = 0;
    this.#length = 0;
  }

  /** Returns the level for the current sample, then advances one sample. */
  next(): number {
    const value = this.#level;
    this.advance(1);
    return value;
  }

  /** Advances by whole samples in O(phases) and returns the new level. */
  advance(samples: number): number {
    let remaining = count('samples', samples);
    while (remaining > 0 && this.#length > 0) {
      const left = this.#length - this.#index;
      if (remaining >= left) {
        remaining -= left;
        this.#level = this.#target;
        this.#land();
      } else {
        this.#index += remaining;
        remaining = 0;
        this.#level = this.#shaped();
      }
    }
    return this.#level;
  }

  render(frames: number, maxFrames = DEFAULT_MAX_RENDER_FRAMES): Float32Array {
    count('frames', frames);
    if (frames > count('maxFrames', maxFrames)) throw new RangeError('frames exceeds maxFrames');
    const output = new Float32Array(frames);
    for (let i = 0; i < frames; i++) output[i] = this.next();
    return output;
  }

  #shaped(): number {
    const progress = this.#index / this.#length;
    const shaped = this.curve === 'linear' ? progress : 1 - (1 - progress) ** 3;
    return this.#start + (this.#target - this.#start) * shaped;
  }

  #begin(phase: RampPhase): void {
    const target = phase === 'attack' ? 1 : phase === 'decay' ? this.sustainLevel : 0;
    const length = this.#lengths[phase];
    if (length === 0 || (phase === 'release' && this.#level === 0)) {
      this.#level = target;
      this.#phase = phase;
      this.#length = 0;
      this.#index = 0;
      this.#land();
      return;
    }
    this.#phase = phase;
    this.#index = 0;
    this.#length = length;
    this.#start = this.#level;
    this.#target = target;
  }

  #land(): void {
    const finished = this.#phase;
    this.#length = 0;
    this.#index = 0;
    if (finished === 'attack') this.#begin('decay');
    else if (finished === 'decay') this.#phase = 'sustain';
    else this.#phase = 'idle';
  }
}

/** Drives an AdsrEnvelope from an injected millisecond clock; elapsed time becomes whole samples. */
export class ClockedAdsr {
  readonly envelope: AdsrEnvelope;
  readonly #clock: MillisecondClock;
  readonly #origin: number;
  #last: number;
  #consumed = 0;

  constructor(config: AdsrConfig, clock: MillisecondClock) {
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    this.envelope = new AdsrEnvelope(config);
    this.#clock = clock;
    this.#origin = this.#read(-Infinity);
    this.#last = this.#origin;
  }

  #read(minimum: number): number {
    const now = this.#clock();
    if (typeof now !== 'number' || !Number.isFinite(now) || now < minimum) {
      throw new RangeError('clock must return finite, non-decreasing milliseconds');
    }
    return now;
  }

  /** Advances the envelope to the clock's current time and returns the level. */
  level(): number {
    this.#last = this.#read(this.#last);
    const total = Math.floor(((this.#last - this.#origin) * this.envelope.sampleRate) / 1000);
    this.envelope.advance(total - this.#consumed);
    this.#consumed = total;
    return this.envelope.level;
  }

  noteOn(): void {
    this.level();
    this.envelope.noteOn();
  }

  noteOff(): void {
    this.level();
    this.envelope.noteOff();
  }
}
