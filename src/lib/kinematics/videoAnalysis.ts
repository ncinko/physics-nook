/**
 * Pure model for the video analysis lab: everything that turns clicks on a
 * video frame into a physics data set, with no DOM in sight.
 *
 * The organising idea is that a marked point stores **only** its location in
 * intrinsic video pixels and the presentation time of the frame it was marked
 * on. Every physical quantity — position, velocity, and their uncertainties —
 * is derived from those raw pixels plus the current calibration. That is what
 * lets a student drag the scale line, move the origin, tilt the axes, or
 * correct the frame rate *after* marking fifty points and see the whole data
 * set re-derive correctly, instead of having to start over.
 *
 * Note what is deliberately **not** here: a point-by-point acceleration. The
 * second derivative of hand-clicked positions is dominated by click noise, and
 * handing students a column of it invites them to read a number that is mostly
 * noise. Acceleration comes from fitting a parabola to the positions instead,
 * where every point contributes and the fit reports its own uncertainty — see
 * `kinematicsFromQuadratic`.
 *
 * DOM-free and deterministic so it can be unit tested in `tests/kinematics`.
 */

import { type Measurement } from '../measurement/uncertainty.ts';
import { type PolynomialFit } from '../math/leastSquares.ts';
import { fixed } from '../../utils/format.ts';

/**
 * A location in intrinsic video pixels: origin top-left, y increasing
 * downward, spanning [0, videoWidth] x [0, videoHeight]. Deliberately
 * independent of zoom, pan, element size, and fullscreen, so nothing about how
 * the video is currently displayed can corrupt stored data.
 */
export interface PixelPoint {
  px: number;
  py: number;
}

/**
 * What a click on the video does right now. Lives here rather than beside the
 * stage component so the guided tour can talk about modes without importing
 * anything that touches the DOM.
 */
export type StageMode = 'mark' | 'calibrate' | 'origin' | 'axis';

export interface Calibration {
  /** One end of the ruler the student drew over a known length. */
  scaleFrom: PixelPoint;
  scaleTo: PixelPoint;
  /** Real-world length of that ruler, in metres. */
  scaleLengthMeters: number;
  origin: PixelPoint;
  /** Physical +x axis, in degrees counter-clockwise from screen-right. */
  axisAngleDeg: number;
  /** 1-sigma click precision, in intrinsic video pixels. */
  positionUncertaintyPx: number;
}

/** A calibration reduced to the four numbers the transform actually needs. */
export interface CoordinateFrame {
  metersPerPixel: number;
  origin: PixelPoint;
  cos: number;
  sin: number;
}

export interface TrackedPoint {
  id: number;
  /**
   * Presentation time of the marked frame, in seconds. Comes from
   * requestVideoFrameCallback's `mediaTime` when the browser supports it, and
   * from the video element's settled `currentTime` when it does not. Measured
   * once and never recomputed — correcting the frame rate must not move it.
   */
  time: number;
  /** True when `time` is an exact frame timestamp rather than a seek target. */
  exactTime: boolean;
  /** The source of truth for every physical coordinate. */
  pixel: PixelPoint;
}

export interface Track {
  id: number;
  label: string;
  /** Stable across the deletion of other tracks, so colours do not shuffle. */
  colorIndex: number;
  /** Kept sorted ascending by `time`. */
  points: TrackedPoint[];
}

export interface DerivedSample {
  time: number;
  /** Derived from `time` and the current fps, never stored. */
  frame: number;
  px: number;
  py: number;
  x: number;
  y: number;
  vx: number | null;
  vy: number | null;
  speed: number | null;
  sigmaX: number;
  sigmaY: number;
  sigmaVx: number | null;
  sigmaVy: number | null;
  sigmaSpeed: number | null;
}

export type QuantityKey = 'time' | 'x' | 'y' | 'vx' | 'vy' | 'speed';
export type ColumnKey = QuantityKey | 'frame' | 'px' | 'py';

