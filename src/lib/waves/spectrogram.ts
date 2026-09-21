/**
 * Pure spectrogram math for the Live Spectrogram lab.
 *
 * Everything here is DOM-free so it can be tested under plain Node (see
 * tests/waves/spectrogram.test.ts). The island resolves CSS custom properties
 * to `[r, g, b]` triples and passes them in; this module never reads the
 * document.
 *
 * The one import that points at `src/components/` is deliberate: `mixRgb`,
 * `ensureContrast`, `relativeLuminance`, and `contrastRatio` in themeColors.ts
 * are pure functions, and tests/shared/run-tests.ts already imports that module
 * under Node. Duplicating them here would be worse than the odd direction.
 */
import {
  contrastRatio,
  ensureContrast,
  mixRgb,
  relativeLuminance,
  type Rgb,
} from '../../components/shared/themeColors.ts';

export type FrequencyScale = 'log' | 'linear';

/**
 * A0 to C10 - the extended musical range. Chosen over a flat 20 Hz-20 kHz
 * because every frequency a reader is likely to hunt for (a piano note, a
 * whistle, a vowel formant) sits inside it, and the top is already past where
 * a byte-quantized analyser has much left to say.
 */
export const MIN_FREQUENCY_HZ = 27.5;
export const MAX_FREQUENCY_HZ = 16744.04;

export const DEFAULT_MIN_DECIBELS = -90;
export const DEFAULT_MAX_DECIBELS = -20;

/** Columns visible at once: 8 seconds at one column per 60 Hz frame. */
export const PLOT_COLUMNS = 480;
/**
 * Columns kept. Three screenfuls, so a frozen display can be dragged back
 * through nearly half a minute. Without the surplus there is no past to
 * slide to - the ring would hold exactly what is already on screen.
 */
export const HISTORY_COLUMNS = 480 * 3;
export const COLUMN_PX = 2;
/**
 * Rows in the canvas backing store. More than the plot is usually shown at, so
 * that filling a tall fullscreen window stretches the image by well under 2x
 * rather than banding. The history's memory does not depend on this.
 */
export const PLOT_ROWS = 540;
export const PLOT_WIDTH_PX = PLOT_COLUMNS * COLUMN_PX;
/** One column per 60 Hz frame, so the display holds 8 seconds of history. */
export const HOP_SECONDS = 1 / 60;

export const FFT_SIZES = [1024, 2048, 4096, 8192] as const;
export type FftSize = (typeof FFT_SIZES)[number];
export const DEFAULT_FFT_SIZE: FftSize = 4096;

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/**
 * Keep the top of the axis below Nyquist. A device running at 32 kHz would
 * otherwise paint a permanently dead band across the upper third.
 */
export const usableMaxFrequency = (sampleRate: number): number =>
  Math.min(MAX_FREQUENCY_HZ, sampleRate * 0.49);

// ---------------------------------------------------------------------------
// Axis mapping
// ---------------------------------------------------------------------------

/** 0 at `minHz`, 1 at `maxHz`. Unclamped, so callers can detect out-of-range. */
export const frequencyToFraction = (
  hz: number,
  minHz: number,
  maxHz: number,
  scale: FrequencyScale,
): number =>
  scale === 'linear'
    ? (hz - minHz) / (maxHz - minHz)
    : Math.log(hz / minHz) / Math.log(maxHz / minHz);

export const fractionToFrequency = (
  fraction: number,
  minHz: number,
  maxHz: number,
  scale: FrequencyScale,
): number =>
  scale === 'linear'
    ? minHz + fraction * (maxHz - minHz)
    : minHz * (maxHz / minHz) ** fraction;

/** Row 0 is the top of the plot, so low frequencies land at the bottom. */
export const frequencyToRow = (
  hz: number,
  minHz: number,
  maxHz: number,
  scale: FrequencyScale,
  rows: number,
): number => (1 - clamp(frequencyToFraction(hz, minHz, maxHz, scale), 0, 1)) * (rows - 1);

export const rowToFrequency = (
  row: number,
  minHz: number,
  maxHz: number,
  scale: FrequencyScale,
  rows: number,
): number => fractionToFrequency(1 - row / (rows - 1), minHz, maxHz, scale);

// ---------------------------------------------------------------------------
// FFT plumbing
//
// `binBandwidth` and `windowSeconds` are surfaced directly in the UI: they are
// the Gabor tradeoff the lesson teaches, and their product is exactly 1.
// ---------------------------------------------------------------------------

export const binCountFor = (fftSize: number): number => fftSize / 2;

