import { Button, ControlBar, Select, Slider, Toggle } from '../../shared/InlineControls';
import { fixed } from '../../../utils/format';
import type {
  Calibration,
  FrameRateEstimate,
  Track,
} from '../../../lib/kinematics/videoAnalysis';
import type { StageMode } from './VideoStage';

/**
 * The lab's control panel, organised around one question: what does clicking
 * the video do right now?
 *
 * That choice is the most consequential one a student makes, so it sits at the
 * top and everything below it belongs to whichever mode is selected. It also
 * keeps three quarters of the settings off screen at any moment — the axis tilt
 * only matters while tilting axes, and the ruler length only matters while
 * setting a scale.
 */

interface ModeControlsProps {
  mode: StageMode;
  onModeChange: (mode: StageMode) => void;
  calibration: Calibration;
  onCalibrationChange: (next: Calibration) => void;
  metersPerPixel: number | null;
  fps: number;
  onFpsChange: (fps: number) => void;
  frameRateEstimate: FrameRateEstimate | null;
  onDetectFrameRate: () => void;
  followEnabled: boolean;
  onFollowChange: (value: boolean) => void;
  tracks: Track[];
  activeTrackId: number;
  onActiveTrackChange: (id: number) => void;
  onRenameActiveTrack: (label: string) => void;
  onAddTrack: () => void;
  onRemoveTrack: () => void;
}

const MODES: Array<{ value: StageMode; label: string; hint: string }> = [
  {
    value: 'mark',
    label: 'Mark',
    hint: 'Click the object to record a point. The video then advances on its own, ready for the next click.',
  },
  {
    value: 'calibrate',
    label: 'Scale',
    hint: 'Drag across something of known length in the video, then enter that length below.',
  },
  {
    value: 'origin',
    label: 'Origin',
    hint: 'Click wherever x = 0, y = 0 should sit.',
  },
  {
    value: 'axis',
    label: 'Axis',
    hint: 'Drag along a slope to tilt the axes to match it. Hold Shift to snap to 5°.',
  },
];

const numberFieldClass =
  'w-24 rounded-md border border-theme-grid bg-[var(--surface-elevated)] px-2 py-1 text-right font-mono tabular-nums text-[var(--text-primary)]';

