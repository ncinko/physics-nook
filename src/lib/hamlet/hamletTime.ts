/**
 * Hamlet the hamster keeps a single, globally shared schedule: he lives on
 * Pacific time. Everyone watching the `/hamlet` scene — wherever they are —
 * sees the same hamster at the same moment, running his wheel through the
 * Pacific day and curled asleep through the Pacific night.
 *
 * This module is pure and DOM-free so the day/night logic can be unit tested.
 * The Pacific conversion uses `Intl.DateTimeFormat` with the IANA zone, which
 * handles PST/PDT (daylight saving) automatically for any input instant.
 */

export const PACIFIC_TIME_ZONE = 'America/Los_Angeles';

/** Hamlet wakes at 07:00 PT and turns in at 19:00 PT. */
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 19;

const MINUTES_PER_DAY = 24 * 60;
const DAY_START_MIN = DAY_START_HOUR * 60;
const DAY_END_MIN = DAY_END_HOUR * 60;
const DAY_LENGTH_MIN = DAY_END_MIN - DAY_START_MIN;
const NIGHT_LENGTH_MIN = MINUTES_PER_DAY - DAY_LENGTH_MIN;

export type HamletPhase = 'day' | 'night';

export interface PacificClock {
  /** Hour in Pacific time, 0–23. */
  hour: number;
  /** Minute in Pacific time, 0–59. */
  minute: number;
}

export interface HamletTimeState {
  phase: HamletPhase;
  clock: PacificClock;
  /** Minutes since Pacific midnight, 0–1439. */
  minutesSinceMidnight: number;
  /**
   * Progress through the *current* phase, 0–1. For `day` this runs from
   * sunrise (0) to sunset (1); for `night` from dusk (0) to dawn (1). Useful
   * for arcing a sun or moon across the sky.
   */
  phaseProgress: number;
}

const pacificFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TIME_ZONE,
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
});

/** Read the wall-clock hour and minute in Pacific time for a given instant. */
export const getPacificClock = (date: Date = new Date()): PacificClock => {
  const parts = pacificFormatter.formatToParts(date);
  const valueOf = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';

  // `hour12: false` can render midnight as "24" in some ICU builds; fold it back.
  let hour = Number(valueOf('hour')) % 24;
  if (!Number.isFinite(hour)) hour = 0;
  const minute = Number(valueOf('minute'));

  return { hour, minute: Number.isFinite(minute) ? minute : 0 };
};

/** Resolve Hamlet's full time state (phase + clock + animation progress). */
export const getHamletTime = (date: Date = new Date()): HamletTimeState => {
  const clock = getPacificClock(date);
  const minutesSinceMidnight = clock.hour * 60 + clock.minute;
  const isDay = minutesSinceMidnight >= DAY_START_MIN && minutesSinceMidnight < DAY_END_MIN;

  let phaseProgress: number;
  if (isDay) {
    phaseProgress = (minutesSinceMidnight - DAY_START_MIN) / DAY_LENGTH_MIN;
  } else {
    // Night wraps past midnight: minutes elapsed since dusk (19:00 PT).
    const sinceDusk =
      minutesSinceMidnight >= DAY_END_MIN
        ? minutesSinceMidnight - DAY_END_MIN
        : minutesSinceMidnight + (MINUTES_PER_DAY - DAY_END_MIN);
    phaseProgress = sinceDusk / NIGHT_LENGTH_MIN;
  }

  return {
    phase: isDay ? 'day' : 'night',
    clock,
    minutesSinceMidnight,
    phaseProgress,
  };
};

/** Convenience for the simple `'day' | 'night'` question. */
export const getHamletPhase = (date: Date = new Date()): HamletPhase => getHamletTime(date).phase;

/** Format a Pacific clock as a friendly 12-hour label, e.g. "2:09 PM". */
export const formatPacificClock = (clock: PacificClock): string => {
  const suffix = clock.hour < 12 ? 'AM' : 'PM';
  const hour12 = clock.hour % 12 === 0 ? 12 : clock.hour % 12;
  const minute = String(clock.minute).padStart(2, '0');
  return `${hour12}:${minute} ${suffix}`;
};