export const binFrequency = (bin: number, sampleRate: number, fftSize: number): number =>
  (bin * sampleRate) / fftSize;

/** Float, so peak interpolation and row planning can work between bins. */
export const frequencyToBin = (hz: number, sampleRate: number, fftSize: number): number =>
  (hz * fftSize) / sampleRate;

export const binBandwidth = (sampleRate: number, fftSize: number): number => sampleRate / fftSize;

export const windowSeconds = (fftSize: number, sampleRate: number): number => fftSize / sampleRate;

// ---------------------------------------------------------------------------
// Level conversion
//
// These exactly invert AnalyserNode.getByteFrequencyData, which is what makes
// the cursor probe's decibel reading a real measurement rather than a guess.
// ---------------------------------------------------------------------------

export const byteToDecibels = (byte: number, minDb: number, maxDb: number): number =>
  minDb + (clamp(byte, 0, 255) / 255) * (maxDb - minDb);

export const decibelsToByte = (db: number, minDb: number, maxDb: number): number =>
  clamp(Math.round(((db - minDb) / (maxDb - minDb)) * 255), 0, 255);

/**
 * Re-encode a byte captured under one display range into another.
 *
 * Columns already in the history were quantized against the analyser's
 * min/maxDecibels at capture time. When the reader moves the floor we neither
 * clear the history (annoying) nor redraw it against the wrong range (a lie):
 * each column carries its own range and gets renormalized on redraw.
 */
export const renormalizeByte = (
  byte: number,
  fromMin: number,
  fromMax: number,
  toMin: number,
  toMax: number,
): number =>
  fromMin === toMin && fromMax === toMax
    ? clamp(Math.round(byte), 0, 255)
    : decibelsToByte(byteToDecibels(byte, fromMin, fromMax), toMin, toMax);

export const formatDecibels = (db: number): string =>
  `${db < 0 ? '-' : ''}${Math.abs(db).toFixed(0)} dB`;

// ---------------------------------------------------------------------------
// Row -> bin plan
//
// Sampling the nearest bin per row is wrong in both directions. On a log axis
// with 2048 bins over 360 rows the top octave packs hundreds of bins into a
// few dozen rows, so nearest-sampling silently drops most peaks; the bottom
// octave has fewer than one bin per row, so it bands. Pool with a max over the
// covered bins where a row spans several, and interpolate where it spans none.
// ---------------------------------------------------------------------------

export interface RowBinPlan {
  rows: number;
  /** First bin covered by the row. */
  start: Uint16Array;
  /** Last bin covered, always >= start. Equal to start on interpolated rows. */
  end: Uint16Array;
  /** Position between `start` and `start + 1`; only meaningful when end === start. */
  frac: Float32Array;
}

export interface RowBinPlanOptions {
  rows: number;
  binCount: number;
  sampleRate: number;
  fftSize: number;
  minHz: number;
  maxHz: number;
  scale: FrequencyScale;
}

export const buildRowBinPlan = (options: RowBinPlanOptions): RowBinPlan => {
  const { rows, binCount, sampleRate, fftSize, minHz, maxHz, scale } = options;
  const start = new Uint16Array(rows);
  const end = new Uint16Array(rows);
  const frac = new Float32Array(rows);
  const lastBin = binCount - 1;

  for (let row = 0; row < rows; row += 1) {
    const lowHz = rowToFrequency(Math.min(row + 0.5, rows - 1), minHz, maxHz, scale, rows);
    const highHz = rowToFrequency(Math.max(row - 0.5, 0), minHz, maxHz, scale, rows);
    const lowBin = frequencyToBin(lowHz, sampleRate, fftSize);
    const highBin = frequencyToBin(highHz, sampleRate, fftSize);

    // Bins whose centres fall inside this row's band. Adjacent rows share an
    // edge, so ceil/floor hands off without leaving a bin uncovered.
    const first = Math.ceil(lowBin);
    const last = Math.floor(highBin);

    if (last >= first) {
      start[row] = clamp(first, 0, lastBin);
      end[row] = clamp(last, start[row], lastBin);
      frac[row] = 0;
    } else {
      // No bin centre in this row: the analyser is coarser than the display
      // here, so interpolate between the two nearest bins instead of banding.
      const centreBin = frequencyToBin(
        rowToFrequency(row, minHz, maxHz, scale, rows),
        sampleRate,
        fftSize,
      );
      const base = clamp(Math.floor(centreBin), 0, lastBin);
      start[row] = base;
      end[row] = base;
      frac[row] = clamp(centreBin - base, 0, 1);
    }
  }

  return { rows, start, end, frac };
};