export function ModeControls({
  mode,
  onModeChange,
  calibration,
  onCalibrationChange,
  metersPerPixel,
  fps,
  onFpsChange,
  frameRateEstimate,
  onDetectFrameRate,
  followEnabled,
  onFollowChange,
  tracks,
  activeTrackId,
  onActiveTrackChange,
  onRenameActiveTrack,
  onAddTrack,
  onRemoveTrack,
}: ModeControlsProps) {
  const activeTrack = tracks.find((track) => track.id === activeTrackId);
  const hint = MODES.find((entry) => entry.value === mode)?.hint ?? '';

  return (
    <div className="control-panel flex flex-col gap-3 rounded-xl border border-theme-grid bg-[var(--surface-elevated)] p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Click to
        </span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="What clicking the video does">
          {MODES.map((entry) => (
            <Button
              key={entry.value}
              type="button"
              variant={entry.value === mode ? 'primary' : 'secondary'}
              aria-pressed={entry.value === mode}
              className="px-4 py-2 text-base"
              onClick={() => onModeChange(entry.value)}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      </div>

      <p className="m-0 text-sm leading-6 text-[var(--text-muted)]">{hint}</p>

      <div className="flex flex-col gap-3 border-t border-theme-grid pt-3">
        {mode === 'mark' && (
          <>
            <ControlBar align="start">
              <Select
                label="Tracking"
                value={String(activeTrackId)}
                onChange={(value) => onActiveTrackChange(Number(value))}
                options={tracks.map((track) => ({ value: String(track.id), label: track.label }))}
              />
              <input
                type="text"
                aria-label="Rename the tracked object"
                value={activeTrack?.label ?? ''}
                onChange={(event) => onRenameActiveTrack(event.target.value)}
                className="w-36 rounded-md border border-theme-grid bg-[var(--surface-elevated)] px-2 py-1 text-[var(--text-primary)]"
              />
              <Button variant="secondary" type="button" onClick={onAddTrack}>
                Add object
              </Button>
              <Button
                variant="secondary"
                type="button"
                onClick={onRemoveTrack}
                disabled={tracks.length <= 1}
              >
                Remove object
              </Button>
            </ControlBar>
            <ControlBar align="start">
              <Slider
                label="Click precision"
                unit="px"
                min={0.5}
                max={20}
                step={0.5}
                value={calibration.positionUncertaintyPx}
                onChange={(value) =>
                  onCalibrationChange({ ...calibration, positionUncertaintyPx: value })
                }
                format={(value) => `±${value.toFixed(1)}`}
              />
              <Toggle label="Follow last point" checked={followEnabled} onChange={onFollowChange} />
            </ControlBar>
            <p className="m-0 text-xs leading-5 text-[var(--text-muted)]">
              How closely you can hit the same feature each time. It sets the error bars on the
              graph and the weights in a fit
              {metersPerPixel !== null ? (
                <>
                  {' '}
                  — about{' '}
                  <span className="font-mono tabular-nums">
                    ±{fixed(metersPerPixel * calibration.positionUncertaintyPx, 4)}
                  </span>{' '}
                  m at this scale
                </>
              ) : null}
              .
            </p>
          </>
        )}

        {mode === 'calibrate' && (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Distance
              </span>
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
                      onCalibrationChange({
                        ...calibration,
                        scaleLengthMeters: Number(event.target.value),
                      })
                    }
                    className={numberFieldClass}
                  />
                  <span className="text-[var(--text-muted)]">m</span>
                </label>
              </ControlBar>
              <p className="m-0 text-xs leading-5 text-[var(--text-muted)]">
                {metersPerPixel === null ? (
                  <span className="text-[var(--accent-red)]">
                    Drag the purple ruler across something of known length, then enter that length.
                  </span>
                ) : (
                  <>
                    <span className="font-mono tabular-nums">{metersPerPixel.toPrecision(3)}</span> m
                    per pixel. Change it later and every point you have marked rescales with it.
                  </>
                )}
              </p>
            </div>

            <div className="flex flex-col gap-1 border-t border-theme-grid pt-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Time
              </span>
              <ControlBar align="start">
                <label className="inline-flex items-center gap-2 text-sm">
                  <span className="font-medium">Frame rate</span>
                  <input
                    type="number"
                    min={1}
                    step="any"
                    inputMode="decimal"
                    value={fps}
                    onChange={(event) => onFpsChange(Number(event.target.value))}
                    className={numberFieldClass}
                  />
                  <span className="text-[var(--text-muted)]">fps</span>
                </label>
                <Button variant="secondary" type="button" onClick={onDetectFrameRate}>
                  Detect frame rate
                </Button>
              </ControlBar>
              <p className="m-0 text-xs leading-5 text-[var(--text-muted)]">
                {frameRateEstimate
                  ? `Measured ${frameRateEstimate.measuredFps.toFixed(2)} fps from ${frameRateEstimate.sampleCount} frames${
                      frameRateEstimate.snapped ? ', snapped to a standard rate.' : '.'
                    }`
                  : 'Not measured yet — set this to match your camera if you know it.'}
              </p>
            </div>
          </>
        )}

        {mode === 'origin' && (
          <>
            <p className="m-0 text-sm leading-6">
              Origin at{' '}
              <span className="font-mono tabular-nums">
                ({fixed(calibration.origin.px, 0)}, {fixed(calibration.origin.py, 0)})
              </span>{' '}
              in the frame.
            </p>
            <p className="m-0 text-xs leading-5 text-[var(--text-muted)]">
              Moving the origin shifts every position.  Velocity is related to differences in position, so it is unaffected by the choice of origin.
            </p>
          </>
        )}

        {mode === 'axis' && (
          <>
            <ControlBar align="start">
              <label className="inline-flex items-center gap-2 text-sm">
                <span className="font-medium">Axis tilt</span>
                <input
                  type="number"
                  step={1}
                  inputMode="decimal"
                  value={calibration.axisAngleDeg}
                  onChange={(event) =>
                    onCalibrationChange({ ...calibration, axisAngleDeg: Number(event.target.value) })
                  }
                  className={numberFieldClass}
                />
                <span className="text-[var(--text-muted)]">°</span>
              </label>
              <Button
                variant="secondary"
                type="button"
                onClick={() => onCalibrationChange({ ...calibration, axisAngleDeg: 0 })}
                disabled={calibration.axisAngleDeg === 0}
              >
                Level the axes
              </Button>
            </ControlBar>
            <p className="m-0 text-xs leading-5 text-[var(--text-muted)]">
              Tilting the axes puts x along the slope and y perpendicular to it.  This is useful for measuring motion along a ramp.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default ModeControls;
