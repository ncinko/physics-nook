export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const MINUTE_PER_SECOND_SPEED = MINUTE_MS / SECOND_MS;
export const HOUR_PER_SECOND_SPEED = HOUR_MS / SECOND_MS;
export const DAY_PER_SECOND_SPEED = DAY_MS / SECOND_MS;

export const TIME_SPEED_PRESETS = [
  -DAY_PER_SECOND_SPEED,
  -HOUR_PER_SECOND_SPEED,
  -MINUTE_PER_SECOND_SPEED,
  1,
  MINUTE_PER_SECOND_SPEED,
  HOUR_PER_SECOND_SPEED,
  DAY_PER_SECOND_SPEED,
] as const;

export const advanceSimulationTime = (
  current: Date,
  elapsedRealMs: number,
  speedMultiplier: number,
  running: boolean,
): Date => {
  if (!running || speedMultiplier === 0 || elapsedRealMs === 0) {
    return new Date(current.getTime());
  }

  return new Date(current.getTime() + elapsedRealMs * speedMultiplier);
};

export const speedFromLogSlider = (value: number): number => {
  if (Math.abs(value) < 0.001) return 1;
  const sign = value < 0 ? -1 : 1;
  const magnitude = 10 ** Math.abs(value);
  return sign * magnitude;
};

export const formatSpeedLabel = (speedMultiplier: number): string => {
  if (speedMultiplier === 1) return '1x';
  if (speedMultiplier === -1) return '-1x';
  const sign = speedMultiplier < 0 ? '-' : '';
  const absolute = Math.abs(speedMultiplier);

  if (absolute >= DAY_PER_SECOND_SPEED) {
    return `${sign}${Math.round(absolute / DAY_PER_SECOND_SPEED)} days/s`;
  }
  if (absolute >= HOUR_PER_SECOND_SPEED) {
    return `${sign}${Math.round(absolute / HOUR_PER_SECOND_SPEED)} hours/s`;
  }
  if (absolute >= MINUTE_PER_SECOND_SPEED) {
    return `${sign}${Math.round(absolute / MINUTE_PER_SECOND_SPEED)} min/s`;
  }
  return `${speedMultiplier.toFixed(1)}x`;
};
