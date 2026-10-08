// A ball in a U-shaped ramp for the landing-page mechanics miniature (screen units, y down).

export const BOWL_W = 320;
export const BOWL_H = 150;
export const BALL_RADIUS = 9;

const BOTTOM = 126; // surface height at the centre of the ramp
const RISE = 92; // how far the ramp climbs by the side walls
const HALF = 150; // half-width of the ramp
const CENTRE = BOWL_W / 2;

const GRAVITY = 420; // px/s^2
const RESTITUTION = 0.6;
const BOUNCE_MIN_SPEED = 30; // slower impacts don't bounce
const ROLL_DRAG = 0.35; // 1/s, applied while in contact
const SLOW_SPEED = 35; // below this the ball loses energy faster, so a swing dies out
const SLOW_DRAG = 1.2; // 1/s
const REST_SLOPE = 0.04;
const SUBSTEP = 1 / 240;

export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Roll angle in radians. */
  angle: number;
}

/** Height (screen y) of the ramp surface at x. */
export function surfaceY(x: number): number {
  const u = (x - CENTRE) / HALF;
  return BOTTOM - RISE * u * u;
}

/** dy/dx of the ramp surface at x. */
export function surfaceSlope(x: number): number {
  const u = (x - CENTRE) / HALF;
  return (-2 * RISE * u) / HALF;
}

export function rampPath(samples = 40): string {
  let d = '';
  for (let i = 0; i <= samples; i += 1) {
    const x = (BOWL_W * i) / samples;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${surfaceY(x).toFixed(1)}`;
  }
  return d;
}

/** Height of the ball's lowest point above the ramp along the normal (negative = penetrating). */
function gap(x: number, y: number): number {
  const m = surfaceSlope(x);
  return (surfaceY(x) - y) / Math.sqrt(1 + m * m) - BALL_RADIUS;
}

/** At rest means on the ramp, nearly stationary, and on a nearly flat part of it. A ball
 * passing through zero speed at the top of a swing is still on a slope, so it isn't resting. */
export function isAtRest(ball: BallState): boolean {
  return (
    Math.hypot(ball.vx, ball.vy) < 3 &&
    Math.abs(gap(ball.x, ball.y)) < 0.75 &&
    Math.abs(surfaceSlope(ball.x)) < REST_SLOPE
  );
}

/** Put the ball back on or above the ramp and inside the frame (used after a drag). */
export function settleAboveRamp(ball: BallState): BallState {
  const x = Math.min(BOWL_W - BALL_RADIUS, Math.max(BALL_RADIUS, ball.x));
  const y = Math.min(surfaceY(x) - BALL_RADIUS, Math.max(BALL_RADIUS, ball.y));
  return { ...ball, x, y };
}

function substep(b: BallState, dt: number): BallState {
  let { x, y, vx, vy, angle } = b;
  vy += GRAVITY * dt;
  x += vx * dt;
  y += vy * dt;

  if (x < BALL_RADIUS) {
    x = BALL_RADIUS;
    vx = Math.abs(vx) * RESTITUTION;
  } else if (x > BOWL_W - BALL_RADIUS) {
    x = BOWL_W - BALL_RADIUS;
    vx = -Math.abs(vx) * RESTITUTION;
  }
  if (y < BALL_RADIUS) {
    y = BALL_RADIUS;
    vy = Math.abs(vy) * RESTITUTION;
  }

  const g = gap(x, y);
  if (g < 0) {
    const m = surfaceSlope(x);
    const len = Math.sqrt(1 + m * m);
    const nx = m / len;
    const ny = -1 / len;
    x += nx * -g;
    y += ny * -g;
    const vn = vx * nx + vy * ny;
    if (vn < 0) {
      const e = -vn > BOUNCE_MIN_SPEED ? RESTITUTION : 0;
      vx -= (1 + e) * vn * nx;
      vy -= (1 + e) * vn * ny;
    }
    const drag = Math.max(0, 1 - (Math.hypot(vx, vy) < SLOW_SPEED ? SLOW_DRAG : ROLL_DRAG) * dt);
    vx *= drag;
    vy *= drag;
    // Rolling without slipping: spin follows the speed along the ramp.
    const tx = 1 / len;
    const ty = m / len;
    angle += ((vx * tx + vy * ty) / BALL_RADIUS) * dt;
  } else {
    angle += (vx / BALL_RADIUS) * dt * 0.1; // slow spin in flight
  }
  return { x, y, vx, vy, angle };
}

export function stepBall(ball: BallState, dt: number): BallState {
  let state = ball;
  let remaining = Math.min(dt, 0.05);
  while (remaining > 1e-9) {
    const h = Math.min(SUBSTEP, remaining);
    state = substep(state, h);
    remaining -= h;
  }
  return state;
}
