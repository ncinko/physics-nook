/**
 * The browser half of the detector calibration: where the scale is remembered.
 *
 * The arithmetic and the band live in `lib/vernier/calibration`, which is pure
 * and tested. This holds the React state and the localStorage read, which are
 * the parts that need a browser — the same split as `useVernierMotion`.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  CALIBRATION_STORAGE_KEY,
  NEUTRAL_SCALE,
  computeScale,
  readStoredScale,
  serializeScale,
  type CalibrationOutcome,
} from '../../lib/vernier/calibration';

export interface DetectorCalibration {
  scale: number;
  isDefault: boolean;
  /** Solves for a new scale and adopts it only if the result is usable. */
  apply: (measuredMeters: number, trueMeters: number) => CalibrationOutcome;
  reset: () => void;
}

export const useDetectorCalibration = (): DetectorCalibration => {
  const [scale, setScale] = useState(NEUTRAL_SCALE);

  // Read in an effect rather than during render, so the island paints the same
  // markup every time and a private window with storage disabled is not an
  // error — the same reason `useVernierMotion` feature-detects in an effect.
  useEffect(() => {
    try {
      setScale(readStoredScale(window.localStorage.getItem(CALIBRATION_STORAGE_KEY)));
    } catch {
      setScale(NEUTRAL_SCALE);
    }
  }, []);

  const store = useCallback((next: number) => {
    setScale(next);
    try {
      if (next === NEUTRAL_SCALE) window.localStorage.removeItem(CALIBRATION_STORAGE_KEY);
      else window.localStorage.setItem(CALIBRATION_STORAGE_KEY, serializeScale(next));
    } catch {
      // Storage refused. The scale still applies for this session, which is the
      // period the detector is set up for anyway.
    }
  }, []);

  const apply = useCallback(
    (measuredMeters: number, trueMeters: number) => {
      const outcome = computeScale(measuredMeters, trueMeters, scale);
      if (outcome.ok) store(outcome.scale);
      return outcome;
    },
    [scale, store],
  );

  const reset = useCallback(() => store(NEUTRAL_SCALE), [store]);

  return { scale, isDefault: scale === NEUTRAL_SCALE, apply, reset };
};
