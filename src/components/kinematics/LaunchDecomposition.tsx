import { useRef, useState, type PointerEvent } from 'react';

import {
  LAUNCH_ANGLE_MAX,
  LAUNCH_ANGLE_MIN,
  LAUNCH_SPEED_MAX,
  LAUNCH_SPEED_MIN,
  launchComponents,
  launchFromPointer,
} from '../../lib/kinematics/launch';
import { fixed } from '../../utils/format';
import { ControlBar, Slider } from '../shared/InlineControls';

// Inline illustration for the launch-components equations: drag the tip of the
// launch velocity (or use the sliders) and watch it resolve into v0 cos(theta)
// along the ground and v0 sin(theta) straight up. Pointer geometry lives in
// lib/kinematics/launch.

const VIEW_W = 440;
const VIEW_H = 400;
const ORIGIN_X = 56;
const ORIGIN_Y = 356;
const ZOOM = Math.min((VIEW_W - ORIGIN_X - 24) / LAUNCH_SPEED_MAX, (ORIGIN_Y - 20) / LAUNCH_SPEED_MAX);
const TICKS = [0, 10, 20, 30, 40, 50, 60];

// Velocity keeps the green it has everywhere else in the kinematics pages.
const VELOCITY_GREEN = '#16a34a';

const round = (n: number) => Math.round(n * 1000) / 1000;
const sx = (vx: number) => round(ORIGIN_X + vx * ZOOM);
const sy = (vy: number) => round(ORIGIN_Y - vy * ZOOM);

export default function LaunchDecomposition() {
  const [angleDeg, setAngleDeg] = useState(35);
  const [speed, setSpeed] = useState(34);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef(false);

  const { vx, vy } = launchComponents(speed, angleDeg);
  const tipX = sx(vx);
  const tipY = sy(vy);
  const angle = (angleDeg * Math.PI) / 180;

  const updateFromPointer = (event: PointerEvent<SVGElement>) => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) * VIEW_W) / rect.width;
    const py = ((event.clientY - rect.top) * VIEW_H) / rect.height;
    const next = launchFromPointer(px - ORIGIN_X, ORIGIN_Y - py, ZOOM);
    setAngleDeg(next.angleDeg);
    setSpeed(next.speed);
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    // Touch only grabs the handle, so a finger elsewhere on the diagram still
    // scrolls the page; a mouse can click anywhere to place the tip.
    const onHandle = (event.target as Element).closest('[data-launch-handle]') !== null;
    if (event.pointerType !== 'mouse' && !onHandle) {
      return;
    }
    event.preventDefault();
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (draggingRef.current) {
      updateFromPointer(event);
    }
  };

  const endDrag = () => {
    draggingRef.current = false;
  };

  const arcR = 38;
  const showArc = speed * ZOOM > arcR + 12 && angleDeg > 2;
  const showRightAngle = vx * ZOOM > 14 && vy * ZOOM > 14;

  return (
    <div className="not-prose mx-auto my-8 w-full max-w-[640px] text-[var(--text-primary)]">
      <ControlBar className="mb-3">
        <Slider
          label="Angle θ"
          unit="°"
          min={LAUNCH_ANGLE_MIN}
          max={LAUNCH_ANGLE_MAX}
          value={angleDeg}
          onChange={setAngleDeg}
          format={(value) => fixed(value, 0)}
        />
        <Slider
          label={
            <>
              Speed v<sub>0</sub>
            </>
          }
          unit="m/s"
          min={LAUNCH_SPEED_MIN}
          max={LAUNCH_SPEED_MAX}
          step={0.5}
          value={speed}
          onChange={setSpeed}
          format={(value) => fixed(value, 1)}
        />
      </ControlBar>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={`Launch velocity of ${fixed(speed, 1)} metres per second at ${fixed(angleDeg, 0)} degrees, with a horizontal component of ${fixed(vx, 1)} and a vertical component of ${fixed(vy, 1)} metres per second`}
        className="mx-auto block h-auto w-full max-w-[460px] select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <rect
          x={ORIGIN_X}
          y={sy(LAUNCH_SPEED_MAX)}
          width={round(LAUNCH_SPEED_MAX * ZOOM)}
          height={round(LAUNCH_SPEED_MAX * ZOOM)}
          fill="var(--surface-plot)"
          stroke="var(--grid-line)"
        />

        {TICKS.map((tick) => (
          <g key={tick}>
            <line x1={sx(tick)} x2={sx(tick)} y1={sy(0)} y2={sy(LAUNCH_SPEED_MAX)} stroke="var(--grid-line)" opacity={0.7} />
            <line x1={sx(0)} x2={sx(LAUNCH_SPEED_MAX)} y1={sy(tick)} y2={sy(tick)} stroke="var(--grid-line)" opacity={0.7} />
            <text x={sx(tick)} y={ORIGIN_Y + 16} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
              {tick}
            </text>
            {tick > 0 && (
              <text x={ORIGIN_X - 8} y={sy(tick) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
                {tick}
              </text>
            )}
          </g>
        ))}
        <text x={sx(LAUNCH_SPEED_MAX)} y={VIEW_H - 6} textAnchor="end" fontSize={12} fill="var(--text-muted)">
          m/s
        </text>

        <line x1={ORIGIN_X} x2={sx(LAUNCH_SPEED_MAX)} y1={ORIGIN_Y} y2={ORIGIN_Y} stroke="var(--text-muted)" strokeWidth={1.5} />
        <line x1={ORIGIN_X} x2={ORIGIN_X} y1={ORIGIN_Y} y2={sy(LAUNCH_SPEED_MAX)} stroke="var(--text-muted)" strokeWidth={1.5} />

        {showRightAngle && (
          <polyline
            points={`${tipX - 10},${ORIGIN_Y} ${tipX - 10},${ORIGIN_Y - 10} ${tipX},${ORIGIN_Y - 10}`}
            fill="none"
            stroke="var(--text-muted)"
            strokeWidth={1.2}
          />
        )}

        {showArc && (
          <>
            <path
              d={`M ${ORIGIN_X + arcR} ${ORIGIN_Y} A ${arcR} ${arcR} 0 0 0 ${round(ORIGIN_X + arcR * Math.cos(angle))} ${round(ORIGIN_Y - arcR * Math.sin(angle))}`}
              fill="none"
              stroke="var(--text-primary)"
              strokeWidth={1.4}
            />
            <text
              x={round(ORIGIN_X + (arcR + 14) * Math.cos(angle / 2))}
              y={round(ORIGIN_Y - (arcR + 14) * Math.sin(angle / 2) + 5)}
              textAnchor="middle"
              fontSize={15}
              fontStyle="italic"
              fill="var(--text-primary)"
            >
              θ
            </text>
          </>
        )}

        <Arrow x0={ORIGIN_X} y0={ORIGIN_Y} x1={tipX} y1={ORIGIN_Y} dashed />
        <Arrow x0={tipX} y0={ORIGIN_Y} x1={tipX} y1={tipY} dashed />
        <Arrow x0={ORIGIN_X} y0={ORIGIN_Y} x1={tipX} y1={tipY} />

        {vx * ZOOM > 30 && (
          <Symbol x={round((ORIGIN_X + tipX) / 2)} y={ORIGIN_Y + 34} sub="0x" anchor="middle" />
        )}
        {vy * ZOOM > 30 && <Symbol x={tipX + 8} y={round((ORIGIN_Y + tipY) / 2 + 5)} sub="0y" anchor="start" />}
        {speed * ZOOM > 20 && (
          <Symbol
            x={round(tipX - 14 * Math.sin(angle) - 6)}
            y={round(tipY - 12 * Math.cos(angle) - 4)}
            sub="0"
            anchor="end"
          />
        )}

        <circle cx={ORIGIN_X} cy={ORIGIN_Y} r={4} fill="var(--text-primary)" />

        <g data-launch-handle="" style={{ cursor: 'grab', touchAction: 'none' }}>
          <circle cx={tipX} cy={tipY} r={20} fill="transparent" />
          <circle cx={tipX} cy={tipY} r={6.5} fill={VELOCITY_GREEN} stroke="var(--surface-plot)" strokeWidth={2} />
        </g>
      </svg>

      <p className="mt-2 mb-0 text-center text-sm text-[var(--text-muted)]">
        <span className="whitespace-nowrap">
          v<sub>0x</sub> = v<sub>0</sub> cos θ ={' '}
          <span className="font-semibold tabular-nums text-[var(--text-primary)]">{fixed(vx, 1)} m/s</span>
        </span>
        <span aria-hidden="true" className="mx-3">
          ·
        </span>
        <span className="whitespace-nowrap">
          v<sub>0y</sub> = v<sub>0</sub> sin θ ={' '}
          <span className="font-semibold tabular-nums text-[var(--text-primary)]">{fixed(vy, 1)} m/s</span>
        </span>
      </p>
    </div>
  );
}