export interface FrameRateEstimate {
  /** What the frame timings actually said, before snapping. */
  measuredFps: number;
  /** The rate to use — snapped to a standard rate when one is close enough. */
  fps: number;
  snapped: boolean;
  /** How many frame-to-frame gaps went into the estimate. */
  sampleCount: number;
}

/**
 * Reduce a calibration to a coordinate frame, or null when the scale line has
 * no length (or no declared length) and there is nothing to measure against.
 */
export const frameFromCalibration = (calibration: Calibration): CoordinateFrame | null => {
  const dx = calibration.scaleTo.px - calibration.scaleFrom.px;
  const dy = calibration.scaleTo.py - calibration.scaleFrom.py;
  const pixelLength = Math.hypot(dx, dy);
  if (!Number.isFinite(pixelLength) || pixelLength <= 0) return null;
  if (!Number.isFinite(calibration.scaleLengthMeters) || calibration.scaleLengthMeters <= 0) {
    return null;
  }
  const theta = (calibration.axisAngleDeg * Math.PI) / 180;
  return {
    metersPerPixel: calibration.scaleLengthMeters / pixelLength,
    origin: calibration.origin,
    cos: Math.cos(theta),
    sin: Math.sin(theta),
  };
};

export interface PhysicalPoint {
  x: number;
  y: number;
}

/**
 * Video pixels to physical coordinates. Two things happen here: the y axis is
 * flipped (video y grows downward, physics y grows upward), and the axes are
 * rotated by the calibration angle so an incline can be measured along-slope.
 */
export const toPhysical = (frame: CoordinateFrame, point: PixelPoint): PhysicalPoint => {
  const dx = point.px - frame.origin.px;
  const dy = -(point.py - frame.origin.py);
  return {
    x: (dx * frame.cos + dy * frame.sin) * frame.metersPerPixel,
    y: (-dx * frame.sin + dy * frame.cos) * frame.metersPerPixel,
  };
};

/** The exact inverse of `toPhysical`, used to draw axes back onto the overlay. */
export const toPixel = (frame: CoordinateFrame, position: PhysicalPoint): PixelPoint => {
  const sx = position.x / frame.metersPerPixel;
  const sy = position.y / frame.metersPerPixel;
  return {
    px: frame.origin.px + (sx * frame.cos - sy * frame.sin),
    py: frame.origin.py - (sx * frame.sin + sy * frame.cos),
  };
};

/**
 * Frame index a measured time falls on, given the working frame rate.
 *
 * This rounds, so it is only correct for a time that sits at (or very near) a
 * frame's *start* — which is what a presentation timestamp is. Never hand it a
 * mid-frame seek target like `(k + 0.5) / fps`: that rounds to `k + 1`, and the
 * stepper built on top of it then advances two frames per step. The round trip
 * `frameIndexForTime(timeForFrameIndex(k, fps), fps) === k` is the invariant
 * callers rely on.
 */
/**
 * What to do when a video element reports its metadata.
 *
 * `loadedmetadata` and `durationchange` both carry this news, and the second
 * can arrive at any time: some containers — QuickTime `.mov` especially —
 * hand the browser an estimated duration up front and revise it later, once
 * decoding reaches part of the file it had not parsed. A seek deep into a short
 * clip is exactly what provokes that.
 *
 * So the news has to be split by whether it is the first word or a correction.
 * The first word initialises the clip and measures its frame rate; a correction
 * only updates the duration. Re-measuring the frame rate on a correction would
 * mean the tool starts *playing the clip* under a student who was mid-way
 * through marking points, because measuring a frame rate means watching frames
 * go past.
 */
export type MetadataAction =
  /** No usable duration yet: provoke one by seeking past the end. */
  | 'await-duration'
  /** First real duration: adopt it, then measure the frame rate. */
  | 'initialise'
  /** A revised duration for a clip already in use: adopt it and nothing else. */
  | 'update'
  /** Nonsense arriving after the clip is already running. Drop it. */
  | 'ignore';

