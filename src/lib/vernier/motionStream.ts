/**
 * Conditioning a live ultrasonic distance stream into something you can plot.
 *
 * A sonar rangefinder does not fail gracefully. It returns a plausible-looking
 * number that happens to be an echo off a wall, a chair, or the second lobe of
 * its own pulse. Those show up as isolated spikes, and a naive derivative turns
 * one 30 cm spike into a 6 m/s velocity glitch that swamps the real signal. So
 * the pipeline is: reject implausible samples, interpolate short gaps, and take
 * velocity from a least-squares slope over a window rather than a difference
 * between neighbours.
 *
 * DOM-free and deterministic, so `tests/vernier` can drive it with synthetic
 * traces.
 */

import { fitPolynomial } from '../math/leastSquares.ts';
import { MOTION_DETECTOR_RANGE } from './sensorIds.ts';

export type SampleQuality = 'ok' | 'dropout';

export interface MotionSample {
  /** Seconds since the recording started. */
  t: number;
  /** Metres from the detector. */
  distance: number;
  quality: SampleQuality;
}

/**
 * No one walks at 4 m/s in front of a motion detector in a classroom. Anything
 * implying more than this between consecutive samples is an echo, not motion.
 */
export const MAX_PLAUSIBLE_SPEED = 4;

/** Gaps up to this long are bridged; longer ones stay holes. */
export const MAX_INTERPOLATED_GAP_SECONDS = 0.25;

/**
 * Half-width of the velocity fit window. At 20 Hz this is 11 samples, which
 * cuts the sonar's millimetre jitter down enough to read a walking speed while
 * still resolving the half-second turnarounds the target graphs ask for.
 */
export const VELOCITY_HALF_WINDOW_SECONDS = 0.25;

const inRange = (distance: number): boolean =>
  Number.isFinite(distance) &&
  distance >= MOTION_DETECTOR_RANGE.minMeters &&
  distance <= MOTION_DETECTOR_RANGE.maxMeters;

/**
 * Classifies one incoming reading against the last accepted one. Pass
 * `previous` as the most recent `quality === 'ok'` sample, or null to accept
 * the first plausible reading unconditionally.
 */
export const conditionSample = (
  previous: MotionSample | null,
  candidate: { t: number; distance: number },
): MotionSample => {
  if (!inRange(candidate.distance)) {
    return { t: candidate.t, distance: candidate.distance, quality: 'dropout' };
  }

  if (previous) {
    const dt = candidate.t - previous.t;
    // A non-positive dt means duplicated or reordered reports; treat the
    // reading as unverifiable rather than dividing by zero.
    if (dt <= 0) {
      return { t: candidate.t, distance: candidate.distance, quality: 'dropout' };
    }
    const impliedSpeed = Math.abs(candidate.distance - previous.distance) / dt;
    if (impliedSpeed > MAX_PLAUSIBLE_SPEED) {
      return { t: candidate.t, distance: candidate.distance, quality: 'dropout' };
    }
  }

  return { t: candidate.t, distance: candidate.distance, quality: 'ok' };
};

/** The most recent accepted sample, or null when the run has none yet. */
export const lastGoodSample = (samples: readonly MotionSample[]): MotionSample | null => {
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    if (samples[index].quality === 'ok') return samples[index];
  }
  return null;
};

/**
 * Bridges short dropout runs by linear interpolation between the good samples
 * on either side. Interpolated points are marked `'ok'` — they are as trustworthy
 * as their neighbours over a quarter second of walking. Longer holes, and any
 * dropout at the very start or end with nothing to interpolate from, stay
 * `'dropout'` so scoring can penalise them honestly.
 */
export const fillDropouts = (
  samples: readonly MotionSample[],
  maxGapSeconds = MAX_INTERPOLATED_GAP_SECONDS,
): MotionSample[] => {
  const filled = samples.map((sample) => ({ ...sample }));

  let index = 0;
  while (index < filled.length) {
    if (filled[index].quality === 'ok') {
      index += 1;
      continue;
    }

    const gapStart = index;
    let gapEnd = index;
    while (gapEnd < filled.length && filled[gapEnd].quality === 'dropout') gapEnd += 1;

    const before = gapStart > 0 ? filled[gapStart - 1] : null;
    const after = gapEnd < filled.length ? filled[gapEnd] : null;

    if (before && after && after.t - before.t <= maxGapSeconds) {
      const span = after.t - before.t;
      for (let inner = gapStart; inner < gapEnd; inner += 1) {
        const fraction = span > 0 ? (filled[inner].t - before.t) / span : 0;
        filled[inner] = {
          t: filled[inner].t,
          distance: before.distance + fraction * (after.distance - before.distance),
          quality: 'ok',
        };
      }
    }

    index = gapEnd;
  }

  return filled;
};

