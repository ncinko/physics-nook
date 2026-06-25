import type { AstronomyScaleMode } from './cameraControls.ts';
import type { Vec3 } from './ephemeris.ts';
import { normalizeVec3 } from './ephemeris.ts';

export interface BinaryStarSnapshot {
  position: Vec3;
  radius: number;
  radiusKm: number;
  label: string;
  color: number;
}

export interface BinarySystemSnapshot {
  date: Date;
  primaryStar: BinaryStarSnapshot;
  secondaryStar: BinaryStarSnapshot;
  planetPosition: Vec3;
  moonPosition: Vec3;
  planetRadius: number;
  moonRadius: number;
  planetPath: Vec3[];
  moonPath: Vec3[];
  primaryDirectionFromMoon: Vec3;
  secondaryDirectionFromMoon: Vec3;
  primaryDistanceFromMoonKm: number;
  secondaryDistanceFromMoonKm: number;
}

export const BINARY_DISTANCE_UNIT_KM = 1_000_000;
export const BINARY_PATH_SAMPLE_COUNT = 145;
export const BINARY_PRIMARY_STAR_RADIUS_KM = 810_000;
export const BINARY_SECONDARY_STAR_RADIUS_KM = 480_000;

const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;
const BINARY_STAR_PERIOD_DAYS = 19.4;
const BINARY_PLANET_PERIOD_DAYS = 268;
const BINARY_MOON_PERIOD_DAYS = 17.8;
const BINARY_STAR_SEPARATION = 34;
const PRIMARY_MASS = 1.1;
const SECONDARY_MASS = 0.72;
const PLANET_ORBIT_RADIUS = 320;
const MOON_ORBIT_RADIUS = 28;
const PLANET_ORBIT_INCLINATION = 0.08;
const MOON_ORBIT_INCLINATION = 0.22;

const add = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});

const subtract = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

const scale = (vector: Vec3, amount: number): Vec3 => ({
  x: vector.x * amount,
  y: vector.y * amount,
  z: vector.z * amount,
});

const length = (vector: Vec3): number =>
  Math.hypot(vector.x, vector.y, vector.z);

const orbitAngle = (
  date: Date,
  periodDays: number,
  phaseRadians = 0,
): number => {
  const turns = (date.getTime() - J2000_MS) / (periodDays * DAY_MS);
  return turns * Math.PI * 2 + phaseRadians;
};

const orbitPoint = (
  radius: number,
  angle: number,
  yInclination = 0,
  eccentricity = 0,
): Vec3 => {
  const radialScale = 1 - eccentricity * Math.cos(angle);
  return {
    x: Math.cos(angle) * radius * radialScale,
    y: Math.sin(angle) * radius * yInclination,
    z: Math.sin(angle) * radius * radialScale,
  };
};

const getStarPositions = (date: Date) => {
  const angle = orbitAngle(date, BINARY_STAR_PERIOD_DAYS, 0.45);
  const primaryDistance = BINARY_STAR_SEPARATION * SECONDARY_MASS / (PRIMARY_MASS + SECONDARY_MASS);
  const secondaryDistance = BINARY_STAR_SEPARATION * PRIMARY_MASS / (PRIMARY_MASS + SECONDARY_MASS);
  const axis = orbitPoint(1, angle, 0.05);

  return {
    primary: scale(axis, -primaryDistance),
    secondary: scale(axis, secondaryDistance),
  };
};

export const getBinaryPlanetPosition = (date: Date): Vec3 =>
  orbitPoint(PLANET_ORBIT_RADIUS, orbitAngle(date, BINARY_PLANET_PERIOD_DAYS, -0.7), PLANET_ORBIT_INCLINATION, 0.05);

export const getBinaryMoonRelativePosition = (date: Date): Vec3 =>
  orbitPoint(MOON_ORBIT_RADIUS, orbitAngle(date, BINARY_MOON_PERIOD_DAYS, 1.25), MOON_ORBIT_INCLINATION, 0.04);

export const getBinaryMoonPosition = (date: Date): Vec3 =>
  add(getBinaryPlanetPosition(date), getBinaryMoonRelativePosition(date));

export const sampleBinaryPath = (
  date: Date,
  periodDays: number,
  getPosition: (date: Date) => Vec3,
  sampleCount = BINARY_PATH_SAMPLE_COUNT,
): Vec3[] => {
  const count = Math.max(3, Math.floor(sampleCount));
  const startTime = date.getTime() - (periodDays * DAY_MS) / 2;
  const stepMs = (periodDays * DAY_MS) / (count - 1);
  return Array.from({ length: count }, (_, index) =>
    getPosition(new Date(startTime + stepMs * index)));
};

export const binaryModelDistanceKm = (a: Vec3, b: Vec3): number =>
  length(subtract(a, b)) * BINARY_DISTANCE_UNIT_KM;

export const binarySceneScale = (_scaleMode: AstronomyScaleMode): number => 1;

export const scaleBinaryScenePosition = (
  position: Vec3,
  scaleMode: AstronomyScaleMode,
): Vec3 => scale(position, binarySceneScale(scaleMode));

export const getBinarySystemSnapshot = (date: Date): BinarySystemSnapshot => {
  const stars = getStarPositions(date);
  const planetPosition = getBinaryPlanetPosition(date);
  const moonPosition = add(planetPosition, getBinaryMoonRelativePosition(date));
  const primaryOffset = subtract(stars.primary, moonPosition);
  const secondaryOffset = subtract(stars.secondary, moonPosition);

  return {
    date,
    primaryStar: {
      position: stars.primary,
      radius: 4.5,
      radiusKm: BINARY_PRIMARY_STAR_RADIUS_KM,
      label: 'Primary star',
      color: 0xffc46b,
    },
    secondaryStar: {
      position: stars.secondary,
      radius: 2.9,
      radiusKm: BINARY_SECONDARY_STAR_RADIUS_KM,
      label: 'Secondary star',
      color: 0xaed7ff,
    },
    planetPosition,
    moonPosition,
    planetRadius: 7.8,
    moonRadius: 2.35,
    planetPath: sampleBinaryPath(date, BINARY_PLANET_PERIOD_DAYS, getBinaryPlanetPosition),
    moonPath: sampleBinaryPath(date, BINARY_MOON_PERIOD_DAYS, getBinaryMoonPosition),
    primaryDirectionFromMoon: normalizeVec3(primaryOffset),
    secondaryDirectionFromMoon: normalizeVec3(secondaryOffset),
    primaryDistanceFromMoonKm: length(primaryOffset) * BINARY_DISTANCE_UNIT_KM,
    secondaryDistanceFromMoonKm: length(secondaryOffset) * BINARY_DISTANCE_UNIT_KM,
  };
};