export const metadataAction = (duration: number, initialised: boolean): MetadataAction => {
  if (!Number.isFinite(duration) || duration <= 0) {
    return initialised ? 'ignore' : 'await-duration';
  }
  return initialised ? 'update' : 'initialise';
};

export const frameIndexForTime = (time: number, fps: number): number => {
  if (!Number.isFinite(time) || !Number.isFinite(fps) || fps <= 0) return 0;
  return Math.max(0, Math.round(time * fps));
};

export const timeForFrameIndex = (index: number, fps: number): number =>
  fps > 0 ? index / fps : 0;

/**
 * Three-point derivative stencils for *non-uniformly* spaced samples. Frame
 * times are not evenly spaced in practice — a student skips frames, a seek
 * lands a frame early, a dropped frame widens one gap — so the familiar
 * `(y[i+1] - y[i-1]) / (t[i+1] - t[i-1])` is wrong: it reports the derivative
 * at the midpoint of the outer pair rather than at the sample itself.
 *
 * Returning the coefficients (rather than the value) means the value and its
 * uncertainty are computed from the same numbers and cannot drift apart:
 * sigma = sigma_position * sqrt(sum of the squared coefficients).
 */
const firstDerivativeStencil = (h1: number, h2: number): [number, number, number] => [
  -h2 / (h1 * (h1 + h2)),
  (h2 - h1) / (h1 * h2),
  h1 / (h2 * (h1 + h2)),
];

const applyStencil = (
  stencil: readonly [number, number, number],
  before: number,
  at: number,
  after: number,
): number => stencil[0] * before + stencil[1] * at + stencil[2] * after;

const stencilSigma = (stencil: readonly [number, number, number], sigma: number): number =>
  sigma * Math.hypot(stencil[0], stencil[1], stencil[2]);

/**
 * Turn marked points into the full derived data set.
 *
 * Endpoints carry no velocity. One-sided difference formulas exist, but they
 * amplify click noise badly and students reliably over-read the spurious first
 * and last values that result; a blank is more honest. Velocity therefore
 * covers the index range 1..n-2, which also keeps the table and the export
 * rectangular.
 *
 * Note that neighbouring velocities share input points and so are correlated.
 * The error bars are right for reading, but a weighted fit *to the velocity
 * series* has correlated residuals — which is another reason acceleration
 * belongs to a quadratic fit on the positions.
 */
export const deriveSeries = (
  points: readonly TrackedPoint[],
  frame: CoordinateFrame,
  positionUncertaintyPx: number,
  fps: number,
): DerivedSample[] => {
  const ordered = [...points].sort((a, b) => a.time - b.time);
  // A rotation is an isometry, so the position uncertainty is the same along
  // both axes whatever the axis angle is. That is what justifies drawing
  // isotropic error bars.
  const sigma = Math.max(0, positionUncertaintyPx) * frame.metersPerPixel;

  const positions = ordered.map((point) => toPhysical(frame, point.pixel));

  return ordered.map((point, i) => {
    const position = positions[i];
    const base: DerivedSample = {
      time: point.time,
      frame: frameIndexForTime(point.time, fps),
      px: point.pixel.px,
      py: point.pixel.py,
      x: position.x,
      y: position.y,
      vx: null,
      vy: null,
      speed: null,
      sigmaX: sigma,
      sigmaY: sigma,
      sigmaVx: null,
      sigmaVy: null,
      sigmaSpeed: null,
    };

    if (i === 0 || i === ordered.length - 1) return base;

    const h1 = ordered[i].time - ordered[i - 1].time;
    const h2 = ordered[i + 1].time - ordered[i].time;
    if (!(h1 > 0) || !(h2 > 0)) return base;

    const first = firstDerivativeStencil(h1, h2);
    const previous = positions[i - 1];
    const next = positions[i + 1];

    const vx = applyStencil(first, previous.x, position.x, next.x);
    const vy = applyStencil(first, previous.y, position.y, next.y);
    const sigmaV = stencilSigma(first, sigma);
    const speed = Math.hypot(vx, vy);

    return {
      ...base,
      vx,
      vy,
      speed,
      sigmaVx: sigmaV,
      sigmaVy: sigmaV,
      // d|v| propagated from the components; at a turning point the direction
      // is undefined, so fall back to the component uncertainty.
      sigmaSpeed: speed > 0 ? (Math.hypot(vx * sigmaV, vy * sigmaV) / speed) : sigmaV,
    };
  });
};

