import assert from 'node:assert/strict';
import {
  agreesWithin,
  combine,
  combineHighLow,
  discrepancy,
  formatMeasurement,
  range,
  relativeUncertainty,
  roundUncertaintyToOneSigFig,
  uncertaintyDecimals,
  type Measurement,
} from '../../src/lib/measurement/uncertainty.ts';
import {
  RC_DEFAULT_SEED,
  RC_DELAYED_SEED,
  RC_DELAYED_TRUTH,
  RC_SIGMA,
  RC_TRUTH,
  bestDelayedForTau,
  bestV0ForTau,
  chiSquareAt,
  delayedChiSquareAt,
  delayedResiduals,
  delayedVoltage,
  deltaChiInterval,
  deltaChiIntervalDelayed,
  fitDelayedRc,
  generateDelayedRcData,
  profileDelayedChiSquare,
  fitRc,
  fitRcLine,
  generateRcData,
  profileChiSquare,
  rcResiduals,
  runTrials,
} from '../../src/lib/measurement/rcFit.ts';
import {
  CHICKEN_ROUNDS,
  chickenCountForRound,
  chickenCountGameScore,
  scoreChickenEstimate,
  selectBestChickenCountScoresByUniqueName,
  validateChickenCountScoreSubmission,
} from '../../src/lib/measurement/chickenCount.ts';

