/**
 * Time-to-angle maths for the stopwatch dial, kept DOM-free so the fiddly parts
 * - the atan2 convention and the wrap at twelve o'clock - can be tested without
 * a browser.
 *
 * Angles are measured in radians clockwise from twelve o'clock, which is where
 * the run starts and ends.
 */

export const TAU = Math.PI * 2;

/** Where the hand points at a given time. */
export const timeToAngle = (value: number, max: number) => (value / max) * TAU;

/**
 * The time a pointer is indicating, from its offset relative to the dial centre
 * in screen coordinates (y growing downward).
 */
export const pointerToTime = (dx: number, dy: number, max: number) => {
  // atan2(dx, -dy) puts zero at twelve o'clock and grows clockwise.
  let angle = Math.atan2(dx, -dy);
  if (angle < 0) {
    angle += TAU;
  }
  return (angle / TAU) * max;
};

/**
 * Brings a time back into [0, max). The dial is a circle and the motion it
 * scrubs is a closed cycle, so stepping off either end wraps rather than clamps.
 */
export const wrapTime = (value: number, max: number) => ((value % max) + max) % max;