/**
 * Replace rather than append when a point already exists on the target frame.
 * One point per frame per track keeps the table monotone, makes re-marking a
 * frame free (step back, click again), and removes a whole class of
 * duplicate-point bugs.
 */
export const upsertPoint = (
  points: readonly TrackedPoint[],
  candidate: TrackedPoint,
  fps: number,
): TrackedPoint[] => {
  const target = frameIndexForTime(candidate.time, fps);
  const kept = points.filter((point) => frameIndexForTime(point.time, fps) !== target);
  return [...kept, candidate].sort((a, b) => a.time - b.time);
};

/** Frame rates a consumer camera might actually be recording at. */
export const STANDARD_FRAME_RATES = [
  23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120, 240,
] as const;

/**
 * Estimate the frame rate from a list of measured frame presentation times.
 * Browsers expose no frame-rate metadata at all, so this is the only way to get
 * one without demuxing the container ourselves.
 *
 * The median gap is used rather than the mean because a single dropped frame
 * doubles one gap, which would drag a mean noticeably and leaves a median
 * untouched. When every gap agrees with the median the sample is clean, so the
 * estimate is refined over the whole span, which is far more precise than any
 * single gap.
 *
 * Snapping: 29.97 and 30 sit 0.1% apart and are not reliably separable from a
 * short sample, so when both are in range the integer wins — consumer phones
 * record nominal integer rates far more often. Guessing wrong costs almost
 * nothing here, because stored times are measured rather than reconstructed
 * from the frame rate.
 */
export const estimateFrameRate = (
  mediaTimes: readonly number[],
  tolerance = 0.02,
): FrameRateEstimate | null => {
  const times = [...new Set(mediaTimes.filter((time) => Number.isFinite(time)))].sort(
    (a, b) => a - b,
  );
  if (times.length < 2) return null;

  const deltas: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    const delta = times[i] - times[i - 1];
    if (delta > 0) deltas.push(delta);
  }
  if (deltas.length === 0) return null;

  const sorted = [...deltas].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  if (!(median > 0)) return null;

  const uniform = deltas.every((delta) => Math.abs(delta - median) <= 0.2 * median);
  const span = times[times.length - 1] - times[0];
  const measuredFps = uniform && span > 0 ? (times.length - 1) / span : 1 / median;

  const candidates = STANDARD_FRAME_RATES.map((candidate) => ({
    candidate,
    error: Math.abs(candidate - measuredFps) / candidate,
  }))
    .filter((entry) => entry.error <= tolerance)
    .sort((a, b) => a.error - b.error);

  if (candidates.length === 0) {
    return { measuredFps, fps: measuredFps, snapped: false, sampleCount: deltas.length };
  }

  const closest = candidates[0];
  const integerRival = candidates.find(
    (entry) => Number.isInteger(entry.candidate) && entry.error <= 0.0025,
  );
  const chosen = closest.error <= 0.0025 && integerRival ? integerRival : closest;
  return {
    measuredFps,
    fps: chosen.candidate,
    snapped: true,
    sampleCount: deltas.length,
  };
};

export interface QuadraticKinematics {
  acceleration: Measurement;
  initialVelocity: Measurement;
  initialPosition: Measurement;
}

/**
 * Read a quadratic position fit as physics. For `s = c0 + c1·t + c2·t²` matched
 * against `s = s0 + v0·t + ½at²`, the acceleration is twice the leading
 * coefficient — and so is its uncertainty.
 */
