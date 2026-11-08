/**
 * Basic analysis of one channel over an optional time window. DOM-free.
 *
 * Every function takes plain arrays plus a `TimeRange | null` and ignores
 * non-finite samples, so a dropout never poisons a statistic.
 */

import {
  fitPolynomial,
  predictPolynomial,
  type FitResult,
  type PolynomialDegree,
} from '../math/leastSquares.ts';
import type { TimeRange } from './types.ts';

export interface Windowed {
  t: number[];
  y: number[];
}

export const windowSeries = (
  t: readonly number[],
  y: readonly number[],
  range: TimeRange | null,
): Windowed => {
  const out: Windowed = { t: [], y: [] };
  const count = Math.min(t.length, y.length);
  for (let index = 0; index < count; index += 1) {
    if (!Number.isFinite(t[index]) || !Number.isFinite(y[index])) continue;
    if (range && (t[index] < range.min || t[index] > range.max)) continue;
    out.t.push(t[index]);
    out.y.push(y[index]);
  }
  return out;
};

export interface SeriesStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  /** Sample standard deviation (n - 1); NaN for fewer than two points. */
  std: number;
  /** Time of the maximum and of the minimum. */
  tMax: number;
  tMin: number;
}

export const seriesStats = (
  t: readonly number[],
  y: readonly number[],
  range: TimeRange | null = null,
): SeriesStats | null => {
  const data = windowSeries(t, y, range);
  if (data.y.length === 0) return null;

  let min = Infinity;
  let max = -Infinity;
  let tMin = data.t[0];
  let tMax = data.t[0];
  let sum = 0;
  data.y.forEach((value, index) => {
    sum += value;
    if (value < min) {
      min = value;
      tMin = data.t[index];
    }
    if (value > max) {
      max = value;
      tMax = data.t[index];
    }
  });
  const mean = sum / data.y.length;
  const variance =
    data.y.length > 1
      ? data.y.reduce((acc, value) => acc + (value - mean) ** 2, 0) / (data.y.length - 1)
      : NaN;

  return { count: data.y.length, min, max, mean, std: Math.sqrt(variance), tMax, tMin };
};

/**
 * Area under the curve by the trapezoid rule. For a force channel this is the
 * impulse in N·s. Returns null with fewer than two points in the window.
 */
export const integrate = (
  t: readonly number[],
  y: readonly number[],
  range: TimeRange | null = null,
): number | null => {
  const data = windowSeries(t, y, range);
  if (data.t.length < 2) return null;
  let area = 0;
  for (let index = 1; index < data.t.length; index += 1) {
    area += ((data.y[index] + data.y[index - 1]) / 2) * (data.t[index] - data.t[index - 1]);
  }
  return area;
};

/** Central-difference derivative, one-sided at the ends. Same length as input. */
export const derivative = (t: readonly number[], y: readonly number[]): number[] => {
  const count = Math.min(t.length, y.length);
  const out: number[] = new Array(count).fill(NaN);
  for (let index = 0; index < count; index += 1) {
    const lo = Math.max(0, index - 1);
    const hi = Math.min(count - 1, index + 1);
    const dt = t[hi] - t[lo];
    out[index] = dt > 0 ? (y[hi] - y[lo]) / dt : NaN;
  }
  return out;
};

/** Centred moving average of odd width; the window shrinks at the edges. */
export const smooth = (y: readonly number[], width: number): number[] => {
  const half = Math.max(0, Math.floor(width / 2));
  return y.map((_, index) => {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, index - half); k <= Math.min(y.length - 1, index + half); k += 1) {
      if (Number.isFinite(y[k])) {
        sum += y[k];
        n += 1;
      }
    }
    return n > 0 ? sum / n : NaN;
  });
};

export const fitSeries = (
  t: readonly number[],
  y: readonly number[],
  degree: PolynomialDegree,
  range: TimeRange | null = null,
): FitResult => {
  const data = windowSeries(t, y, range);
  return fitPolynomial(
    data.t.map((x, index) => ({ x, y: data.y[index] })),
    degree,
  );
};

