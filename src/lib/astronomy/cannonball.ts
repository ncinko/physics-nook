/**
 * Newton's cannonball: a ball fired horizontally from a mountaintop under
 * inverse-square gravity toward Earth's centre, alongside the textbook
 * constant-g parabola over flat ground. DOM-free so the geometry can be tested.
 *
 * Coordinates: Earth's centre at the origin, y up, the cannon on the +y axis
 * firing toward +x. Angles are measured clockwise from +y, so an angle phi is
 * also the ground distance R * phi travelled around the planet.
 */

/** Earth's gravitational parameter G*M, in m^3/s^2. */
export const EARTH_GM = 3.986004418e14;
/** Mean Earth radius, in metres. */
export const EARTH_RADIUS_M = 6.371e6;
/** The cannon sits on an Everest-height mountain; air is ignored. */
export const CANNON_ALTITUDE_M = 8.8e3;
export const LAUNCH_RADIUS_M = EARTH_RADIUS_M + CANNON_ALTITUDE_M;

/** Treat a launch this close to circular speed (as a fraction) as circular. */
const CIRCULAR_TOLERANCE = 0.005;

export const gravityAt = (r: number, gm = EARTH_GM) => gm / (r * r);
export const circularSpeed = (r: number, gm = EARTH_GM) => Math.sqrt(gm / r);
export const escapeSpeed = (r: number, gm = EARTH_GM) => Math.sqrt((2 * gm) / r);

export type CannonOrbitKind = 'lands' | 'orbit-apogee' | 'circular' | 'orbit-perigee' | 'escape';

export interface CannonOrbit {
  /** Launch radius and speed. */
  r0: number;
  v: number;
  /** k = (v / v_circular)^2; the whole family of paths depends only on k. */
  k: number;
  eccentricity: number;
  /** Semi-latus rectum p, which is also the radius of curvature at launch. */
  semiLatusRectum: number;
  kind: CannonOrbitKind;
  /** Angle (and so R * angle of ground distance) where the ball lands, or null. */
  impactAngle: number | null;
  periapsisRadius: number;
  /** Infinity for an unbound path. */
  apoapsisRadius: number;
  /** For an unbound path, the angle of its outgoing asymptote; else null. */
  asymptoteAngle: number | null;
}

/**
 * The conic for a horizontal launch. With the launch point at an apsis, the
 * orbit equation collapses to r(phi) = r0 k / (1 + (k - 1) cos phi): below
 * circular speed (k < 1) the cannon is at the farthest point, above it at the
 * nearest, and k >= 2 is escape.
 */
export const cannonOrbit = (
  v: number,
  r0 = LAUNCH_RADIUS_M,
  groundRadius = EARTH_RADIUS_M,
  gm = EARTH_GM,
): CannonOrbit => {
  const k = (r0 * v * v) / gm;
  const eccentricity = Math.abs(k - 1);
  const p = r0 * k;
  const nearRadius = k < 1 ? p / (1 + eccentricity) : r0;
  const farRadius = k < 1 ? r0 : k < 2 ? p / (1 - eccentricity) : Infinity;

  // Landing: solve r(phi) = groundRadius on the way down from the cannon.
  let impactAngle: number | null = null;
  if (k < 1 && nearRadius <= groundRadius) {
    const cosPhi = (p / groundRadius - 1) / (k - 1);
    impactAngle = Math.acos(Math.max(-1, Math.min(1, cosPhi)));
  }

  let kind: CannonOrbitKind;
  if (impactAngle !== null) kind = 'lands';
  else if (Math.abs(Math.sqrt(k) - 1) < CIRCULAR_TOLERANCE) kind = 'circular';
  else if (k < 1) kind = 'orbit-apogee';
  else if (k < 2) kind = 'orbit-perigee';
  else kind = 'escape';

  return {
    r0,
    v,
    k,
    eccentricity,
    semiLatusRectum: p,
    kind,
    impactAngle,
    periapsisRadius: nearRadius,
    apoapsisRadius: farRadius,
    asymptoteAngle: k >= 2 ? Math.acos(-1 / (k - 1)) : null,
  };
};

/** Distance from Earth's centre at angle phi; Infinity past an escape asymptote. */
export const orbitRadiusAt = (orbit: CannonOrbit, phi: number) => {
  const denominator = 1 + (orbit.k - 1) * Math.cos(phi);
  return denominator > 0 ? orbit.semiLatusRectum / denominator : Infinity;
};

export const pointAtAngle = (r: number, phi: number) => ({
  x: r * Math.sin(phi),
  y: r * Math.cos(phi),
});

export const orbitPointAt = (orbit: CannonOrbit, phi: number) =>
  pointAtAngle(orbitRadiusAt(orbit, phi), phi);

/** Period of a bound path, in seconds; Infinity when unbound. */
export const orbitPeriod = (orbit: CannonOrbit, gm = EARTH_GM) => {
  if (orbit.k >= 2) return Infinity;
  const a = (orbit.periapsisRadius + orbit.apoapsisRadius) / 2;
  return 2 * Math.PI * Math.sqrt((a * a * a) / gm);
};

// ---------------------------------------------------------------------------
// The textbook model: constant g straight down onto flat ground at y = R.
// g is taken at the launch height, so the parabola and the true path leave
// the cannon with the same curvature.
// ---------------------------------------------------------------------------

export const flatGroundRange = (v: number, height = CANNON_ALTITUDE_M, g = gravityAt(LAUNCH_RADIUS_M)) =>
  v * Math.sqrt((2 * height) / g);

export const flatParabolaY = (v: number, x: number, r0 = LAUNCH_RADIUS_M, g = gravityAt(r0)) =>
  r0 - (g * x * x) / (2 * v * v);

// ---------------------------------------------------------------------------
// Time stepping for the animated ball.
// ---------------------------------------------------------------------------

export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export const launchState = (v: number, r0 = LAUNCH_RADIUS_M): BallState => ({ x: 0, y: r0, vx: v, vy: 0 });

export const gravityVector = (x: number, y: number, gm = EARTH_GM) => {
  const r2 = x * x + y * y;
  const scale = -gm / (r2 * Math.sqrt(r2));
  return { ax: x * scale, ay: y * scale };
};

/** One velocity-Verlet step. Symplectic, so closed orbits do not drift. */
export const stepVerlet = (state: BallState, dt: number, gm = EARTH_GM): BallState => {
  const a0 = gravityVector(state.x, state.y, gm);
  const x = state.x + state.vx * dt + 0.5 * a0.ax * dt * dt;
  const y = state.y + state.vy * dt + 0.5 * a0.ay * dt * dt;
  const a1 = gravityVector(x, y, gm);
  return {
    x,
    y,
    vx: state.vx + 0.5 * (a0.ax + a1.ax) * dt,
    vy: state.vy + 0.5 * (a0.ay + a1.ay) * dt,
  };
};

export const specificEnergy = (state: BallState, gm = EARTH_GM) =>
  0.5 * (state.vx * state.vx + state.vy * state.vy) - gm / Math.hypot(state.x, state.y);

export const specificAngularMomentum = (state: BallState) => state.x * state.vy - state.y * state.vx;

/** A 1-2-5 length, in metres, close to `target`: for scale bars. */
export const niceLength = (target: number) => {
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const normalized = target / magnitude;
  const nice = normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10;
  return nice * magnitude;
};
