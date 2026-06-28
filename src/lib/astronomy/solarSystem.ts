import {
  Body,
  GeoVector,
  HelioVector,
  KM_PER_AU,
} from 'astronomy-engine';

import {
  EARTH_RADIUS_KM,
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
  earthRotationAngleForDate,
  rotationAngleForDate,
  type Vec3,
} from './ephemeris.ts';
import { DAY_MS } from './time.ts';
import {
  add,
  length,
  normalize,
  scale,
} from './surfaceNavigation.ts';

export const SOLAR_SYSTEM_AU_KM = KM_PER_AU;
export const SOLAR_ORBIT_SAMPLE_COUNT = 96;
export const SOLAR_TRUE_DISTANCE_UNITS_PER_AU = 68;

export const SOLAR_SYSTEM_BODY_IDS = [
  'sun',
  'mercury',
  'venus',
  'earth',
  'moon',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
] as const;

export type SolarSystemBodyId = typeof SOLAR_SYSTEM_BODY_IDS[number];
export type SolarSystemScaleMode = 'compact' | 'true';

export interface SolarSystemBodyDefinition {
  id: SolarSystemBodyId;
  label: string;
  astronomyBody: Body | null;
  parentId: SolarSystemBodyId | null;
  radiusKm: number;
  sceneRadius: number;
  color: number;
  accentColor: number;
  orbitalPeriodDays: number | null;
  rotationPeriodHours: number | null;
  landable: boolean;
  hasRings?: boolean;
  hasBands?: boolean;
  hasAtmosphere?: boolean;
}

export interface SolarSystemBodySnapshot {
  id: SolarSystemBodyId;
  definition: SolarSystemBodyDefinition;
  heliocentricKm: Vec3;
  distanceFromSunKm: number;
  distanceFromParentKm: number;
  orbitPathKm: Vec3[];
  parentPathKm?: Vec3[];
  rotationRadians: number;
}

export interface SolarSystemSnapshot {
  date: Date;
  bodies: SolarSystemBodySnapshot[];
  bodyMap: Record<SolarSystemBodyId, SolarSystemBodySnapshot>;
}

interface CachedOrbitPath {
  orbitPathKm: Vec3[];
  parentPathKm?: Vec3[];
}

const HOUR_MS = 60 * 60 * 1000;
const ORBIT_PATH_CACHE_STEP_MS = 12 * 60 * 60 * 1000;
const MAX_ORBIT_PATH_CACHE_ENTRIES = 48;

const orbitPathCache = new Map<string, CachedOrbitPath>();

