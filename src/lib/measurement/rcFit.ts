/**
 * Synthetic charging-RC data and the fitting helpers the "Fitting Data" page
 * is built on.
 *
 * Model: V(t) = V0 · (1 − e^(−t/τ)), with τ = RC. A line is the wrong model, a
 * two-parameter exponential is the right one, and the *uncertainty* in τ can be
 * read three ways that all agree here:
 *   1. scanning τ by hand until the residuals look systematic,
 *   2. the chi-square rule "χ² rises by 1 from its minimum" (`profileChiSquare`,
 *      `deltaChiInterval`), and
 *   3. the covariance matrix from the fit (`fitRc().uncertainties`), or the
 *      scatter of τ over repeated trials (`runTrials`).
 *
 * Data are generated from a seed, so every page load (and the server render)
 * draws the identical set. Nothing here touches the DOM.
 */

import { fitPolynomial, type FitPoint, type PolynomialFit } from '../math/leastSquares.ts';
import { fitNonlinear, type NonlinearFit } from '../math/nonlinearFit.ts';
import { createRng } from '../shared/rng.ts';

/** The "truth" behind the synthetic data: 100 kΩ × 22 µF = 2.2 s. */
export const RC_TRUTH = { v0: 5, tau: 2.2 } as const;

/** Voltmeter uncertainty on every reading, in volts. */
export const RC_SIGMA = 0.05;

/** Reading times, in seconds. */
export const RC_TIMES: readonly number[] = Array.from({ length: 20 }, (_, i) => 0.5 * (i + 1));

/** The seed behind the dataset every island on the page starts from. */
export const RC_DEFAULT_SEED = 3;

export const chargingVoltage = (t: number, v0: number, tau: number): number =>
  v0 * (1 - Math.exp(-t / tau));