export const sampleRow = (data: Uint8Array, plan: RowBinPlan, row: number): number => {
  const first = plan.start[row];
  const last = plan.end[row];

  if (last > first) {
    let peak = 0;
    for (let bin = first; bin <= last; bin += 1) {
      if (data[bin] > peak) peak = data[bin];
    }
    return peak;
  }

  const fraction = plan.frac[row];
  if (fraction > 0 && first + 1 < data.length) {
    return data[first] + (data[first + 1] - data[first]) * fraction;
  }
  return data[first];
};

// ---------------------------------------------------------------------------
// Colormap
// ---------------------------------------------------------------------------

export interface RampStops {
  /** --surface-plot: what silence looks like. */
  background: Rgb;
  /** --accent-blue */
  cool: Rgb;
  /** --accent-red */
  warm: Rgb;
  /** --text-primary, used to darken the hot end on a light surface. */
  ink: Rgb;
}

const WHITE: Rgb = [255, 255, 255];

interface RampKey {
  at: number;
  color: Rgb;
}

const rampKeysFor = ({ background, cool, warm, ink }: RampStops): RampKey[] => {
  const lightSurface = relativeLuminance(background) > 0.5;

  // On a light or Paper surface, loud has to read as dark ink: a ramp that
  // brightened toward white would make the loudest sounds invisible on #fbf7ef.
  // On a dark surface, loud reads as bright, like every other audio tool.
  //
  // The keys are placed by *target contrast* rather than by mixing toward a
  // fixed color, because in these palettes red and blue sit at almost the same
  // luminance: an unguided blue-to-red ramp is flat in the middle, and forcing
  // it monotonic afterwards crushes the whole top half to solid black. Asking
  // for a contrast each key must reach keeps the hue and the ordering.
  const coolContrast = Math.max(contrastRatio(cool, background), 3);
  // The hottest color leans toward the theme's own extreme - its text color on
  // a light surface, white on a dark one - so the top of the ramp belongs to
  // the palette rather than being an arbitrary black.
  const extreme: Rgb = lightSurface ? ink : WHITE;

  return [
    { at: 0, color: background },
    { at: 0.12, color: mixRgb(background, cool, lightSurface ? 0.25 : 0.28) },
    { at: 0.34, color: mixRgb(background, cool, lightSurface ? 0.7 : 0.72) },
    { at: 0.52, color: ensureContrast(cool, background, coolContrast) },
    { at: 0.64, color: ensureContrast(mixRgb(cool, warm, 0.5), background, coolContrast * 1.2) },
    { at: 0.82, color: ensureContrast(warm, background, coolContrast * 1.55) },
    {
      at: 1,
      color: ensureContrast(
        mixRgb(warm, extreme, 0.25),
        background,
        coolContrast * (lightSurface ? 2.35 : 2.2),
      ),
    },
  ];
};

/**
 * A 256-entry RGB lookup table, flat, for direct use in an ImageData loop.
 *
 * Monotone by construction rather than by correction. Each key has to reach a
 * higher contrast against the background than the one before it, so a louder
 * byte is never meaningfully closer to the background than a quieter one. An
 * earlier version forced this afterwards by darkening any entry that dipped,
 * which on Paper drove everything above the midpoint to solid black - half the
 * dynamic range spent to remove a wobble of about one percent.
 */
export const buildSpectrogramRamp = (stops: RampStops, steps = 256): Uint8Array => {
  const keys = rampKeysFor(stops);
  const ramp = new Uint8Array(steps * 3);

  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    let upper = 1;
    while (upper < keys.length - 1 && keys[upper].at < t) upper += 1;
    const a = keys[upper - 1];
    const b = keys[upper];
    const span = b.at - a.at;
    const local = span <= 0 ? 0 : clamp((t - a.at) / span, 0, 1);
    const color = mixRgb(a.color, b.color, local);
    ramp[i * 3] = color[0];
    ramp[i * 3 + 1] = color[1];
    ramp[i * 3 + 2] = color[2];
  }

  return ramp;
};

export const rampColorAt = (ramp: Uint8Array, byte: number): Rgb => {
  const index = clamp(Math.round(byte), 0, ramp.length / 3 - 1) * 3;
  return [ramp[index], ramp[index + 1], ramp[index + 2]];
};

// ---------------------------------------------------------------------------
// Peak picking
// ---------------------------------------------------------------------------

export interface SpectralPeak {
  bin: number;
  frequencyHz: number;
  levelByte: number;
}

