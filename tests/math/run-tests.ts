import assert from 'node:assert/strict';
import {
  add,
  cleanScalar,
  directionDegrees,
  formatScalar,
  formatVector,
  magnitude,
  scale,
  subtract,
  toDegrees,
  toRadians,
  vectorFromMagnitudeAndDirection,
} from '../../src/lib/math/vectors.ts';
import {
  isReached,
  moveIsBlocked,
  pathPositions,
  pointInRect,
  segmentIntersectsRect,
  totalDisplacement,
  voyageLevels,
  type Rect,
} from '../../src/lib/math/vectorVoyage.ts';
import {
  hopLabel,
  hopLandings,
  hopPosition,
  hopStaysOnLine,
  totalHop,
} from '../../src/lib/math/bunnyHops.ts';
import {
  FIELD_BOUNDS,
  UNIT_STEPS,
  carrotReached,
  cellCount,
  clampToField,
  randomCarrot,
  stepBunny,
} from '../../src/lib/math/bunnyField.ts';
import {
  fitPolynomial,
  predictPolynomial,
  type FitPoint,
} from '../../src/lib/math/leastSquares.ts';

const near = (actual: number, expected: number, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be near ${expected}`);
};

assert.deepEqual(add({ x: 3, y: -2 }, { x: -5, y: 7 }), { x: -2, y: 5 });
assert.deepEqual(subtract({ x: 3, y: -2 }, { x: -5, y: 7 }), { x: 8, y: -9 });
assert.deepEqual(scale({ x: 3, y: -2 }, -2), { x: -6, y: 4 });

near(magnitude({ x: 3, y: 4 }), 5);
near(toDegrees(Math.PI / 2), 90);
near(toRadians(180), Math.PI);

near(directionDegrees({ x: 1, y: 0 }), 0);
near(directionDegrees({ x: 0, y: 1 }), 90);
near(directionDegrees({ x: -1, y: 0 }), 180);
near(directionDegrees({ x: 0, y: -1 }), 270);
near(directionDegrees({ x: 0, y: 0 }), 0);

const polarVector = vectorFromMagnitudeAndDirection(5, 53.13010235415598);
near(polarVector.x, 3);
near(polarVector.y, 4);

assert.equal(cleanScalar(-0), 0);
assert.equal(cleanScalar(1e-12), 0);
assert.equal(formatScalar(-0.00000000001, 2), '0.00');
assert.equal(formatVector({ x: 1.25, y: -0.00000000001 }, 2), '<1.25, 0.00>');

console.log('Math vector helper tests passed.');

// --- Vector Voyage geometry ---

const sampleHedge: Rect = { minX: -1, maxX: 1, minY: -1, maxY: 1 };

// A segment passing straight through the box crosses it.
assert.equal(segmentIntersectsRect({ x: -3, y: 0 }, { x: 3, y: 0 }, sampleHedge), true);
// A segment that stays clear does not.
assert.equal(segmentIntersectsRect({ x: -3, y: 3 }, { x: 3, y: 3 }, sampleHedge), false);
// Grazing exactly along an edge is allowed (not counted as a crossing).
assert.equal(segmentIntersectsRect({ x: -3, y: 1 }, { x: 3, y: 1 }, sampleHedge), false);
// A segment ending inside the box still counts as a crossing.
assert.equal(segmentIntersectsRect({ x: -3, y: 0 }, { x: 0, y: 0 }, sampleHedge), true);

assert.equal(pointInRect({ x: 0, y: 0 }, sampleHedge), true);
assert.equal(pointInRect({ x: 2, y: 0 }, sampleHedge), false);

assert.deepEqual(totalDisplacement([{ x: 4, y: 3 }, { x: 4, y: -3 }]), { x: 8, y: 0 });
assert.deepEqual(
  pathPositions({ x: -4, y: 0 }, [{ x: 4, y: 3 }, { x: 4, y: -3 }]),
  [{ x: -4, y: 0 }, { x: 0, y: 3 }, { x: 4, y: 0 }],
);

assert.equal(isReached({ x: 4.1, y: -0.1 }, { x: 4, y: 0 }), true);
assert.equal(isReached({ x: 5, y: 0 }, { x: 4, y: 0 }), false);

// Every shipped level must be solvable: its bundled route clears all hedges,
// keeps start and target out of the hedges, and lands on the target.
for (const level of voyageLevels) {
  assert.ok(level.solutionMoves.length > 0, `${level.id} has a solution route`);

  for (const hedge of level.hedges) {
    assert.equal(pointInRect(level.start, hedge), false, `${level.id} start is clear`);
    assert.equal(pointInRect(level.target, hedge), false, `${level.id} target is clear`);
  }

  const positions = pathPositions(level.start, level.solutionMoves);
  for (let i = 0; i < level.solutionMoves.length; i += 1) {
    assert.equal(
      moveIsBlocked(positions[i], positions[i + 1], level.hedges),
      false,
      `${level.id} route leg ${i + 1} is unobstructed`,
    );
  }

  const finalPosition = positions[positions.length - 1];
  assert.equal(isReached(finalPosition, level.target), true, `${level.id} route reaches the flag`);
  assert.ok(
    level.solutionMoves.length >= level.par,
    `${level.id} par is not below its solution length`,
  );
}

console.log('Vector Voyage geometry tests passed.');

// --- Number-line bunny hops (1D vectors) ---

assert.deepEqual(hopLandings(0, [3, -2, 4]), [0, 3, 1, 5]);
assert.equal(totalHop([3, -2, 4]), 5);
assert.equal(hopPosition(-1, [2, 2]), 3);
assert.equal(hopLabel(3), '+3');
assert.equal(hopLabel(-2), '-2');
assert.equal(hopLabel(0), '+0');
assert.equal(hopStaysOnLine(6, 3, -8, 8), false);
assert.equal(hopStaysOnLine(6, 2, -8, 8), true);
assert.equal(hopStaysOnLine(-7, -2, -8, 8), false);

console.log('Bunny hop tests passed.');

// --- Keyboard bunny field (2D unit-vector hops) ---

// A unit step inside the field just adds the unit vector.
assert.deepEqual(stepBunny({ x: 0, y: 0 }, UNIT_STEPS.right), { x: 1, y: 0 });
assert.deepEqual(stepBunny({ x: 0, y: 0 }, UNIT_STEPS.up), { x: 0, y: 1 });
assert.deepEqual(stepBunny({ x: 0, y: 0 }, UNIT_STEPS.left), { x: -1, y: 0 });
assert.deepEqual(stepBunny({ x: 0, y: 0 }, UNIT_STEPS.down), { x: 0, y: -1 });

// Stepping off an edge clamps back to the boundary (no move).
assert.deepEqual(stepBunny({ x: FIELD_BOUNDS.maxX, y: 0 }, UNIT_STEPS.right), {
  x: FIELD_BOUNDS.maxX,
  y: 0,
});
assert.deepEqual(stepBunny({ x: 0, y: FIELD_BOUNDS.minY }, UNIT_STEPS.down), {
  x: 0,
  y: FIELD_BOUNDS.minY,
});
assert.deepEqual(clampToField({ x: 99, y: -99 }), {
  x: FIELD_BOUNDS.maxX,
  y: FIELD_BOUNDS.minY,
});

assert.equal(carrotReached({ x: 2, y: -1 }, { x: 2, y: -1 }), true);
assert.equal(carrotReached({ x: 2, y: -1 }, { x: 2, y: 0 }), false);

// Default field is 11 x 7 cells.
assert.equal(cellCount(), 77);

// randomCarrot maps the smallest draw to the bottom-left cell and never lands on
// the avoided cell, even when the raw draw points straight at it.
assert.deepEqual(randomCarrot({ x: 0, y: 0 }, FIELD_BOUNDS, () => 0), {
  x: FIELD_BOUNDS.minX,
  y: FIELD_BOUNDS.minY,
});
const avoidCell = { x: 0, y: 0 };
const width = FIELD_BOUNDS.maxX - FIELD_BOUNDS.minX + 1;
const avoidIndex = (avoidCell.y - FIELD_BOUNDS.minY) * width + (avoidCell.x - FIELD_BOUNDS.minX);
// A draw fraction that rounds to exactly the avoided index must be skipped.
const collidingDraw = (avoidIndex + 0.5) / (cellCount() - 1);
assert.equal(
  carrotReached(randomCarrot(avoidCell, FIELD_BOUNDS, () => collidingDraw), avoidCell),
  false,
);
// Sampling the full [0, 1) range always yields an in-bounds cell that is not the
// avoided one.
for (let i = 0; i < cellCount() - 1; i += 1) {
  const draw = i / (cellCount() - 1);
  const carrot = randomCarrot(avoidCell, FIELD_BOUNDS, () => draw);
  assert.ok(
    carrot.x >= FIELD_BOUNDS.minX &&
      carrot.x <= FIELD_BOUNDS.maxX &&
      carrot.y >= FIELD_BOUNDS.minY &&
      carrot.y <= FIELD_BOUNDS.maxY,
    `random carrot ${JSON.stringify(carrot)} is in bounds`,
  );
  assert.equal(carrotReached(carrot, avoidCell), false, 'random carrot avoids the bunny');
}

console.log('Bunny field tests passed.');

// --- Weighted polynomial least squares -------------------------------------

const linePoints = (
  count: number,
  first: number,
  step: number,
  intercept: number,
  slope: number,
  sigma?: number,
): FitPoint[] =>
  Array.from({ length: count }, (_, i) => {
    const x = first + i * step;
    return { x, y: intercept + slope * x, sigma };
  });

const expectFit = (result: ReturnType<typeof fitPolynomial>) => {
  assert.equal(result.ok, true, 'expected the fit to succeed');
  if (!result.ok) throw new Error('unreachable');
  return result.fit;
};

// An exact line is recovered exactly, explains all the variance, and leaves no
// residual behind.
const exactLine = expectFit(fitPolynomial(linePoints(6, 0, 1, 3, -2), 1));
near(exactLine.coefficients[0], 3);
near(exactLine.coefficients[1], -2);
near(exactLine.rSquared, 1, 1e-12);
exactLine.residuals.forEach((residual) => near(residual, 0, 1e-12));
assert.equal(exactLine.degreesOfFreedom, 4);
assert.equal(exactLine.weighted, false);

// The same line moved out to x ~ 1000. Recovering the intercept means undoing a
// cancellation of about 2000, which is exactly what fitting in centered
// coordinates protects. An uncentered normal-equation solve loses this.
const farLine = expectFit(fitPolynomial(linePoints(6, 1000, 1, 3, -2), 1));
near(farLine.coefficients[0], 3, 1e-9);
near(farLine.coefficients[1], -2, 1e-9);

// An exact parabola, near the origin and then pushed out to x ~ 100.
const quadraticAt = (first: number, sigma?: number): FitPoint[] =>
  Array.from({ length: 6 }, (_, i) => {
    const x = first + i;
    return { x, y: 1 + 2 * x + 3 * x * x, sigma };
  });
const exactQuadratic = expectFit(fitPolynomial(quadraticAt(0), 2));
near(exactQuadratic.coefficients[0], 1);
near(exactQuadratic.coefficients[1], 2);
near(exactQuadratic.coefficients[2], 3);
const farQuadratic = expectFit(fitPolynomial(quadraticAt(100), 2));
near(farQuadratic.coefficients[0], 1, 1e-6);
near(farQuadratic.coefficients[1], 2, 1e-6);
near(farQuadratic.coefficients[2], 3, 1e-9);

// Doubling every error bar doubles every parameter uncertainty, and leaves the
// best-fit coefficients untouched.
const tightFit = expectFit(fitPolynomial(linePoints(8, 0, 0.5, 1, 4, 0.02), 1));
const looseFit = expectFit(fitPolynomial(linePoints(8, 0, 0.5, 1, 4, 0.04), 1));
tightFit.uncertainties.forEach((value, k) => {
  near(looseFit.uncertainties[k] / value, 2, 1e-12);
});
near(looseFit.coefficients[1], tightFit.coefficients[1], 1e-12);
assert.equal(tightFit.weighted, true);

// Closed form for the slope uncertainty of an evenly spaced line fit:
// sigma * sqrt(12 / (h^2 * n * (n^2 - 1))).
{
  const n = 7;
  const h = 0.5;
  const sigma = 0.02;
  const fit = expectFit(fitPolynomial(linePoints(n, 0, h, 1, 4, sigma), 1));
  near(fit.uncertainties[1], sigma * Math.sqrt(12 / (h * h * n * (n * n - 1))), 1e-9);
}

// Closed form for the intercept uncertainty, sigma * sqrt(1/n + xbar^2 / Sxx),
// measured far from the origin. This is the assertion that fails if the
// covariance is not carried back through the centering transform: it would
// otherwise report sqrt(1/n) = 0.316 instead of ~11.5.
{
  const n = 10;
  const sigma = 1;
  const fit = expectFit(fitPolynomial(linePoints(n, 100, 1, 0, 2, sigma), 1));
  const mean = 104.5;
  const sumSquares = (n * (n * n - 1)) / 12;
  near(fit.uncertainties[0], sigma * Math.sqrt(1 / n + (mean * mean) / sumSquares), 1e-9);
  assert.ok(fit.uncertainties[0] > 10, 'intercept far from the data is poorly constrained');
}

// The scatter-based uncertainties describe the data's own wobble, so they do
// not move when the claimed error bars are rescaled.
{
  const wobble = [0.03, -0.05, 0.02, 0.04, -0.06, 0.01, -0.02, 0.05];
  const scattered = (sigma: number): FitPoint[] =>
    wobble.map((offset, i) => ({ x: i, y: 1 + 4 * i + offset, sigma }));
  const claimedTight = expectFit(fitPolynomial(scattered(0.01), 1));
  const claimedLoose = expectFit(fitPolynomial(scattered(1), 1));
  claimedTight.scatterUncertainties.forEach((value, k) => {
    near(claimedLoose.scatterUncertainties[k], value, 1e-12);
  });
  // The claimed bars were far too tight, so chi-square per degree of freedom is
  // large — the honesty check works.
  assert.ok(claimedTight.reducedChiSquare > 1, 'over-tight error bars inflate chi-square');
  assert.ok(claimedLoose.reducedChiSquare < 1, 'over-loose error bars deflate chi-square');
  assert.ok(claimedTight.rSquared > 0 && claimedTight.rSquared <= 1);
}

// An exactly determined fit is still a fit. With no degrees of freedom there is
// nothing to estimate the scatter from, so those figures are NaN rather than a
// misleading zero.
{
  const fit = expectFit(
    fitPolynomial(
      [
        { x: 0, y: 1, sigma: 0.1 },
        { x: 1, y: 6, sigma: 0.1 },
        { x: 2, y: 17, sigma: 0.1 },
      ],
      2,
    ),
  );
  assert.equal(fit.degreesOfFreedom, 0);
  assert.ok(Number.isNaN(fit.reducedChiSquare));
  assert.ok(fit.scatterUncertainties.every((value) => Number.isNaN(value)));
  assert.ok(fit.uncertainties.every((value) => Number.isFinite(value)));
}

// Degenerate and under-determined inputs are reported, never guessed at.
assert.deepEqual(
  fitPolynomial(
    [
      { x: 5, y: 1 },
      { x: 5, y: 2 },
      { x: 5, y: 3 },
    ],
    1,
  ),
  { ok: false, reason: 'degenerate' },
);
assert.deepEqual(
  fitPolynomial(
    [
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 3 },
      { x: 1, y: 4 },
    ],
    2,
  ),
  { ok: false, reason: 'degenerate' },
);
assert.deepEqual(fitPolynomial([{ x: 0, y: 1 }], 1), { ok: false, reason: 'too-few-points' });

// Weights actually bite: a wild outlier with a huge error bar stops dragging
// the line around.
{
  const raw: FitPoint[] = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 2 },
    { x: 2, y: 10 },
  ];
  const unweighted = expectFit(fitPolynomial(raw, 1));
  const sigmas = [1, 1, 1, 100];
  const weighted = expectFit(fitPolynomial(raw.map((p, i) => ({ ...p, sigma: sigmas[i] })), 1));
  assert.ok(unweighted.coefficients[1] > 3, 'the outlier drags an unweighted line upward');
  near(weighted.coefficients[1], 1, 0.01);
  assert.ok(weighted.coefficients[1] < unweighted.coefficients[1]);
}

// A flat data set has no variance to explain; the fit lands on it, so R-squared
// is 1 rather than NaN.
{
  const flat = expectFit(
    fitPolynomial(
      [
        { x: 0, y: 7 },
        { x: 1, y: 7 },
        { x: 2, y: 7 },
      ],
      1,
    ),
  );
  near(flat.rSquared, 1, 1e-12);
  near(flat.coefficients[1], 0, 1e-12);
}

// Residuals are defined against the returned coefficients, so the residual
// strip can never drift away from the drawn fit curve.
{
  const noisy: FitPoint[] = [0, 1, 2, 3, 4, 5].map((x) => ({
    x,
    y: 2 + 3 * x - 0.5 * x * x + (x % 2 === 0 ? 0.1 : -0.1),
  }));
  const fit = expectFit(fitPolynomial(noisy, 2));
  noisy.forEach((point, i) => {
    assert.equal(fit.residuals[i], point.y - predictPolynomial(fit.coefficients, point.x));
  });
}

console.log('Least squares tests passed.');
