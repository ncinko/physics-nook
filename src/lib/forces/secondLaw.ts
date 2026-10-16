// One-dimensional second-law model for the sled demo: the net force on a body
// of fixed mass sets its acceleration, and a "motion map" records where it is
// at equal time intervals. Positions are in metres, positive to the right.

export interface MotionState {
  t: number;
  x: number;
  v: number;
}

export interface MotionDot {
  t: number;
  x: number;
}

export const START_STATE: MotionState = { t: 0, x: 0, v: 0 };

/** Net force along the track, positive to the right. */
export const netForce1D = (pushRight: number, pushLeft: number) => pushRight - pushLeft;

/** a = F / m, guarded against a zero mass. */
export const accelerationFromForce = (net: number, mass: number) => net / Math.max(mass, 1e-6);

/** Exact advance for a constant net force over `dt` seconds. */
export const advanceMotion = (state: MotionState, net: number, mass: number, dt: number): MotionState => {
  const a = accelerationFromForce(net, mass);
  return {
    t: state.t + dt,
    x: state.x + state.v * dt + 0.5 * a * dt * dt,
    v: state.v + a * dt,
  };
};

const EPSILON = 1e-9;

/**
 * Advance by `dt` and drop a motion-map dot each time the clock passes a
 * multiple of `interval`, positioned at the exact crossing rather than at the
 * end of the step. `dots` is not mutated; a new array is returned only when a
 * dot is added.
 */
export const advanceWithDots = (
  state: MotionState,
  dots: MotionDot[],
  net: number,
  mass: number,
  dt: number,
  interval: number,
): { state: MotionState; dots: MotionDot[] } => {
  const end = state.t + dt;
  let current = state;
  let nextDots = dots;
  let nextTime = (Math.floor(current.t / interval + EPSILON) + 1) * interval;

  while (nextTime <= end + EPSILON) {
    current = advanceMotion(current, net, mass, Math.max(0, nextTime - current.t));
    nextDots = [...nextDots, { t: nextTime, x: current.x }];
    nextTime += interval;
  }

  return { state: advanceMotion(current, net, mass, Math.max(0, end - current.t)), dots: nextDots };
};
