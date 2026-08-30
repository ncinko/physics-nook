import { ControlBar, Button, Slider } from '../../shared/InlineControls';
import { fixed } from '../../../utils/format';
import type { Calibration } from '../../../lib/kinematics/videoAnalysis';
import type { StageMode } from './VideoStage';

/**
 * Everything that turns pixels into metres: the ruler's real length, where the
 * origin sits, and how far the axes are tilted. Each control edits exactly one
 * field of the `Calibration` object, which is the only thing this component
 * knows about.
 */

interface CalibrationControlsProps {
  calibration: Calibration;
  onChange: (next: Calibration) => void;
  metersPerPixel: number | null;
  mode: StageMode;
  onModeChange: (mode: StageMode) => void;
}

const MODES: Array<{ value: StageMode; label: string; hint: string }> = [
  { value: 'mark', label: 'Mark', hint: 'Click the object on each frame' },
  { value: 'calibrate', label: 'Scale', hint: 'Drag across something of known length' },
  { value: 'origin', label: 'Origin', hint: 'Click where x = 0, y = 0 should sit' },
  { value: 'axis', label: 'Axis', hint: 'Drag along a slope; hold Shift to snap to 5°' },
];

export function CalibrationControls({
  calibration,
  onChange,
  metersPerPixel,
  mode,
  onModeChange,
}: CalibrationControlsProps) {
  const activeHint = MODES.find((entry) => entry.value === mode)?.hint ?? '';

  return (
    <div className="flex flex-col gap-2">
      <ControlBar align="start">
        <span className="text-sm font-medium">Click to</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Stage mode">
          {MODES.map((entry) => (
            <Button
              key={entry.value}
              type="button"
              variant={entry.value === mode ? 'primary' : 'secondary'}
              aria-pressed={entry.value === mode}
              onClick={() => onModeChange(entry.value)}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      </ControlBar>
      <p className="m-0 text-xs text-[var(--text-muted)]">{activeHint}</p>

      <ControlBar align="start">
        <label className="inline-flex items-center gap-2 text-sm">
          <span className="font-medium">Ruler length</span>
          <input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={calibration.scaleLengthMeters}
            onChange={(event) =>
              onChange({ ...calibration, scaleLengthMeters: Number(event.target.value) })
            }
            className="w-24 rounded-md border border-theme-grid bg-[var(--surface-elevated)] px-2 py-1 text-right font-mono tabular-nums text-[var(--text-primary)]"
          />
          <span className="text-[var(--text-muted)]">m</span>
        </label>

        <label className="inline-flex items-center gap-2 text-sm">
          <span className="font-medium">Axis tilt</span>
          <input
            type="number"
            step={1}
            inputMode="decimal"
            value={calibration.axisAngleDeg}
            onChange={(event) =>
              onChange({ ...calibration, axisAngleDeg: Number(event.target.value) })
            }
            className="w-20 rounded-md border border-theme-grid bg-[var(--surface-elevated)] px-2 py-1 text-right font-mono tabular-nums text-[var(--text-primary)]"
          />
          <span className="text-[var(--text-muted)]">°</span>
        </label>

        <Slider
          label="Click precision"
          unit="px"
          min={0.5}
          max={20}
          step={0.5}
          value={calibration.positionUncertaintyPx}
          onChange={(value) => onChange({ ...calibration, positionUncertaintyPx: value })}
          format={(value) => `±${value.toFixed(1)}`}
        />
      </ControlBar>

      <p className="m-0 text-xs text-[var(--text-muted)]">
        {metersPerPixel === null ? (
          <span className="text-[var(--accent-red)]">
            Draw a scale line over something of known length, then type that length above.
          </span>
        ) : (
          <>
            Scale: <span className="font-mono tabular-nums">{metersPerPixel.toPrecision(3)}</span> m
            per pixel, so each click is worth about{' '}
            <span className="font-mono tabular-nums">
              ±{fixed(metersPerPixel * calibration.positionUncertaintyPx, 4)}
            </span>{' '}
            m.
          </>
        )}
      </p>
    </div>
  );
}

export default CalibrationControls;