export interface FindPeaksOptions {
  sampleRate: number;
  fftSize: number;
  minHz?: number;
  maxHz?: number;
  thresholdByte?: number;
  maxPeaks?: number;
  minSeparationCents?: number;
}

export const centsBetween = (a: number, b: number): number => Math.abs(1200 * Math.log2(a / b));

export const findSpectralPeaks = (data: Uint8Array, options: FindPeaksOptions): SpectralPeak[] => {
  const {
    sampleRate,
    fftSize,
    minHz = MIN_FREQUENCY_HZ,
    maxHz = MAX_FREQUENCY_HZ,
    thresholdByte = 70,
    maxPeaks = 8,
    minSeparationCents = 60,
  } = options;

  const first = Math.max(1, Math.ceil(frequencyToBin(minHz, sampleRate, fftSize)));
  const last = Math.min(data.length - 2, Math.floor(frequencyToBin(maxHz, sampleRate, fftSize)));
  const found: SpectralPeak[] = [];

  for (let bin = first; bin <= last; bin += 1) {
    const here = data[bin];
    if (here < thresholdByte) continue;
    if (here <= data[bin - 1] || here < data[bin + 1]) continue;

    // Parabolic interpolation across the three bins around the maximum. The
    // byte data is already decibel-scaled, and this fit is exact for a
    // log-magnitude Gaussian window, so it pulls a 440 Hz tone to within a
    // hertz or two instead of snapping it to the nearest bin centre.
    const left = data[bin - 1];
    const right = data[bin + 1];
    const denominator = left - 2 * here + right;
    const delta = denominator === 0 ? 0 : clamp((0.5 * (left - right)) / denominator, -0.5, 0.5);

    found.push({
      bin,
      frequencyHz: binFrequency(bin + delta, sampleRate, fftSize),
      levelByte: here,
    });
  }

  found.sort((a, b) => b.levelByte - a.levelByte || a.frequencyHz - b.frequencyHz);

  const kept: SpectralPeak[] = [];
  for (const peak of found) {
    if (kept.length >= maxPeaks) break;
    const crowded = kept.some(
      (other) => centsBetween(peak.frequencyHz, other.frequencyHz) < minSeparationCents,
    );
    if (crowded) continue;
    kept.push(peak);
  }
  return kept;
};

export interface StabilizeOptions {
  toleranceCents?: number;
  framesToConfirm?: number;
  framesToDrop?: number;
}

export interface PeakTrack extends SpectralPeak {
  /** Consecutive frames this track has been seen in. */
  seen: number;
  /** Consecutive frames it has been missing for. */
  missed: number;
  confirmed: boolean;
}

/**
 * Hysteresis over consecutive detections.
 *
 * Raw per-frame peaks flicker, and a label that appears and vanishes sixty
 * times a second is unreadable. A peak has to survive two consecutive frames
 * before it earns a label, and it survives one dropout before losing it.
 */
export const stabilizePeaks = (
  previous: PeakTrack[],
  current: SpectralPeak[],
  options: StabilizeOptions = {},
): PeakTrack[] => {
  const { toleranceCents = 50, framesToConfirm = 2, framesToDrop = 1 } = options;
  const tracks: PeakTrack[] = [];
  const claimed = new Set<number>();

  for (const track of previous) {
    let bestIndex = -1;
    let bestCents = toleranceCents;
    current.forEach((peak, index) => {
      if (claimed.has(index)) return;
      const distance = centsBetween(peak.frequencyHz, track.frequencyHz);
      if (distance < bestCents) {
        bestCents = distance;
        bestIndex = index;
      }
    });

    if (bestIndex >= 0) {
      claimed.add(bestIndex);
      const peak = current[bestIndex];
      const seen = track.seen + 1;
      tracks.push({ ...peak, seen, missed: 0, confirmed: seen >= framesToConfirm });
    } else if (track.missed < framesToDrop) {
      tracks.push({ ...track, missed: track.missed + 1 });
    }
  }

  current.forEach((peak, index) => {
    if (claimed.has(index)) return;
    tracks.push({ ...peak, seen: 1, missed: 0, confirmed: framesToConfirm <= 1 });
  });

  return tracks.sort((a, b) => b.levelByte - a.levelByte);
};

export const confirmedPeaks = (tracks: PeakTrack[]): SpectralPeak[] =>
  tracks
    .filter((track) => track.confirmed)
    .map(({ bin, frequencyHz, levelByte }) => ({ bin, frequencyHz, levelByte }));