export const SOLAR_SYSTEM_BODIES: Record<SolarSystemBodyId, SolarSystemBodyDefinition> = {
  sun: {
    id: 'sun',
    label: 'Sun',
    astronomyBody: Body.Sun,
    parentId: null,
    radiusKm: SUN_RADIUS_KM,
    sceneRadius: 18,
    color: 0xffd37a,
    accentColor: 0xfff0b8,
    orbitalPeriodDays: null,
    rotationPeriodHours: 609.12,
    landable: false,
  },
  mercury: {
    id: 'mercury',
    label: 'Mercury',
    astronomyBody: Body.Mercury,
    parentId: null,
    radiusKm: 2439.7,
    sceneRadius: 2.2,
    color: 0xb7ada2,
    accentColor: 0xe5ded5,
    orbitalPeriodDays: 87.969,
    rotationPeriodHours: 1407.5,
    landable: true,
  },
  venus: {
    id: 'venus',
    label: 'Venus',
    astronomyBody: Body.Venus,
    parentId: null,
    radiusKm: 6051.8,
    sceneRadius: 3.8,
    color: 0xd9b26f,
    accentColor: 0xffe0a3,
    orbitalPeriodDays: 224.701,
    rotationPeriodHours: -5832.5,
    landable: true,
    hasAtmosphere: true,
  },
  earth: {
    id: 'earth',
    label: 'Earth',
    astronomyBody: Body.Earth,
    parentId: null,
    radiusKm: EARTH_RADIUS_KM,
    sceneRadius: 4.2,
    color: 0x4f9fe8,
    accentColor: 0xb9ecff,
    orbitalPeriodDays: 365.256,
    rotationPeriodHours: 23.934,
    landable: true,
    hasAtmosphere: true,
  },
  moon: {
    id: 'moon',
    label: 'Moon',
    astronomyBody: Body.Moon,
    parentId: 'earth',
    radiusKm: MOON_RADIUS_KM,
    sceneRadius: 1.35,
    color: 0xb9b6ad,
    accentColor: 0xe5e7eb,
    orbitalPeriodDays: 27.321661,
    rotationPeriodHours: 655.72,
    landable: true,
  },
  mars: {
    id: 'mars',
    label: 'Mars',
    astronomyBody: Body.Mars,
    parentId: null,
    radiusKm: 3389.5,
    sceneRadius: 3,
    color: 0xc76941,
    accentColor: 0xf6b089,
    orbitalPeriodDays: 686.98,
    rotationPeriodHours: 24.623,
    landable: true,
  },
  jupiter: {
    id: 'jupiter',
    label: 'Jupiter',
    astronomyBody: Body.Jupiter,
    parentId: null,
    radiusKm: 69911,
    sceneRadius: 10.6,
    color: 0xd7b38a,
    accentColor: 0xffd6a3,
    orbitalPeriodDays: 4332.59,
    rotationPeriodHours: 9.925,
    landable: false,
    hasBands: true,
  },
  saturn: {
    id: 'saturn',
    label: 'Saturn',
    astronomyBody: Body.Saturn,
    parentId: null,
    radiusKm: 58232,
    sceneRadius: 9.1,
    color: 0xd9c38b,
    accentColor: 0xffebb6,
    orbitalPeriodDays: 10759.22,
    rotationPeriodHours: 10.656,
    landable: false,
    hasBands: true,
    hasRings: true,
  },
  uranus: {
    id: 'uranus',
    label: 'Uranus',
    astronomyBody: Body.Uranus,
    parentId: null,
    radiusKm: 25362,
    sceneRadius: 6.2,
    color: 0x91d8dd,
    accentColor: 0xc7fbff,
    orbitalPeriodDays: 30685.4,
    rotationPeriodHours: -17.24,
    landable: false,
    hasRings: true,
  },
  neptune: {
    id: 'neptune',
    label: 'Neptune',
    astronomyBody: Body.Neptune,
    parentId: null,
    radiusKm: 24622,
    sceneRadius: 6.1,
    color: 0x4976e8,
    accentColor: 0xaec6ff,
    orbitalPeriodDays: 60189,
    rotationPeriodHours: 16.11,
    landable: false,
    hasBands: true,
  },
  pluto: {
    id: 'pluto',
    label: 'Pluto',
    astronomyBody: Body.Pluto,
    parentId: null,
    radiusKm: 1188.3,
    sceneRadius: 1.3,
    color: 0xb48a6d,
    accentColor: 0xf1c7a7,
    orbitalPeriodDays: 90560,
    rotationPeriodHours: -153.3,
    landable: true,
  },
};

export const SOLAR_SYSTEM_BODY_LIST = SOLAR_SYSTEM_BODY_IDS.map(
  (id) => SOLAR_SYSTEM_BODIES[id],
);

const zeroVec3 = (): Vec3 => ({ x: 0, y: 0, z: 0 });

const subtractVec3 = (a: Vec3, b: Vec3): Vec3 => add(a, scale(b, -1));

const toSceneKilometers = (vector: { x: number; y: number; z: number }): Vec3 => ({
  x: vector.x * KM_PER_AU,
  y: vector.z * KM_PER_AU,
  z: -vector.y * KM_PER_AU,
});

const getOrbitCacheKey = (
  id: SolarSystemBodyId,
  date: Date,
  sampleCount: number,
): string => `${id}:${sampleCount}:${Math.round(date.getTime() / ORBIT_PATH_CACHE_STEP_MS)}`;

