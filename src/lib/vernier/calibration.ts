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
 * The scale is never transmitted. The scoring endpoint rescores the submitted
 * distances and range-checks them, and a client-side number it can only trust
 * or reject on adds nothing. Nor does it need to: within the band below the
 * scale is a single global multiplier on a target spanning 0.6-2.3 m, so a
 * dishonest value that flatters one leg penalises another. At 2 m, 15% is 30 cm
 * against a `SCORING_ZERO_AT.position` of 0.4 — a large loss, not a gift.
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

/**
 * How far a one-point correction is allowed to move the reading.
 *
 * The speed-of-sound temperature term moves about 2% across a plausible room
 * and the sensor's own accuracy is similar, so a few percent is an instrument
 * that needs correcting. A demand for more than this is usually a different
 * fault wearing the same clothes — an echo off a wall or a chair, the wrong
 * object measured, or a true distance entered in feet — and correcting it would
 * bake that mistake into every reading afterwards.
 */
export const CALIBRATION_BAND = { min: 0.85, max: 1.15 } as const;

/** Readings averaged before a scale is computed, and the fewest that will do. */
export const CALIBRATION_SAMPLE_COUNT = 12;
export const MIN_CALIBRATION_SAMPLES = 5;

export type CalibrationReason = 'ok' | 'out-of-band' | 'no-reading' | 'invalid-true-distance';

export interface CalibrationOutcome {
  ok: boolean;
  /**
   * The scale to adopt. On failure this is the scale already in force, never a
   * clamped guess: a clamped value is wrong but plausible-looking, and it would
   * leave a detector reading well off with nothing on screen to show it.
   */
  scale: number;
  /** The composed ratio before the band was checked, so a message can quote it. */
  proposed: number;
  reason: CalibrationReason;
}

export const isScaleInBand = (scale: number): boolean =>
  Number.isFinite(scale) && scale >= CALIBRATION_BAND.min && scale <= CALIBRATION_BAND.max;

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
  const inForce = Number.isFinite(currentScale) && currentScale > 0 ? currentScale : NEUTRAL_SCALE;
  const reject = (reason: CalibrationReason, proposed = inForce): CalibrationOutcome => ({
    ok: false,
    scale: inForce,
    proposed,
    reason,
  });

  if (!Number.isFinite(measuredMeters) || measuredMeters <= 0) return reject('no-reading');
  if (!Number.isFinite(trueMeters) || trueMeters <= 0) return reject('invalid-true-distance');

  const proposed = inForce * (trueMeters / measuredMeters);
  if (!isScaleInBand(proposed)) return reject('out-of-band', proposed);

  return { ok: true, scale: proposed, proposed, reason: 'ok' };
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
 * Reads a stored scale back, refusing anything outside the band. A poisoned or
 * stale value is worth less than no calibration at all, and silently reading
 * the detector 30% wrong is the failure this whole module exists to prevent.
 */
export const readStoredScale = (raw: string | null): number => {
  if (raw === null) return NEUTRAL_SCALE;
  const parsed = Number.parseFloat(raw);
  return isScaleInBand(parsed) ? parsed : NEUTRAL_SCALE;
};

/** Plain English for a factor, since 1.043 says nothing to a reader. */
export const describeScale = (scale: number): string => {
  const percent = Math.abs(scale - 1) * 100;
  if (percent < 0.05) return 'Readings are used exactly as the detector reports them.';
  const direction = scale > 1 ? 'stretched' : 'shortened';
  return `Readings are being ${direction} by ${percent.toFixed(1)}%.`;
};
