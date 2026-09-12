/**
 * Target and viewport rules for the Projectile Launcher, kept DOM-free so they
 * can be tested without a canvas.
 */

/** Horizontal extent of the unzoomed view, in metres. */
export const BASE_RANGE_M = 100;

/** A landing this close to the flag counts as a hit. */
export const HIT_RADIUS_M = 1;

/** Where a relocated flag may land, and how far it must move to feel new. */
export const TARGET_MIN_M = 20;
export const TARGET_MAX_M = 100;
export const TARGET_MIN_JUMP_M = 15;

/** Zoomed ranges snap up to a multiple of this, so the view steps out rather than creeping. */
export const ZOOM_STEP_M = 25;

/** Headroom beyond the farthest point, so a projectile never skims the edge. */
const ZOOM_MARGIN = 1.05;

export const isHit = (landingX: number, targetX: number) =>
  Math.abs(landingX - targetX) <= HIT_RADIUS_M;

/**
 * A new flag position between TARGET_MIN_M and TARGET_MAX_M, at least
 * TARGET_MIN_JUMP_M from the old one, so a hit always asks for a new shot.
 */
export const nextTargetX = (current: number, random: () => number = Math.random) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = TARGET_MIN_M + random() * (TARGET_MAX_M - TARGET_MIN_M);
    if (Math.abs(candidate - current) >= TARGET_MIN_JUMP_M) {
      return candidate;
    }
  }
  // A degenerate random source: fall back to the far end of the field.
  return current > (TARGET_MIN_M + TARGET_MAX_M) / 2 ? TARGET_MIN_M : TARGET_MAX_M;
};

/**
 * The horizontal range, in metres, that keeps the point (x, y) on screen. The
 * vertical extent follows from the plot's shape, so a tall shot widens the range
 * too. Never shrinks: the view stays zoomed out until the caller resets it.
 *
 * `plotAspect` is the plot's height divided by its width, both in pixels.
 */
export const zoomedRange = (currentRange: number, x: number, y: number, plotAspect: number) => {
  const needed = Math.max(x, y / Math.max(plotAspect, 1e-6)) * ZOOM_MARGIN;
  if (needed <= currentRange) {
    return currentRange;
  }
  return Math.ceil(needed / ZOOM_STEP_M) * ZOOM_STEP_M;
};

/** A 1-2-5 grid spacing giving roughly ten divisions across the range. */
export const gridStep = (range: number) => {
  const raw = range / 10;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
};