/** Standard normal draw (Box–Muller) from a `createRng`-style uniform source. */
const gaussian = (next: () => number): number => {
  const u = Math.max(next(), 1e-12);
  const v = next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/**
 * Scramble the run number before seeding. Neighbouring seeds fed straight into
 * mulberry32 give visibly correlated first draws, which would make consecutive
 * "repeat" runs less independent than a real repeated experiment.
 */
const scrambleSeed = (seed: number): number => {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

/** One run of the experiment: true curve plus Gaussian voltmeter noise. */
export const generateRcData = (seed: number): FitPoint[] => {
  const rng = createRng(scrambleSeed(seed));
  return RC_TIMES.map((t) => ({
    x: t,
    y: chargingVoltage(t, RC_TRUTH.v0, RC_TRUTH.tau) + RC_SIGMA * gaussian(rng.next),
    sigma: RC_SIGMA,
  }));
};

const rcModel = (t: number, p: readonly number[]) => chargingVoltage(t, p[0], p[1]);

export type RcFitResult = { ok: true; fit: NonlinearFit } | { ok: false };

/** Best-fit V0 and τ. Parameters are `[v0, tau]`; uncertainties line up. */
export const fitRc = (points: readonly FitPoint[]): RcFitResult => {
  const finite = points.filter((point) => Number.isFinite(point.y));
  if (finite.length < 3) return { ok: false };
  const guessV0 = Math.max(...finite.map((point) => point.y), 1e-3);
  const guessTau = Math.max(...finite.map((point) => point.x), 1) / 3;
  const result = fitNonlinear(points, rcModel, [guessV0, guessTau]);
  return result.ok ? { ok: true, fit: result.fit } : { ok: false };
};

/** The straight-line fit to the same data (the "wrong model" half of the page). */
export const fitRcLine = (points: readonly FitPoint[]): PolynomialFit | null => {
  const result = fitPolynomial(points, 1);
  return result.ok ? result.fit : null;
};

export const rcResiduals = (points: readonly FitPoint[], v0: number, tau: number): number[] =>
  points.map((point) => point.y - chargingVoltage(point.x, v0, tau));

/** Weighted sum of squared residuals: χ² = Σ ((y − f)/σ)². */
export const chiSquareAt = (points: readonly FitPoint[], v0: number, tau: number): number =>
  points.reduce((sum, point) => {
    const sigma = point.sigma ?? 1;
    return sum + ((point.y - chargingVoltage(point.x, v0, tau)) / sigma) ** 2;
  }, 0);

/**
 * The V0 that minimizes χ² when τ is held fixed. The model is linear in V0, so
 * this has a closed form: V0 = Σ w·f·y / Σ w·f², with f = 1 − e^(−t/τ).
 */
export const bestV0ForTau = (points: readonly FitPoint[], tau: number): number => {
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    const weight = 1 / (point.sigma ?? 1) ** 2;
    const f = 1 - Math.exp(-point.x / tau);
    numerator += weight * f * point.y;
    denominator += weight * f * f;
  }
  return denominator > 0 ? numerator / denominator : Number.NaN;
};

export interface ProfilePoint {
  tau: number;
  /** χ² with V0 re-optimized at this τ. */
  chiSquare: number;
  v0: number;
}

/**
 * χ² as a function of τ alone, re-optimizing V0 at every τ. This is what "move
 * τ, then re-adjust V0 until it looks as good as it can" does by hand.
 */
export const profileChiSquare = (
  points: readonly FitPoint[],
  taus: readonly number[],
): ProfilePoint[] =>
  taus.map((tau) => {
    const v0 = bestV0ForTau(points, tau);
    return { tau, v0, chiSquare: chiSquareAt(points, v0, tau) };
  });

export interface TauInterval {
  low: number;
  high: number;
  /** χ² at the best fit, the baseline the interval is measured from. */
  minimum: number;
}

/**
 * The τ range over which the profiled χ² stays within `rise` (default 1) of its
 * minimum, found by bisection outward from the best-fit τ. Returns null if the
 * curve never rises that far inside the search window.
 */
export const deltaChiInterval = (
  points: readonly FitPoint[],
  bestTau: number,
  rise = 1,
): TauInterval | null => {
  const chiAt = (tau: number) => {
    const v0 = bestV0ForTau(points, tau);
    return chiSquareAt(points, v0, tau);
  };
  const minimum = chiAt(bestTau);
  const target = minimum + rise;

  const crossing = (direction: 1 | -1): number | null => {
    let inside = bestTau;
    let outside = bestTau;
    let step = bestTau * 0.01;
    for (let i = 0; i < 60; i += 1) {
      const candidate = direction === 1 ? bestTau + step : bestTau - step;
      if (candidate <= 0) return null;
      if (chiAt(candidate) >= target) {
        outside = candidate;
        break;
      }
      inside = candidate;
      step *= 1.5;
      if (i === 59) return null;
    }
    for (let i = 0; i < 80; i += 1) {
      const mid = (inside + outside) / 2;
      if (chiAt(mid) >= target) outside = mid;
      else inside = mid;
    }
    return (inside + outside) / 2;
  };

  const low = crossing(-1);
  const high = crossing(1);
  if (low === null || high === null) return null;
  return { low, high, minimum };
};

export interface TrialSummary {
  taus: number[];
  mean: number;
  /** Sample standard deviation of the fitted τ values (NaN with fewer than 2). */
  scatter: number;
}

/** Fit `count` independent runs (seeds `firstSeed`, `firstSeed + 1`, ...). */
export const runTrials = (firstSeed: number, count: number): TrialSummary => {
  const taus: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const result = fitRc(generateRcData(firstSeed + i));
    if (result.ok) taus.push(result.fit.parameters[1]);
  }
  return summarizeTrials(taus);
};

export const summarizeTrials = (taus: readonly number[]): TrialSummary => {
  const mean = taus.length > 0 ? taus.reduce((sum, value) => sum + value, 0) / taus.length : Number.NaN;
  const scatter =
    taus.length > 1
      ? Math.sqrt(taus.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (taus.length - 1))
      : Number.NaN;
  return { taus: taus.slice(), mean, scatter };
};
