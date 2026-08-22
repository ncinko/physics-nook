/**
 * Formats a signed quantity to a fixed number of decimals without ever
 * producing "-0.00".
 *
 * A value that rounds to zero from below - an acceleration passing through zero
 * at the top of a curve, a velocity at a turnaround - comes out of `toFixed` as
 * "-0.00", which reads as a display bug rather than as zero. Rounding first
 * collapses negative zero onto zero.
 */
export const fixed = (value: number, digits = 2) => {
  const rounded = Number(value.toFixed(digits));
  return (rounded === 0 ? 0 : rounded).toFixed(digits);
};