// ---------------------------------------------------------------------------
// Fundamental and harmonics
// ---------------------------------------------------------------------------

export interface FundamentalEstimate {
  frequencyHz: number;
  confidence: number;
  /** Indices into the peaks array that voted for this fundamental. */
  supporting: number[];
}

/**
 * How many harmonics at the bottom of the series may be absent. A genuinely
 * missing fundamental is usually missing only the first, occasionally the
 * first two; a candidate whose lowest match is the fifth harmonic is an
 * arithmetic accident, not a pitch.
 */
const MAX_MISSING_HARMONICS = 3;
/**
 * Fraction of the integers between the lowest and highest matched harmonic
 * that must actually be present. Loose enough for a clarinet, which sounds
 * only odd harmonics, and tight enough to reject a scattered pair.
 */
const MIN_HARMONIC_DENSITY = 0.5;

export interface FundamentalOptions {
  minHz?: number;
  maxHz?: number;
  maxHarmonic?: number;
  toleranceCents?: number;
}

export const estimateFundamental = (
  peaks: SpectralPeak[],
  options: FundamentalOptions = {},
): FundamentalEstimate | null => {
  const {
    minHz = MIN_FREQUENCY_HZ,
    maxHz = 2000,
    maxHarmonic = 12,
    toleranceCents = 45,
  } = options;

  if (peaks.length === 0) return null;

  // Candidates include each peak divided by a small integer, which is what
  // recovers a fundamental that is weak or missing from the spectrum entirely.
  const candidates: number[] = [];
  for (const peak of peaks) {
    for (let divisor = 1; divisor <= 5; divisor += 1) {
      const candidate = peak.frequencyHz / divisor;
      if (candidate >= minHz && candidate <= maxHz) candidates.push(candidate);
    }
  }
  if (candidates.length === 0) return null;

  const totalLevel = peaks.reduce((sum, peak) => sum + peak.levelByte, 0);
  let best: { candidate: number; score: number; supporting: number[] } | null = null;

  for (const candidate of candidates) {
    const supporting: number[] = [];
    const harmonics: number[] = [];
    let score = 0;
    peaks.forEach((peak, index) => {
      const harmonic = Math.round(peak.frequencyHz / candidate);
      if (harmonic < 1 || harmonic > maxHarmonic) return;
      if (centsBetween(peak.frequencyHz, harmonic * candidate) > toleranceCents) return;
      supporting.push(index);
      harmonics.push(harmonic);
      score += peak.levelByte;
    });

    if (harmonics.length === 0) continue;

    // Divide enough unrelated frequencies by enough small integers and one of
    // the quotients will "explain" them all - 440 and 611 Hz are the 5th and
    // 7th harmonics of 88 Hz to within 14 cents, which is nonsense. A real
    // fundamental shows up near the bottom of its own series and fills most of
    // it in, so require both.
    const lowest = Math.min(...harmonics);
    const highest = Math.max(...harmonics);
    const density = harmonics.length / (highest - lowest + 1);
    if (lowest > MAX_MISSING_HARMONICS + 1 || density < MIN_HARMONIC_DENSITY) continue;

    // Ties go to the HIGHER candidate. Every subharmonic of a true fundamental
    // scores identically, so preferring the lowest would report a pitch an
    // octave or two below the real one every single time.
    if (!best || score > best.score || (score === best.score && candidate > best.candidate)) {
      best = { candidate, score, supporting };
    }
  }

  if (!best) return null;
  // One supporting peak out of several is not a harmonic series, it is a
  // coincidence. A lone tone is still allowed to be its own fundamental.
  if (peaks.length > 1 && best.supporting.length < 2) return null;

  let weighted = 0;
  let weight = 0;
  for (const index of best.supporting) {
    const peak = peaks[index];
    const harmonic = Math.max(1, Math.round(peak.frequencyHz / best.candidate));
    weighted += peak.levelByte * (peak.frequencyHz / harmonic);
    weight += peak.levelByte;
  }

  return {
    frequencyHz: weight > 0 ? weighted / weight : best.candidate,
    confidence: totalLevel > 0 ? best.score / totalLevel : 0,
    supporting: best.supporting,
  };
};

export const harmonicSeries = (fundamentalHz: number, maxHz: number, maxCount = 12): number[] => {
  const series: number[] = [];
  for (let n = 1; n <= maxCount; n += 1) {
    const frequency = fundamentalHz * n;
    if (frequency > maxHz) break;
    series.push(frequency);
  }
  return series;
};

