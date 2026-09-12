import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Pause, Play } from 'lucide-react';

import {
  SAMPLE2D_T_MAX,
  SAMPLE2D_T_MIN,
  accelerationOfT2D,
  magnitude,
  motionTrend2D,
  pathLength2DOfT,
  positionOfT2D,
  velocityOfT2D,
  type Vec2,
} from '../../lib/kinematics/sampleMotion2D';
import { hedgehogGait, hedgehogHeading } from '../../lib/kinematics/hedgehogGait';
import { fixed } from '../../utils/format';
import { ControlBar, Toggle } from '../shared/InlineControls';
import { HedgehogSprite } from './HedgehogSprite';
import { HEDGEHOG_CELL_H } from './hedgehogSheet';
import StopwatchDial from './StopwatchDial';

// The 2D companion to the 1D page's MotionOpener: the same hedgehog, now running
// a figure eight across a top-down field with its position, velocity, and
// acceleration drawn as arrows. The motion itself lives in
// lib/kinematics/sampleMotion2D.

const X_RANGE = 5;
const Y_RANGE = 3;

const VIEW_W = 640;
const PAD = { l: 36, r: 14, t: 30, b: 34 };
const UNIT = (VIEW_W - PAD.l - PAD.r) / (2 * X_RANGE);
const PLOT_W = UNIT * 2 * X_RANGE;
const PLOT_H = UNIT * 2 * Y_RANGE;
const VIEW_H = PAD.t + PLOT_H + PAD.b;

// Field metres of arrow per unit of the quantity. Velocity and acceleration are
// not lengths, so these are display choices, fixed so arrow lengths compare
// honestly from one moment to the next.
const V_SCALE = 0.7;
const A_SCALE = 0.8;

const READOUT_STEP = 0.1;

// One quantity, one colour, matching the 1D graph explorers.
const POSITION_COLOR = 'var(--accent-blue)';
const VELOCITY_COLOR = '#16a34a';
const ACCELERATION_COLOR = 'var(--accent-purple)';

const SPEED_PHRASE = {
  'speeding-up': 'speeding up',
  'slowing-down': 'slowing down',
  constant: 'holding its speed',
} as const;

const TURN_PHRASE = {
  left: 'turning left',
  right: 'turning right',
  straight: 'heading straight',
} as const;

// Rounded before reaching the DOM so server and client markup agree to the bit.
const round = (n: number) => Math.round(n * 1000) / 1000;
const toX = (x: number) => round(PAD.l + (x + X_RANGE) * UNIT);
const toY = (y: number) => round(PAD.t + (Y_RANGE - y) * UNIT);

const TRAIL_PATH = Array.from({ length: 241 }, (_, index) => {
  const p = positionOfT2D(SAMPLE2D_T_MIN + ((SAMPLE2D_T_MAX - SAMPLE2D_T_MIN) * index) / 240);
  return `${index === 0 ? 'M' : 'L'}${toX(p.x)},${toY(p.y)}`;
}).join(' ');

const X_TICKS = Array.from({ length: 2 * X_RANGE + 1 }, (_, i) => i - X_RANGE);
const Y_TICKS = Array.from({ length: 2 * Y_RANGE + 1 }, (_, i) => i - Y_RANGE);

