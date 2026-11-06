import {
  AdsrEnvelope,
  ClockedAdsr,
  type AdsrConfig,
  type EnvelopePhase,
  type EnvelopeState,
  type MillisecondClock,
} from '@lp-labs/audio-envelope';
const config: AdsrConfig = {
  sampleRate: 1000,
  attackSeconds: 0.01,
  decaySeconds: 0.02,
  sustainLevel: 0.5,
  releaseSeconds: 0.03,
  curve: 'exponential',
};
const envelope = new AdsrEnvelope(config);
envelope.noteOn();
const phase: EnvelopePhase = envelope.phase;
const state: EnvelopeState = envelope.snapshot();
const clock: MillisecondClock = () => 0;
new ClockedAdsr(config, clock).level().toFixed();
phase.length.toFixed();
state.level.toFixed();
envelope.render(4).length.toFixed();
// @ts-expect-error sustainLevel is required
new AdsrEnvelope({ sampleRate: 1, attackSeconds: 0, decaySeconds: 0, releaseSeconds: 0 });
// @ts-expect-error unknown curve
new AdsrEnvelope({ ...config, curve: 'log' });
// @ts-expect-error phase is read-only
envelope.phase = 'idle';
// @ts-expect-error clock must be a function
new ClockedAdsr(config, 5);