export const kinematicsFromQuadratic = (fit: PolynomialFit): QuadraticKinematics => ({
  acceleration: { value: 2 * fit.coefficients[2], uncertainty: 2 * fit.uncertainties[2] },
  initialVelocity: { value: fit.coefficients[1], uncertainty: fit.uncertainties[1] },
  initialPosition: { value: fit.coefficients[0], uncertainty: fit.uncertainties[0] },
});

export interface LinearKinematics {
  slope: Measurement;
  intercept: Measurement;
}

export const kinematicsFromLinear = (fit: PolynomialFit): LinearKinematics => ({
  slope: { value: fit.coefficients[1], uncertainty: fit.uncertainties[1] },
  intercept: { value: fit.coefficients[0], uncertainty: fit.uncertainties[0] },
});

/**
 * Axis tick positions on a 1 / 2 / 5 x 10^n ladder — the steps that read as
 * round numbers to a human.
 */
export const niceTicks = (min: number, max: number, target = 6): number[] => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max <= min) {
    // A degenerate range still deserves an axis: open a band around the value.
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.5 : 1;
    return niceTicks(min - pad, min + pad, target);
  }
  const rawStep = (max - min) / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = magnitude * (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10);

  const ticks: number[] = [];
  const firstIndex = Math.ceil(min / step - 1e-9);
  const lastIndex = Math.floor(max / step + 1e-9);
  for (let i = firstIndex; i <= lastIndex; i += 1) {
    // Multiplying back out reintroduces floating-point fuzz (0.30000000000000004);
    // rounding to the step's own precision keeps labels clean.
    ticks.push(Number((i * step).toPrecision(12)));
  }
  return ticks;
};

export type ExportLayout = 'wide' | 'long';

export interface TrackSeries {
  label: string;
  samples: DerivedSample[];
}

export interface SerializeOptions {
  delimiter: '\t' | ',';
  columns: readonly ColumnKey[];
  layout: ExportLayout;
  decimals?: number;
}

const COLUMN_LABELS: Record<ColumnKey, string> = {
  frame: 'frame',
  time: 't (s)',
  x: 'x (m)',
  y: 'y (m)',
  vx: 'vx (m/s)',
  vy: 'vy (m/s)',
  speed: 'speed (m/s)',
  px: 'px (px)',
  py: 'py (px)',
};

export const columnLabel = (column: ColumnKey): string => COLUMN_LABELS[column];

/** Short axis names, in the notation the lessons use. */
export const QUANTITY_LABELS: Record<QuantityKey, string> = {
  time: 't',
  x: 'x',
  y: 'y',
  vx: 'vx',
  vy: 'vy',
  speed: '|v|',
};

export const QUANTITY_UNITS: Record<QuantityKey, string> = {
  time: 's',
  x: 'm',
  y: 'm',
  vx: 'm/s',
  vy: 'm/s',
  speed: 'm/s',
};

export const sampleValue = (sample: DerivedSample, column: ColumnKey): number | null => {
  switch (column) {
    case 'frame':
      return sample.frame;
    case 'time':
      return sample.time;
    case 'x':
      return sample.x;
    case 'y':
      return sample.y;
    case 'vx':
      return sample.vx;
    case 'vy':
      return sample.vy;
    case 'speed':
      return sample.speed;
    case 'px':
      return sample.px;
    case 'py':
      return sample.py;
  }
};

/**
 * The uncertainty that belongs on a quantity's error bar. Frame times are known
 * to microseconds, so time carries none.
 */
export const sampleSigma = (sample: DerivedSample, quantity: QuantityKey): number | null => {
  switch (quantity) {
    case 'time':
      return 0;
    case 'x':
      return sample.sigmaX;
    case 'y':
      return sample.sigmaY;
    case 'vx':
      return sample.sigmaVx;
    case 'vy':
      return sample.sigmaVy;
    case 'speed':
      return sample.sigmaSpeed;
  }
};