export default function HedgehogField2D() {
  const [t, setT] = useState(SAMPLE2D_T_MIN);
  const [playing, setPlaying] = useState(true);
  const [showR, setShowR] = useState(false);
  const [showV, setShowV] = useState(true);
  const [showA, setShowA] = useState(false);
  const [splitA, setSplitA] = useState(false);

  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const facingRef = useRef<1 | -1>(1);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPlaying(false);
    }
  }, []);

  useEffect(() => {
    if (!playing) {
      return undefined;
    }

    const tick = (timestamp: number) => {
      if (lastFrameRef.current !== null) {
        const dt = (timestamp - lastFrameRef.current) / 1000;
        setT((current) => {
          const next = current + dt;
          return next >= SAMPLE2D_T_MAX ? next - SAMPLE2D_T_MAX : next;
        });
      }
      lastFrameRef.current = timestamp;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
      lastFrameRef.current = null;
    };
  }, [playing]);

  // The sentence snaps to tenths of a second and describes that one instant.
  const readoutT = Math.round(t / READOUT_STEP) * READOUT_STEP;
  const readoutR = positionOfT2D(readoutT);
  const readoutV = velocityOfT2D(readoutT);
  const readoutTrend = motionTrend2D(readoutV, accelerationOfT2D(readoutT));
  const sentence = `At ${fixed(readoutT, 1)} s the hedgehog is at ⟨${fixed(readoutR.x, 1)}, ${fixed(readoutR.y, 1)}⟩ m, moving at ${fixed(magnitude(readoutV), 1)} m/s, ${SPEED_PHRASE[readoutTrend.speed]} and ${TURN_PHRASE[readoutTrend.turn]}.`;

  const r = positionOfT2D(t);
  const v = velocityOfT2D(t);
  const a = accelerationOfT2D(t);
  const speed = magnitude(v);
  const { aParallel, aPerp } = motionTrend2D(v, a);

  const heading = hedgehogHeading(v.x, v.y, facingRef.current);
  facingRef.current = heading.facing;

  const pose = useMemo(
    () => hedgehogGait({ distance: pathLength2DOfT(t), velocity: speed, acceleration: aParallel }),
    [t, speed, aParallel],
  );

  const hx = toX(r.x);
  const hy = toY(r.y);
  const unitV: Vec2 = speed > 1e-9 ? { x: v.x / speed, y: v.y / speed } : { x: 1, y: 0 };
  const unitN: Vec2 = { x: -unitV.y, y: unitV.x };

  // Tip of an arrow drawn from the hedgehog, for a vector in field units.
  const tipFrom = (vec: Vec2, scale: number) => ({
    x: round(hx + vec.x * scale * UNIT),
    y: round(hy - vec.y * scale * UNIT),
  });

  const vTip = tipFrom(v, V_SCALE);
  const aTip = tipFrom(a, A_SCALE);
  const aParTip = tipFrom({ x: unitV.x * aParallel, y: unitV.y * aParallel }, A_SCALE);
  const aPerpTip = tipFrom({ x: unitN.x * aPerp, y: unitN.y * aPerp }, A_SCALE);

  return (
    <div className="not-prose my-8 overflow-hidden rounded-[1.35rem] border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--surface-elevated)_88%,transparent)] px-4 py-4 shadow-sm sm:px-5">
      <p className="m-0 min-h-[2.5rem] text-sm text-[var(--text-muted)]">
        At <Value>{fixed(readoutT, 1)} s</Value> the hedgehog is at{' '}
        <Value>
          <span style={{ color: POSITION_COLOR }}>r</span> = ⟨{fixed(readoutR.x, 1)}, {fixed(readoutR.y, 1)}⟩ m
        </Value>
        , moving at <Value>{fixed(magnitude(readoutV), 1)} m/s</Value>, {SPEED_PHRASE[readoutTrend.speed]} and{' '}
        {TURN_PHRASE[readoutTrend.turn]}.
      </p>

      <ControlBar className="mt-3">
        <Toggle label={<Swatch color={POSITION_COLOR}>position r</Swatch>} checked={showR} onChange={setShowR} />
        <Toggle label={<Swatch color={VELOCITY_COLOR}>velocity v</Swatch>} checked={showV} onChange={setShowV} />
        <Toggle label={<Swatch color={ACCELERATION_COLOR}>acceleration a</Swatch>} checked={showA} onChange={setShowA} />
        <Toggle label="decompose a" checked={splitA} onChange={setSplitA} />
      </ControlBar>

      <svg
        viewBox={`0 0 ${VIEW_W} ${round(VIEW_H)}`}
        role="img"
        aria-label={`A pixel-art hedgehog running a figure eight on a top-down grid. ${sentence}`}
        className="mx-auto mt-3 block h-auto w-full max-w-[680px]"
      >
        <rect
          x={PAD.l}
          y={PAD.t}
          width={round(PLOT_W)}
          height={round(PLOT_H)}
          rx={6}
          fill="var(--surface-plot)"
          stroke="var(--grid-line)"
        />

        {X_TICKS.map((x) => (
          <g key={`x-${x}`}>
            <line
              x1={toX(x)}
              x2={toX(x)}
              y1={toY(Y_RANGE)}
              y2={toY(-Y_RANGE)}
              stroke={x === 0 ? 'var(--text-muted)' : 'var(--grid-line)'}
              strokeWidth={x === 0 ? 1.4 : 1}
              opacity={0.7}
            />
            <text x={toX(x)} y={round(PAD.t + PLOT_H + 18)} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
              {x}
            </text>
          </g>
        ))}

        {Y_TICKS.map((y) => (
          <g key={`y-${y}`}>
            <line
              x1={toX(-X_RANGE)}
              x2={toX(X_RANGE)}
              y1={toY(y)}
              y2={toY(y)}
              stroke={y === 0 ? 'var(--text-muted)' : 'var(--grid-line)'}
              strokeWidth={y === 0 ? 1.4 : 1}
              opacity={0.7}
            />
            <text x={PAD.l - 8} y={toY(y) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
              {y}
            </text>
          </g>
        ))}

        <text x={toX(X_RANGE)} y={round(VIEW_H - 2)} textAnchor="end" fontSize={12} fill="var(--text-muted)">
          x (m)
        </text>
        <text x={PAD.l - 8} y={PAD.t - 14} textAnchor="end" fontSize={12} fill="var(--text-muted)">
          y (m)
        </text>

        <path d={TRAIL_PATH} fill="none" stroke="var(--text-muted)" strokeWidth={1.2} strokeDasharray="2 5" opacity={0.55} />

        {/* Velocity and acceleration start at the hedgehog and sit behind it;
            position ends at the hedgehog and is drawn over it. */}
        {showA && splitA && (
          <>
            <Arrow from={{ x: hx, y: hy }} to={aTip} color={ACCELERATION_COLOR} opacity={0.3} />
            <Arrow from={{ x: hx, y: hy }} to={aParTip} color={ACCELERATION_COLOR} dashed label="a∥" />
            <Arrow from={{ x: hx, y: hy }} to={aPerpTip} color={ACCELERATION_COLOR} dashed label="a⊥" />
          </>
        )}
        {showA && !splitA && <Arrow from={{ x: hx, y: hy }} to={aTip} color={ACCELERATION_COLOR} label="a" />}
        {showV && <Arrow from={{ x: hx, y: hy }} to={vTip} color={VELOCITY_COLOR} label="v" />}

        <g transform={`translate(${hx} ${hy}) rotate(${round((heading.rotate * 180) / Math.PI)}) translate(0 ${HEDGEHOG_CELL_H / 2}) scale(${heading.facing} 1)`}>
          <HedgehogSprite frame={pose.frame} />
        </g>

        {showR && (
          <Arrow from={{ x: toX(0), y: toY(0) }} to={{ x: hx, y: hy }} color={POSITION_COLOR} label="r" />
        )}
      </svg>

      <div className="mt-2 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => setPlaying((value) => !value)}
          aria-label={playing ? 'Pause the motion' : 'Play the motion'}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--grid-line)] bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm transition hover:border-[var(--accent-blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-blue)]"
        >
          {playing ? (
            <Pause aria-hidden="true" size={17} strokeWidth={2.5} />
          ) : (
            <Play aria-hidden="true" size={17} strokeWidth={2.5} />
          )}
        </button>

        <StopwatchDial value={t} max={SAMPLE2D_T_MAX} onChange={setT} onScrubStart={() => setPlaying(false)} />
      </div>
    </div>
  );
}

