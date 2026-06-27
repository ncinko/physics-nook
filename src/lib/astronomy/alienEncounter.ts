import type { Vec3 } from './ephemeris.ts';
import {
  dot,
  length,
  moveSurfacePose,
  normalize,
  projectToTangent,
  type SurfacePose,
} from './surfaceNavigation.ts';

export type AlienWorldMode = 'earthMoonSun' | 'binarySystem';

const subtract = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

export const isAlienCaught = (
  playerPose: SurfacePose,
  alienPose: SurfacePose,
  catchDistance: number,
): boolean => length(subtract(playerPose.position, alienPose.position)) <= catchDistance;

export const moveAlienTowardPose = (
  alienPose: SurfacePose,
  targetPose: SurfacePose,
  radius: number,
  moveDistance: number,
): SurfacePose => {
  const towardTarget = projectToTangent(
    subtract(targetPose.position, alienPose.position),
    alienPose.up,
  );
  const walkDirection = length(towardTarget) > 1e-9
    ? normalize(towardTarget)
    : alienPose.forward;

  return moveSurfacePose(alienPose, radius, {
    forwardDistance: dot(walkDirection, alienPose.forward) * moveDistance,
    rightDistance: dot(walkDirection, alienPose.right) * moveDistance,
  });
};

export const spawnAlienNearPlayer = (
  playerPose: SurfacePose,
  radius: number,
): SurfacePose => moveSurfacePose(playerPose, radius, {
  forwardDistance: radius * 0.45,
  rightDistance: radius * 0.18,
});

const seededUnit = (seed: number, salt: number) => {
  const value = Math.sin(seed * 127.1 + salt * 311.7) * 43758.5453123;
  return value - Math.floor(value);
};

export const spawnAlienFarFromPlayer = (
  playerPose: SurfacePose,
  radius: number,
  seed = 0,
): SurfacePose => {
  const forwardSign = seededUnit(seed, 1) > 0.5 ? 1 : -1;
  const forwardDistance = radius * forwardSign * (1.25 + seededUnit(seed, 2) * 0.62);
  const rightDistance = radius * (seededUnit(seed, 3) - 0.5) * 0.9;
  const turnRadians = (seededUnit(seed, 4) - 0.5) * Math.PI * 2;

  return moveSurfacePose(playerPose, radius, {
    forwardDistance,
    rightDistance,
    turnRadians,
  });
};

export const nextAlienWorldMode = (worldMode: AlienWorldMode): AlienWorldMode =>
  worldMode === 'earthMoonSun' ? 'binarySystem' : 'earthMoonSun';

export const surfaceDirectionToWorld = (
  pose: SurfacePose,
  direction: Vec3,
): Vec3 => ({
  x: pose.forward.x * direction.x + pose.up.x * direction.y + pose.right.x * direction.z,
  y: pose.forward.y * direction.x + pose.up.y * direction.y + pose.right.y * direction.z,
  z: pose.forward.z * direction.x + pose.up.z * direction.y + pose.right.z * direction.z,
});

export const moveAlongDirection = (origin: Vec3, direction: Vec3, distance: number): Vec3 => {
  const unit = normalize(direction);
  return {
    x: origin.x + unit.x * distance,
    y: origin.y + unit.y * distance,
    z: origin.z + unit.z * distance,
  };
};
