/**
 * One-point distance calibration for the Motion Detector.
 *
 * The detector reports a ping-to-echo round trip; `sensorIds.motionToMeters`
 * turns that into metres through the speed of sound. That is the physics, and
 * it is right — but a detector in a real room can still disagree with a tape
 * measure, and until now there was no way to say so from the page.
 *
 * The correction is a single multiplier, applied at the one place raw ticks
 * become metres (`sources/webUsbSource.ts`). Everything downstream — the
 * plausibility gate, the recorded buffer, derived velocity, scoring, and the
 * samples that get submitted — therefore works in corrected metres with no
 * second seam to keep in step.
 *
 * A multiplier fixes an error that grows with distance. It cannot fix a
 * constant offset, which is what you have if the reading is still wrong at
 * other distances after calibrating at one; adding an offset term later means
 * widening `SensorContext` and this module, and nothing else.
 *
 * There is no ceiling on the correction. A detector that needs a large one is
 * usually reading something other than what was measured — an echo off a wall,
 * or a distance entered in different units — but refusing the number would only
 * substitute this module's guess about the room for the reading of whoever is
 * standing in it, and they can see the result and try again. Whatever they set
 * is shown, in plain terms, wherever the detector is in use.
 *
 * The scale is never transmitted. The scoring endpoint rescores the submitted
 * distances and range-checks them, and a client-side number it can only trust
 * or reject on adds nothing. Nor does it need to: the scale is a single global
 * multiplier on a target spanning 0.6-2.3 m, so a dishonest value that flatters
 * one leg penalises another — at 2 m, 15% is 30 cm against a
 * `SCORING_ZERO_AT.position` of 0.4, a large loss rather than a gift.
 *
 * One consequence worth naming: the range gate now sees corrected metres, so a
 * genuine 0.15 m reading at a scale of 0.9 reads 0.135 and is classed a
 * dropout. That is the very edge of the sensor's range and far below the game's
 * 0.6 m floor.
 */

import type { MotionSample } from './motionStream.ts';

export const CALIBRATION_STORAGE_KEY = 'physics-nook-motion-detector-calibration-v1';

/** The detector trusted as it reads. */
export const NEUTRAL_SCALE = 1;

/** Readings averaged before a scale is computed, and the fewest that will do. */
export const CALIBRATION_SAMPLE_COUNT = 12;
export const MIN_CALIBRATION_SAMPLES = 5;

export type CalibrationReason = 'ok' | 'no-reading' | 'invalid-true-distance';

export interface CalibrationOutcome {
  ok: boolean;
  /** The scale to adopt. On failure, the scale already in force. */
  scale: number;
  reason: CalibrationReason;
}

/** A scale has to be a real positive multiplier; how large is not our business. */
export const isUsableScale = (scale: number): boolean => Number.isFinite(scale) && scale > 0;

/**
 * Solves for the scale that would have made `measuredMeters` read `trueMeters`.
 *
 * `currentScale` is what makes recalibration work. Once a scale is in force the
 * reading on screen is already corrected, so `trueMeters / measured` is only
 * the *relative* correction and adopting it would silently undo the previous
 * calibration. Composing instead:
 *
 *     proposed = currentScale * (trueMeters / measuredMeters)
 *
 * With the detector's own error factor `e`, the screen shows `e * T *
 * currentScale`, so `proposed` works out to `1 / e` whatever scale is in force.
 * Calibrating twice against a consistent world lands on the same number both
 * times.
 */
export const computeScale = (
  measuredMeters: number,
  trueMeters: number,
  currentScale: number = NEUTRAL_SCALE,
): CalibrationOutcome => {
  const inForce = isUsableScale(currentScale) ? currentScale : NEUTRAL_SCALE;
  const reject = (reason: CalibrationReason): CalibrationOutcome => ({
    ok: false,
    scale: inForce,
    reason,
  });

  if (!Number.isFinite(measuredMeters) || measuredMeters <= 0) return reject('no-reading');
  if (!Number.isFinite(trueMeters) || trueMeters <= 0) return reject('invalid-true-distance');

  return { ok: true, scale: inForce * (trueMeters / measuredMeters), reason: 'ok' };
};

/**
 * Mean of the most recent good readings.
 *
 * A single ping carries millimetre noise and a standing person sways, so one
 * reading is not a measurement. The window is counted, not timed: entering the
 * calibrate screen retunes the sample rate, a retune re-enters 'streaming' and
 * re-zeroes the device's capture clock, and a window keyed on `sample.t` would
 * empty or overfill at exactly that moment.
 */
export const averageDistance = (
  samples: readonly MotionSample[],
  count: number = CALIBRATION_SAMPLE_COUNT,
): number | null => {
  const good = samples.filter((sample) => sample.quality === 'ok').slice(-count);
  if (good.length < MIN_CALIBRATION_SAMPLES) return null;
  return good.reduce((sum, sample) => sum + sample.distance, 0) / good.length;
};

export const serializeScale = (scale: number): string => scale.toFixed(6);

/**
 * Reads a stored scale back. Only garbage is refused — anything that is not a
 * positive finite number could not have come from a calibration, and applying
 * it would leave the detector reading zero, or nothing at all.
 */
export const readStoredScale = (raw: string | null): number => {
  if (raw === null) return NEUTRAL_SCALE;
  const parsed = Number.parseFloat(raw);
  return isUsableScale(parsed) ? parsed : NEUTRAL_SCALE;
};

/** Plain English for a factor, since 1.043 says nothing to a reader. */
export const describeScale = (scale: number): string => {
  const percent = Math.abs(scale - 1) * 100;
  if (percent < 0.05) return 'Readings are used exactly as the detector reports them.';
  const direction = scale > 1 ? 'stretched' : 'shortened';
  return `Readings are being ${direction} by ${percent.toFixed(1)}%.`;
};
