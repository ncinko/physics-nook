/**
 * Launch-vector geometry for the inline Launch Decomposition demo, kept
 * DOM-free so the clamping can be tested without a browser.
 */

export const LAUNCH_ANGLE_MIN = 0;
export const LAUNCH_ANGLE_MAX = 90;
export const LAUNCH_SPEED_MIN = 0;
export const LAUNCH_SPEED_MAX = 60;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const launchComponents = (speed: number, angleDeg: number) => {
  const angle = (angleDeg * Math.PI) / 180;
  return { vx: speed * Math.cos(angle), vy: speed * Math.sin(angle) };
};

/**
 * The launch a pointer is indicating, from its offset to the origin in plot
 * pixels (dy positive upward) and the plot's pixels per m/s. Dragging below the
 * ground or behind the launcher pins the angle to the nearest edge rather than
 * flipping the vector.
 */
export const launchFromPointer = (dx: number, dy: number, pxPerUnit: number) => ({
  angleDeg: clamp((Math.atan2(dy, dx) * 180) / Math.PI, LAUNCH_ANGLE_MIN, LAUNCH_ANGLE_MAX),
  speed: clamp(Math.hypot(dx, dy) / Math.max(pxPerUnit, 1e-3), LAUNCH_SPEED_MIN, LAUNCH_SPEED_MAX),
});
