import { useMemo, useState } from 'react';

import {
  SAMPLE_T_MAX,
  SAMPLE_T_MIN,
  areaUnderVelocity,
  pathLengthOfT,
  velocityOfT,
} from '../../lib/kinematics/sampleMotion';
import { stripsUnder } from '../../lib/kinematics/areaStrips';
import { withAlpha } from './plotShading';
import { fixed } from '../../utils/format';
import { ControlBar, Slider, Toggle } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';

// Inline companion to the slope-vs-area argument: slice the hedgehog's velocity
// graph into constant-velocity strips, add up v * dt, and watch the running
// total close on the displacement as the strips narrow. It plots the same v(t)
// as the two graph explorers above it, so the strips land on a curve the reader
// already knows. Strip arithmetic lives in lib/kinematics/areaStrips.

const T_MIN = SAMPLE_T_MIN;
const T_MAX = SAMPLE_T_MAX;
const V_MIN = -2;
const V_MAX = 3;

const VIEW_W = 640;
const VIEW_H = 280;
const PAD = { l: 52, r: 16, t: 16, b: 36 };
const PLOT_W = VIEW_W - PAD.l - PAD.r;
const PLOT_H = VIEW_H - PAD.t - PAD.b;

const T_TICKS = [0, 2, 4, 6, 8, 10];
const V_TICKS = [-2, -1, 0, 1, 2, 3];

const MIN_STRIPS = 1;
const MAX_STRIPS = 40;
const DEFAULT_STRIPS = 5;

// Sample dots crowd the curve once the strips get thin, and by then the reader
// is watching the total rather than the individual heights.
const DOTS_UP_TO = 16;

// Velocity keeps the green it has on the explorers above, so one quantity reads
// as one colour down the whole page.
const VELOCITY_GREEN = '#16a34a';

const xPix = (t: number) => PAD.l + ((t - T_MIN) / (T_MAX - T_MIN)) * PLOT_W;
const yPix = (v: number) => PAD.t + ((V_MAX - v) / (V_MAX - V_MIN)) * PLOT_H;

const CURVE_PATH = Array.from({ length: 241 }, (_, index) => {
  const t = T_MIN + ((T_MAX - T_MIN) * index) / 240;
  return `${index === 0 ? 'M' : 'L'}${xPix(t).toFixed(2)},${yPix(velocityOfT(t)).toFixed(2)}`;
}).join(' ');

const EXACT_DISPLACEMENT = areaUnderVelocity(T_MIN, T_MAX);
const EXACT_DISTANCE = pathLengthOfT(T_MAX) - pathLengthOfT(T_MIN);

export default function AreaStrips() {
  const [count, setCount] = useState(DEFAULT_STRIPS);
  const [signed, setSigned] = useState(true);

  const { width, strips, total } = useMemo(
    () => stripsUnder(velocityOfT, T_MIN, T_MAX, count, { signed }),
    [count, signed],
  );

  const exact = signed ? EXACT_DISPLACEMENT : EXACT_DISTANCE;
  const quantity = signed ? 'displacement' : 'distance traveled';
  const gap = total - exact;
  const stripWord = count === 1 ? 'strip' : 'strips';
  const verdict =
    Math.abs(gap) < 0.005
      ? `With ${count} ${stripWord}, the sum matches the exact ${quantity} to the centimeter.`
      : `With ${count} ${stripWord}, the sum ${gap > 0 ? 'overshoots' : 'falls short of'} the exact ${quantity} by ${fixed(Math.abs(gap))} m.`;

  return (
    <div className="not-prose mx-auto my-8 w-full max-w-[640px] text-[var(--text-primary)]">
      <ControlBar className="mb-3">
        <Slider label="Strips" min={MIN_STRIPS} max={MAX_STRIPS} value={count} onChange={setCount} />
        <Toggle label="Strips below the axis subtract" checked={signed} onChange={setSigned} />
      </ControlBar>

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={`Velocity versus time cut into ${count} ${stripWord}. ${verdict}`}
        className="block h-auto w-full"
      >
        {V_TICKS.map((v) => (
          <g key={`v-${v}`}>
            <line
              x1={PAD.l}
              y1={yPix(v)}
              x2={PAD.l + PLOT_W}
              y2={yPix(v)}
              stroke="var(--grid-line)"
              strokeWidth={v === 0 ? 1.6 : 1}
            />
            <text
              x={PAD.l - 10}
              y={yPix(v) + 4}
              textAnchor="end"
              fill="var(--text-muted)"
              fontSize="11"
            >
              {v}
            </text>
          </g>
        ))}

        {T_TICKS.map((t) => (
          <g key={`t-${t}`}>
            <line
              x1={xPix(t)}
              y1={PAD.t}
              x2={xPix(t)}
              y2={PAD.t + PLOT_H}
              stroke="var(--grid-line)"
              strokeWidth="1"
              opacity="0.6"
            />
            <text
              x={xPix(t)}
              y={PAD.t + PLOT_H + 18}
              textAnchor="middle"
              fill="var(--text-muted)"
              fontSize="11"
            >
              {t}
            </text>
          </g>
        ))}

        {/* Each strip is drawn from the zero line to its own left-edge height, so
            a strip below the axis hangs downward and reads as a subtraction. */}
        {strips.map((strip) => {
          const subtracts = signed && strip.height < 0;
          return (
            <rect
              key={strip.from}
              x={xPix(strip.from)}
              y={yPix(Math.max(strip.height, 0))}
              width={Math.max(xPix(strip.to) - xPix(strip.from), 0)}
              height={Math.abs(yPix(strip.height) - yPix(0))}
              fill={withAlpha(VELOCITY_GREEN, subtracts ? 0.12 : 0.28)}
              stroke={withAlpha(VELOCITY_GREEN, subtracts ? 0.5 : 0.55)}
              strokeWidth="1"
              strokeDasharray={subtracts ? '4 4' : undefined}
            />
          );
        })}

        <path d={CURVE_PATH} fill="none" stroke={VELOCITY_GREEN} strokeWidth="2.5" />

        {/* The corner of each strip that touches the curve: the one moment whose
            velocity the whole strip is borrowing. */}
        {count <= DOTS_UP_TO &&
          strips.map((strip) => (
            <circle
              key={`dot-${strip.from}`}
              cx={xPix(strip.from)}
              cy={yPix(strip.height)}
              r="2.6"
              fill={VELOCITY_GREEN}
            />
          ))}

        <text x={xPix(T_MAX)} y={VIEW_H - 4} textAnchor="end" fill="var(--text-muted)" fontSize="12">
          t (s)
        </text>
        <text x={PAD.l - 10} y={PAD.t - 4} textAnchor="end" fill="var(--text-muted)" fontSize="12">
          v (m/s)
        </text>
      </svg>

      <Readout variant="inline" className="mt-3 justify-center">
        <Readout.Value label="Δt" value={fixed(width)} unit="s" />
        <Readout.Value
          label={signed ? 'Σ v Δt' : 'Σ |v| Δt'}
          value={<span style={{ color: VELOCITY_GREEN }}>{fixed(total)}</span>}
          unit="m"
        />
        <Readout.Value label={signed ? 'exact Δx' : 'exact distance'} value={fixed(exact)} unit="m" />
      </Readout>

      <p className="mt-2 mb-0 text-center text-sm text-[var(--text-muted)]">{verdict}</p>
    </div>
  );
}
