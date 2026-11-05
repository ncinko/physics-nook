/**
 * Cart-on-a-ramp runs: velocity from a position trace, and the straight-line
 * fit that turns a velocity-time graph into an acceleration.
 *
 * This is the analysis half of the Cart Lab, the part LoggerPro does in the
 * lab handout. Velocity is a central difference of the recorded positions, as
 * LoggerPro's is, and the fit is `v = a·t + v₀` with a free intercept over the
 * stretch where the cart was freely accelerating. The student chooses that
 * stretch, because hand contact at the start and a bounce or a lost echo at the
 * end are not part of it.
 *
 * DOM-free and deterministic, so `tests/forces` can drive it with synthetic
 * runs.
 */

import { fitPolynomial, type FitResult } from '../math/leastSquares.ts';
import { fitSummaryLines, showMeasurement, type SummaryGroup } from '../kinematics/fitSummary.ts';
import type { Measurement } from '../measurement/uncertainty.ts';
import { fixed } from '../../utils/format.ts';

export interface CartSample {
  /** Seconds since the recording started. */
  t: number;
  /** Metres from the detector, already corrected by the calibration scale. */
  x: number;
  /** False for a dropout the recorder could not bridge. */
  ok: boolean;
}

export interface FitRange {
  min: number;
  max: number;
}

export interface CartRun {
  id: number;
  label: string;
  samples: CartSample[];
  /** Seconds between pings when it was recorded. */
  periodSeconds: number;
  /** The detector scale in force when it was recorded; later changes do not rewrite the run. */
  distanceScale: number;
  /** The window the student chose to fit, or null for everything with a velocity. */
  fitRange: FitRange | null;
}

export interface CartRow {
  t: number;
  x: number | null;
  v: number | null;
}

/**
 * Velocity at each sample from the samples either side of it, using the real
 * timestamps rather than assuming an even spacing. The ends have no neighbour on
 * one side and carry no velocity, and neither does any sample that is a dropout
 * or sits next to one: a blank, not a zero, because a zero would read as the
 * cart standing still.
 */
export const centralDifferenceVelocity = (samples: readonly CartSample[]): (number | null)[] =>
  samples.map((sample, index) => {
    const before = samples[index - 1];
    const after = samples[index + 1];
    if (!before || !after) return null;
    if (!before.ok || !sample.ok || !after.ok) return null;
    const dt = after.t - before.t;
    if (!(dt > 0)) return null;
    return (after.x - before.x) / dt;
  });

export const deriveRows = (samples: readonly CartSample[]): CartRow[] => {
  const velocity = centralDifferenceVelocity(samples);
  return samples.map((sample, index) => ({
    t: sample.t,
    x: sample.ok ? sample.x : null,
    v: velocity[index],
  }));
};

/** The time span covered by rows that have a velocity: the default fit window. */
export const velocitySpan = (rows: readonly CartRow[]): FitRange | null => {
  const times = rows.filter((row) => row.v !== null).map((row) => row.t);
  if (times.length === 0) return null;
  return { min: Math.min(...times), max: Math.max(...times) };
};

const EPSILON = 1e-9;

export const inRange = (time: number, range: FitRange | null): boolean =>
  range === null || (time >= range.min - EPSILON && time <= range.max + EPSILON);

/**
 * The straight line `v = a·t + v₀` through the rows inside `range`.
 *
 * Unweighted: a sonar trace has no per-point error bar to weight by. That is why
 * the uncertainties reported below are the scatter-based ones. With no sigmas,
 * `PolynomialFit.uncertainties` assume σ = 1 and carry no physical scale.
 */
export const fitRunVelocity = (rows: readonly CartRow[], range: FitRange | null): FitResult =>
  fitPolynomial(
    rows
      .filter((row) => row.v !== null && inRange(row.t, range))
      .map((row) => ({ x: row.t, y: row.v as number })),
    1,
  );

