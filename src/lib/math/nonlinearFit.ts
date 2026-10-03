/**
 * Weighted nonlinear least squares by Levenberg–Marquardt.
 *
 * Companion to `leastSquares.ts`: that module handles lines and parabolas in
 * closed form, this one handles any model `y = f(x; p)` that is smooth in its
 * parameters (an exponential approach to a limit, a decay with a background, ...)
 * by iterating from an initial guess.
 *
 * The result mirrors `PolynomialFit` on purpose, so a page can show a line fit
 * and a functional fit side by side with the same vocabulary:
 * `uncertainties` come from the supplied sigmas, `scatterUncertainties` are
 * rescaled by sqrt(chi2_red), and a missing or invalid sigma on *any* point makes
 * the whole fit fall back to unit weights.
 *
 * Uncertainties come from the covariance matrix (JᵀWJ)⁻¹ at the minimum, with J
 * the Jacobian of the model. Near the minimum chi-square is a paraboloid in the
 * parameters and this is its curvature — the same "chi-square rises by 1" rule a
 * by-hand scan of one parameter would find (see `profileChiSquare` in
 * `src/lib/measurement/rcFit.ts`).
 *
 * DOM-free and deterministic; tested in `tests/math`.
 */

import type { FitPoint } from './leastSquares.ts';

export type ModelFunction = (x: number, parameters: readonly number[]) => number;

export interface NonlinearFit {
  parameters: number[];
  /** 1-sigma, propagated from the supplied per-point sigmas. */
  uncertainties: number[];
  /** `uncertainties` times sqrt(chi2_red); NaN when there are no degrees of freedom. */
  scatterUncertainties: number[];
  /** Parameter covariance (JᵀWJ)⁻¹, from the supplied sigmas. */
  covariance: number[][];
  chiSquare: number;
  reducedChiSquare: number;
  degreesOfFreedom: number;
  /** y[i] - f(x[i]; parameters), in input order. */
  residuals: number[];
  /** False when sigmas were absent or invalid and unit weights were used. */
  weighted: boolean;
  pointCount: number;
  iterations: number;
}

export type NonlinearFailure = 'too-few-points' | 'degenerate' | 'no-convergence';

export type NonlinearFitResult =
  | { ok: true; fit: NonlinearFit }
  | { ok: false; reason: NonlinearFailure };

export interface NonlinearOptions {
  maxIterations?: number;
  /** Stop when chi-square improves by less than this fraction. */
  tolerance?: number;
}

/** Gauss-Jordan inverse with partial pivoting; null if the matrix is singular. */
const invert = (matrix: readonly number[][]): number[][] | null => {
  const size = matrix.length;
  let scale = 0;
  const rows = matrix.map((row, i) => {
    const extended = new Array<number>(size * 2).fill(0);
    row.forEach((value, j) => {
      extended[j] = value;
      scale = Math.max(scale, Math.abs(value));
    });
    extended[size + i] = 1;
    return extended;
  });
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  const tolerance = 1e-13 * scale;

  for (let col = 0; col < size; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < size; r += 1) {
      if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    }
    if (!(Math.abs(rows[pivot][col]) > tolerance)) return null;
    [rows[pivot], rows[col]] = [rows[col], rows[pivot]];
    const pivotValue = rows[col][col];
    for (let j = 0; j < size * 2; j += 1) rows[col][j] /= pivotValue;
    for (let r = 0; r < size; r += 1) {
      if (r === col) continue;
      const factor = rows[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < size * 2; j += 1) rows[r][j] -= factor * rows[col][j];
    }
  }
  return rows.map((row) => row.slice(size));
};

