/**
 * Declarative specs for the Live Spectrogram's example sounds.
 *
 * No Web Audio here on purpose: this file describes what each example *is*,
 * which keeps it pure and testable, and `spectrogramAudio.ts` turns a spec
 * into oscillators. Every example exists to make one specific shape appear on
 * the display; the page's "Things worth trying" list says what to look for.
 */

export type ExampleSpec =
  | { kind: 'partials'; partials: { hz: number; gain: number }[] }
  | { kind: 'sweep'; fromHz: number; toHz: number; sweep: 'log' | 'linear' }
  | { kind: 'noise'; color: 'white' | 'pink' };

export interface SynthExample {
  id: string;
  label: string;
  durationSeconds: number;
  spec: ExampleSpec;
}

/** Amplitudes falling as 1/n, the recipe that makes a sawtooth. */
const sawtoothPartials = (fundamentalHz: number, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    hz: fundamentalHz * (index + 1),
    gain: 1 / (index + 1),
  }));

export const SYNTH_EXAMPLES: SynthExample[] = [
  {
    id: 'pure-tone',
    label: 'Pure tone (440 Hz)',
    durationSeconds: 6,
    spec: { kind: 'partials', partials: [{ hz: 440, gain: 1 }] },
  },
  {
    id: 'octave-pair',
    label: 'Octave pair (220 + 440 Hz)',
    durationSeconds: 6,
    spec: { kind: 'partials', partials: [{ hz: 220, gain: 0.8 }, { hz: 440, gain: 0.8 }] },
  },
  {
    id: 'sawtooth-stack',
    label: 'Harmonic stack (110 Hz sawtooth)',
    durationSeconds: 6,
    spec: { kind: 'partials', partials: sawtoothPartials(110, 12) },
  },
  {
    id: 'log-sweep',
    label: 'Rising sweep (80 Hz to 8 kHz)',
    durationSeconds: 6,
    spec: { kind: 'sweep', fromHz: 80, toHz: 8000, sweep: 'log' },
  },
  {
    id: 'beats',
    label: 'Beats (440 + 444 Hz)',
    durationSeconds: 8,
    spec: { kind: 'partials', partials: [{ hz: 440, gain: 0.7 }, { hz: 444, gain: 0.7 }] },
  },
  {
    id: 'white-noise',
    label: 'White noise',
    durationSeconds: 5,
    spec: { kind: 'noise', color: 'white' },
  },
  {
    id: 'pink-noise',
    label: 'Pink noise',
    durationSeconds: 5,
    spec: { kind: 'noise', color: 'pink' },
  },
];

export const exampleById = (id: string): SynthExample | undefined =>
  SYNTH_EXAMPLES.find((example) => example.id === id);

/**
 * The frequencies this example should be producing at time `t`.
 *
 * Used for an optional "expected" marker on the overlay, and as the thing the
 * tests assert against - the sweep really is geometric in the middle, and the
 * sawtooth really is twelve integer multiples.
 */
export const expectedPeaksAt = (example: SynthExample, tSeconds: number): number[] => {
  const spec = example.spec;
  switch (spec.kind) {
    case 'partials':
      return spec.partials.map((partial) => partial.hz);
    case 'sweep': {
      const progress = Math.min(Math.max(tSeconds / example.durationSeconds, 0), 1);
      return [
        spec.sweep === 'log'
          ? spec.fromHz * (spec.toHz / spec.fromHz) ** progress
          : spec.fromHz + (spec.toHz - spec.fromHz) * progress,
      ];
    }
    case 'noise':
      return [];
    default:
      return [];
  }
};

const clampSample = (value: number): number => (value < -1 ? -1 : value > 1 ? 1 : value);

export const fillWhiteNoise = (out: Float32Array, random: () => number): void => {
  for (let i = 0; i < out.length; i += 1) {
    out[i] = clampSample(random() * 2 - 1);
  }
};

/**
 * Paul Kellet's filter approximation of pink noise: roughly -3 dB per octave,
 * which is what gives the wash its visible downward tilt on the display.
 */
export const fillPinkNoise = (out: Float32Array, random: () => number): void => {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  for (let i = 0; i < out.length; i += 1) {
    const white = random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    out[i] = clampSample((b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11);
    b6 = white * 0.115926;
  }
};
