import {
  add,
  dot,
  magnitude,
  normalize,
  scale,
  subtract,
  ZERO_VECTOR,
  type Vector2,
} from '../math/vectors.ts';

export {
  add,
  clampMagnitude,
  dot,
  magnitude,
  normalize,
  project,
  reject,
  scale,
  subtract,
  ZERO_VECTOR,
  type Vector2,
} from '../math/vectors.ts';

export interface BodyState {
  position: Vector2;
  velocity: Vector2;
  angle?: number;
  angularVelocity?: number;
}

export interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface WallImpulse {
  position: Vector2;
  impulse: Vector2;
  normal: Vector2;
}

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const netForce = (forces: Vector2[]): Vector2 =>
  forces.reduce((total, force) => add(total, force), ZERO_VECTOR);

export const integrateBody = (
  state: BodyState,
  force: Vector2,
  mass: number,
  dt: number,
): BodyState => {
  const safeMass = Math.max(mass, 1e-6);
  const acceleration = scale(force, 1 / safeMass);
  const velocity = add(state.velocity, scale(acceleration, dt));
  const position = add(state.position, scale(velocity, dt));

  return {
    position,
    velocity,
    angle: (state.angle ?? 0) + (state.angularVelocity ?? 0) * dt,
    angularVelocity: state.angularVelocity ?? 0,
  };
};

export const hookeForce = (displacementFromEquilibrium: Vector2, stiffness: number): Vector2 =>
  scale(displacementFromEquilibrium, -stiffness);

export const springForceToAnchor = (
  position: Vector2,
  anchor: Vector2,
  restLength: number,
  stiffness: number,
): Vector2 => {
  const fromAnchor = subtract(position, anchor);
  const length = magnitude(fromAnchor);

  if (length === 0) {
    return ZERO_VECTOR;
  }

  const extension = length - restLength;
  return scale(normalize(fromAnchor), -stiffness * extension);
};

export const contactNormalForce = (
  compressionDepth: number,
  normal: Vector2,
  stiffness: number,
): Vector2 => {
  if (compressionDepth <= 0) {
    return ZERO_VECTOR;
  }

  return scale(normalize(normal, { x: 0, y: -1 }), compressionDepth * stiffness);
};

export interface TongueTensionResult {
  force: Vector2;
  stretch: number;
  taut: boolean;
}

export const tongueTensionForce = (
  position: Vector2,
  anchor: Vector2,
  restLength: number,
  stiffness: number,
): TongueTensionResult => {
  const towardAnchor = subtract(anchor, position);
  const length = magnitude(towardAnchor);
  const stretch = Math.max(0, length - restLength);

  if (stretch === 0 || length === 0) {
    return {
      force: ZERO_VECTOR,
      stretch: 0,
      taut: false,
    };
  }

  return {
    force: scale(towardAnchor, (stiffness * stretch) / length),
    stretch,
    taut: true,
  };
};

export const gravityForce = (mass: number, g = 9.8): Vector2 => ({ x: 0, y: mass * g });

export interface FrictionInput {
  normalMagnitude: number;
  velocity: Vector2;
  appliedForce: Vector2;
  muStatic: number;
  muKinetic: number;
  tangent?: Vector2;
  restSpeedThreshold?: number;
}

export interface FrictionResult {
  force: Vector2;
  mode: 'static' | 'kinetic' | 'none';
  maxStatic: number;
}

export const frictionForce = ({
  normalMagnitude,
  velocity,
  appliedForce,
  muStatic,
  muKinetic,
  tangent = { x: 1, y: 0 },
  restSpeedThreshold = 1e-3,
}: FrictionInput): FrictionResult => {
  const axis = normalize(tangent);
  const velocityAlongSurface = dot(velocity, axis);
  const appliedAlongSurface = dot(appliedForce, axis);
  const maxStatic = Math.max(0, muStatic * normalMagnitude);

  if (normalMagnitude <= 0) {
    return { force: ZERO_VECTOR, mode: 'none', maxStatic: 0 };
  }

  if (Math.abs(velocityAlongSurface) <= restSpeedThreshold && Math.abs(appliedAlongSurface) <= maxStatic) {
    return {
      force: scale(axis, -appliedAlongSurface),
      mode: Math.abs(appliedAlongSurface) > 0 ? 'static' : 'none',
      maxStatic,
    };
  }

  const direction =
    Math.abs(velocityAlongSurface) > restSpeedThreshold
      ? Math.sign(velocityAlongSurface)
      : Math.sign(appliedAlongSurface);

  return {
    force: scale(axis, -direction * Math.max(0, muKinetic * normalMagnitude)),
    mode: 'kinetic',
    maxStatic,
  };
};

export const resolveWallBounce = (
  state: BodyState,
  radius: number,
  bounds: Bounds,
  restitution = 0.86,
): { state: BodyState; impulses: WallImpulse[] } => {
  const position = { ...state.position };
  const velocity = { ...state.velocity };
  const impulses: WallImpulse[] = [];

  const addImpulse = (normal: Vector2, contactPosition: Vector2, beforeVelocity: Vector2) => {
    const speedIntoWall = Math.max(0, -dot(beforeVelocity, normal));

    if (speedIntoWall > 0) {
      impulses.push({
        normal,
        position: contactPosition,
        impulse: scale(normal, speedIntoWall * (1 + restitution)),
      });
    }
  };

  if (position.x - radius < bounds.left) {
    const before = { ...velocity };
    position.x = bounds.left + radius;
    velocity.x = Math.abs(velocity.x) * restitution;
    addImpulse({ x: 1, y: 0 }, { x: bounds.left, y: position.y }, before);
  } else if (position.x + radius > bounds.right) {
    const before = { ...velocity };
    position.x = bounds.right - radius;
    velocity.x = -Math.abs(velocity.x) * restitution;
    addImpulse({ x: -1, y: 0 }, { x: bounds.right, y: position.y }, before);
  }

  if (position.y - radius < bounds.top) {
    const before = { ...velocity };
    position.y = bounds.top + radius;
    velocity.y = Math.abs(velocity.y) * restitution;
    addImpulse({ x: 0, y: 1 }, { x: position.x, y: bounds.top }, before);
  } else if (position.y + radius > bounds.bottom) {
    const before = { ...velocity };
    position.y = bounds.bottom - radius;
    velocity.y = -Math.abs(velocity.y) * restitution;
    addImpulse({ x: 0, y: -1 }, { x: position.x, y: bounds.bottom }, before);
  }

  return {
    state: {
      ...state,
      position,
      velocity,
    },
    impulses,
  };
};

export const inverseSquareRelativeStrength = (distance: number, referenceDistance = 1) => {
  const safeDistance = Math.max(distance, 1e-6);
  return (referenceDistance * referenceDistance) / (safeDistance * safeDistance);
};
