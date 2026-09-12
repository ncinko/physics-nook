/**
 * The sample motion behind the 2D kinematics hedgehog.
 *
 * The hedgehog runs a figure eight - a 1:2 Lissajous curve - around the origin
 * of a top-down field:
 *
 *   x(t) = A sin(wt)
 *   y(t) = B sin(2wt)
 *
 * Each component on its own is a plain one-dimensional sine motion, which is
 * the point the lesson's "Component Motion" section makes: two 1D motions that
 * share a clock add up to one 2D path.
 *
 * The curve is chosen because one loop passes through every relationship
 * between velocity and acceleration the page talks about:
 *
 *   - At the crossing (t = 0 and t = T/2) the acceleration is exactly zero.
 *   - At the tips of the two lobes (t = T/4 and 3T/4) the acceleration is
 *     exactly perpendicular to the velocity: the hedgehog is turning, and for
 *     that instant its speed is not changing at all.
 *   - Everywhere in between the acceleration has a part along the velocity and
 *     a part across it, so the hedgehog is speeding up or slowing down while it
 *     turns.
 *
 * It is periodic with period T, so r, v, and a all come back to where they
 * started and the animation loops without a jump. v and a below are exact
 * derivatives, not numerical ones.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export const SAMPLE2D_T_MIN = 0;
export const SAMPLE2D_T_MAX = 10;

/** Half-width of the figure eight, in metres. */
export const LOOP_A = 4;
/** Half-height of each lobe, in metres. */
export const LOOP_B = 2;

const PERIOD = SAMPLE2D_T_MAX - SAMPLE2D_T_MIN;
const OMEGA = (2 * Math.PI) / PERIOD;

/** Times of the special moments on the loop, for the page and the tests. */
export const CROSSING_TIMES = [0, PERIOD / 2] as const;
export const TIP_TIMES = [PERIOD / 4, (3 * PERIOD) / 4] as const;

export const positionOfT2D = (t: number): Vec2 => ({
  x: LOOP_A * Math.sin(OMEGA * t),
  y: LOOP_B * Math.sin(2 * OMEGA * t),
});

export const velocityOfT2D = (t: number): Vec2 => ({
  x: LOOP_A * OMEGA * Math.cos(OMEGA * t),
  y: 2 * LOOP_B * OMEGA * Math.cos(2 * OMEGA * t),
});

export const accelerationOfT2D = (t: number): Vec2 => ({
  x: -LOOP_A * OMEGA * OMEGA * Math.sin(OMEGA * t),
  y: -4 * LOOP_B * OMEGA * OMEGA * Math.sin(2 * OMEGA * t),
});

export const magnitude = ({ x, y }: Vec2) => Math.hypot(x, y);

/** Signed components of `a` along `v` and across it (positive = to the left). */
export const splitAcceleration = (v: Vec2, a: Vec2) => {
  const speed = magnitude(v);
  if (speed < 1e-9) {
    return { parallel: 0, perpendicular: 0 };
  }
  return {
    parallel: (v.x * a.x + v.y * a.y) / speed,
    perpendicular: (v.x * a.y - v.y * a.x) / speed,
  };
};

/**
 * Below this, a component of the acceleration is read as zero. The readout
 * snaps to tenths of a second, and the special moments land on exact tenths,
 * but floating point still leaves crumbs of order 1e-16 there.
 */
export const TREND_EPSILON = 0.05;

export type SpeedTrend2D = 'speeding-up' | 'slowing-down' | 'constant';
export type TurnTrend = 'left' | 'right' | 'straight';

export interface MotionTrend2D {
  speed: SpeedTrend2D;
  turn: TurnTrend;
  /** Component of acceleration along the velocity, in m/s^2. */
  aParallel: number;
  /** Component of acceleration across the velocity, positive to the left. */
  aPerp: number;
}

/**
 * What the acceleration is doing to the motion right now. The part along the
 * velocity changes the speed; the part across it changes the direction.
 */
export const motionTrend2D = (v: Vec2, a: Vec2): MotionTrend2D => {
  const { parallel, perpendicular } = splitAcceleration(v, a);
  const speedStill = magnitude(v) < 1e-9;
  let speed: SpeedTrend2D;
  if (speedStill) {
    speed = magnitude(a) < TREND_EPSILON ? 'constant' : 'speeding-up';
  } else if (Math.abs(parallel) < TREND_EPSILON) {
    speed = 'constant';
  } else {
    speed = parallel > 0 ? 'speeding-up' : 'slowing-down';
  }
  const turn: TurnTrend =
    speedStill || Math.abs(perpendicular) < TREND_EPSILON
      ? 'straight'
      : perpendicular > 0
        ? 'left'
        : 'right';
  return { speed, turn, aParallel: parallel, aPerp: perpendicular };
};

export const clampSample2DT = (t: number) =>
  Math.max(SAMPLE2D_T_MIN, Math.min(SAMPLE2D_T_MAX, t));

/**
 * Cumulative path length, the integral of |v| from 0 to t, for the hedgehog's
 * stride phase. Precomputed and interpolated, as in the 1D sample motion, so
 * the pose is a pure function of t and scrubbing backwards is exact.
 */
const PATH_SAMPLES = 1024;
const PATH_STEP = PERIOD / PATH_SAMPLES;

const PATH_TABLE: number[] = (() => {
  const table = [0];
  let total = 0;
  for (let i = 0; i < PATH_SAMPLES; i += 1) {
    total += magnitude(velocityOfT2D(SAMPLE2D_T_MIN + (i + 0.5) * PATH_STEP)) * PATH_STEP;
    table.push(total);
  }
  return table;
})();

export const SAMPLE2D_PATH_LENGTH = PATH_TABLE[PATH_SAMPLES];

export const pathLength2DOfT = (t: number) => {
  const position = (clampSample2DT(t) - SAMPLE2D_T_MIN) / PATH_STEP;
  const index = Math.min(PATH_SAMPLES - 1, Math.floor(position));
  const fraction = position - index;
  return PATH_TABLE[index] + (PATH_TABLE[index + 1] - PATH_TABLE[index]) * fraction;
};
