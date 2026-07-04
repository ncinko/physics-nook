// Pure, DOM-free rotational-dynamics and rotating-frame model logic.
// Rendering and controls live in src/components/rotation; the deterministic
// physics is unit tested in tests/rotation.

export interface Vec2 {
  x: number;
  y: number;
}

export interface UniformCircularMotionState {
  position: Vec2;
  velocity: Vec2;
  acceleration: Vec2;
  speed: number;
  centripetalAcceleration: number;
}

/**
 * Position and kinematics for uniform circular motion about the origin.
 * Positive omega moves counterclockwise; changing its sign reverses velocity
 * while the acceleration remains directed toward the center.
 */
export function uniformCircularMotion(
  radius: number,
  omega: number,
  angle: number,
): UniformCircularMotionState {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const velocity = {
    x: -radius * omega * sin,
    y: radius * omega * cos,
  };
  const acceleration = {
    x: -radius * omega * omega * cos,
    y: -radius * omega * omega * sin,
  };

  return {
    position: { x: radius * cos, y: radius * sin },
    velocity,
    acceleration,
    speed: Math.hypot(velocity.x, velocity.y),
    centripetalAcceleration: Math.hypot(acceleration.x, acceleration.y),
  };
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

/** Convert revolutions per minute to angular speed: ω = 2π · rpm / 60. */
export function rpmToRadPerSec(rpm: number): number {
  return (2 * Math.PI * rpm) / 60;
}

export interface AngularKinematicsState {
  theta: number;
  omega: number;
}

/**
 * Constant angular acceleration kinematics:
 *   θ = θ₀ + ω₀ t + ½ α t²,  ω = ω₀ + α t.
 */
export function angularKinematics(
  theta0: number,
  omega0: number,
  alpha: number,
  t: number,
): AngularKinematicsState {
  return {
    theta: theta0 + omega0 * t + 0.5 * alpha * t * t,
    omega: omega0 + alpha * t,
  };
}

/**
 * Position of a point at radius pointRadius on a wheel of radius wheelRadius
 * rolling without slipping along +x, after the wheel has turned through θ
 * (a curtate cycloid; the common cycloid when pointRadius = wheelRadius):
 *   x = R θ − r sin θ,  y = R − r cos θ.
 * The point starts at the bottom of the wheel (θ = 0).
 */
export function cycloidPoint(wheelRadius: number, pointRadius: number, theta: number): Vec2 {
  return {
    x: wheelRadius * theta - pointRadius * Math.sin(theta),
    y: wheelRadius - pointRadius * Math.cos(theta),
  };
}

/**
 * Velocity of that same point when the wheel spins at angular speed ω:
 *   v = (ω (R − r cos θ), ω r sin θ).
 * At the contact point (r = R, θ = 0) the velocity is exactly zero, and at the
 * top of the wheel the speed is 2 R ω.
 */
export function cycloidVelocity(
  wheelRadius: number,
  pointRadius: number,
  theta: number,
  omega: number,
): Vec2 {
  return {
    x: omega * (wheelRadius - pointRadius * Math.cos(theta)),
    y: omega * pointRadius * Math.sin(theta),
  };
}

/** Total moment of inertia of a collection of point masses: I = Σ mᵢ rᵢ². */
export function compositeMomentOfInertia(
  masses: Array<{ mass: number; radius: number }>,
): number {
  return masses.reduce((sum, m) => sum + pointMomentOfInertia(m.mass, m.radius), 0);
}

export type RollingShape = 'hoop' | 'disk' | 'solidSphere' | 'hollowSphere';

/** The coefficient c in I = c m r² for common rolling shapes. */
export function inertiaCoefficient(shape: RollingShape): number {
  switch (shape) {
    case 'hoop':
      return 1;
    case 'disk':
      return 1 / 2;
    case 'solidSphere':
      return 2 / 5;
    case 'hollowSphere':
      return 2 / 3;
  }
}

/**
 * Acceleration of a body with I = c m r² rolling without slipping down an
 * incline of angle θ: a = g sin θ / (1 + c). Independent of mass and radius —
 * only the shape coefficient matters.
 */
export function rollingAcceleration(g: number, inclineAngle: number, c: number): number {
  return (g * Math.sin(inclineAngle)) / (1 + c);
}

export interface RollingRaceState {
  distance: number;
  speed: number;
}

/**
 * Closed-form state of a shape released from rest and rolling down an incline
 * for time t: distance along the slope ½ a t² and speed a t. Deterministic in
 * t, so simulations can scrub or pause without integration drift.
 */
export function rollingRaceState(
  g: number,
  inclineAngle: number,
  c: number,
  t: number,
): RollingRaceState {
  const a = rollingAcceleration(g, inclineAngle, c);
  return { distance: 0.5 * a * t * t, speed: a * t };
}

export interface RollingEnergyBreakdown {
  translational: number;
  rotational: number;
  total: number;
}

/**
 * Kinetic energy split for a body with I = c m r² rolling without slipping at
 * speed v: K_trans = ½ m v² and K_rot = ½ I ω² = ½ c m v² (v = rω eliminates
 * the radius). A hoop (c = 1) splits its energy exactly in half.
 */
export function rollingEnergyBreakdown(
  mass: number,
  speed: number,
  c: number,
): RollingEnergyBreakdown {
  const translational = 0.5 * mass * speed * speed;
  const rotational = c * translational;
  return { translational, rotational, total: translational + rotational };
}

/**
 * Angular speed after a torque-free change of moment of inertia, from
 * conservation of angular momentum: ω₂ = I₁ ω₁ / I₂.
 */
export function conservedOmega(i1: number, omega1: number, i2: number): number {
  if (i2 === 0) return Infinity;
  return (i1 * omega1) / i2;
}

export interface AngularCollisionResult {
  omegaFinal: number;
  angularMomentum: number;
  keInitial: number;
  keFinal: number;
}

/**
 * Rotational analog of a perfectly inelastic collision: two bodies about the
 * same axis lock together. Angular momentum is conserved,
 * ω_f = (I₁ω₁ + I₂ω₂) / (I₁ + I₂), while kinetic energy drops unless the
 * bodies already shared the same angular velocity.
 */
export function angularCollision(
  i1: number,
  omega1: number,
  i2: number,
  omega2: number,
): AngularCollisionResult {
  const totalL = angularMomentum(i1, omega1) + angularMomentum(i2, omega2);
  const totalI = i1 + i2;
  const omegaFinal = totalI === 0 ? 0 : totalL / totalI;
  return {
    omegaFinal,
    angularMomentum: totalL,
    keInitial: rotationalKineticEnergy(i1, omega1) + rotationalKineticEnergy(i2, omega2),
    keFinal: rotationalKineticEnergy(totalI, omegaFinal),
  };
}
