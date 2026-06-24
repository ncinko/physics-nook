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
  MAX_CHICKEN_COUNT,
  MIN_CHICKEN_COUNT,
  chickenCountForRandom,
  scoreChickenEstimate,
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

// --- Chicken counting: accuracy vs precision ---

assert.equal(chickenCountForRandom(() => 0), MIN_CHICKEN_COUNT);
assert.equal(chickenCountForRandom(() => 0.999999), MAX_CHICKEN_COUNT);
assert.equal(chickenCountForRandom(() => 1), MAX_CHICKEN_COUNT);

{
  const perfect = scoreChickenEstimate({ trueCount: 50, estimate: 50, uncertainty: 0 });
  assert.equal(perfect.coversTruth, true);
  assert.equal(perfect.error, 0);
  assert.equal(perfect.discrepancy, 0);
  assert.equal(perfect.score, 100);
}

{
  const honest = scoreChickenEstimate({ trueCount: 50, estimate: 47, uncertainty: 5 });
  assert.equal(honest.coversTruth, true);
  assert.ok(honest.score > 70, 'an honest close interval should score well');
}

{
  const vague = scoreChickenEstimate({ trueCount: 50, estimate: 50, uncertainty: 30 });
  assert.equal(vague.coversTruth, true);
  assert.equal(vague.accuracyPoints, 60);
  assert.equal(vague.precisionPoints, 0);
  assert.equal(vague.score, 60);
}

{
  const overconfident = scoreChickenEstimate({ trueCount: 50, estimate: 48, uncertainty: 1 });
  assert.equal(overconfident.coversTruth, false);
  assert.equal(overconfident.discrepancy, 2);
  assert.ok(overconfident.score < 60, 'a tight interval that misses truth loses precision credit');
}

console.log('Chicken-count scoring tests passed.');

console.log('All measurement tests passed.');