const near = (actual: number, expected: number, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be near ${expected}`);
};

// --- Relative uncertainty ---

near(relativeUncertainty({ value: 4, uncertainty: 0.2 }), 0.05);
near(relativeUncertainty({ value: -4, uncertainty: 0.2 }), 0.05); // sign-agnostic
assert.equal(relativeUncertainty({ value: 0, uncertainty: 0 }), 0);
assert.equal(relativeUncertainty({ value: 0, uncertainty: 0.1 }), Infinity);

// --- Shortcut rules: absolute add for + and - ---

assert.deepEqual(combine({ value: 2, uncertainty: 0.1 }, { value: 3, uncertainty: 0.2 }, 'add'), {
  value: 5,
  uncertainty: 0.30000000000000004,
});
{
  const diff = combine({ value: 5, uncertainty: 0.1 }, { value: 3, uncertainty: 0.2 }, 'subtract');
  near(diff.value, 2);
  near(diff.uncertainty, 0.3);
}

// --- Shortcut rules: relative add for * and / ---

{
  const product = combine({ value: 2, uncertainty: 0.1 }, { value: 3, uncertainty: 0.2 }, 'multiply');
  near(product.value, 6);
  near(product.uncertainty, 0.7); // 6 * (0.05 + 0.0666...) = 0.7
}
{
  const quotient = combine({ value: 6, uncertainty: 0.3 }, { value: 2, uncertainty: 0.1 }, 'divide');
  near(quotient.value, 3);
  near(quotient.uncertainty, 0.3); // 3 * (0.05 + 0.05)
}

// --- High–low bracket method ---

// For +, -, and *, the bracket and the shortcut rule must agree exactly.
for (const op of ['add', 'subtract', 'multiply'] as const) {
  const a: Measurement = { value: 6, uncertainty: 0.3 };
  const b: Measurement = { value: 2.5, uncertainty: 0.2 };
  const bracket = combineHighLow(a, b, op);
  const rule = combine(a, b, op);
  near(bracket.value, rule.value);
  near(bracket.uncertainty, rule.uncertainty, 1e-9);
}

// The bracket always brackets the best estimate.
{
  const b = combineHighLow({ value: 2, uncertainty: 0.1 }, { value: 3, uncertainty: 0.2 }, 'multiply');
  assert.ok(b.low < b.value && b.value < b.high, 'best estimate sits inside the bracket');
  near(b.low, 1.9 * 2.8); // 5.32
  near(b.high, 2.1 * 3.2); // 6.72
}

// For division the bracket is slightly wider than the shortcut rule (the rule
// drops a second-order term), but they agree to first order.
{
  const a: Measurement = { value: 6, uncertainty: 0.3 };
  const b: Measurement = { value: 2, uncertainty: 0.1 };
  const bracket = combineHighLow(a, b, 'divide');
  const rule = combine(a, b, 'divide');
  assert.ok(bracket.uncertainty >= rule.uncertainty, 'divide bracket is at least as wide as the rule');
  assert.ok(
    (bracket.uncertainty - rule.uncertainty) / rule.uncertainty < 0.02,
    'divide bracket and rule agree to first order',
  );
}

console.log('Uncertainty propagation tests passed.');

// --- Comparing to theory ---

{
  const [low, high] = range({ value: 3.1, uncertainty: 0.08 });
  near(low, 3.02);
  near(high, 3.18);
}

const pi = Math.PI;
assert.equal(agreesWithin({ value: 3.1, uncertainty: 0.08 }, pi), true); // [3.02, 3.18] ∋ π
assert.equal(agreesWithin({ value: 3.13, uncertainty: 0.06 }, pi), true); // [3.07, 3.19] ∋ π
assert.equal(agreesWithin({ value: 3.22, uncertainty: 0.03 }, pi), false); // [3.19, 3.25] ∌ π
assert.equal(agreesWithin({ value: pi, uncertainty: 0 }, pi), true); // exact hit, no doubt

near(discrepancy({ value: 3.22, uncertainty: 0.03 }, pi), Math.abs(3.22 - pi) / 0.03);
assert.ok(discrepancy({ value: 3.22, uncertainty: 0.03 }, pi) > 2, 'biased coin is a >2σ discrepancy');
assert.ok(discrepancy({ value: 3.1, uncertainty: 0.08 }, pi) < 1, 'mug sits well within its bar');
assert.equal(discrepancy({ value: 3, uncertainty: 0 }, 3), 0);
assert.equal(discrepancy({ value: 3, uncertainty: 0 }, 3.5), Infinity);

console.log('Theory-comparison tests passed.');

// --- Reporting: one-sig-fig uncertainty + matched decimals ---

near(roundUncertaintyToOneSigFig(0.083), 0.08);
near(roundUncertaintyToOneSigFig(0.087), 0.09);
near(roundUncertaintyToOneSigFig(0.12), 0.1);
near(roundUncertaintyToOneSigFig(0.16), 0.2);
near(roundUncertaintyToOneSigFig(0.96), 1);
near(roundUncertaintyToOneSigFig(1.4), 1);
near(roundUncertaintyToOneSigFig(23), 20);
assert.equal(roundUncertaintyToOneSigFig(0), 0);

assert.equal(uncertaintyDecimals(0.083), 2);
assert.equal(uncertaintyDecimals(0.12), 1);
assert.equal(uncertaintyDecimals(0.5), 1);
assert.equal(uncertaintyDecimals(1.4), 0);
assert.equal(uncertaintyDecimals(23), 0);

assert.equal(formatMeasurement({ value: 3.097, uncertainty: 0.083 }), '3.10 ± 0.08');
assert.equal(formatMeasurement({ value: 3.14159, uncertainty: 0.12 }), '3.1 ± 0.1');
assert.equal(formatMeasurement({ value: 9.81, uncertainty: 0.23 }), '9.8 ± 0.2');

console.log('Reporting/format tests passed.');

// --- Chicken counting: three-round count ranges and speed-aware score ---

assert.deepEqual(CHICKEN_ROUNDS.map(({ min, max }) => [min, max]), [
  [20, 40],
  [50, 100],
  [100, 200],
]);

assert.equal(chickenCountForRound(0, () => 0), 20);
assert.equal(chickenCountForRound(0, () => 0.999999), 40);
assert.equal(chickenCountForRound(1, () => 0), 50);
assert.equal(chickenCountForRound(1, () => 0.999999), 100);
assert.equal(chickenCountForRound(2, () => 0), 100);
assert.equal(chickenCountForRound(2, () => 0.999999), 200);
assert.equal(chickenCountForRound(99, () => 1), 200);

{
  const perfectFast = scoreChickenEstimate({
    trueCount: 50,
    estimate: 50,
    uncertainty: 0,
    elapsedSeconds: 2,
  });
  assert.equal(perfectFast.error, 0);
  assert.equal(perfectFast.errorUncertaintyRatio, 0);
  assert.equal(perfectFast.accuracyScore, 160);
  assert.ok(perfectFast.speedBonus > 35, 'fast guesses earn a speed bonus');
}

{
  const accurateSlow = scoreChickenEstimate({
    trueCount: 50,
    estimate: 50,
    uncertainty: 5,
    elapsedSeconds: 20,
  });
  assert.equal(accurateSlow.speedBonus, 0);
  assert.ok(accurateSlow.score < scoreChickenEstimate({
    trueCount: 50,
    estimate: 50,
    uncertainty: 5,
    elapsedSeconds: 3,
  }).score, 'same estimate scores higher when locked sooner');
}

{
  const honestMiss = scoreChickenEstimate({
    trueCount: 50,
    estimate: 47,
    uncertainty: 5,
    elapsedSeconds: 8,
  });
  const overconfidentMiss = scoreChickenEstimate({
    trueCount: 50,
    estimate: 47,
    uncertainty: 1,
    elapsedSeconds: 8,
  });
  assert.equal(honestMiss.error, overconfidentMiss.error);
  assert.ok(overconfidentMiss.errorUncertaintyRatio > honestMiss.errorUncertaintyRatio);
  assert.ok(overconfidentMiss.score < honestMiss.score, 'large error:uncertainty ratio is penalized');
}

console.log('Chicken-count scoring tests passed.');

// --- Chicken counting: cloud leaderboard validation and ranking ---

{
  const rounds = [
    scoreChickenEstimate({ trueCount: 30, estimate: 31, uncertainty: 3, elapsedSeconds: 4 }),
    scoreChickenEstimate({ trueCount: 72, estimate: 70, uncertainty: 5, elapsedSeconds: 8 }),
    scoreChickenEstimate({ trueCount: 150, estimate: 148, uncertainty: 8, elapsedSeconds: 12 }),
  ].map(({ trueCount, estimate, uncertainty, elapsedSeconds, score }) => ({
    trueCount,
    estimate,
    uncertainty,
    elapsedSeconds,
    score,
  }));
  const validation = validateChickenCountScoreSubmission({
    name: '  Henrietta   ',
    score: chickenCountGameScore(rounds),
    rounds,
  });

  assert.equal(validation.ok, true);
  assert.equal(validation.name, 'Henrietta');
  assert.equal(validation.rounds.length, 3);
  assert.equal(validation.score, chickenCountGameScore(rounds));
  assert.ok(validation.totalError > 0);

  const mismatched = validateChickenCountScoreSubmission({
    name: 'Henrietta',
    score: validation.score + 1,
    rounds,
  });
  assert.equal(mismatched.ok, false, 'a final score that does not match the rounds is rejected');

  const outOfRange = validateChickenCountScoreSubmission({
    name: 'Henrietta',
    score: rounds[0].score + rounds[1].score + rounds[2].score,
    rounds: [{ ...rounds[0], trueCount: 999 }, rounds[1], rounds[2]],
  });
  assert.equal(outOfRange.ok, false, 'round true counts must match their configured ranges');
}

{
  const now = Date.now();
  const ranked = selectBestChickenCountScoresByUniqueName([
    {
      name: 'Ada',
      score: 350,
      totalError: 12,
      totalElapsedSeconds: 24,
      round1Count: 30,
      round2Count: 70,
      round3Count: 120,
      createdAt: now + 20,
    },
    {
      name: 'ada ',
      score: 360,
      totalError: 20,
      totalElapsedSeconds: 30,
      round1Count: 31,
      round2Count: 75,
      round3Count: 130,
      createdAt: now + 30,
    },
    {
      name: 'Berta',
      score: 360,
      totalError: 8,
      totalElapsedSeconds: 38,
      round1Count: 32,
      round2Count: 80,
      round3Count: 140,
      createdAt: now + 10,
    },
    {
      name: 'Clara',
      score: 360,
      totalError: 8,
      totalElapsedSeconds: 34,
      round1Count: 32,
      round2Count: 80,
      round3Count: 140,
      createdAt: now + 40,
    },
  ]);

  assert.equal(ranked[0].name, 'Clara', 'ties prefer lower total error, then faster total time');
  assert.equal(ranked[1].name, 'Berta');
  assert.equal(ranked[2].name, 'ada ', "a player's best score is kept");
}

console.log('Chicken-count leaderboard tests passed.');

// --- RC fitting page ---

// The generator is deterministic: same seed, same data; different seed, different data.
{
  const a = generateRcData(RC_DEFAULT_SEED);
  const b = generateRcData(RC_DEFAULT_SEED);
  const c = generateRcData(RC_DEFAULT_SEED + 1);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(a.length, 20);
  assert.ok(a.every((point) => point.sigma === RC_SIGMA));
}

// The exponential fit recovers the truth to within a few of its own uncertainties,
// and the straight line is hopelessly worse on the same data.
{
  const data = generateRcData(RC_DEFAULT_SEED);
  const result = fitRc(data);
  assert.ok(result.ok);
  if (result.ok) {
    const [v0, tau] = result.fit.parameters;
    const [dv0, dtau] = result.fit.uncertainties;
    near(v0, RC_TRUTH.v0, 4 * dv0);
    near(tau, RC_TRUTH.tau, 4 * dtau);
    assert.ok(result.fit.reducedChiSquare > 0.4 && result.fit.reducedChiSquare < 2.5);

    const line = fitRcLine(data);
    assert.ok(line !== null);
    if (line) assert.ok(line.reducedChiSquare > 20 * result.fit.reducedChiSquare);
  }
}

// Profiled χ²: V0 is re-optimized at each τ, the minimum sits at the best-fit τ,
// and the best V0 for the best-fit τ is the best-fit V0.
{
  const data = generateRcData(RC_DEFAULT_SEED);
  const result = fitRc(data);
  assert.ok(result.ok);
  if (result.ok) {
    const [v0, tau] = result.fit.parameters;
    near(bestV0ForTau(data, tau), v0, 1e-6);
    near(chiSquareAt(data, v0, tau), result.fit.chiSquare, 1e-9);

    const taus = Array.from({ length: 81 }, (_, i) => tau - 0.4 + i * 0.01);
    const profile = profileChiSquare(data, taus);
    const lowest = profile.reduce((best, entry) => (entry.chiSquare < best.chiSquare ? entry : best));
    near(lowest.tau, tau, 0.011);
    assert.ok(profile.every((entry) => entry.chiSquare >= result.fit.chiSquare - 1e-9));

    // The χ²_min + 1 interval brackets τ and has the width the covariance predicts.
    const interval = deltaChiInterval(data, tau);
    assert.ok(interval !== null);
    if (interval) {
      assert.ok(interval.low < tau && tau < interval.high);
      near((interval.high - interval.low) / 2, result.fit.uncertainties[1], 0.15 * result.fit.uncertainties[1]);
      near(interval.minimum, result.fit.chiSquare, 1e-9);
    }

    const residuals = rcResiduals(data, v0, tau);
    near(
      residuals.reduce((sum, value) => sum + value * value, 0) / RC_SIGMA ** 2,
      result.fit.chiSquare,
      1e-6,
    );
  }
}

// Repeating the experiment: the scatter of fitted τ matches the single-run uncertainty.
{
  const single = fitRc(generateRcData(RC_DEFAULT_SEED));
  assert.ok(single.ok);
  const trials = runTrials(RC_DEFAULT_SEED, 200);
  assert.equal(trials.taus.length, 200);
  near(trials.mean, RC_TRUTH.tau, 0.02);
  if (single.ok) near(trials.scatter, single.fit.uncertainties[1], 0.25 * single.fit.uncertainties[1]);
}

// --- Delayed start: a third parameter, t0 ---

// Three readings precede the switch closing, and they sit near zero.
{
  const data = generateDelayedRcData(RC_DELAYED_SEED);
  assert.deepEqual(data, generateDelayedRcData(RC_DELAYED_SEED));
  assert.equal(data.length, 21);
  const before = data.filter((point) => point.x < RC_DELAYED_TRUTH.t0);
  assert.equal(before.length, 3);
  assert.ok(before.every((point) => Math.abs(point.y) < 5 * RC_SIGMA));
  near(delayedVoltage(0.5, 5, 2.2, 1.25), 0, 0);
  near(delayedVoltage(1.25, 5, 2.2, 1.25), 0, 0);
  near(delayedVoltage(3.45, 5, 2.2, 1.25), 5 * (1 - Math.exp(-1)), 1e-12);
}

// The three-parameter fit recovers V0, tau and t0, and the profiled chi-square
// (V0 and t0 re-optimized at each tau) bottoms out at the full fit's minimum.
{
  const data = generateDelayedRcData(RC_DELAYED_SEED);
  const result = fitDelayedRc(data);
  assert.ok(result.ok);
  if (result.ok) {
    const [v0, tau, t0] = result.fit.parameters;
    const [dv0, dtau, dt0] = result.fit.uncertainties;
    near(v0, RC_DELAYED_TRUTH.v0, 4 * dv0);
    near(tau, RC_DELAYED_TRUTH.tau, 4 * dtau);
    near(t0, RC_DELAYED_TRUTH.t0, 4 * dt0);
    assert.equal(result.fit.degreesOfFreedom, 18);
    assert.ok(result.fit.reducedChiSquare > 0.4 && result.fit.reducedChiSquare < 2.5);

    const atBest = bestDelayedForTau(data, tau);
    near(atBest.chiSquare, result.fit.chiSquare, 1e-6);
    near(atBest.t0, t0, 1e-3);
    near(delayedChiSquareAt(data, v0, tau, t0), result.fit.chiSquare, 1e-9);

    const taus = Array.from({ length: 41 }, (_, i) => tau - 0.4 + i * 0.02);
    const profile = profileDelayedChiSquare(data, taus);
    assert.ok(profile.every((entry) => entry.chiSquare >= result.fit.chiSquare - 1e-6));

    // Freeing t0 widens tau's uncertainty relative to the two-parameter model, and
    // the chi-square+1 interval still matches the covariance matrix.
    const interval = deltaChiIntervalDelayed(data, tau);
    assert.ok(interval !== null);
    if (interval) {
      assert.ok(interval.low < tau && tau < interval.high);
      near((interval.high - interval.low) / 2, dtau, 0.15 * dtau);
    }
    const twoParameter = fitRc(generateRcData(RC_DEFAULT_SEED));
    assert.ok(twoParameter.ok);
    if (twoParameter.ok) assert.ok(dtau > 1.3 * twoParameter.fit.uncertainties[1]);

    const residuals = delayedResiduals(data, v0, tau, t0);
    near(
      residuals.reduce((sum, value) => sum + value * value, 0) / RC_SIGMA ** 2,
      result.fit.chiSquare,
      1e-6,
    );
  }
}

console.log('RC fitting tests passed.');

console.log('All measurement tests passed.');