const trimOrbitCache = () => {
  while (orbitPathCache.size > MAX_ORBIT_PATH_CACHE_ENTRIES) {
    const firstKey = orbitPathCache.keys().next().value;
    if (firstKey === undefined) return;
    orbitPathCache.delete(firstKey);
  }
};

export const getSolarSystemBodyDefinition = (
  id: SolarSystemBodyId,
): SolarSystemBodyDefinition => SOLAR_SYSTEM_BODIES[id];

export const isSolarSystemBodyLandable = (id: SolarSystemBodyId): boolean =>
  SOLAR_SYSTEM_BODIES[id].landable;

export const getSolarSystemBodyHeliocentricKm = (
  id: SolarSystemBodyId,
  date: Date,
): Vec3 => {
  if (id === 'sun') return zeroVec3();
  if (id === 'moon') {
    return add(
      getSolarSystemBodyHeliocentricKm('earth', date),
      toSceneKilometers(GeoVector(Body.Moon, date, false)),
    );
  }

  const body = SOLAR_SYSTEM_BODIES[id].astronomyBody;
  if (!body) return zeroVec3();
  return toSceneKilometers(HelioVector(body, date));
};

export const getSolarSystemDistanceFromParentKm = (
  id: SolarSystemBodyId,
  positionKm: Vec3,
  positionsKm: Partial<Record<SolarSystemBodyId, Vec3>>,
): number => {
  const parentId = SOLAR_SYSTEM_BODIES[id].parentId;
  if (!parentId) return length(positionKm);
  const parentPosition = positionsKm[parentId];
  return parentPosition ? length(subtractVec3(positionKm, parentPosition)) : 0;
};

export const sampleSolarSystemOrbitPath = (
  id: SolarSystemBodyId,
  date: Date,
  sampleCount = SOLAR_ORBIT_SAMPLE_COUNT,
): CachedOrbitPath => {
  if (id === 'sun') return { orbitPathKm: [] };

  const count = Math.max(8, Math.floor(sampleCount));
  const cacheKey = getOrbitCacheKey(id, date, count);
  const cached = orbitPathCache.get(cacheKey);
  if (cached) return cached;

  const definition = SOLAR_SYSTEM_BODIES[id];
  const spanDays = Math.max(7, definition.orbitalPeriodDays ?? 365.256);
  const startTime = date.getTime() - (spanDays * DAY_MS) / 2;
  const stepMs = (spanDays * DAY_MS) / (count - 1);
  const parentPathKm: Vec3[] | undefined = definition.parentId ? [] : undefined;
  const orbitPathKm = Array.from({ length: count }, (_, index) => {
    const sampleDate = new Date(startTime + index * stepMs);
    if (definition.parentId && parentPathKm) {
      parentPathKm.push(getSolarSystemBodyHeliocentricKm(definition.parentId, sampleDate));
    }
    return getSolarSystemBodyHeliocentricKm(id, sampleDate);
  });
  const path = parentPathKm ? { orbitPathKm, parentPathKm } : { orbitPathKm };

  orbitPathCache.set(cacheKey, path);
  trimOrbitCache();
  return path;
};

export const getSolarSystemRotationRadians = (
  id: SolarSystemBodyId,
  date: Date,
): number => {
  if (id === 'earth') return earthRotationAngleForDate(date);

  const periodHours = SOLAR_SYSTEM_BODIES[id].rotationPeriodHours;
  if (!periodHours) return 0;

  const angle = rotationAngleForDate(date, Math.abs(periodHours) * HOUR_MS);
  return periodHours < 0 ? -angle : angle;
};