// ---------------------------------------------------------------------------
// Note names
// ---------------------------------------------------------------------------

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** A0, the bottom of a piano, and C10, the top of the display range. */
const MIN_MIDI = 21;
const MAX_MIDI = 132;

export const midiFromFrequency = (hz: number, a4 = 440): number => 69 + 12 * Math.log2(hz / a4);

export const frequencyFromMidi = (midi: number, a4 = 440): number => a4 * 2 ** ((midi - 69) / 12);

export interface NoteName {
  name: string;
  midi: number;
  /** Signed offset from equal temperament, in cents. */
  cents: number;
}

export const noteFromFrequency = (hz: number, a4 = 440): NoteName | null => {
  if (!(hz > 0)) return null;
  const exact = midiFromFrequency(hz, a4);
  const midi = Math.round(exact);
  if (midi < MIN_MIDI || midi > MAX_MIDI) return null;
  return {
    name: `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`,
    midi,
    cents: (exact - midi) * 100,
  };
};

export const formatNote = (note: NoteName): string => {
  const cents = Math.round(note.cents);
  return cents === 0 ? note.name : `${note.name} ${cents > 0 ? '+' : ''}${cents}¢`;
};

// ---------------------------------------------------------------------------
// Ticks
// ---------------------------------------------------------------------------

export interface AxisTick {
  hz: number;
  row: number;
  label: string;
  emphasis: 'major' | 'minor';
}

export const formatFrequencyLabel = (hz: number): string => {
  if (hz < 1000) return String(Math.round(hz));
  // One decimal, trailing zero dropped. Rounding to whole thousands above 10k
  // would label the linear axis's 12 500 Hz tick "13k", which is simply wrong.
  return `${Number((hz / 1000).toFixed(1))}k`;
};

const LOG_MULTIPLIERS = [1, 2, 3, 4, 5, 6, 8];

