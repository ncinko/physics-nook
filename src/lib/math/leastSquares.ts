/**
 * Weighted polynomial least squares for degree 1 (a line) and degree 2 (a
 * parabola) — the two models a first-year lab actually fits.
 *
 * The module is deliberately domain-free: it knows nothing about time,
 * position, or physics. Interpreting a quadratic coefficient as half an
 * acceleration is the caller's job (see `kinematicsFromQuadratic` in
 * `src/lib/kinematics/videoAnalysis.ts`).
 *
 * Two design points worth knowing before editing:
 *
 * 1. The fit is computed in centered coordinates `u = x - x̄`, then mapped back.
 *    Normal equations built on raw x around, say, 100 are badly conditioned:
 *    the moments span many orders of magnitude and a 3x3 solve loses most of
 *    its significant digits. Centering makes the constant and linear columns
 *    orthogonal under the weighted inner product, which fixes the conditioning.
 *    The coefficients *and the covariance matrix* are then transformed back by
 *    the same linear map T — transforming only the coefficients is a classic
 *    bug that reports the intercept uncertainty as the (far smaller)
 *    uncertainty of the fitted value at x̄.
 *
 * 2. Two uncertainty families are reported, because they answer different
 *    questions. `uncertainties` come from the supplied per-point sigmas: "if my
 *    error bars are right, how well is this parameter pinned?"
 *    `scatterUncertainties` come from the observed residual scatter: "given how
 *    much the data actually wobbles, how well is it pinned?" `reducedChiSquare`
 *    is the honesty check between the two — near 1 means the claimed error bars
 *    match the observed scatter.
 *
 * Everything here is DOM-free and deterministic so it can be unit tested in
 * `tests/math`.
 */

export type PolynomialDegree = 1 | 2;

/** One observation. `sigma` is the 1-sigma uncertainty on `y`. */
export interface FitPoint {
  x: number;
  y: number;
  /**
   * Omitted, non-finite, or non-positive on *any* point makes the whole fit
   * fall back to unit weights (`weighted: false`). Partial weighting is not
   * offered: silently treating a missing sigma as 1 would quietly reweight the
   * data set in units nobody chose.
   */
  sigma?: number;
}

export interface PolynomialFit {
  degree: PolynomialDegree;
  /** Ascending powers: y = c[0] + c[1]·x + c[2]·x². */
  coefficients: number[];
  /** 1-sigma, propagated from the supplied per-point sigmas. */
  uncertainties: number[];
  /**
   * 1-sigma, rescaled by the observed scatter: sqrt(chi2_red) times
   * `uncertainties`. With unit weights this reduces exactly to
   * sqrt(SSR/(n-p)) * sqrt(diag((AᵀA)⁻¹)). NaN when `degreesOfFreedom` is 0 —
   * there is no scatter to estimate from.
   */
  scatterUncertainties: number[];
  /** Weighted coefficient of determination, always in [0, 1]. */
  rSquared: number;
  /** Sum of w·residual². Equals the plain SSR when `weighted` is false. */
  chiSquare: number;
  /** chiSquare / degreesOfFreedom; NaN when there are no degrees of freedom. */
  reducedChiSquare: number;
  degreesOfFreedom: number;
  /** y[i] - predictPolynomial(coefficients, x[i]), in input order. */
  residuals: number[];
  /**
   * False when sigmas were absent or invalid and unit weights were used. In
   * that case `uncertainties` assume sigma = 1 and carry no physical scale —
   * callers should show `scatterUncertainties` instead.
   */
  weighted: boolean;
  /** Points that survived the finite-value filter and entered the fit. */
  pointCount: number;
}

export type FitFailure = 'too-few-points' | 'degenerate';

export type FitResult =
  | { ok: true; fit: PolynomialFit }
  | { ok: false; reason: FitFailure };

/** Evaluate an ascending-power coefficient list at `x` (Horner's method). */
export const predictPolynomial = (coefficients: readonly number[], x: number): number => {
  let value = 0;
  for (let k = coefficients.length - 1; k >= 0; k -= 1) {
    value = value * x + coefficients[k];
  }
  return value;
};

