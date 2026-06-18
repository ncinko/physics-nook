/**
 * Tiny seeded PRNG (mulberry32) for the hidden Caerbannog defense game. Keeping
 * randomness seedable makes wave spawns and upgrade offers deterministic, so the
 * game model can be unit tested in `tests/caerbannog`.
 */

export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, maxInclusive]. */
  int(min: number, maxInclusive: number): number;
}

export const createRng = (seed: number): Rng => {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, maxInclusive) => min + Math.floor(next() * (maxInclusive - min + 1)),
  };
};
