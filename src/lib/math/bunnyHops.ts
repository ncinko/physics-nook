/**
 * Pure model for the 1D "number-line bunny" on-ramp interactive. A hop along a
 * number line is a one-dimensional vector: a size (how far) and a direction
 * (sign). Chaining hops is vector addition, which is the same bookkeeping the
 * 2D Vector Voyage uses. DOM-free and deterministic so it can be unit tested in
 * `tests/math`.
 */

/** Landing spot after each hop, starting from `start` (length = hops + 1). */
export const hopLandings = (start: number, hops: number[]): number[] => {
  const landings = [start];
  for (const hop of hops) {
    landings.push(landings[landings.length - 1] + hop);
  }
  return landings;
};

/** Net displacement of a run of hops (their sum). */
export const totalHop = (hops: number[]): number => hops.reduce((sum, hop) => sum + hop, 0);

/** Final position after all hops. */
export const hopPosition = (start: number, hops: number[]): number => start + totalHop(hops);

/** Signed hop label, e.g. 3 -> "+3", -2 -> "-2". */
export const hopLabel = (hop: number): string => (hop >= 0 ? `+${hop}` : `${hop}`);

/** Whether a hop keeps the bunny within [min, max]. */
export const hopStaysOnLine = (
  position: number,
  hop: number,
  min: number,
  max: number,
): boolean => {
  const landing = position + hop;
  return landing >= min && landing <= max;
};
