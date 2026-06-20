// Pure, DOM-free rotational-dynamics and rotating-frame model logic.
// Rendering and controls live in src/components/rotation; the deterministic
// physics is unit tested in tests/rotation.

export interface Vec2 {
  x: number;
  y: number;
}

/** Newton's second law for rotation: angular acceleration α = τ / I. */
export function angularAccel(torque: number, momentOfInertia: number): number {
  if (momentOfInertia === 0) return Infinity;
  return torque / momentOfInertia;
}

/** Moment of inertia of a point mass at radius r: I = m r². */
export function pointMomentOfInertia(mass: number, radius: number): number {
  return mass * radius * radius;
}

/** Moment of inertia of a uniform solid disk about its center: I = ½ m r². */
export function diskMomentOfInertia(mass: number, radius: number): number {
  return 0.5 * mass * radius * radius;
}

/** Rotational kinetic energy: K = ½ I ω². */
export function rotationalKineticEnergy(momentOfInertia: number, omega: number): number {
  return 0.5 * momentOfInertia * omega * omega;
}

/** Angular momentum of a rigid body: L = I ω. */
export function angularMomentum(momentOfInertia: number, omega: number): number {
  return momentOfInertia * omega;
}

/** Torque from a force applied at radius r at angle θ to the lever arm: τ = r F sin θ. */
export function torqueFromForce(radius: number, force: number, angle: number): number {
  return radius * force * Math.sin(angle);
}

/** Angular frequency of a physical pendulum: ω = sqrt(m g d / I). */
export function physicalPendulumOmega(
  mass: number,
  g: number,
  pivotToCenter: number,
  momentOfInertia: number,
): number {
  if (momentOfInertia <= 0) return 0;
  return Math.sqrt((mass * g * pivotToCenter) / momentOfInertia);
}

export interface PolarState {
  r: number;
  rDot: number;
  rDDot: number;
  thetaDot: number;
  thetaDDot: number;
}

/**
 * Acceleration in polar coordinates, decomposed into radial and transverse
 * components:
 *   a_r     = r̈ − r θ̇²        (radial; the −r θ̇² term is centripetal)
 *   a_theta = r θ̈ + 2 ṙ θ̇      (transverse; the 2 ṙ θ̇ term is the Coriolis term)
 */
export function polarAcceleration(state: PolarState): { aRadial: number; aTransverse: number } {
  const { r, rDot, rDDot, thetaDot, thetaDDot } = state;
  return {
    aRadial: rDDot - r * thetaDot * thetaDot,
    aTransverse: r * thetaDDot + 2 * rDot * thetaDot,
  };
}

/**
 * Apparent centrifugal acceleration in a frame rotating at angular speed Ω,
 * for a point at position (x, y) in the rotating frame: a = Ω² r, directed
 * radially outward.
 */
export function centrifugalAccel(omega: number, x: number, y: number): Vec2 {
  return { x: omega * omega * x, y: omega * omega * y };
}

/**
 * Apparent Coriolis acceleration in a frame rotating at angular speed Ω (about
 * +z), for a body with velocity (vx, vy) measured in the rotating frame:
 * a_cor = −2 Ω × v = (2 Ω vy, −2 Ω vx).
 */
export function coriolisAccel(omega: number, vx: number, vy: number): Vec2 {
  return { x: 2 * omega * vy, y: -2 * omega * vx };
}