export interface CartFit {
  /** Slope: the acceleration, m/s². */
  a: Measurement;
  /** Intercept: the velocity at t = 0 on the fitted line, m/s. */
  v0: Measurement;
  rSquared: number;
  pointCount: number;
}

export const cartFitFrom = (result: FitResult): CartFit | null => {
  if (!result.ok) return null;
  const { fit } = result;
  return {
    a: { value: fit.coefficients[1], uncertainty: fit.scatterUncertainties[1] },
    v0: { value: fit.coefficients[0], uncertainty: fit.scatterUncertainties[0] },
    rSquared: fit.rSquared,
    pointCount: fit.pointCount,
  };
};

/** Why there is no fit to show, in words a student can act on. */
export const cartFitProblem = (result: FitResult): string | null => {
  if (result.ok) return null;
  return result.reason === 'too-few-points'
    ? 'Not enough points in the fit window. A line needs at least two velocities.'
    : 'The points in this window share too few distinct times to fix a line.';
};

/** The same groups drive the on-screen readout and the caption under a saved plot. */
export const cartFitGroups = (result: FitResult): SummaryGroup[] => {
  const fit = cartFitFrom(result);
  if (!fit) return [];
  return [
    {
      label: 'Line v = a·t + v₀',
      values: [
        { label: 'a (slope)', value: showMeasurement(fit.a), unit: 'm/s²' },
        { label: 'v₀ (intercept)', value: showMeasurement(fit.v0), unit: 'm/s' },
      ],
    },
    {
      label: 'Goodness of fit',
      values: [
        { label: 'R²', value: fixed(fit.rSquared, 4) },
        { label: 'points fitted', value: String(fit.pointCount) },
      ],
    },
  ];
};

export interface RunResult {
  rows: CartRow[];
  /** The window actually fitted: the student's, or the span of the data. */
  range: FitRange | null;
  result: FitResult;
}

export const analyzeRun = (run: CartRun): RunResult => {
  const rows = deriveRows(run.samples);
  const range = run.fitRange ?? velocitySpan(rows);
  return { rows, range, result: fitRunVelocity(rows, range) };
};

// --- plot captions and file names -----------------------------------------

export type PlotQuantity = 'position' | 'velocity';

export const cartPlotCaption = (
  run: CartRun,
  analysis: RunResult,
  quantity: PlotQuantity,
): { title: string; captionLines: string[] } => {
  const hz = run.periodSeconds > 0 ? Math.round(1 / run.periodSeconds) : null;
  const facts = [
    `${run.samples.length} samples`,
    hz !== null ? `${hz} Hz` : null,
    `detector scale ${run.distanceScale.toFixed(3)}`,
  ].filter((entry): entry is string => entry !== null);

  const lines = [
    `${quantity === 'velocity' ? 'Velocity' : 'Position'} against time · ${facts.join(' · ')}`,
  ];

  if (quantity === 'velocity') {
    const problem = cartFitProblem(analysis.result);
    if (problem) {
      lines.push(problem);
    } else {
      if (analysis.range) {
        lines.push(
          `Fitted over t from ${analysis.range.min.toFixed(3)} to ${analysis.range.max.toFixed(3)} s`,
        );
      }
      lines.push(...fitSummaryLines(cartFitGroups(analysis.result)));
    }
  } else if (analysis.range && run.fitRange) {
    lines.push(
      `Velocity fit window: ${analysis.range.min.toFixed(3)} to ${analysis.range.max.toFixed(3)} s`,
    );
  }

  return { title: `Cart Lab — ${run.label}`, captionLines: lines };
};

const slug = (text: string) =>
  text
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'run';

export const plotFileName = (run: CartRun, quantity: PlotQuantity): string =>
  `${slug(run.label)}-${quantity === 'velocity' ? 'velocity-fit' : 'position'}.png`;

// --- spreadsheet export ----------------------------------------------------

export type ExportLayout = 'wide' | 'long';

interface SerializeOptions {
  delimiter: '\t' | ',';
  layout: ExportLayout;
}