export const getSolarSystemSnapshot = (
  date: Date,
  sampleCount = SOLAR_ORBIT_SAMPLE_COUNT,
): SolarSystemSnapshot => {
  const positionsKm = {} as Record<SolarSystemBodyId, Vec3>;
  SOLAR_SYSTEM_BODY_IDS.forEach((id) => {
    positionsKm[id] = getSolarSystemBodyHeliocentricKm(id, date);
  });

  const bodyMap = {} as Record<SolarSystemBodyId, SolarSystemBodySnapshot>;
  SOLAR_SYSTEM_BODY_IDS.forEach((id) => {
    const path = sampleSolarSystemOrbitPath(id, date, sampleCount);
    const positionKm = positionsKm[id];
    bodyMap[id] = {
      id,
      definition: SOLAR_SYSTEM_BODIES[id],
      heliocentricKm: positionKm,
      distanceFromSunKm: length(positionKm),
      distanceFromParentKm: getSolarSystemDistanceFromParentKm(id, positionKm, positionsKm),
      orbitPathKm: path.orbitPathKm,
      parentPathKm: path.parentPathKm,
      rotationRadians: getSolarSystemRotationRadians(id, date),
    };
  });

  return {
    date,
    bodies: SOLAR_SYSTEM_BODY_IDS.map((id) => bodyMap[id]),
    bodyMap,
  };
};

export const solarSystemSceneDistanceForKilometers = (
  distanceKm: number,
  scaleMode: SolarSystemScaleMode,
): number => {
  if (distanceKm <= 0) return 0;
  const au = distanceKm / KM_PER_AU;

  if (scaleMode === 'true') {
    return au * SOLAR_TRUE_DISTANCE_UNITS_PER_AU;
  }

  return 34 + 76 * Math.sqrt(au) + 14 * Math.log10(1 + au);
};

export const solarSystemScenePositionFromKm = (
  positionKm: Vec3,
  scaleMode: SolarSystemScaleMode,
): Vec3 => {
  const distanceKm = length(positionKm);
  if (distanceKm === 0) return zeroVec3();

  return scale(
    normalize(positionKm),
    solarSystemSceneDistanceForKilometers(distanceKm, scaleMode),
  );
};

export const solarSystemMoonSceneOffsetForKilometers = (
  distanceKm: number,
  scaleMode: SolarSystemScaleMode,
): number => {
  if (scaleMode === 'true') {
    return Math.max(9.5, distanceKm / KM_PER_AU * SOLAR_TRUE_DISTANCE_UNITS_PER_AU);
  }

  return Math.max(10.5, Math.min(15, distanceKm / 384400 * 11.8));
};

export const getSolarSystemBodyScenePosition = (
  body: SolarSystemBodySnapshot,
  snapshot: SolarSystemSnapshot,
  scaleMode: SolarSystemScaleMode,
): Vec3 => {
  const parentId = body.definition.parentId;
  if (!parentId) {
    return solarSystemScenePositionFromKm(body.heliocentricKm, scaleMode);
  }

  const parent = snapshot.bodyMap[parentId];
  const parentScenePosition = solarSystemScenePositionFromKm(parent.heliocentricKm, scaleMode);
  const localOffsetKm = subtractVec3(body.heliocentricKm, parent.heliocentricKm);

  return add(
    parentScenePosition,
    scale(
      normalize(localOffsetKm),
      solarSystemMoonSceneOffsetForKilometers(length(localOffsetKm), scaleMode),
    ),
  );
};

export const getSolarSystemOrbitScenePoints = (
  body: SolarSystemBodySnapshot,
  scaleMode: SolarSystemScaleMode,
): Vec3[] => {
  const parentPath = body.parentPathKm;
  if (!parentPath) {
    return body.orbitPathKm.map((point) => solarSystemScenePositionFromKm(point, scaleMode));
  }

  return body.orbitPathKm.map((point, index) => {
    const parentPoint = parentPath[index] ?? parentPath[0];
    if (!parentPoint) return solarSystemScenePositionFromKm(point, scaleMode);
    const localOffsetKm = subtractVec3(point, parentPoint);
    return add(
      solarSystemScenePositionFromKm(parentPoint, scaleMode),
      scale(
        normalize(localOffsetKm),
        solarSystemMoonSceneOffsetForKilometers(length(localOffsetKm), scaleMode),
      ),
    );
  });
};
