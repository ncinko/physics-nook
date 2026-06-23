/**
 * Pure model for the Measurement & Uncertainty lesson. An experimental result is
 * never a single number: it is a best estimate paired with a doubt, written
 * `value ± uncertainty`. This module bundles the algebra-level toolkit a student
 * needs to (1) carry that doubt through a calculation and (2) decide whether a
 * theoretical prediction is consistent with the measurement.
 *
 * Everything here is DOM-free and deterministic so it can be unit tested in
 * `tests/measurement`. Two intentionally redundant propagation paths are
 * provided: `combineHighLow` (recompute with the extreme values — fully general,
 * no formulas) and `combine` (the two algebra shortcuts). They agree exactly for
 * + − ×, and to first order for ÷; the tests pin that relationship down.
 */

/** A measured quantity: a best estimate and a non-negative absolute uncertainty. */
export interface Measurement {
  value: number;
  /** Absolute uncertainty, in the same units as `value`. Always >= 0. */
  uncertainty: number;
}

export type UncertaintyOp = 'add' | 'subtract' | 'multiply' | 'divide';

/** Apply a binary operation to two plain numbers. */
const apply = (op: UncertaintyOp, x: number, y: number): number => {
  switch (op) {
    case 'add':
      return x + y;
    case 'subtract':
      return x - y;
    case 'multiply':
      return x * y;
    case 'divide':
      return x / y;
  }
};

/**
 * Relative (fractional) uncertainty, `u / |value|`. Returns 0 for a perfectly
 * known zero, and Infinity for an uncertain quantity whose best estimate is 0
 * (its relative uncertainty is undefined, which the caller should guard).
 */
export const relativeUncertainty = (m: Measurement): number => {
  if (m.value === 0) return m.uncertainty === 0 ? 0 : Infinity;
  return m.uncertainty / Math.abs(m.value);
};

/**
 * Propagate uncertainty with the two algebra-level shortcut rules:
 *   - add / subtract  → absolute uncertainties add.
 *   - multiply / divide → relative uncertainties add.
 * The result's uncertainty is reported as an absolute value.
 */
export const combine = (a: Measurement, b: Measurement, op: UncertaintyOp): Measurement => {
  const value = apply(op, a.value, b.value);
  if (op === 'add' || op === 'subtract') {
    return { value, uncertainty: a.uncertainty + b.uncertainty };
  }
  const relative = relativeUncertainty(a) + relativeUncertainty(b);
  return { value, uncertainty: Math.abs(value) * relative };
};

export interface HighLowResult extends Measurement {
  /** Smallest plausible result, from the extreme corner that minimizes the op. */
  low: number;
  /** Largest plausible result, from the extreme corner that maximizes the op. */
  high: number;
}

/**
 * Propagate uncertainty with the "high–low" (min–max) bracket method: recompute
 * the result at every combination of each input's extreme values, then take the
 * smallest and largest. The best estimate is the op on the best estimates, and
 * the uncertainty is half the bracket width. No formulas — pure substitution —
 * which is why it is the intuition-building path in the lesson.
 *
 * Valid while the operation is monotonic across each input's range (true for the
 * four basic ops as long as a `divide` denominator does not straddle zero).
 */
export const combineHighLow = (
  a: Measurement,
  b: Measurement,
  op: UncertaintyOp,
): HighLowResult => {
  const corners = [
    apply(op, a.value - a.uncertainty, b.value - b.uncertainty),
    apply(op, a.value - a.uncertainty, b.value + b.uncertainty),
    apply(op, a.value + a.uncertainty, b.value - b.uncertainty),
    apply(op, a.value + a.uncertainty, b.value + b.uncertainty),
  ];
  const low = Math.min(...corners);
  const high = Math.max(...corners);
  return {
    value: apply(op, a.value, b.value),
    uncertainty: (high - low) / 2,
    low,
    high,
  };
};

/** Inclusive measured range `[value - u, value + u]`. */
export const range = (m: Measurement): [number, number] => [
  m.value - m.uncertainty,
  m.value + m.uncertainty,
];

/**
 * Whether a theoretical / accepted value is consistent with the measurement,
 * i.e. it lands inside `value ± uncertainty`. This is the error-bar overlap test
 * at the heart of comparing experiment to theory.
 */
export const agreesWithin = (m: Measurement, theory: number): boolean => {
  const [low, high] = range(m);
  return theory >= low && theory <= high;
};

/**
 * How far the theoretical value sits from the measurement, expressed in units of
 * the uncertainty (`|value - theory| / u`). Under ~1 means "well inside" the bar;
 * much larger than ~2 signals a mistake or an unaccounted systematic error.
 * Returns Infinity when the uncertainty is 0 and the values differ.
 */
export const discrepancy = (m: Measurement, theory: number): number => {
  const gap = Math.abs(m.value - theory);
  if (m.uncertainty === 0) return gap === 0 ? 0 : Infinity;
  return gap / m.uncertainty;
};

/**
 * Round an uncertainty to a single significant figure — the conventional way to
 * report a doubt (you rarely know the doubt itself to better than one digit).
 */
export const roundUncertaintyToOneSigFig = (u: number): number => {
  if (u <= 0) return 0;
  const magnitude = Math.pow(10, Math.floor(Math.log10(u)));
  return Math.round(u / magnitude) * magnitude;
};

/**
 * Number of decimal places implied by a one-sig-fig uncertainty. The reported
 * value is then rounded to this same place so the two line up
 * (e.g. u = 0.083 → 2 places → report `3.10 ± 0.08`).
 */
export const uncertaintyDecimals = (u: number): number => {
  const rounded = roundUncertaintyToOneSigFig(u);
  if (rounded <= 0) return 0;
  // The 1e-9 nudge keeps floating-point results like log10(0.1) = -1.0000000002
  // from flooring to the wrong order of magnitude.
  return Math.max(0, -Math.floor(Math.log10(rounded) + 1e-9));
};

/**
 * Format a measurement as `value ± u` with the uncertainty rounded to one sig
 * fig and the value rounded to the matching decimal place.
 */
export const formatMeasurement = (m: Measurement): string => {
  const decimals = uncertaintyDecimals(m.uncertainty);
  const roundedU = roundUncertaintyToOneSigFig(m.uncertainty);
  return `${m.value.toFixed(decimals)} ± ${roundedU.toFixed(decimals)}`;
};