const formatCell = (value: number | null, column: ColumnKey, decimals: number): string => {
  // A missing endpoint velocity is blank, never 0 and never NaN — a zero there
  // would be read as a measurement.
  if (value === null || !Number.isFinite(value)) return '';
  if (column === 'frame') return String(Math.round(value));
  return fixed(value, decimals);
};

/**
 * Track labels are typed by the student, so every cell goes through this.
 * Tab-separated output has no quoting mechanism at all, so separators are
 * replaced; CSV gets proper RFC 4180 quoting.
 */
const escapeField = (value: string, delimiter: string): string => {
  if (delimiter === '\t') return value.replace(/[\t\r\n]/g, ' ');
  return /["\r\n,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
};

/**
 * Serialise the data set for the clipboard (tab-separated, which is what Google
 * Sheets pastes as columns) or for a CSV download.
 *
 * The wide layout aligns tracks on their derived frame index and gives each
 * track its own time column, because two objects marked on different frames
 * legitimately have different times. Where a track has no point on a row, the
 * cell is blank. A single track — the common case — collapses to a clean
 * `frame, t (s), x (m), y (m)` with no label prefixes.
 */
export const serializeTracks = (
  series: readonly TrackSeries[],
  options: SerializeOptions,
): string => {
  const decimals = options.decimals ?? 5;
  const { delimiter } = options;
  const escape = (value: string) => escapeField(value, delimiter);
  const columns = options.columns.filter((column) => column in COLUMN_LABELS);
  if (columns.length === 0 || series.length === 0) return '';

  if (options.layout === 'long') {
    const header = ['track', ...columns.map(columnLabel)].map(escape).join(delimiter);
    const rows = series.flatMap((track) =>
      track.samples.map((sample) =>
        [
          escape(track.label),
          ...columns.map((column) => formatCell(sampleValue(sample, column), column, decimals)),
        ].join(delimiter),
      ),
    );
    return [header, ...rows].join('\n');
  }

  // The frame index is what aligns several objects onto one row, so it stays a
  // single shared column instead of repeating per track. It does keep the place
  // the caller asked for, though: leading when it is the first column requested,
  // trailing otherwise, so a caller grouping it with the other raw columns at
  // the end gets it at the end.
  const frameIndex = columns.indexOf('frame');
  const includeSharedFrame = frameIndex !== -1;
  const frameLeads = frameIndex === 0;
  const sharedFrame = (cell: string) =>
    includeSharedFrame ? ([cell] as const) : ([] as const);
  const withSharedFrame = (cell: string, rest: readonly string[]) =>
    frameLeads ? [...sharedFrame(cell), ...rest] : [...rest, ...sharedFrame(cell)];
  const perTrackColumns = columns.filter((column) => column !== 'frame');
  const single = series.length === 1;

  // One slot per frame index per track. Correcting the frame rate can push two
  // points onto the same index; rather than dropping one, the later point takes
  // the next free slot while its own `t` column still reports its true time.
  const slotsByTrack = series.map((track) => {
    const slots = new Map<number, DerivedSample>();
    [...track.samples]
      .sort((a, b) => a.time - b.time)
      .forEach((sample) => {
        let index = sample.frame;
        while (slots.has(index)) index += 1;
        slots.set(index, sample);
      });
    return slots;
  });

  const frames = [...new Set(slotsByTrack.flatMap((slots) => [...slots.keys()]))].sort(
    (a, b) => a - b,
  );

  const header = withSharedFrame(
    'frame',
    series.flatMap((track) =>
      perTrackColumns.map((column) =>
        single ? columnLabel(column) : `${track.label}: ${columnLabel(column)}`,
      ),
    ),
  )
    .map(escape)
    .join(delimiter);

  const rows = frames.map((index) =>
    withSharedFrame(
      String(index),
      slotsByTrack.flatMap((slots) => {
        const sample = slots.get(index);
        return perTrackColumns.map((column) =>
          sample ? formatCell(sampleValue(sample, column), column, decimals) : '',
        );
      }),
    ).join(delimiter),
  );

  return [header, ...rows].join('\n');
};
