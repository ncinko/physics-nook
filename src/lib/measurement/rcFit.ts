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
export const RC_SIGMA = 0.1;

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
): TauInterval | null =>
  deltaChiIntervalFor(
    (tau) => chiSquareAt(points, bestV0ForTau(points, tau), tau),
    bestTau,
    rise,
  );

/** The same search for any profiled χ²(τ), e.g. one that also re-optimizes t0. */
export const deltaChiIntervalFor = (
  chiAt: (tau: number) => number,
  bestTau: number,
  rise = 1,
): TauInterval | null => {
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

// --- A run that starts recording before the switch closes -------------------
//
// The same circuit, but the voltmeter was started early: the first few readings
// sit at zero, and the capacitor only begins charging at the (unknown) time t0.
// V(t) = 0 for t ≤ t0, then V0 (1 − e^(−(t − t0)/τ)). That is a third parameter,
// and it is correlated with τ, which is why τ's uncertainty grows when it is free.

/** The "truth" for the delayed run: the switch closes at t0 = 1.25 s. */
export const RC_DELAYED_TRUTH = { v0: 5, tau: 2.2, t0: 1.25 } as const;

/** Reading times for the delayed run: 0 to 10 s, so three readings precede t0. */
export const RC_DELAYED_TIMES: readonly number[] = Array.from({ length: 21 }, (_, i) => 0.5 * i);

/** The seed behind the delayed dataset the by-hand island starts from. */
export const RC_DELAYED_SEED = 10;

export const delayedVoltage = (t: number, v0: number, tau: number, t0: number): number =>
  t <= t0 ? 0 : v0 * (1 - Math.exp(-(t - t0) / tau));

export const generateDelayedRcData = (seed: number): FitPoint[] => {
  const rng = createRng(scrambleSeed(seed));
  return RC_DELAYED_TIMES.map((t) => ({
    x: t,
    y:
      delayedVoltage(t, RC_DELAYED_TRUTH.v0, RC_DELAYED_TRUTH.tau, RC_DELAYED_TRUTH.t0) +
      RC_SIGMA * gaussian(rng.next),
    sigma: RC_SIGMA,
  }));
};

const delayedModel = (t: number, p: readonly number[]) => delayedVoltage(t, p[0], p[1], p[2]);

/** Best-fit V0, τ and t0, in that order (uncertainties line up). */
export const fitDelayedRc = (points: readonly FitPoint[]): RcFitResult => {
  const finite = points.filter((point) => Number.isFinite(point.y));
  if (finite.length < 4) return { ok: false };
  const peak = Math.max(...finite.map((point) => point.y), 1e-3);
  const rising = finite.find((point) => point.y > 0.25 * peak);
  const guessT0 = rising ? Math.max(0, rising.x - 0.75) : 0;
  const guessTau = Math.max(...finite.map((point) => point.x), 1) / 4;
  const result = fitNonlinear(points, delayedModel, [peak, guessTau, guessT0]);
  return result.ok ? { ok: true, fit: result.fit } : { ok: false };
};

export const delayedResiduals = (
  points: readonly FitPoint[],
  v0: number,
  tau: number,
  t0: number,
): number[] => points.map((point) => point.y - delayedVoltage(point.x, v0, tau, t0));

export const delayedChiSquareAt = (
  points: readonly FitPoint[],
  v0: number,
  tau: number,
  t0: number,
): number =>
  points.reduce((sum, point) => {
    const sigma = point.sigma ?? 1;
    return sum + ((point.y - delayedVoltage(point.x, v0, tau, t0)) / sigma) ** 2;
  }, 0);

/** The V0 that minimizes χ² at fixed τ and t0 (still linear in V0). */
const bestV0ForDelay = (points: readonly FitPoint[], tau: number, t0: number): number => {
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    const weight = 1 / (point.sigma ?? 1) ** 2;
    const f = delayedVoltage(point.x, 1, tau, t0);
    numerator += weight * f * point.y;
    denominator += weight * f * f;
  }
  return denominator > 0 ? numerator / denominator : Number.NaN;
};

export interface DelayedBest {
  v0: number;
  t0: number;
  chiSquare: number;
}

const T0_SEARCH: readonly [number, number] = [0, 3];

/**
 * With τ held fixed, the V0 and t0 that minimize χ²: what "move τ, then re-adjust
 * V0 and t0 until it looks as good as it can" does by hand. V0 has a closed form,
 * so only t0 is searched: a coarse scan to find the right valley, then
 * golden-section refinement inside it.
 */
export const bestDelayedForTau = (points: readonly FitPoint[], tau: number): DelayedBest => {
  const chiAtT0 = (t0: number) => delayedChiSquareAt(points, bestV0ForDelay(points, tau, t0), tau, t0);
  const [lo, hi] = T0_SEARCH;
  const steps = 60;
  const width = (hi - lo) / steps;
  let bestIndex = 0;
  let bestChi = Infinity;
  for (let i = 0; i <= steps; i += 1) {
    const chi = chiAtT0(lo + i * width);
    if (chi < bestChi) {
      bestChi = chi;
      bestIndex = i;
    }
  }
  let a = Math.max(lo, lo + (bestIndex - 1) * width);
  let b = Math.min(hi, lo + (bestIndex + 1) * width);
  const ratio = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 60; i += 1) {
    const c = b - ratio * (b - a);
    const d = a + ratio * (b - a);
    if (chiAtT0(c) < chiAtT0(d)) b = d;
    else a = c;
  }
  const t0 = (a + b) / 2;
  const v0 = bestV0ForDelay(points, tau, t0);
  return { v0, t0, chiSquare: delayedChiSquareAt(points, v0, tau, t0) };
};

export interface DelayedProfilePoint extends DelayedBest {
  tau: number;
}

/** χ² as a function of τ alone, with V0 and t0 re-optimized at every τ. */
export const profileDelayedChiSquare = (
  points: readonly FitPoint[],
  taus: readonly number[],
): DelayedProfilePoint[] => taus.map((tau) => ({ tau, ...bestDelayedForTau(points, tau) }));

export const deltaChiIntervalDelayed = (
  points: readonly FitPoint[],
  bestTau: number,
  rise = 1,
): TauInterval | null =>
  deltaChiIntervalFor((tau) => bestDelayedForTau(points, tau).chiSquare, bestTau, rise);

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
