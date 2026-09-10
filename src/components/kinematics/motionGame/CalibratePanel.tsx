/**
 * Correcting the detector against a tape measure.
 *
 * A sonar reading is a round trip through the speed of sound, and the physics
 * is right, but a detector in a real room can still disagree with a tape. This
 * is where that disagreement gets measured and fixed: stand at a distance you
 * have measured, type it in, and the reading is scaled to match from then on.
 *
 * The arithmetic, the band and the storage rules are in
 * `lib/vernier/calibration`, which is tested. What is here is the buffer of
 * recent readings and the wording.
 */

import { useEffect, useState } from 'react';
import { Button } from '../../shared/InlineControls';
import { fixed } from '../../../utils/format';
import {
  CALIBRATION_BAND,
  CALIBRATION_SAMPLE_COUNT,
  MIN_CALIBRATION_SAMPLES,
  averageDistance,
  describeScale,
  type CalibrationOutcome,
} from '../../../lib/vernier/calibration';
import type { MotionSample } from '../../../lib/vernier/motionStream';
import type { VernierMotionApi } from '../../hardware/useVernierMotion';
import type { DetectorCalibration } from '../../hardware/useDetectorCalibration';
import BigReading from './BigReading';

const numberFieldClass =
  'w-28 rounded-md border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-2 py-1 text-right font-mono tabular-nums text-[var(--text-primary)]';

const message = (outcome: CalibrationOutcome): string => {
  switch (outcome.reason) {
    case 'ok':
      return `Done. ${describeScale(outcome.scale)}`;
    case 'no-reading':
      return 'No steady reading yet. Make sure the detector can see the object, then wait a moment.';
    case 'invalid-true-distance':
      return 'Enter the measured distance in metres, as a positive number.';
    case 'out-of-band': {
      const percent = Math.abs(outcome.proposed - 1) * 100;
      return `That would be a ${percent.toFixed(0)}% correction, which is more than a detector is ever out by. It is usually an echo off something else in the room, or a distance entered in different units. Nothing was changed.`;
    }
  }
};

interface CalibratePanelProps {
  device: VernierMotionApi;
  calibration: DetectorCalibration;
  onBack: () => void;
}

export default function CalibratePanel({ device, calibration, onBack }: CalibratePanelProps) {
  const [recent, setRecent] = useState<MotionSample[]>([]);
  const [trueDistance, setTrueDistance] = useState('');
  const [outcome, setOutcome] = useState<CalibrationOutcome | null>(null);

  // A rolling window of the last few readings. Kept by count rather than by
  // time: entering this screen retunes the sample rate, and a retune re-zeroes
  // the device's capture clock.
  const { subscribe } = device;
  useEffect(
    () =>
      subscribe((sample) => {
        setRecent((previous) => [...previous, sample].slice(-CALIBRATION_SAMPLE_COUNT));
      }),
    [subscribe],
  );

  const live = device.latest && device.latest.quality === 'ok' ? device.latest.distance : null;
  const averaged = averageDistance(recent);
  const goodCount = Math.min(
    recent.filter((sample) => sample.quality === 'ok').length,
    CALIBRATION_SAMPLE_COUNT,
  );

  const handleApply = () => {
    const parsed = Number.parseFloat(trueDistance);
    setOutcome(calibration.apply(averaged ?? Number.NaN, parsed));
  };

  return (
    <div className="@container">
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">Calibrate the detector</h3>

      <p className="mt-1 max-w-prose text-sm text-[var(--text-muted)]">
        Put something the detector can see at a distance you have measured — a metre or two works
        best, and it is the range the graphs use. Wait for the averaged reading to settle, type the
        distance you measured, and set the scale.
      </p>

      <div className="mt-4 rounded-xl border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-4">
        <BigReading label="Detector reads" value={live === null ? null : `${fixed(live, 3)} m`} />
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Averaged over the last{' '}
          <span className="font-mono tabular-nums text-[var(--text-primary)]">{goodCount}</span>{' '}
          {goodCount === 1 ? 'reading' : 'readings'}:{' '}
          <span className="font-mono tabular-nums text-[var(--text-primary)]">
            {averaged === null ? '—' : `${fixed(averaged, 3)} m`}
          </span>
          {averaged === null && ` (needs at least ${MIN_CALIBRATION_SAMPLES})`}
        </p>
      </div>

      <form
        className="mt-4 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          handleApply();
        }}
      >
        <label className="text-sm text-[var(--text-primary)]" htmlFor="motion-calibrate-true">
          Measured distance (m)
        </label>
        <input
          id="motion-calibrate-true"
          className={numberFieldClass}
          inputMode="decimal"
          value={trueDistance}
          onChange={(event) => {
            setTrueDistance(event.target.value);
            setOutcome(null);
          }}
        />
        <Button type="submit" className="btn-lg" disabled={averaged === null}>
          Set the scale
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={calibration.isDefault}
          onClick={() => {
            calibration.reset();
            setOutcome(null);
          }}
        >
          Reset to 1.000
        </Button>
      </form>

      {outcome && (
        <p
          className={`mt-3 max-w-prose text-sm ${
            outcome.ok ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'
          }`}
          role="status"
        >
          {message(outcome)}
        </p>
      )}

      <p className="mt-4 text-sm text-[var(--text-primary)]">
        Scale in force:{' '}
        <span className="font-mono tabular-nums">{fixed(calibration.scale, 3)}</span>{' '}
        <span className="text-[var(--text-muted)]">{describeScale(calibration.scale)}</span>
      </p>
      <p className="mt-1 max-w-prose text-xs text-[var(--text-muted)]">
        Corrections beyond {Math.round((1 - CALIBRATION_BAND.min) * 100)}% are refused — a detector
        that far out is reading something other than what you measured. The scale is remembered in
        this browser, not on the detector.
      </p>

      <div className="mt-4">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}