// --- functional fits for Analyze mode ---------------------------------------

export type FitKind = 'none' | 'linear' | 'quadratic' | 'proportional';

export interface FitSummary {
  kind: Exclude<FitKind, 'none'>;
  /** Ascending powers: y = c0 + c1 x + c2 x². Proportional has c0 = 0. */
  coefficients: number[];
  rSquared: number;
  pointCount: number;
  equation: string;
  predict: (x: number) => number;
}

/** Four significant figures, without trailing noise. */
export const sig = (value: number, digits = 4): string =>
  Number.isFinite(value) ? String(Number(value.toPrecision(digits))) : '—';

const term = (value: number, suffix: string, first: boolean): string => {
  const magnitude = sig(Math.abs(value));
  const body = `${magnitude}${suffix}`;
  if (first) return value < 0 ? `−${body}` : body;
  return `${value < 0 ? '−' : '+'} ${body}`;
};

/**
 * Least squares through the origin: y = k x. The slope is Σxy / Σx²; R² is
 * measured against the mean of y, floored at zero because a through-origin
 * model can fit worse than a flat line.
 */
export const fitProportional = (
  t: readonly number[],
  y: readonly number[],
  range: TimeRange | null = null,
): { k: number; rSquared: number; pointCount: number } | null => {
  const data = windowSeries(t, y, range);
  if (data.t.length < 2) return null;
  const sxx = data.t.reduce((sum, x) => sum + x * x, 0);
  if (!(sxx > 0)) return null;
  const sxy = data.t.reduce((sum, x, index) => sum + x * data.y[index], 0);
  const k = sxy / sxx;
  const mean = data.y.reduce((sum, value) => sum + value, 0) / data.y.length;
  const ssr = data.y.reduce((sum, value, index) => sum + (value - k * data.t[index]) ** 2, 0);
  const sst = data.y.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return { k, rSquared: sst > 0 ? Math.max(0, 1 - ssr / sst) : 1, pointCount: data.t.length };
};

/** Fits `kind` over the window; null when there are too few points or none is chosen. */
export const computeFit = (
  kind: FitKind,
  t: readonly number[],
  y: readonly number[],
  range: TimeRange | null,
  names: { x: string; y: string } = { x: 't', y: 'y' },
): FitSummary | null => {
  if (kind === 'none') return null;

  if (kind === 'proportional') {
    const fit = fitProportional(t, y, range);
    if (!fit) return null;
    return {
      kind,
      coefficients: [0, fit.k],
      rSquared: fit.rSquared,
      pointCount: fit.pointCount,
      equation: `${names.y} = ${term(fit.k, `·${names.x}`, true)}`,
      predict: (x) => fit.k * x,
    };
  }

  const result = fitSeries(t, y, kind === 'linear' ? 1 : 2, range);
  if (!result.ok) return null;
  const c = result.fit.coefficients;
  const equation =
    kind === 'linear'
      ? `${names.y} = ${term(c[1], `·${names.x}`, true)} ${term(c[0], '', false)}`
      : `${names.y} = ${term(c[2], `·${names.x}²`, true)} ${term(c[1], `·${names.x}`, false)} ${term(c[0], '', false)}`;
  return {
    kind,
    coefficients: c,
    rSquared: result.fit.rSquared,
    pointCount: result.fit.pointCount,
    equation,
    predict: (x) => predictPolynomial(c, x),
  };
};

/** Samples a fit across a window for drawing. */
export const sampleFit = (
  fit: FitSummary,
  range: TimeRange,
  count = 64,
): Array<{ x: number; y: number }> =>
  Array.from({ length: count }, (_, index) => {
    const x = range.min + ((range.max - range.min) * index) / (count - 1);
    return { x, y: fit.predict(x) };
  });