interface SolvedSystem {
  solution: number[];
  /** The inverse of the normal matrix — the covariance up to a scale factor. */
  inverse: number[][];
}

/**
 * Gauss-Jordan elimination with partial pivoting on the (2x2 or 3x3) normal
 * matrix, producing the solution and the inverse in one pass. Returns null when
 * a pivot collapses relative to the matrix scale, which is how near-degenerate
 * data (all x nearly equal) is detected.
 */
const solveSymmetric = (
  size: number,
  matrix: number[][],
  rhs: number[],
): SolvedSystem | null => {
  let scale = 0;
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      if (!Number.isFinite(matrix[i][j])) return null;
      scale = Math.max(scale, Math.abs(matrix[i][j]));
    }
  }
  if (!(scale > 0)) return null;
  const tolerance = 1e-12 * scale;

  // Each row is [ matrix | identity | rhs ].
  const width = size * 2 + 1;
  const rows: number[][] = [];
  for (let i = 0; i < size; i += 1) {
    const row = new Array<number>(width).fill(0);
    for (let j = 0; j < size; j += 1) row[j] = matrix[i][j];
    row[size + i] = 1;
    row[width - 1] = rhs[i];
    rows.push(row);
  }

  for (let col = 0; col < size; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < size; r += 1) {
      if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) pivot = r;
    }
    if (Math.abs(rows[pivot][col]) <= tolerance) return null;
    if (pivot !== col) {
      const swap = rows[pivot];
      rows[pivot] = rows[col];
      rows[col] = swap;
    }
    const pivotValue = rows[col][col];
    for (let j = col; j < width; j += 1) rows[col][j] /= pivotValue;
    for (let r = 0; r < size; r += 1) {
      if (r === col) continue;
      const factor = rows[r][col];
      if (factor === 0) continue;
      for (let j = col; j < width; j += 1) rows[r][j] -= factor * rows[col][j];
    }
  }

  return {
    solution: rows.map((row) => row[width - 1]),
    inverse: rows.map((row) => row.slice(size, size * 2)),
  };
};

const binomial = (n: number, k: number): number => {
  let result = 1;
  for (let i = 0; i < k; i += 1) result = (result * (n - i)) / (i + 1);
  return result;
};

/**
 * The linear map from centered coefficients to raw-x coefficients. Substituting
 * u = x - m into the sum of c'_j u^j and collecting powers of x gives
 * `T[k][j] = C(j,k)·(-m)^(j-k)`; for degree 2 that is the familiar
 * [[1, -m, m²], [0, 1, -2m], [0, 0, 1]].
 *
 * The same T transforms the covariance: Cov_x = T · Cov_u · Tᵀ.
 */
const centeringTransform = (order: number, center: number): number[][] => {
  const transform: number[][] = [];
  for (let k = 0; k < order; k += 1) {
    const row = new Array<number>(order).fill(0);
    for (let j = k; j < order; j += 1) {
      row[j] = binomial(j, k) * (-center) ** (j - k);
    }
    transform.push(row);
  }
  return transform;
};

/** T · C · Tᵀ, for the small square matrices this module deals in. */
const congruence = (transform: number[][], covariance: number[][]): number[][] => {
  const order = transform.length;
  const partial: number[][] = [];
  for (let k = 0; k < order; k += 1) {
    const row = new Array<number>(order).fill(0);
    for (let j = 0; j < order; j += 1) {
      let sum = 0;
      for (let a = 0; a < order; a += 1) sum += transform[k][a] * covariance[a][j];
      row[j] = sum;
    }
    partial.push(row);
  }
  const result: number[][] = [];
  for (let k = 0; k < order; k += 1) {
    const row = new Array<number>(order).fill(0);
    for (let l = 0; l < order; l += 1) {
      let sum = 0;
      for (let j = 0; j < order; j += 1) sum += partial[k][j] * transform[l][j];
      row[l] = sum;
    }
    result.push(row);
  }
  return result;
};

