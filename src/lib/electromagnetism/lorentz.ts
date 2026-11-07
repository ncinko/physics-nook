// Motion of a charged particle in a uniform magnetic field perpendicular to the
// screen. The model is 2D with screen coordinates (x right, y down), so a
// positive turn angle is clockwise on screen. Lengths and speeds are in
// arbitrary units: the simulation is about shapes and ratios, not SI values.

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Signed charge in elementary charges (arbitrary units). */
  charge: number;
  mass: number;
}

/**
 * Angular velocity (rad/s) of the circular motion: omega = qB/m. `bz` is the
 * field component out of the page, so out of page is positive. Positive omega
 * turns the velocity clockwise on screen: a positive charge moving right in a
 * field out of the page is pushed down, which F = qv x B predicts.
 */
export function angularVelocity(charge: number, mass: number, bz: number): number {
  return (charge * bz) / mass;
}

/** Rotate a velocity by `angle` radians, clockwise on screen for positive angles. */
export function rotateVelocity(vx: number, vy: number, angle: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [vx * c - vy * s, vx * s + vy * c];
}

/**
 * Advance a particle by `dt` seconds in a uniform field `bz`. The velocity is
 * rotated by exactly omega*dt and the position moves along the matching chord of
 * the circle, so speed is conserved and the path is an exact circle for any
 * step size.
 */
export function advanceParticle(p: Particle, bz: number, dt: number): Particle {
  const omega = angularVelocity(p.charge, p.mass, bz);
  const turn = omega * dt;
  const half = turn / 2;
  // Chord length over the step is v*dt * sin(half)/half; the limit at half = 0 is 1.
  const sinc = Math.abs(half) < 1e-6 ? 1 : Math.sin(half) / half;
  const [mx, my] = rotateVelocity(p.vx, p.vy, half);
  const [vx, vy] = rotateVelocity(p.vx, p.vy, turn);
  return { ...p, x: p.x + mx * dt * sinc, y: p.y + my * dt * sinc, vx, vy };
}

/** Radius of the circular path, r = mv / (|q|B). Infinite when nothing bends the path. */
export function cyclotronRadius(speed: number, charge: number, mass: number, bz: number): number {
  const denominator = Math.abs(charge * bz);
  return denominator === 0 ? Infinity : (mass * speed) / denominator;
}

/** Time for one full orbit, T = 2*pi*m / (|q|B). Independent of speed. */
export function cyclotronPeriod(charge: number, mass: number, bz: number): number {
  const denominator = Math.abs(charge * bz);
  return denominator === 0 ? Infinity : (2 * Math.PI * mass) / denominator;
}

export function particleSpeed(p: Pick<Particle, 'vx' | 'vy'>): number {
  return Math.hypot(p.vx, p.vy);
}

/** Launch a particle moving right. Both signs start the same way so the sign alone sets the bend. */
export function launchParticle(
  x: number,
  y: number,
  speed: number,
  charge: number,
  mass: number,
): Particle {
  return { x, y, vx: speed, vy: 0, charge, mass };
}

/** Which way a given particle first turns on screen: `1` clockwise, `-1` counterclockwise, `0` straight. */
export function turnSense(charge: number, mass: number, bz: number): -1 | 0 | 1 {
  const omega = angularVelocity(charge, mass, bz);
  return omega === 0 ? 0 : omega > 0 ? 1 : -1;
}
