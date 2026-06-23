import { useState } from 'react';
import { ControlBar, Slider } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';
import {
  agreesWithin,
  discrepancy,
  formatMeasurement,
  type Measurement,
} from '../../lib/measurement/uncertainty';

// Capstone: each round object gives a measured value of π = C / d, drawn as a
// point with an error bar against the true value. A bar that crosses the line
// agrees with theory; one that misses signals a mistake or an unaccounted
// systematic error. The slider scales every reported doubt, so students can feel
// how over- or under-stating uncertainty changes the verdict.

interface RoundObject {
  name: string;
  /** Measured C / d for this object. */
  pi: number;
  /** Reported uncertainty at a scale of 1 (propagated from the tape readings). */
  baseUncertainty: number;
}

// A coin is small and was over-read: tight bar, biased high — it misses π.
const OBJECTS: RoundObject[] = [
  { name: 'mug', pi: 3.1, baseUncertainty: 0.08 },
  { name: 'plate', pi: 3.16, baseUncertainty: 0.05 },
  { name: 'coin', pi: 3.22, baseUncertainty: 0.03 },
  { name: 'bucket', pi: 3.13, baseUncertainty: 0.06 },
];

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 360;
const PLOT_TOP = 28;
const PLOT_BOTTOM = 268;
const AXIS_X = 70;
const PLOT_RIGHT = 560;
const PI_MIN = 2.95;
const PI_MAX = 3.35;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const toY = (value: number) =>
  clamp(
    PLOT_BOTTOM - ((value - PI_MIN) / (PI_MAX - PI_MIN)) * (PLOT_BOTTOM - PLOT_TOP),
    PLOT_TOP,
    PLOT_BOTTOM,
  );
const columnX = (index: number) =>
  AXIS_X + 50 + (index + 0.5) * ((PLOT_RIGHT - AXIS_X - 50) / OBJECTS.length);

const GRID_VALUES = [3.0, 3.1, 3.2, 3.3];

export function PiHunt() {
  const [scale, setScale] = useState(1);

  const measured = OBJECTS.map((object) => {
    const measurement: Measurement = { value: object.pi, uncertainty: object.baseUncertainty * scale };
    return {
      ...object,
      measurement,
      agrees: agreesWithin(measurement, Math.PI),
      sigma: discrepancy(measurement, Math.PI),
    };
  });
  const agreeingCount = measured.filter((m) => m.agrees).length;
  const piY = toY(Math.PI);

  return (
    <div className="not-prose mx-auto my-8 flex max-w-[600px] flex-col gap-4 text-[var(--text-primary)]">
      <p className="m-0 text-center text-sm leading-6 text-[var(--text-muted)]">
        Each object's error bar is its measured π give-or-take the
        propagated uncertainty. 
      </p>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label={`Measured values of pi with error bars; ${agreeingCount} of ${OBJECTS.length} agree with the true value`}
        className="block h-auto w-full"
      >
        {/* axes */}
        <line x1={AXIS_X} y1={PLOT_TOP} x2={AXIS_X} y2={PLOT_BOTTOM} stroke="var(--grid-line)" strokeWidth={1} />
        <line x1={AXIS_X} y1={PLOT_BOTTOM} x2={PLOT_RIGHT} y2={PLOT_BOTTOM} stroke="var(--grid-line)" strokeWidth={1} />

        {GRID_VALUES.map((value) => (
          <g key={value}>
            <line x1={AXIS_X} y1={toY(value)} x2={PLOT_RIGHT} y2={toY(value)} stroke="var(--grid-line)" strokeWidth={0.5} opacity={0.6} />
            <text x={AXIS_X - 8} y={toY(value) + 4} textAnchor="end" fill="var(--text-muted)" fontSize="12">
              {value.toFixed(2)}
            </text>
          </g>
        ))}

        {/* true value */}
        <line x1={AXIS_X} y1={piY} x2={PLOT_RIGHT} y2={piY} stroke="var(--accent-purple)" strokeWidth={1.5} strokeDasharray="7 5" />
        <text x={PLOT_RIGHT} y={piY - 6} textAnchor="end" fill="var(--accent-purple)" fontSize="12" fontWeight={600}>
          π = 3.14159
        </text>

        {measured.map((object, index) => {
          const x = columnX(index);
          const color = object.agrees ? 'var(--accent-green)' : 'var(--accent-red)';
          const topY = toY(object.pi + object.measurement.uncertainty);
          const bottomY = toY(object.pi - object.measurement.uncertainty);
          return (
            <g key={object.name} stroke={color} fill={color}>
              <line x1={x} y1={topY} x2={x} y2={bottomY} strokeWidth={2.5} />
              <line x1={x - 9} y1={topY} x2={x + 9} y2={topY} strokeWidth={2.5} />
              <line x1={x - 9} y1={bottomY} x2={x + 9} y2={bottomY} strokeWidth={2.5} />
              <circle cx={x} cy={toY(object.pi)} r={4.5} />
              <text x={x} y={PLOT_BOTTOM + 22} textAnchor="middle" fill="var(--text-primary)" fontSize="12" fontWeight={600} stroke="none">
                {object.name}
              </text>
              <text x={x} y={PLOT_BOTTOM + 38} textAnchor="middle" fill="var(--text-muted)" fontSize="11" stroke="none">
                {formatMeasurement(object.measurement)}
              </text>
            </g>
          );
        })}

        {/* legend */}
        <circle cx={AXIS_X + 6} cy={VIEW_HEIGHT - 12} r={4.5} fill="var(--accent-green)" />
        <text x={AXIS_X + 16} y={VIEW_HEIGHT - 8} fill="var(--text-muted)" fontSize="11">
          crosses π — agrees
        </text>
        <circle cx={AXIS_X + 190} cy={VIEW_HEIGHT - 12} r={4.5} fill="var(--accent-red)" />
        <text x={AXIS_X + 200} y={VIEW_HEIGHT - 8} fill="var(--text-muted)" fontSize="11">
          misses π — disagrees
        </text>
      </svg>

      <ControlBar>
        <Slider
          label="Uncertainty scale"
          min={0.1}
          max={3.0}
          step={0.1}
          value={scale}
          onChange={setScale}
          format={(v) => `${v.toFixed(1)}×`}
        />
      </ControlBar>

      <Readout>
        <Readout.Group label="Verdict">
          <Readout.Value label="consistent with π" value={`${agreeingCount} of ${OBJECTS.length}`} />
          <Readout.Value
            label="coin discrepancy"
            value={Number.isFinite(measured[2].sigma) ? `${measured[2].sigma.toFixed(1)}×` : '∞'}
            unit="its own ±"
          />
        </Readout.Group>
      </Readout>
    </div>
  );
}
