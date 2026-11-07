/**
 * Basic analysis of one channel over an optional time window. DOM-free.
 *
 * Every function takes plain arrays plus a `TimeRange | null` and ignores
 * non-finite samples, so a dropout never poisons a statistic.
 */

import { fitPolynomial, type FitResult, type PolynomialDegree } from '../math/leastSquares.ts';
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

export interface Peak {
  index: number;
  t: number;
  value: number;
}

/**
 * Local maxima at least `minProminence` above the lowest point reached before
 * the next higher peak on either side. A cheap, honest definition: it ignores
 * noise wiggles smaller than the threshold without needing a smoothing pass.
 */
export const findPeaks = (
  t: readonly number[],
  y: readonly number[],
  minProminence: number,
  range: TimeRange | null = null,
): Peak[] => {
  const data = windowSeries(t, y, range);
  const peaks: Peak[] = [];
  for (let index = 1; index < data.y.length - 1; index += 1) {
    const value = data.y[index];
    if (!(value > data.y[index - 1] && value >= data.y[index + 1])) continue;

    let leftMin = value;
    for (let k = index - 1; k >= 0 && data.y[k] <= value; k -= 1) leftMin = Math.min(leftMin, data.y[k]);
    let rightMin = value;
    for (let k = index + 1; k < data.y.length && data.y[k] <= value; k += 1) {
      rightMin = Math.min(rightMin, data.y[k]);
    }
    if (value - Math.max(leftMin, rightMin) >= minProminence) {
      peaks.push({ index, t: data.t[index], value });
    }
  }
  return peaks;
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
