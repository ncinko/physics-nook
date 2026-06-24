import {
  type AstroTime,
  Body,
  type EclipseKind,
  GeoVector,
  Illumination,
  KM_PER_AU,
  MoonPhase,
  NextGlobalSolarEclipse,
  NextLunarEclipse,
  SearchGlobalSolarEclipse,
  SearchLunarEclipse,
} from 'astronomy-engine';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MoonPhaseSummary {
  longitudeDegrees: number;
  illuminationFraction: number;
  phaseName: string;
  waxing: boolean;
}

export interface EclipseState {
  type: 'solar' | 'lunar';
  kind: string;
  peak: Date;
  intensity: number;
  label: string;
}

export interface SurfaceSkyState {
  sunAltitude: number;
  daylight: number;
  twilight: number;
  night: number;
}

interface EclipseCandidate {
  type: 'solar' | 'lunar';
  kind: string;
  peak: Date;
  windowMs: number;
  label: string;
}

export interface EarthMoonSunSnapshot {
  date: Date;
  moonGeocentricKm: Vec3;
  sunGeocentricKm: Vec3;
  moonPathGeocentricKm: Vec3[];
  moonDistanceKm: number;
  sunDistanceKm: number;
  sunDirection: Vec3;
  phase: MoonPhaseSummary;
  eclipseState: EclipseState | null;
  surfaceSky: SurfaceSkyState;
  earthRotationRadians: number;
  moonRotationRadians: number;
}

export const EARTH_RADIUS_KM = 6371;
export const MOON_RADIUS_KM = 1737.4;
export const MEAN_MOON_DISTANCE_KM = 384400;
export const EARTH_SIDEREAL_DAY_MS = 86164.0905 * 1000;
export const MOON_SYNODIC_PERIOD_DAYS = 29.530588853;
export const MOON_SIDEREAL_PERIOD_DAYS = 27.321661;
export const MOON_PATH_SAMPLE_COUNT = 145;

const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;
const ECLIPSE_SEARCH_BACK_DAYS = 40;
const SOLAR_ECLIPSE_WINDOW_MS = 8 * 60 * 60 * 1000;
const LUNAR_MINIMUM_WINDOW_MS = 4 * 60 * 60 * 1000;
const MOON_PATH_CACHE_STEP_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 32;

const moonPathCache = new Map<number, Vec3[]>();
const eclipseCandidateCache = new Map<number, EclipseCandidate[]>();

const vectorLength = (vector: Vec3) =>
  Math.hypot(vector.x, vector.y, vector.z);

export const normalizeVec3 = (vector: Vec3): Vec3 => {
  const length = vectorLength(vector);
  if (length === 0) return { x: 0, y: 0, z: 0 };
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
};

const toSceneKilometers = (vector: { x: number; y: number; z: number }): Vec3 => ({
  x: vector.x * KM_PER_AU,
  y: vector.z * KM_PER_AU,
  z: -vector.y * KM_PER_AU,
});

export const normalizeDegrees = (degrees: number): number => {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
};

export const moonIlluminationFromLongitude = (longitudeDegrees: number): number => {
  const phaseRadians = normalizeDegrees(longitudeDegrees) * Math.PI / 180;
  return (1 - Math.cos(phaseRadians)) / 2;
};

export const moonPhaseNameFromLongitude = (longitudeDegrees: number): string => {
  const longitude = normalizeDegrees(longitudeDegrees);

  if (longitude < 22.5 || longitude >= 337.5) return 'New Moon';
  if (longitude < 67.5) return 'Waxing Crescent';
  if (longitude < 112.5) return 'First Quarter';
  if (longitude < 157.5) return 'Waxing Gibbous';
  if (longitude < 202.5) return 'Full Moon';
  if (longitude < 247.5) return 'Waning Gibbous';
  if (longitude < 292.5) return 'Third Quarter';
  return 'Waning Crescent';
};

export const getMoonPhaseSummary = (date: Date): MoonPhaseSummary => {
  const longitudeDegrees = normalizeDegrees(MoonPhase(date));
  const illumination = Illumination(Body.Moon, date);

  return {
    longitudeDegrees,
    illuminationFraction: illumination.phase_fraction,
    phaseName: moonPhaseNameFromLongitude(longitudeDegrees),
    waxing: longitudeDegrees > 0 && longitudeDegrees < 180,
  };
};

export const sampleMoonPathGeocentricKm = (
  date: Date,
  sampleCount = MOON_PATH_SAMPLE_COUNT,
  spanDays = MOON_SIDEREAL_PERIOD_DAYS,
): Vec3[] => {
  const usesDefaultWindow = sampleCount === MOON_PATH_SAMPLE_COUNT && spanDays === MOON_SIDEREAL_PERIOD_DAYS;
  const cacheKey = Math.round(date.getTime() / MOON_PATH_CACHE_STEP_MS);
  if (usesDefaultWindow) {
    const cached = moonPathCache.get(cacheKey);
    if (cached) return cached;
  }

  const count = Math.max(3, Math.floor(sampleCount));
  const startTime = date.getTime() - (spanDays * DAY_MS) / 2;
  const stepMs = (spanDays * DAY_MS) / (count - 1);

  const samples = Array.from({ length: count }, (_, index) => (
    toSceneKilometers(GeoVector(Body.Moon, new Date(startTime + index * stepMs), false))
  ));

  if (usesDefaultWindow) {
    moonPathCache.set(cacheKey, samples);
    trimCache(moonPathCache);
  }

  return samples;
};