/**
 * Fit `y = c0 + c1·x (+ c2·x²)` by weighted least squares.
 *
 * Failure modes, checked in this order:
 *   - fewer usable points than parameters -> 'too-few-points'
 *   - fewer *distinct* x than parameters  -> 'degenerate' (a vertical data set
 *     has no unique fit)
 *   - the normal matrix cannot be inverted -> 'degenerate' (near-duplicate x)
 *
 * An exactly-determined fit (n === degree + 1) succeeds. Its residuals are all
 * zero, so the scatter-based uncertainties and the reduced chi-square are NaN
 * rather than a misleading 0 — with no degrees of freedom there is genuinely
 * nothing to estimate them from.
 */
export const fitPolynomial = (
  points: readonly FitPoint[],
  degree: PolynomialDegree,
): FitResult => {
  const usable = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const order = degree + 1;
  const count = usable.length;
  if (count < order) return { ok: false, reason: 'too-few-points' };
  if (new Set(usable.map((point) => point.x)).size < order) {
    return { ok: false, reason: 'degenerate' };
  }

  const weighted = usable.every(
    (point) => typeof point.sigma === 'number' && Number.isFinite(point.sigma) && point.sigma > 0,
  );
  const weights = usable.map((point) => (weighted ? 1 / (point.sigma as number) ** 2 : 1));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(weightSum > 0) || !Number.isFinite(weightSum)) return { ok: false, reason: 'degenerate' };

  // Center on the weighted mean of x — see the note at the top of the file.
  const center = usable.reduce((sum, point, i) => sum + weights[i] * point.x, 0) / weightSum;
  const shifted = usable.map((point) => point.x - center);

  // Moments (sum of w·u^k) up to the highest power the normal matrix needs,
  // accumulated alongside the projections (sum of w·u^k·y) in one pass.
  const moments = new Array<number>(2 * degree + 1).fill(0);
  const projections = new Array<number>(order).fill(0);
  for (let i = 0; i < count; i += 1) {
    let power = 1;
    for (let k = 0; k < moments.length; k += 1) {
      moments[k] += weights[i] * power;
      if (k < order) projections[k] += weights[i] * power * usable[i].y;
      power *= shifted[i];
    }
  }

  const normal: number[][] = [];
  for (let j = 0; j < order; j += 1) {
    const row = new Array<number>(order).fill(0);
    for (let k = 0; k < order; k += 1) row[k] = moments[j + k];
    normal.push(row);
  }

  const solved = solveSymmetric(order, normal, projections);
  if (!solved) return { ok: false, reason: 'degenerate' };

  const transform = centeringTransform(order, center);
  const coefficients = transform.map((row) =>
    row.reduce((sum, factor, j) => sum + factor * solved.solution[j], 0),
  );
  const covariance = congruence(transform, solved.inverse);
  const uncertainties = covariance.map((row, k) => Math.sqrt(Math.max(0, row[k])));

  // Residuals are evaluated from the returned coefficients so the residual
  // strip and the drawn fit curve can never disagree with each other.
  const residuals = usable.map((point) => point.y - predictPolynomial(coefficients, point.x));

  let chiSquare = 0;
  for (let i = 0; i < count; i += 1) chiSquare += weights[i] * residuals[i] ** 2;

  const degreesOfFreedom = count - order;
  const reducedChiSquare = degreesOfFreedom > 0 ? chiSquare / degreesOfFreedom : Number.NaN;
  const scatterFactor = Math.sqrt(reducedChiSquare);
  const scatterUncertainties = uncertainties.map((value) => value * scatterFactor);

  const meanY = usable.reduce((sum, point, i) => sum + weights[i] * point.y, 0) / weightSum;
  let totalSquares = 0;
  for (let i = 0; i < count; i += 1) totalSquares += weights[i] * (usable[i].y - meanY) ** 2;
  // All y identical: the model explains everything there is to explain (1) if it
  // lands on them, nothing (0) if it does not. Never NaN.
  const rSquared = totalSquares > 0 ? 1 - chiSquare / totalSquares : chiSquare === 0 ? 1 : 0;

  return {
    ok: true,
    fit: {
      degree,
      coefficients,
      uncertainties,
      scatterUncertainties,
      rSquared,
      chiSquare,
      reducedChiSquare,
      degreesOfFreedom,
      residuals,
      weighted,
      pointCount: count,
    },
  };
};
