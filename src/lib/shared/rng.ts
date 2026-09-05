/**
 * Tiny seeded PRNG (mulberry32).
 *
 * Seedable randomness is what lets a generated game be reproduced exactly from
 * a single integer: the browser builds a set of target graphs from a seed, and
 * the Cloudflare Function rebuilds the identical set from the same seed when it
 * scores the submission. Nothing about the generated content has to travel over
 * the wire or be trusted.
 *
 * Originally written for the Caerbannog game, which still re-exports this.
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
