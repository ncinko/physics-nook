// Pure, DOM-free physics core for the single-player CoasterBuilder3D island.
//
// This intentionally lives alongside — but separate from — the multiplayer
// `physics.ts` / `track.ts` model (which drives `CoasterParkBuilder`). The two
// use different track representations; this module holds only the along-track
// velocity integration, g-force, and energy math used by the 3D editor so that
// the React island owns rendering/input while the testable math stays here.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Stronger-than-Earth gravity; chosen in the original editor for visual punch. */
export const GRAVITY = 16;
/** Quadratic rolling/air resistance coefficient. */
export const FRICTION_COEFF = 0.001;
/** Speed the cart is (re)launched from the station with. */
export const INITIAL_SPEED = 15;
/** Hard clamp on cart speed in either direction (m/s). */
export const MAX_SPEED = 60;

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface RideStepInput {
  /** Current along-track speed (signed; positive is forward). */
  speed: number;
  /** Vertical component of the unit tangent (rise per unit length). */
  slopeY: number;
  /** Fixed timestep in seconds. */
  dt: number;
  /** Target speed when on a chain-lift section, else null. */
  chainTarget?: number | null;
  /** Constant forward acceleration from a booster section. */
  boostForce?: number;
  /** Linear drag coefficient from a brake section (replaces rolling friction). */
  brakeDrag?: number;
}

/**
 * Advance the cart's along-track speed by one fixed step. Mirrors the original
 * editor's inline integrator: gravity projected along the tangent, quadratic
 * rolling friction, with chain-lift / booster / brake overrides. Chain lift
 * eases the speed toward its target and suppresses friction while engaged.
 */
export const stepRideSpeed = (input: RideStepInput): number => {
  const { slopeY, dt } = input;
  let speed = input.speed;
  const chainTarget = input.chainTarget ?? null;
  const boostForce = input.boostForce ?? 0;
  const brakeDrag = input.brakeDrag ?? 0;

  const accelG = -GRAVITY * slopeY;
  let friction = -FRICTION_COEFF * speed * Math.abs(speed);
  const accelExternal = boostForce;

  if (chainTarget !== null && speed < chainTarget) {
    speed = lerp(speed, chainTarget, 0.1);
    friction = 0;
  }

  if (brakeDrag) {
    friction = -speed * brakeDrag;
  }

  speed += (accelG + friction + accelExternal) * dt;

  if (speed > MAX_SPEED) speed = MAX_SPEED;
  if (speed < -MAX_SPEED) speed = -MAX_SPEED;
  if (Math.abs(speed) < 0.02) speed = 0;

  return speed;
};

export interface GForces {
  vertG: number;
  latG: number;
  totalG: number;
}

/**
 * Resolve a felt-acceleration vector (proper acceleration: kinematic
 * acceleration minus gravity) onto the cart frame, in units of g.
 */
export const gForces = (felt: Vec3, localUp: Vec3, lateral: Vec3): GForces => ({
  vertG: dot(felt, localUp) / GRAVITY,
  latG: dot(felt, lateral) / GRAVITY,
  totalG: length(felt) / GRAVITY,
});

export interface Energy {
  pe: number;
  ke: number;
}

/** Specific (per-unit-mass) gravitational PE and KE at a given height/speed. */
export const energy = (speed: number, height: number): Energy => ({
  pe: GRAVITY * height,
  ke: 0.5 * speed * speed,
});