/** 1 / 2 / 2.5 / 5 x 10^n, the step sizes that produce readable labels. */
export const niceLinearStep = (range: number, targetCount: number): number => {
  const raw = range / Math.max(targetCount, 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
};

export interface FrequencyTickOptions {
  minHz: number;
  maxHz: number;
  scale: FrequencyScale;
  rows: number;
  minRowGap?: number;
}

export const buildFrequencyTicks = (options: FrequencyTickOptions): AxisTick[] => {
  const { minHz, maxHz, scale, rows, minRowGap = 22 } = options;
  const candidates: { hz: number; emphasis: 'major' | 'minor' }[] = [];

  if (scale === 'log') {
    for (let exponent = 0; exponent <= 5; exponent += 1) {
      for (const multiplier of LOG_MULTIPLIERS) {
        const hz = multiplier * 10 ** exponent;
        if (hz < minHz || hz > maxHz) continue;
        candidates.push({ hz, emphasis: multiplier === 1 ? 'major' : 'minor' });
      }
    }
  } else {
    const step = niceLinearStep(maxHz - minHz, 8);
    const majorStep = step * 5;
    for (let hz = Math.ceil(minHz / step) * step; hz <= maxHz; hz += step) {
      const isMajor = Math.abs(hz / majorStep - Math.round(hz / majorStep)) < 1e-9;
      candidates.push({ hz, emphasis: isMajor ? 'major' : 'minor' });
    }
  }

  candidates.sort((a, b) => a.hz - b.hz);

  const kept: AxisTick[] = [];
  for (const candidate of candidates) {
    const row = frequencyToRow(candidate.hz, minHz, maxHz, scale, rows);
    // A major tick outranks a crowded minor one, but the gap invariant still
    // has to hold afterwards, so drop the minor rather than overprint it.
    if (candidate.emphasis === 'major') {
      while (
        kept.length > 0 &&
        kept[kept.length - 1].emphasis === 'minor' &&
        Math.abs(kept[kept.length - 1].row - row) < minRowGap
      ) {
        kept.pop();
      }
    }
    if (kept.length > 0 && Math.abs(kept[kept.length - 1].row - row) < minRowGap) continue;
    kept.push({
      hz: candidate.hz,
      row,
      label: formatFrequencyLabel(candidate.hz),
      emphasis: candidate.emphasis,
    });
  }
  return kept;
};

export interface TimeTick {
  secondsAgo: number;
  column: number;
  label: string;
}

/**
 * `offsetSeconds` is how far into the past the right edge has been dragged.
 * Ticks are placed at round numbers of seconds before *now*, not before the
 * edge, so a panned display still reads in real recording time rather than
 * relabelling wherever it happens to have stopped.
 */
export const buildTimeTicks = (options: {
  columns: number;
  hopSeconds: number;
  spacingSeconds?: number;
  offsetSeconds?: number;
}): TimeTick[] => {
  const { columns, hopSeconds, spacingSeconds = 1, offsetSeconds = 0 } = options;
  if (!(hopSeconds > 0) || !(spacingSeconds > 0)) return [];

  const ticks: TimeTick[] = [];
  if (offsetSeconds <= 0) {
    ticks.push({ secondsAgo: 0, column: columns - 1, label: 'now' });
  }

  const first = Math.max(
    Math.ceil(offsetSeconds / spacingSeconds) * spacingSeconds,
    offsetSeconds <= 0 ? spacingSeconds : 0,
  );

  for (let seconds = first; ; seconds += spacingSeconds) {
    const column = columns - 1 - (seconds - offsetSeconds) / hopSeconds;
    if (column < 0) break;
    ticks.push({ secondsAgo: seconds, column, label: `-${Math.round(seconds)} s` });
  }
  return ticks;
};

/**
 * Place labels as close to where they belong as the room allows.
 *
 * The obvious approach - walk the list and shove anything too close to its
 * neighbour further along - is one-directional and cumulative: one crowded pair
 * near the bottom drags every label above it upward, and the leader lines fan
 * out into long diagonals even though the plot had space to spare. That gets
 * worse the taller the plot is, because more labels survive to be pushed.
 *
 * Instead, only genuinely colliding labels move, and a colliding group is
 * centred on where its members wanted to be, so the error is shared out and
 * every label that had room keeps its exact height.
 *
 * Returns placements in the same order as `ideal`.
 */
export const placeLabels = (
  ideal: number[],
  minGap: number,
  minY: number,
  maxY: number,
): number[] => {
  if (ideal.length === 0) return [];

  const order = ideal.map((_, index) => index).sort((a, b) => ideal[a] - ideal[b]);
  // Each cluster is a run of labels that will be stacked exactly minGap apart.
  let clusters = order.map((index) => ({ members: [index], sum: ideal[index] }));

  const top = (cluster: { members: number[]; sum: number }) => {
    const centre = cluster.sum / cluster.members.length;
    const span = (cluster.members.length - 1) * minGap;
    return clamp(centre - span / 2, minY, Math.max(minY, maxY - span));
  };

  for (let guard = 0; guard < ideal.length; guard += 1) {
    let merged = false;
    const next: typeof clusters = [];

    for (const cluster of clusters) {
      const previous = next[next.length - 1];
      if (previous && top(previous) + (previous.members.length - 1) * minGap + minGap > top(cluster)) {
        previous.members = [...previous.members, ...cluster.members];
        previous.sum += cluster.sum;
        merged = true;
      } else {
        next.push({ members: [...cluster.members], sum: cluster.sum });
      }
    }

    clusters = next;
    if (!merged) break;
  }

  const placed = new Array<number>(ideal.length);
  for (const cluster of clusters) {
    const start = top(cluster);
    cluster.members.forEach((index, offset) => {
      placed[index] = start + offset * minGap;
    });
  }
  return placed;
};

// ---------------------------------------------------------------------------
// Layout geometry
//
// The same numbers drive canvas placement, the SVG overlay, and the
// pointer -> (Hz, time) inverse. A disagreement between those three is the
// most likely bug in the whole lab, so they come from one tested function.
// ---------------------------------------------------------------------------

export interface SpectrogramLayout {
  viewBox: string;
  plot: { x: number; y: number; w: number; h: number };
  gutterLeft: number;
  gutterRight: number;
  gutterTop: number;
  gutterBottom: number;
  /** Where the level legend's bar starts, when `showLegendGutter`. */
  legendX: number;
  fontSize: number;
  showLegendGutter: boolean;
  compact: boolean;
}

export const COMPACT_BREAKPOINT_PX = 640;
/** Enough room beside the plot for "12.5k A4 +3c". */
const PEAK_LABEL_WIDTH = 82;
/** The colour bar plus its two end labels. */
const LEGEND_WIDTH = 48;
/** The shape of the plot when nothing is telling it how tall to be. */
export const DEFAULT_PLOT_ASPECT = 2.4;
/** Narrow screens get a squarer plot, or it is a letterbox slit. */
export const COMPACT_PLOT_ASPECT = 1.5;

/**
 * Geometry in CSS pixels, not in abstract viewBox units.
 *
 * The overlay's viewBox is set to the box's real pixel size so one unit is one
 * pixel: text never distorts however the plot is stretched, and the plot can
 * grow to fill a fullscreen window instead of being locked to one aspect
 * ratio. Everything that positions the canvas, draws the overlay, and converts
 * a pointer back to (hertz, seconds) comes from here, so the three cannot
 * disagree.
 */
export const getSpectrogramLayout = (width: number, height: number): SpectrogramLayout => {
  const compact = width < COMPACT_BREAKPOINT_PX;
  const showLegendGutter = !compact && width >= 900;

  const gutterLeft = compact ? 40 : 52;
  const gutterRight = compact
    ? 10
    : PEAK_LABEL_WIDTH + 6 + (showLegendGutter ? LEGEND_WIDTH : 0);
  const gutterTop = compact ? 10 : 12;
  const gutterBottom = compact ? 26 : 24;

  const w = Math.max(width - gutterLeft - gutterRight, 1);
  const h = Math.max(height - gutterTop - gutterBottom, 1);

  return {
    viewBox: `0 0 ${Math.max(width, 1)} ${Math.max(height, 1)}`,
    plot: { x: gutterLeft, y: gutterTop, w, h },
    gutterLeft,
    gutterRight,
    gutterTop,
    gutterBottom,
    legendX: gutterLeft + w + PEAK_LABEL_WIDTH + 6,
    fontSize: compact ? 13 : 12,
    showLegendGutter,
    compact,
  };
};

// ---------------------------------------------------------------------------
// History ring buffer
//
// This is what makes the cursor probe and the log/linear toggle possible at
// all: pixels are lossy, so the raw frames are retained and the canvas is
// re-rendered from them rather than resampled from what is already on screen.
//
// One flat Uint8Array, not an array of arrays: at HISTORY_COLUMNS that is
// 2.8 MB at fftSize 4096 and 5.6 MB at 8192, allocated once and never grown.
// ---------------------------------------------------------------------------

export interface SpectrogramHistory {
  readonly columns: number;
  readonly binCount: number;
  readonly length: number;
  push(frame: Uint8Array, timeSeconds: number, minDb: number, maxDb: number): void;
  /** index 0 is the oldest retained column, length - 1 the newest. */
  frameAt(index: number): Uint8Array;
  timeAt(index: number): number;
  rangeAt(index: number): { minDb: number; maxDb: number };
  clear(): void;
}

export const createSpectrogramHistory = (
  columns: number,
  binCount: number,
): SpectrogramHistory => {
  const data = new Uint8Array(columns * binCount);
  const times = new Float64Array(columns);
  const minDbs = new Float32Array(columns);
  const maxDbs = new Float32Array(columns);
  let head = 0;
  let length = 0;

  const physical = (index: number): number => (head - length + index + columns * 2) % columns;

  return {
    columns,
    binCount,
    get length() {
      return length;
    },
    push(frame, timeSeconds, minDb, maxDb) {
      data.set(frame.subarray(0, binCount), head * binCount);
      times[head] = timeSeconds;
      minDbs[head] = minDb;
      maxDbs[head] = maxDb;
      head = (head + 1) % columns;
      if (length < columns) length += 1;
    },
    frameAt(index) {
      const slot = physical(index);
      return data.subarray(slot * binCount, (slot + 1) * binCount);
    },
    timeAt(index) {
      return times[physical(index)];
    },
    rangeAt(index) {
      const slot = physical(index);
      return { minDb: minDbs[slot], maxDb: maxDbs[slot] };
    },
    clear() {
      head = 0;
      length = 0;
    },
  };
};

/**
 * The peaks the live analysis would have reported when column `index` was the
 * newest one, recovered from the history.
 *
 * Replays the same hysteresis over the frames the live loop analysed on its
 * way there, one `strideColumns` apart, so a frozen view panned to any column
 * labels exactly what the moving display would have labelled at that moment:
 * a peak still has to be present in consecutive analyses to count.
 */
export const peaksAtHistoryColumn = (
  history: SpectrogramHistory,
  index: number,
  options: FindPeaksOptions & { strideColumns: number; analyses?: number },
): SpectralPeak[] => {
  const { strideColumns, analyses = 3, ...findOptions } = options;
  if (index < 0 || index >= history.length) return [];

  let tracks: PeakTrack[] = [];
  for (let step = analyses - 1; step >= 0; step -= 1) {
    const column = index - step * strideColumns;
    if (column < 0) continue;
    tracks = stabilizePeaks(tracks, findSpectralPeaks(history.frameAt(column), findOptions));
  }
  return confirmedPeaks(tracks);
};
