export interface MotionState {
  x: number;
  v: number;
  a: number;
}

export interface HistoryPoint extends MotionState {
  t: number;
}

export interface StopZoneState {
  center: number;
  halfWidth: number;
  dwell: number;
  stops: number;
  deadline: number;
  gameOver: boolean;
  won: boolean;
}

export interface ScoreValidationResult {
  ok: boolean;
  name: string;
  timeMs: number;
  stops: number;
  errors: string[];
}

export const STOP_ZONE_DEFAULTS = {
  aMax: 4,
  worldHalfWidthM: 6,
  startZoneHalfWidthM: 1.2,
  minZoneHalfWidthM: 0.25,
  shrinkFactor: 0.93,
  velocityThresholdMps: 0.35,
  holdTimeS: 0.5,
  firstZoneTimeS: 10,
  zoneTimeIncrementS: 3,
  winStops: 15,
  historySeconds: 12,
  minScoreTimeMs: 8000,
  maxScoreTimeMs: 10 * 60 * 1000,
  leaderboardLimit: 10,
  localStorageKey: 'physics-nook-kinematics-local-leaderboard-v1',
} as const;

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const wrapDelta = (
  value: number,
  target: number,
  worldHalfWidth = STOP_ZONE_DEFAULTS.worldHalfWidthM,
) => {
  let delta = value - target;
  const circumference = worldHalfWidth * 2;

  if (delta > worldHalfWidth) {
    delta -= circumference;
  }

  if (delta < -worldHalfWidth) {
    delta += circumference;
  }

  return delta;
};

export const wrapPosition = (
  value: number,
  worldHalfWidth = STOP_ZONE_DEFAULTS.worldHalfWidthM,
) => {
  const circumference = worldHalfWidth * 2;
  let next = value;

  while (next < -worldHalfWidth) {
    next += circumference;
  }

  while (next > worldHalfWidth) {
    next -= circumference;
  }

  return next;
};

export const isInsideStopZone = (
  position: number,
  zoneCenter: number,
  zoneHalfWidth: number,
  worldHalfWidth = STOP_ZONE_DEFAULTS.worldHalfWidthM,
) => Math.abs(wrapDelta(position, zoneCenter, worldHalfWidth)) <= zoneHalfWidth;

export const isSlowEnoughForStop = (
  velocity: number,
  threshold = STOP_ZONE_DEFAULTS.velocityThresholdMps,
) => Math.abs(velocity) <= threshold;

export const advanceDwell = ({
  currentDwell,
  dt,
  inside,
  velocity,
  velocityThreshold = STOP_ZONE_DEFAULTS.velocityThresholdMps,
  holdTime = STOP_ZONE_DEFAULTS.holdTimeS,
}: {
  currentDwell: number;
  dt: number;
  inside: boolean;
  velocity: number;
  velocityThreshold?: number;
  holdTime?: number;
}) => {
  const slow = isSlowEnoughForStop(velocity, velocityThreshold);
  const nextDwell = inside && slow ? currentDwell + dt : 0;

  return {
    dwell: nextDwell,
    slow,
    stopComplete: currentDwell < holdTime && nextDwell >= holdTime,
  };
};

export const shrinkZoneHalfWidth = (
  currentHalfWidth: number,
  minHalfWidth = STOP_ZONE_DEFAULTS.minZoneHalfWidthM,
  shrinkFactor = STOP_ZONE_DEFAULTS.shrinkFactor,
) => Math.max(minHalfWidth, currentHalfWidth * shrinkFactor);

export const chooseNextZoneCenter = ({
  currentPosition,
  worldHalfWidth = STOP_ZONE_DEFAULTS.worldHalfWidthM,
  minSeparation = 1.2,
  random = Math.random,
}: {
  currentPosition: number;
  worldHalfWidth?: number;
  minSeparation?: number;
  random?: () => number;
}) => {
  let candidate = 0;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    candidate = (random() * 2 - 1) * (worldHalfWidth - 0.5);

    if (Math.abs(wrapDelta(candidate, currentPosition, worldHalfWidth)) > minSeparation) {
      break;
    }
  }

  return candidate;
};

export const sanitizeLeaderboardName = (name: unknown, fallback = 'Player') => {
  const value = typeof name === 'string' ? name : '';
  const collapsed = value.replace(/\s+/g, ' ').trim();

  return (collapsed || fallback).slice(0, 24);
};

export const validateScoreSubmission = (payload: {
  name?: unknown;
  timeMs?: unknown;
  stops?: unknown;
}): ScoreValidationResult => {
  const errors: string[] = [];
  const name = sanitizeLeaderboardName(payload.name);
  const timeMs = Number(payload.timeMs);
  const stops = Number(payload.stops);

  if (!Number.isInteger(timeMs)) {
    errors.push('timeMs must be an integer.');
  } else if (
    timeMs < STOP_ZONE_DEFAULTS.minScoreTimeMs ||
    timeMs > STOP_ZONE_DEFAULTS.maxScoreTimeMs
  ) {
    errors.push('timeMs is outside the accepted range.');
  }

  if (!Number.isInteger(stops) || stops !== STOP_ZONE_DEFAULTS.winStops) {
    errors.push(`stops must equal ${STOP_ZONE_DEFAULTS.winStops}.`);
  }

  return {
    ok: errors.length === 0,
    name,
    timeMs,
    stops,
    errors,
  };
};

export const formatSeconds = (timeMs: number | null) =>
  timeMs === null ? '--' : `${(timeMs / 1000).toFixed(2)} s`;