/**
 * One cell of text. A comma-separated file quotes anything that could break a
 * row; a tab-separated one cannot quote, so it drops the characters that would.
 */
const cell = (text: string, delimiter: '\t' | ','): string => {
  if (delimiter === '\t') return text.replace(/[\t\r\n]+/g, ' ');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const number = (value: number | null, digits: number): string =>
  value === null || !Number.isFinite(value) ? '' : value.toFixed(digits);

const join = (cells: string[], delimiter: '\t' | ',') =>
  cells.map((entry) => cell(entry, delimiter)).join(delimiter);

/**
 * Raw time, position and velocity for pasting into a spreadsheet.
 *
 * `wide` puts each run in its own block of columns, which is how a sheet is
 * usually laid out for plotting; `long` is one row per sample with the run named
 * on every row, which is what a pivot table wants. Velocity is blank where there
 * is none. There is no trailing newline, so a paste does not end on an empty row.
 */
export const serializeRuns = (runs: readonly CartRun[], options: SerializeOptions): string => {
  const { delimiter, layout } = options;
  const derived = runs.map((run) => ({ run, rows: deriveRows(run.samples) }));
  if (derived.length === 0) return '';

  if (layout === 'long') {
    const lines = [join(['run', 't (s)', 'x (m)', 'v (m/s)'], delimiter)];
    derived.forEach(({ run, rows }) =>
      rows.forEach((row) =>
        lines.push(
          join([run.label, number(row.t, 4), number(row.x, 4), number(row.v, 4)], delimiter),
        ),
      ),
    );
    return lines.join('\n');
  }

  const prefix = (label: string, column: string) =>
    derived.length > 1 ? `${label}: ${column}` : column;
  const header = derived.flatMap(({ run }) => [
    prefix(run.label, 't (s)'),
    prefix(run.label, 'x (m)'),
    prefix(run.label, 'v (m/s)'),
  ]);
  const height = Math.max(...derived.map(({ rows }) => rows.length));
  const lines = [join(header, delimiter)];
  for (let index = 0; index < height; index += 1) {
    lines.push(
      join(
        derived.flatMap(({ rows }) => {
          const row = rows[index];
          return row ? [number(row.t, 4), number(row.x, 4), number(row.v, 4)] : ['', '', ''];
        }),
        delimiter,
      ),
    );
  }
  return lines.join('\n');
};

/** One row per run: what the fit found, for pasting next to the raw data. */
export const serializeResults = (runs: readonly CartRun[], delimiter: '\t' | ','): string => {
  if (runs.length === 0) return '';
  const lines = [
    join(
      ['run', 'a (m/s²)', 'σ_a (m/s²)', 'v0 (m/s)', 'σ_v0 (m/s)', 't start (s)', 't end (s)', 'points'],
      delimiter,
    ),
  ];
  runs.forEach((run) => {
    const analysis = analyzeRun(run);
    const fit = cartFitFrom(analysis.result);
    lines.push(
      join(
        [
          run.label,
          number(fit ? fit.a.value : null, 4),
          number(fit ? fit.a.uncertainty : null, 4),
          number(fit ? fit.v0.value : null, 4),
          number(fit ? fit.v0.uncertainty : null, 4),
          number(fit && analysis.range ? analysis.range.min : null, 3),
          number(fit && analysis.range ? analysis.range.max : null, 3),
          fit ? String(fit.pointCount) : '',
        ],
        delimiter,
      ),
    );
  });
  return lines.join('\n');
};

// --- run bookkeeping -------------------------------------------------------

/** "Run 4" after "Run 3", whatever the earlier runs have since been renamed to. */
export const nextRunLabel = (runs: readonly CartRun[]): string => {
  const numbers = runs
    .map((run) => /^Run (\d+)$/.exec(run.label))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]));
  return `Run ${Math.max(0, ...numbers) + 1}`;
};

export const nextRunId = (runs: readonly CartRun[]): number =>
  Math.max(0, ...runs.map((run) => run.id)) + 1;

