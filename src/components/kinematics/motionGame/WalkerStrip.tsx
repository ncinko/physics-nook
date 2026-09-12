/**
 * Pointer and keyboard control for the simulated walker. Left is close to the
 * detector, right is far — the same orientation as distance on the plot above,
 * so the mental mapping is the one the graph already teaches.
 *
 * Only ever shown behind `?walker=1`. The activity is walking in front of a
 * detector; a mouse-driven run is a different exercise wearing the same
 * clothes, and it exists so the game can be tested without hardware.
 */

import { POSITION_AXIS_MAX } from '../../../lib/kinematics/motionGame';
import { MOTION_DETECTOR_RANGE } from '../../../lib/vernier/sensorIds';
import type { VernierMotionApi } from '../../hardware/useVernierMotion';

export default function WalkerStrip({ device }: { device: VernierMotionApi }) {
  const min = MOTION_DETECTOR_RANGE.minMeters;
  const max = POSITION_AXIS_MAX;
  const current = device.latest?.distance ?? min;

  const setFromClientX = (element: HTMLElement, clientX: number) => {
    const rect = element.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    device.simulated?.setTarget(min + fraction * (max - min));
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Simulated walker position"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(current.toFixed(2))}
      aria-valuetext={`${current.toFixed(2)} metres from the detector`}
      className="mt-3 h-12 w-full cursor-ew-resize touch-none rounded border border-[var(--grid-line)] bg-[var(--sim-bg)]"
      style={{ touchAction: 'none' }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setFromClientX(event.currentTarget, event.clientX);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 0) return;
        setFromClientX(event.currentTarget, event.clientX);
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.01 : 0.05;
        if (event.key === 'ArrowLeft') {
          device.simulated?.setTarget((device.simulated?.getTarget() ?? current) - step);
          event.preventDefault();
        }
        if (event.key === 'ArrowRight') {
          device.simulated?.setTarget((device.simulated?.getTarget() ?? current) + step);
          event.preventDefault();
        }
      }}
    >
      <div className="relative h-full">
        <div
          className="absolute top-1 h-10 w-1 -translate-x-1/2 rounded bg-[var(--accent-blue)]"
          style={{ left: `${((current - min) / (max - min)) * 100}%` }}
        />
        <span className="absolute bottom-1 left-2 text-[11px] text-[var(--text-muted)]">
          near ({min} m)
        </span>
        <span className="absolute right-2 bottom-1 text-[11px] text-[var(--text-muted)]">
          far ({max} m)
        </span>
      </div>
    </div>
  );
}
