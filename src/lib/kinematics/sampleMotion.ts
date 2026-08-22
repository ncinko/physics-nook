/**
 * The single sample motion behind the 1D kinematics graph explorers.
 *
 * `MotionOpener` runs the hedgehog through it, `VelocityExplorer` plots x(t)
 * and v(t), and `AccelerationExplorer` plots v(t) and a(t). All three read from
 * this module so every picture on the lesson page is a view of one motion
 * rather than three unrelated curves.
 *
 * The motion is built from the acceleration up, in three phases:
 *
 *   [0, 1.5]    a = 0. The hedgehog enters at x = 0 already running right at a
 *               steady 2.4 m/s.
 *   [1.5, 8.5]  a traces one full sine period: negative first, which slows the
 *               run, turns it around, and drives it left; then positive, which
 *               kills the leftward drift and turns it around again.
 *   [8.5, 10]   a = 0 again, and because a full sine period integrates to zero
 *               the velocity has come back to exactly what it started at. The
 *               hedgehog runs off the right at the same 2.4 m/s it arrived with.
 *
 * That last point is what makes the loop seamless: v(10) = v(0) and a(10) =
 * a(0) = 0, so when the animation wraps there is no jump in speed, in gait, or
 * in whether the hedgehog is speeding up. Only the position resets - it exits
 * at x = 10 m and re-enters at x = 0 - which reads as running off one end of
 * the track and back on at the other.
 *
 * v and x below are exact antiderivatives of a, not numerical integrals, which
 * is what lets the explorers claim their slopes and areas are exact.
 */

export const SAMPLE_T_MIN = 0;
export const SAMPLE_T_MAX = 10;

/** How long the opening (and closing) constant-velocity stretch lasts. */
export const CRUISE_DURATION = 1.5;

/** The turning section runs between these two times; a is zero outside it. */
export const TURN_START = CRUISE_DURATION;
export const TURN_END = SAMPLE_T_MAX - CRUISE_DURATION;

const TURN_SPAN = TURN_END - TURN_START;

/** Velocity at t = 0 and again at t = 10, so the cycle closes without a jump. */
export const V_CRUISE = 2.4;

/** Velocity at the deepest point of the leftward excursion, halfway through. */
export const V_REVERSE = -1.6;

const OMEGA = (2 * Math.PI) / TURN_SPAN;

// Sized so the velocity swings exactly from V_CRUISE down to V_REVERSE and back.
const A_AMPLITUDE = ((V_CRUISE - V_REVERSE) / 2) * OMEGA;

// The mean velocity through the turning section; also the shorthand that keeps
// the position formula readable.
const V_MEAN = V_CRUISE - A_AMPLITUDE / OMEGA;

const X_TURN_START = V_CRUISE * TURN_START;
const X_TURN_END = X_TURN_START + V_MEAN * TURN_SPAN;

export const accelerationOfT = (t: number) => {
  if (t <= TURN_START || t >= TURN_END) {
    return 0;
  }
  return -A_AMPLITUDE * Math.sin(OMEGA * (t - TURN_START));
};

export const velocityOfT = (t: number) => {
  if (t <= TURN_START || t >= TURN_END) {
    return V_CRUISE;
  }
  return V_CRUISE + (A_AMPLITUDE / OMEGA) * (Math.cos(OMEGA * (t - TURN_START)) - 1);
};

export const positionOfT = (t: number) => {
  if (t <= TURN_START) {
    return V_CRUISE * t;
  }
  if (t >= TURN_END) {
    return X_TURN_END + V_CRUISE * (t - TURN_END);
  }
  const s = t - TURN_START;
  return X_TURN_START + V_MEAN * s + (A_AMPLITUDE / (OMEGA * OMEGA)) * Math.sin(OMEGA * s);
};

export const clampSampleT = (t: number) =>
  Math.max(SAMPLE_T_MIN, Math.min(SAMPLE_T_MAX, t));

/** Average rate of change of `f` across the interval, i.e. the secant slope. */
export const averageRate = (f: (t: number) => number, t1: number, t2: number) =>
  (f(t2) - f(t1)) / (t2 - t1);

/**
 * Signed area under a(t) from t1 to t2. Because a is exactly dv/dt, the area is
 * exactly the change in velocity over the interval - the point the acceleration
 * explorer's shaded band is making.
 */
export const areaUnderAcceleration = (t1: number, t2: number) =>
  velocityOfT(t2) - velocityOfT(t1);

/**
 * Signed area under v(t) from t1 to t2, which is the displacement. Used for the
 * area-direction discussion on the lesson page.
 */
export const areaUnderVelocity = (t1: number, t2: number) =>
  positionOfT(t2) - positionOfT(t1);

/**
 * What the speed is doing right now. Note this is about speed, not velocity:
 * acceleration and velocity pointing the same way means speeding up whichever
 * direction that is, and from a standstill any acceleration speeds things up.
 */
export type SpeedTrend = 'speeding-up' | 'slowing-down' | 'constant';

export const speedTrend = (velocity: number, acceleration: number): SpeedTrend => {
  if (Math.abs(acceleration) < 1e-9) {
    return 'constant';
  }
  if (Math.abs(velocity) < 1e-9) {
    return 'speeding-up';
  }
  return velocity * acceleration > 0 ? 'speeding-up' : 'slowing-down';
};

/**
 * Cumulative path length travelled, integral of |v| from 0 to t. Distance rather
 * than displacement, so it keeps growing while the motion doubles back - which
 * is what the hedgehog's stride phase needs. Precomputed once and interpolated
 * so the pose stays a pure function of t and scrubbing backwards is exact.
 */
const PATH_SAMPLES = 512;
const PATH_STEP = (SAMPLE_T_MAX - SAMPLE_T_MIN) / PATH_SAMPLES;

const PATH_TABLE: number[] = (() => {
  const table = [0];
  let total = 0;
  for (let i = 0; i < PATH_SAMPLES; i += 1) {
    const midpoint = SAMPLE_T_MIN + (i + 0.5) * PATH_STEP;
    total += Math.abs(velocityOfT(midpoint)) * PATH_STEP;
    table.push(total);
  }
  return table;
})();

/** Total ground covered over one cycle, used to keep the stride phase in step. */
export const SAMPLE_PATH_LENGTH = PATH_TABLE[PATH_SAMPLES];

export const pathLengthOfT = (t: number) => {
  const clamped = clampSampleT(t);
  const position = (clamped - SAMPLE_T_MIN) / PATH_STEP;
  const index = Math.min(PATH_SAMPLES - 1, Math.floor(position));
  const fraction = position - index;
  return PATH_TABLE[index] + (PATH_TABLE[index + 1] - PATH_TABLE[index]) * fraction;
};
