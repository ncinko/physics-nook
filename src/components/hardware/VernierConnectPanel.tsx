import { Button } from '../shared/InlineControls';
import { fixed } from '../../utils/format';
import { DEFAULT_SCALE } from '../../lib/vernier/calibration';
import DeviceConnectPanel from './DeviceConnectPanel';
import type { VernierMotionApi } from './useVernierMotion';

// Connecting a LabQuest Mini and confirming it reads the world correctly.
//
// Beyond the connect button there is only the live reading, which is enough to
// tell whether the detector is aimed at you: hold still and watch the number.
// `diagnosticsText()` on the hook still assembles the USB transcript that
// settled the NGIO framing against real hardware — nothing on the page calls
// it, but the next protocol surprise will, so the surface it needs is kept.

interface VernierConnectPanelProps {
  device: VernierMotionApi;
  /**
   * Offers the simulated walker as a source. Off for readers: the activity is
   * about walking in front of a detector, and a mouse-driven run is a different
   * exercise wearing the same clothes. See `isSimulatedWalkerEnabled`.
   */
  allowSimulated?: boolean;
  /**
   * The one-point distance scale in force, if any. Surfaced here rather than
   * left on the calibrate screen because the calibration is stored per browser,
   * not per detector — WebUSB offers no serial to key it to — so a shared
   * classroom machine could otherwise carry a stale correction into next period
   * with nothing on screen to say so.
   */
  distanceScale?: number;
  onResetCalibration?: () => void;
  className?: string;
}

export default function VernierConnectPanel({
  device,
  allowSimulated = false,
  distanceScale = DEFAULT_SCALE,
  onResetCalibration,
  className = '',
}: VernierConnectPanelProps) {
  const { latest } = device;

  return (
    <DeviceConnectPanel
      device={device}
      allowSimulated={allowSimulated}
      simulatedLabel="Simulated walker"
      className={className}
    >
      <p className="text-sm text-[var(--text-primary)]">
        Live reading:{' '}
        <span className="font-mono tabular-nums">
          {latest && latest.quality === 'ok' ? `${fixed(latest.distance, 3)} m` : 'no echo'}
        </span>
      </p>

      {/* Only a departure from the default is news. The default stretch is
          what every detector gets, so announcing it would be noise. */}
      {distanceScale !== DEFAULT_SCALE && (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
          <span>
            Calibrated: readings multiplied by{' '}
            <span className="font-mono tabular-nums text-[var(--text-primary)]">
              {fixed(distanceScale, 3)}
            </span>
          </span>
          {onResetCalibration && (
            <Button variant="secondary" onClick={onResetCalibration}>
              Clear
            </Button>
          )}
        </p>
      )}
    </DeviceConnectPanel>
  );
}