/**
 * Velocity at each sample from a least-squares line through everything inside
 * `±halfWindowSeconds`. Returns null where the window holds too few good
 * samples to fit — a blank, not a zero, because a zero would read as "standing
 * still" on a velocity graph.
 */
export const slidingVelocity = (
  samples: readonly MotionSample[],
  halfWindowSeconds = VELOCITY_HALF_WINDOW_SECONDS,
): (number | null)[] =>
  samples.map((sample) => velocityAt(samples, sample.t, halfWindowSeconds));

/** Velocity at one instant, fitted over the same window `slidingVelocity` uses. */
export const velocityAt = (
  samples: readonly MotionSample[],
  time: number,
  halfWindowSeconds = VELOCITY_HALF_WINDOW_SECONDS,
): number | null => {
  const window = samples.filter(
    (sample) => sample.quality === 'ok' && Math.abs(sample.t - time) <= halfWindowSeconds,
  );

  if (window.length < 3) return null;

  const fit = fitPolynomial(
    window.map((sample) => ({ x: sample.t, y: sample.distance })),
    1,
  );

  return fit.ok ? fit.fit.coefficients[1] : null;
};

/**
 * Trims a growing sample array to a trailing time window. Used for the live
 * readout, where only the last few seconds are on screen — the full recording
 * is kept separately for scoring.
 */
export const trimToWindow = (
  samples: readonly MotionSample[],
  now: number,
  windowSeconds: number,
): MotionSample[] => samples.filter((sample) => now - sample.t <= windowSeconds);

/**
 * Resamples onto a fixed grid. Scoring compares a recording against a target
 * curve, and the leaderboard posts a downsampled trace; both want evenly
 * spaced points regardless of how the device actually delivered them.
 */
export const resample = (
  samples: readonly MotionSample[],
  periodSeconds: number,
  durationSeconds: number,
): MotionSample[] => {
  const output: MotionSample[] = [];
  const count = Math.floor(durationSeconds / periodSeconds) + 1;

  // Grid points outside the recording are holes, not readings. Without this a
  // run that stopped early would hold its final distance across the rest of the
  // grid and keep earning marks for a recording that was never made.
  const first = samples[0] ?? null;
  const last = samples[samples.length - 1] ?? null;
  const edgeTolerance = periodSeconds / 2;

  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const t = index * periodSeconds;

    if (!first || !last || t < first.t - edgeTolerance || t > last.t + edgeTolerance) {
      output.push({ t, distance: 0, quality: 'dropout' });
      continue;
    }

    while (cursor < samples.length - 1 && samples[cursor + 1].t <= t) cursor += 1;

    const before = samples[cursor];
    const after = samples[cursor + 1];

    if (!before) {
      output.push({ t, distance: 0, quality: 'dropout' });
      continue;
    }

    if (!after || before.quality === 'dropout' || after.quality === 'dropout') {
      output.push({ t, distance: before.distance, quality: before.quality });
      continue;
    }

    const span = after.t - before.t;
    const fraction = span > 0 ? (t - before.t) / span : 0;
    output.push({
      t,
      distance: before.distance + fraction * (after.distance - before.distance),
      quality: 'ok',
    });
  }

  return output;
};

/**
 * Root-mean-square of the second difference — how much the trace wiggles
 * between adjacent samples, independent of the motion itself.
 *
 * A real sonar trace always carries a millimetre or two of this. A curve
 * generated from an equation carries none. The leaderboard validator uses that
 * asymmetry as a cheap forgery check; it is a bar to clear, not a proof.
 */
export const jitterRms = (samples: readonly MotionSample[]): number => {
  const good = samples.filter((sample) => sample.quality === 'ok');
  if (good.length < 3) return 0;

  let sum = 0;
  let count = 0;
  for (let index = 1; index < good.length - 1; index += 1) {
    const second = good[index + 1].distance - 2 * good[index].distance + good[index - 1].distance;
    sum += second * second;
    count += 1;
  }

  return count > 0 ? Math.sqrt(sum / count) : 0;
};
