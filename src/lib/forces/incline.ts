// Block-on-an-incline solver, written the way the lesson works it: an axis along
// the slope and an axis perpendicular to it, so the weight is the only force
// that has to be broken into components.
//
// Sign convention along the slope: positive points *down* the slope.

export interface InclineInput {
  /** Slope angle from horizontal, in degrees. */
  angleDeg: number;
  /** Mass of the block, in kilograms. */
  mass: number;
  /** Coefficient of static friction. */
  muStatic: number;
  /** Coefficient of kinetic friction. */
  muKinetic: number;
  /** Gravitational field strength, in m/s^2. */
  g?: number;
}

export interface InclineSolution {
  /** Weight magnitude, mg. */
  weight: number;
  /** Component of weight along the slope, mg sin(theta). Always down-slope. */
  weightAlong: number;
  /** Component of weight perpendicular to the slope, mg cos(theta). */
  weightPerpendicular: number;
  /** Normal force magnitude. Balances the perpendicular weight component. */
  normal: number;
  /** Largest static friction the surface can supply, mu_s * N. */
  maxStatic: number;
  /** Friction along the slope. Negative because it acts up-slope. */
  friction: number;
  /** Net force along the slope. Positive is down-slope. */
  netAlong: number;
  /** Acceleration along the slope. Positive is down-slope. */
  acceleration: number;
  /** True once the down-slope weight component beats maximum static friction. */
  sliding: boolean;
  /** Slope angle at which sliding begins, in degrees: arctan(mu_s). */
  slipAngleDeg: number;
}

const DEG = Math.PI / 180;

/**
 * Solve the classic "released from rest on a ramp" case. The block is assumed to
 * start at rest, so static friction gets first refusal: it holds the block if it
 * can, and kinetic friction takes over only once it cannot.
 */
export const solveIncline = ({
  angleDeg,
  mass,
  muStatic,
  muKinetic,
  g = 9.8,
}: InclineInput): InclineSolution => {
  const theta = angleDeg * DEG;
  const weight = mass * g;
  const weightAlong = weight * Math.sin(theta);
  const weightPerpendicular = weight * Math.cos(theta);
  const normal = Math.max(0, weightPerpendicular);
  const maxStatic = Math.max(0, muStatic) * normal;
  const slipAngleDeg = Math.atan(Math.max(0, muStatic)) / DEG;

  if (weightAlong <= maxStatic) {
    // Static friction matches the pull exactly rather than maxing out.
    return {
      weight,
      weightAlong,
      weightPerpendicular,
      normal,
      maxStatic,
      friction: -weightAlong,
      netAlong: 0,
      acceleration: 0,
      sliding: false,
      slipAngleDeg,
    };
  }

  const friction = -Math.max(0, muKinetic) * normal;
  const netAlong = weightAlong + friction;

  if (netAlong <= 0) {
    // Only reachable when mu_k > mu_s: the block breaks free of static friction
    // but kinetic friction is still strong enough to hold it, so it stays put.
    return {
      weight,
      weightAlong,
      weightPerpendicular,
      normal,
      maxStatic,
      friction: -weightAlong,
      netAlong: 0,
      acceleration: 0,
      sliding: false,
      slipAngleDeg,
    };
  }

  return {
    weight,
    weightAlong,
    weightPerpendicular,
    normal,
    maxStatic,
    friction,
    netAlong,
    acceleration: netAlong / Math.max(mass, 1e-6),
    sliding: true,
    slipAngleDeg,
  };
};