// --- remembering runs across a refresh -------------------------------------

export const CART_LAB_STORAGE_KEY = 'physics-nook:cart-lab:v1';

export const serializeStoredRuns = (runs: readonly CartRun[]): string => JSON.stringify(runs);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const parseRun = (value: unknown): CartRun | null => {
  if (typeof value !== 'object' || value === null) return null;
  const entry = value as Record<string, unknown>;
  if (!isFiniteNumber(entry.id) || typeof entry.label !== 'string') return null;
  if (!isFiniteNumber(entry.periodSeconds) || !isFiniteNumber(entry.distanceScale)) return null;
  if (!Array.isArray(entry.samples)) return null;

  const samples: CartSample[] = [];
  for (const raw of entry.samples) {
    const sample = raw as Record<string, unknown> | null;
    if (!sample || !isFiniteNumber(sample.t) || !isFiniteNumber(sample.x)) return null;
    samples.push({ t: sample.t, x: sample.x, ok: sample.ok !== false });
  }

  const range = entry.fitRange as Record<string, unknown> | null | undefined;
  const fitRange =
    range && isFiniteNumber(range.min) && isFiniteNumber(range.max)
      ? { min: range.min, max: range.max }
      : null;

  return {
    id: entry.id,
    label: entry.label,
    samples,
    periodSeconds: entry.periodSeconds,
    distanceScale: entry.distanceScale,
    fitRange,
  };
};

/** Whatever was stored, or nothing: a corrupt entry must never stop the page loading. */
export const parseStoredRuns = (raw: string | null): CartRun[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseRun).filter((run): run is CartRun => run !== null);
  } catch {
    return [];
  }
};

// --- a run to try the page with --------------------------------------------

/** Small deterministic generator, so the sample run is the same every time. */
const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const SAMPLE_ACCELERATION = 0.62;
export const SAMPLE_RELEASE_TIME = 0.6;
export const SAMPLE_CATCH_TIME = 2.4;

/**
 * A made-up release down a ramp, for trying the page without a detector: a hand
 * holds the cart, lets go, the cart speeds up at `SAMPLE_ACCELERATION`, and is
 * caught and nudged back at the end. It is labelled as simulated wherever it is
 * offered, and nothing downstream can tell it from a recording.
 */
export const syntheticCartRun = (
  id: number,
  label: string,
  seed = 1,
  periodSeconds = 0.05,
): CartRun => {
  const random = mulberry32(seed);
  const gaussian = () =>
    Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

  const start = 0.3;
  const travel = 0.5 * SAMPLE_ACCELERATION * (SAMPLE_CATCH_TIME - SAMPLE_RELEASE_TIME) ** 2;
  const caught = start + travel;
  const speedAtCatch = SAMPLE_ACCELERATION * (SAMPLE_CATCH_TIME - SAMPLE_RELEASE_TIME);
  const duration = 3.5;

  const samples: CartSample[] = [];
  for (let index = 0; index * periodSeconds <= duration + 1e-9; index += 1) {
    const t = index * periodSeconds;
    let position: number;
    if (t < SAMPLE_RELEASE_TIME) {
      // A hand steadying the cart: a few millimetres of wobble.
      position = start + 0.004 * Math.sin(9 * t);
    } else if (t < SAMPLE_CATCH_TIME) {
      position = start + 0.5 * SAMPLE_ACCELERATION * (t - SAMPLE_RELEASE_TIME) ** 2;
    } else if (t < SAMPLE_CATCH_TIME + 0.3) {
      // Hit the end and bounce back a little.
      position = caught - 0.3 * speedAtCatch * (t - SAMPLE_CATCH_TIME) * 0.5;
    } else {
      position = caught - 0.3 * speedAtCatch * 0.3 * 0.5;
    }
    samples.push({ t, x: position + 0.0015 * gaussian(), ok: true });
  }

  return { id, label, samples, periodSeconds, distanceScale: 1, fitRange: null };
};