const HEAD_LENGTH = 11;
const HEAD_HALF_WIDTH = 5.5;

function Arrow({ x0, y0, x1, y1, dashed = false }: { x0: number; y0: number; x1: number; y1: number; dashed?: boolean }) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  if (length < 3) {
    return null;
  }
  const ux = dx / length;
  const uy = dy / length;
  const head = Math.min(HEAD_LENGTH, length * 0.6);
  const bx = x1 - ux * head;
  const by = y1 - uy * head;
  return (
    <g opacity={dashed ? 0.75 : 1}>
      <line
        x1={x0}
        y1={y0}
        x2={round(bx + ux)}
        y2={round(by + uy)}
        stroke={VELOCITY_GREEN}
        strokeWidth={dashed ? 2.2 : 3.2}
        strokeLinecap="round"
        strokeDasharray={dashed ? '6 4' : undefined}
      />
      <polygon
        points={`${x1},${y1} ${round(bx - uy * HEAD_HALF_WIDTH)},${round(by + ux * HEAD_HALF_WIDTH)} ${round(bx + uy * HEAD_HALF_WIDTH)},${round(by - ux * HEAD_HALF_WIDTH)}`}
        fill={VELOCITY_GREEN}
      />
    </g>
  );
}

function Symbol({ x, y, sub, anchor }: { x: number; y: number; sub: string; anchor: 'start' | 'middle' | 'end' }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontSize={16}
      fontStyle="italic"
      fontWeight={700}
      fill={VELOCITY_GREEN}
      stroke="var(--surface-plot)"
      strokeWidth={3}
      paintOrder="stroke"
    >
      v
      <tspan fontSize={11} dy={4}>
        {sub}
      </tspan>
    </text>
  );
}