// Below this many pixels an arrow is just a dot under its own head; skip it.
const MIN_ARROW_PX = 4;
const HEAD_LENGTH = 10;
const HEAD_HALF_WIDTH = 5;

function Arrow({
  from,
  to,
  color,
  label,
  dashed = false,
  opacity = 1,
}: {
  from: Vec2;
  to: Vec2;
  color: string;
  label?: string;
  dashed?: boolean;
  opacity?: number;
}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < MIN_ARROW_PX) {
    return null;
  }
  const ux = dx / length;
  const uy = dy / length;
  const head = Math.min(HEAD_LENGTH, length * 0.6);
  const baseX = to.x - ux * head;
  const baseY = to.y - uy * head;
  const points = [
    `${round(to.x)},${round(to.y)}`,
    `${round(baseX - uy * HEAD_HALF_WIDTH)},${round(baseY + ux * HEAD_HALF_WIDTH)}`,
    `${round(baseX + uy * HEAD_HALF_WIDTH)},${round(baseY - ux * HEAD_HALF_WIDTH)}`,
  ].join(' ');

  return (
    <g opacity={opacity}>
      <line
        x1={round(from.x)}
        y1={round(from.y)}
        x2={round(baseX + ux)}
        y2={round(baseY + uy)}
        stroke={color}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeDasharray={dashed ? '5 4' : undefined}
      />
      <polygon points={points} fill={color} />
      {label && (
        <text
          x={round(to.x + ux * 12)}
          y={round(to.y + uy * 12 + 5)}
          textAnchor="middle"
          fontSize={15}
          fontStyle="italic"
          fontWeight={700}
          fill={color}
          stroke="var(--surface-plot)"
          strokeWidth={3}
          paintOrder="stroke"
        >
          {label}
        </text>
      )}
    </g>
  );
}

function Value({ children }: { children: ReactNode }) {
  return <span className="font-semibold tabular-nums text-[var(--text-primary)]">{children}</span>;
}

function Swatch({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded" style={{ background: color }} />
      {children}
    </span>
  );
}