export const fitNonlinear = (
  points: readonly FitPoint[],
  model: ModelFunction,
  initial: readonly number[],
  options: NonlinearOptions = {},
): NonlinearFitResult => {
  const { maxIterations = 200, tolerance = 1e-12 } = options;
  const usable = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const order = initial.length;
  const count = usable.length;
  if (count < order) return { ok: false, reason: 'too-few-points' };
  if (initial.some((value) => !Number.isFinite(value))) return { ok: false, reason: 'degenerate' };

  const weighted = usable.every(
    (point) => typeof point.sigma === 'number' && Number.isFinite(point.sigma) && point.sigma > 0,
  );
  const weights = usable.map((point) => (weighted ? 1 / (point.sigma as number) ** 2 : 1));

  const chiSquareOf = (parameters: readonly number[]): number => {
    let sum = 0;
    for (let i = 0; i < count; i += 1) {
      const residual = usable[i].y - model(usable[i].x, parameters);
      sum += weights[i] * residual * residual;
    }
    return sum;
  };

  // Central-difference Jacobian. The step scales with the parameter so that a
  // parameter near 1e-6 and one near 1e3 are both differentiated sensibly.
  const jacobianRow = (x: number, parameters: readonly number[]): number[] =>
    parameters.map((value, j) => {
      const step = 1e-6 * Math.max(Math.abs(value), 1e-3);
      const up = parameters.slice();
      const down = parameters.slice();
      up[j] = value + step;
      down[j] = value - step;
      return (model(x, up) - model(x, down)) / (2 * step);
    });

  const normalMatrix = (parameters: readonly number[]) => {
    const matrix = Array.from({ length: order }, () => new Array<number>(order).fill(0));
    const gradient = new Array<number>(order).fill(0);
    for (let i = 0; i < count; i += 1) {
      const row = jacobianRow(usable[i].x, parameters);
      const residual = usable[i].y - model(usable[i].x, parameters);
      for (let a = 0; a < order; a += 1) {
        gradient[a] += weights[i] * row[a] * residual;
        for (let b = 0; b < order; b += 1) matrix[a][b] += weights[i] * row[a] * row[b];
      }
    }
    return { matrix, gradient };
  };

  let parameters = initial.slice();
  let chiSquare = chiSquareOf(parameters);
  if (!Number.isFinite(chiSquare)) return { ok: false, reason: 'degenerate' };

  let damping = 1e-3;
  let iterations = 0;
  let converged = false;

  while (iterations < maxIterations) {
    iterations += 1;
    const { matrix, gradient } = normalMatrix(parameters);

    let improved = false;
    // Raise the damping until a step actually lowers chi-square.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const damped = matrix.map((row, a) =>
        row.map((value, b) => (a === b ? value + damping * Math.max(value, 1e-12) : value)),
      );
      const inverse = invert(damped);
      if (!inverse) {
        damping *= 10;
        continue;
      }
      const step = inverse.map((row) => row.reduce((sum, value, b) => sum + value * gradient[b], 0));
      const trial = parameters.map((value, j) => value + step[j]);
      const trialChi = chiSquareOf(trial);
      if (Number.isFinite(trialChi) && trialChi <= chiSquare) {
        const gain = chiSquare - trialChi;
        parameters = trial;
        const previous = chiSquare;
        chiSquare = trialChi;
        damping = Math.max(damping / 10, 1e-12);
        improved = true;
        if (gain <= tolerance * Math.max(previous, 1e-30)) converged = true;
        break;
      }
      damping *= 10;
    }

    if (!improved) {
      // No downhill step at any damping: we are as low as floating point allows.
      converged = true;
    }
    if (converged) break;
  }

  if (!converged) return { ok: false, reason: 'no-convergence' };

  const { matrix } = normalMatrix(parameters);
  const covariance = invert(matrix);
  if (!covariance) return { ok: false, reason: 'degenerate' };

  const uncertainties = covariance.map((row, j) => Math.sqrt(Math.max(0, row[j])));
  const degreesOfFreedom = count - order;
  const reducedChiSquare = degreesOfFreedom > 0 ? chiSquare / degreesOfFreedom : Number.NaN;
  const scatterFactor = Math.sqrt(reducedChiSquare);

  return {
    ok: true,
    fit: {
      parameters,
      uncertainties,
      scatterUncertainties: uncertainties.map((value) => value * scatterFactor),
      covariance,
      chiSquare,
      reducedChiSquare,
      degreesOfFreedom,
      residuals: usable.map((point) => point.y - model(point.x, parameters)),
      weighted,
      pointCount: count,
      iterations,
    },
  };
};
