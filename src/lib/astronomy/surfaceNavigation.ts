import type { Vec3 } from './ephemeris.ts';

export interface SurfacePose {
  position: Vec3;
  up: Vec3;
  forward: Vec3;
  right: Vec3;
}

export interface SurfaceMove {
  forwardDistance: number;
  rightDistance: number;
  turnRadians?: number;
}

export interface SurfaceViewFrame {
  eyeUp: Vec3;
  bodyForward: Vec3;
  bodyRight: Vec3;
  lookDirection: Vec3;
  headUp: Vec3;
}

export interface SurfaceLookState {
  pose: SurfacePose;
  pitch: number;
}

const WORLD_NORTH: Vec3 = { x: 0, y: 1, z: 0 };
const WORLD_FALLBACK: Vec3 = { x: 0, y: 0, z: -1 };
const EPSILON = 1e-9;
const SURFACE_PITCH_LIMIT = Math.PI / 2 - 0.04;

export const add = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});

export const scale = (vector: Vec3, amount: number): Vec3 => ({
  x: vector.x * amount,
  y: vector.y * amount,
  z: vector.z * amount,
});

export const dot = (a: Vec3, b: Vec3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const length = (vector: Vec3): number =>
  Math.hypot(vector.x, vector.y, vector.z);

export const normalize = (vector: Vec3): Vec3 => {
  const magnitude = length(vector);
  if (magnitude < EPSILON) return { x: 0, y: 0, z: 0 };
  return scale(vector, 1 / magnitude);
};

export const projectToTangent = (vector: Vec3, up: Vec3): Vec3 =>
  add(vector, scale(up, -dot(vector, up)));

export const rotateAroundAxis = (vector: Vec3, axis: Vec3, angleRadians: number): Vec3 => {
  const unitAxis = normalize(axis);
  const cos = Math.cos(angleRadians);
  const sin = Math.sin(angleRadians);

  return add(
    add(scale(vector, cos), scale(cross(unitAxis, vector), sin)),
    scale(unitAxis, dot(unitAxis, vector) * (1 - cos)),
  );
};

export const clampSurfacePitch = (pitchRadians: number): number =>
  Math.max(-SURFACE_PITCH_LIMIT, Math.min(SURFACE_PITCH_LIMIT, pitchRadians));

const tangentBasis = (up: Vec3) => {
  let north = normalize(projectToTangent(WORLD_NORTH, up));
  if (length(north) < EPSILON) {
    north = normalize(projectToTangent(WORLD_FALLBACK, up));
  }

  const east = normalize(cross(up, north));
  return { north, east };
};

const poseFromUpAndForward = (up: Vec3, radius: number, forwardHint: Vec3): SurfacePose => {
  const unitUp = normalize(up);
  let forward = normalize(projectToTangent(forwardHint, unitUp));

  if (length(forward) < EPSILON) {
    forward = tangentBasis(unitUp).north;
  }

  const right = normalize(cross(forward, unitUp));
  return {
    position: scale(unitUp, radius),
    up: unitUp,
    forward,
    right,
  };
};

export const createSurfacePose = (
  radius: number,
  latitudeRadians: number,
  longitudeRadians: number,
  headingRadians = 0,
): SurfacePose => {
  const cosLatitude = Math.cos(latitudeRadians);
  const up = normalize({
    x: cosLatitude * Math.cos(longitudeRadians),
    y: Math.sin(latitudeRadians),
    z: cosLatitude * Math.sin(longitudeRadians),
  });

  const { north, east } = tangentBasis(up);
  const forward = normalize(add(
    scale(north, Math.cos(headingRadians)),
    scale(east, Math.sin(headingRadians)),
  ));

  return poseFromUpAndForward(up, radius, forward);
};

export const moveSurfacePose = (
  pose: SurfacePose,
  radius: number,
  move: SurfaceMove,
): SurfacePose => {
  const lateral = add(
    scale(pose.forward, move.forwardDistance),
    scale(pose.right, move.rightDistance),
  );
  const distance = length(lateral);
  let nextUp = pose.up;
  let nextForward = pose.forward;

  if (distance > EPSILON) {
    const direction = scale(lateral, 1 / distance);
    const axis = normalize(cross(pose.up, direction));
    const angle = distance / radius;
    nextUp = normalize(rotateAroundAxis(pose.up, axis, angle));
    nextForward = rotateAroundAxis(pose.forward, axis, angle);
  }

  if (move.turnRadians) {
    nextForward = rotateAroundAxis(nextForward, nextUp, move.turnRadians);
  }

  return poseFromUpAndForward(nextUp, radius, nextForward);
};

export const turnSurfacePose = (
  pose: SurfacePose,
  yawRadians: number,
): SurfacePose => poseFromUpAndForward(
  pose.up,
  length(pose.position),
  rotateAroundAxis(pose.forward, pose.up, -yawRadians),
);

export const applySurfaceLookDrag = (
  state: SurfaceLookState,
  deltaX: number,
  deltaY: number,
  sensitivity: number,
): SurfaceLookState => ({
  pose: turnSurfacePose(state.pose, deltaX * sensitivity),
  pitch: clampSurfacePitch(state.pitch - deltaY * sensitivity),
});

export const getSurfaceViewFrame = (
  pose: SurfacePose,
  pitchRadians: number,
): SurfaceViewFrame => {
  const eyeUp = normalize(pose.up);
  let bodyForward = normalize(projectToTangent(pose.forward, eyeUp));

  if (length(bodyForward) < EPSILON) {
    bodyForward = tangentBasis(eyeUp).north;
  }

  const bodyRight = normalize(cross(bodyForward, eyeUp));
  const pitch = clampSurfacePitch(pitchRadians);
  const lookDirection = normalize(add(
    scale(bodyForward, Math.cos(pitch)),
    scale(eyeUp, Math.sin(pitch)),
  ));
  const headUp = normalize(add(
    scale(eyeUp, Math.cos(pitch)),
    scale(bodyForward, -Math.sin(pitch)),
  ));

  return {
    eyeUp,
    bodyForward,
    bodyRight,
    lookDirection,
    headUp,
  };
};

export const surfaceLatitudeLongitude = (pose: SurfacePose) => {
  const up = normalize(pose.position);
  return {
    latitudeRadians: Math.asin(Math.max(-1, Math.min(1, up.y))),
    longitudeRadians: Math.atan2(up.z, up.x),
  };
};

export const normalizeCompassDegrees = (degrees: number) => {
  const normalized = ((degrees + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
};

export const greatCircleDistanceRadians = (from: Vec3, to: Vec3) => {
  const fromVector = normalize(from);
  const toVector = normalize(to);
  return Math.acos(Math.max(-1, Math.min(1, dot(fromVector, toVector))));
};

export const bearingOffsetToSurfaceTarget = (
  pose: SurfacePose,
  targetUp: Vec3,
) => {
  const up = normalize(pose.up);
  const target = normalize(targetUp);
  const tangent = normalize(projectToTangent(target, up));
  if (length(tangent) < EPSILON) return 0;

  const forward = normalize(pose.forward);
  const right = normalize(pose.right);
  return Math.atan2(dot(tangent, right), dot(tangent, forward)) * 180 / Math.PI;
};

export const headingDegreesForSurfacePose = (pose: SurfacePose) => {
  const up = normalize(pose.up);
  const north = normalize(projectToTangent(WORLD_NORTH, up));
  if (length(north) < EPSILON) return 0;

  const east = normalize(cross(north, up));
  const forward = normalize(pose.forward);
  return (Math.atan2(dot(forward, east), dot(forward, north)) * 180 / Math.PI + 360) % 360;
};