const titleCase = (value: string) =>
  value.slice(0, 1).toUpperCase() + value.slice(1);

const eclipseIntensity = (date: Date, peak: Date, windowMs: number) => {
  const offset = Math.abs(date.getTime() - peak.getTime());
  if (offset > windowMs) return 0;
  return Math.max(0, Math.min(1, 1 - offset / windowMs));
};

const normalizeEclipseKind = (kind: EclipseKind | string) =>
  typeof kind === 'string' ? kind : String(kind);

const toDate = (time: AstroTime) => new Date(time.date);

export const getEclipseState = (date: Date): EclipseState | null => {
  const candidates = getEclipseCandidates(date)
    .map((candidate): EclipseState | null => {
      const intensity = eclipseIntensity(date, candidate.peak, candidate.windowMs);
      if (intensity <= 0) return null;
      return {
        type: candidate.type,
        kind: candidate.kind,
        peak: candidate.peak,
        intensity,
        label: candidate.label,
      };
    })
    .filter((candidate): candidate is EclipseState => candidate !== null);

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.intensity - a.intensity)[0];
};

const getEclipseCandidates = (date: Date): EclipseCandidate[] => {
  const cacheKey = Math.floor(date.getTime() / DAY_MS);
  const cached = eclipseCandidateCache.get(cacheKey);
  if (cached) return cached;

  const searchStart = new Date(cacheKey * DAY_MS - ECLIPSE_SEARCH_BACK_DAYS * DAY_MS);
  const candidates: EclipseCandidate[] = [];

  let lunar = SearchLunarEclipse(searchStart);
  for (let index = 0; index < 4; index += 1) {
    const peak = toDate(lunar.peak);
    const windowMs = Math.max(
      LUNAR_MINIMUM_WINDOW_MS,
      lunar.sd_penum * 60 * 1000,
    );
    const kind = normalizeEclipseKind(lunar.kind);
    candidates.push({
      type: 'lunar',
      kind,
      peak,
      windowMs,
      label: `Lunar eclipse - ${titleCase(kind)}`,
    });
    if (peak.getTime() > (cacheKey + 1) * DAY_MS + LUNAR_MINIMUM_WINDOW_MS) break;
    lunar = NextLunarEclipse(lunar.peak);
  }

  let solar = SearchGlobalSolarEclipse(searchStart);
  for (let index = 0; index < 4; index += 1) {
    const peak = toDate(solar.peak);
    const kind = normalizeEclipseKind(solar.kind);
    candidates.push({
      type: 'solar',
      kind,
      peak,
      windowMs: SOLAR_ECLIPSE_WINDOW_MS,
      label: `Solar eclipse - ${titleCase(kind)}`,
    });
    if (peak.getTime() > (cacheKey + 1) * DAY_MS + SOLAR_ECLIPSE_WINDOW_MS) break;
    solar = NextGlobalSolarEclipse(solar.peak);
  }

  eclipseCandidateCache.set(cacheKey, candidates);
  trimCache(eclipseCandidateCache);
  return candidates;
};

export const getSurfaceSkyState = (
  sunDirection: Vec3,
  surfaceUp: Vec3,
): SurfaceSkyState => {
  const sunAltitude = Math.max(-1, Math.min(1, dotVec3(
    normalizeVec3(sunDirection),
    normalizeVec3(surfaceUp),
  )));
  const daylight = smoothstep(-0.06, 0.16, sunAltitude);
  const twilight = smoothstep(-0.24, 0.08, sunAltitude) * (1 - smoothstep(0.12, 0.38, sunAltitude));
  const night = 1 - smoothstep(-0.2, 0.04, sunAltitude);

  return {
    sunAltitude,
    daylight,
    twilight,
    night,
  };
};

export const rotationAngleForDate = (
  date: Date,
  periodMs: number,
  phaseRadians = 0,
): number => {
  const turns = (date.getTime() - J2000_MS) / periodMs;
  return normalizeDegrees(turns * 360) * Math.PI / 180 + phaseRadians;
};

const dotVec3 = (a: Vec3, b: Vec3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const amount = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
};

const trimCache = <T>(cache: Map<number, T>) => {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey === undefined) return;
    cache.delete(firstKey);
  }
};

export const getEarthMoonSunSnapshot = (date: Date): EarthMoonSunSnapshot => {
  const moonVector = toSceneKilometers(GeoVector(Body.Moon, date, false));
  const sunVector = toSceneKilometers(GeoVector(Body.Sun, date, false));
  const moonDistanceKm = vectorLength(moonVector);
  const sunDistanceKm = vectorLength(sunVector);
  const sunDirection = normalizeVec3(sunVector);

  return {
    date,
    moonGeocentricKm: moonVector,
    sunGeocentricKm: sunVector,
    moonPathGeocentricKm: sampleMoonPathGeocentricKm(date),
    moonDistanceKm,
    sunDistanceKm,
    sunDirection,
    phase: getMoonPhaseSummary(date),
    eclipseState: getEclipseState(date),
    surfaceSky: getSurfaceSkyState(sunDirection, { x: 0, y: 1, z: 0 }),
    earthRotationRadians: rotationAngleForDate(date, EARTH_SIDEREAL_DAY_MS),
    moonRotationRadians: rotationAngleForDate(
      date,
      MOON_SYNODIC_PERIOD_DAYS * DAY_MS,
      Math.PI,
    ),
  };
};
