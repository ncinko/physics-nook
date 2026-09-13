import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import {
  gradeDots,
  gradeSummary,
  samePoint,
  snapToGrid,
  toggleDot,
  type DotGrade,
  type GridPoint,
} from '../../lib/kinematics/gridDotProblem';
import { Button, ControlBar } from '../shared/InlineControls';

// Interactive problem: a top-down meter grid where the reader places dots for
// where something is at each second, then checks against the answer key. Grading
// and snapping live in lib/kinematics/gridDotProblem so other problems can reuse
// this with their own answers.

interface GridDotProblemProps {
  cols: number;
  rows: number;
  answer: GridPoint[];
  start?: GridPoint;
  snapStep?: number;
  subjectLabel?: string;
  labelEvery?: number;
}

const CELL = 22;
const PAD_L = 36;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 38;
// A tap that moves further than this (in CSS px) was a scroll, not a placement.
const TAP_SLOP = 8;

const round = (n: number) => Math.round(n * 1000) / 1000;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default function GridDotProblem({
  cols,
  rows,
  answer,
  start = { x: 0, y: 0 },
  snapStep = 1,
  subjectLabel = 'object',
  labelEvery = 4,
}: GridDotProblemProps) {
  const [dots, setDots] = useState<GridPoint[]>([]);
  const [grade, setGrade] = useState<DotGrade | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [hover, setHover] = useState<GridPoint | null>(null);
  const [cursor, setCursor] = useState<GridPoint>(start);
  const [focused, setFocused] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const downRef = useRef<{ x: number; y: number } | null>(null);

  const viewW = PAD_L + cols * CELL + PAD_R;
  const viewH = PAD_T + rows * CELL + PAD_B;
  const sx = (x: number) => round(PAD_L + x * CELL);
  const sy = (y: number) => round(PAD_T + (rows - y) * CELL);

  const pointFromEvent = (event: PointerEvent<SVGSVGElement>): GridPoint | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) * viewW) / rect.width;
    const py = ((event.clientY - rect.top) * viewH) / rect.height;
    const gx = (px - PAD_L) / CELL;
    const gy = rows - (py - PAD_T) / CELL;
    // Ignore clicks well outside the field (axis labels, margins).
    if (gx < -0.5 || gx > cols + 0.5 || gy < -0.5 || gy > rows + 0.5) return null;
    return snapToGrid(gx, gy, snapStep, cols, rows);
  };

  const toggle = (point: GridPoint) => {
    // The starting dot is given, not part of the answer.
    if (samePoint(point, start)) return;
    setDots((current) => toggleDot(current, point));
    setGrade(null);
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    downRef.current = { x: event.clientX, y: event.clientY };
  };

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const down = downRef.current;
    downRef.current = null;
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > TAP_SLOP) return;
    const point = pointFromEvent(event);
    if (point) toggle(point);
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerType !== 'mouse') return;
    setHover(pointFromEvent(event));
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const step = event.shiftKey ? 1 : snapStep;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (moves[event.key]) {
      event.preventDefault();
      const [dx, dy] = moves[event.key];
      setCursor((c) => snapToGrid(c.x + dx, c.y + dy, snapStep, cols, rows));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle(cursor);
    }
  };

  const reset = () => {
    setDots([]);
    setGrade(null);
    setShowAnswer(false);
  };

  const dotColor = (dot: GridPoint) => {
    if (!grade) return 'var(--text-primary)';
    return grade.matched.some((m) => samePoint(m, dot)) ? 'var(--accent-green)' : 'var(--accent-red)';
  };

  const status = grade
    ? gradeSummary(grade, answer.length)
    : dots.length === 0
      ? `Tap a grid point to place a dot for the ${subjectLabel}; tap it again to remove it.`
      : `${dots.length} of ${answer.length} ${dots.length === 1 ? 'dot' : 'dots'} placed.`;

  const halfLines = snapStep < 1;
  const xLabels = Array.from({ length: Math.floor(cols / labelEvery) + 1 }, (_, i) => i * labelEvery);
  // Skip y = 0: the x axis already labels the origin, where the start dot sits.
  const yLabels = Array.from({ length: Math.floor(rows / labelEvery) }, (_, i) => (i + 1) * labelEvery);
  const answerPath = [start, ...answer].map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ');

  return (
    <div className="not-prose mx-auto my-6 w-full max-w-[680px] text-[var(--text-primary)]">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${viewW} ${viewH}`}
        role="application"
        tabIndex={0}
        aria-label={`Grid ${cols} by ${rows} meters. Use arrow keys to move, Shift for whole meters, Enter to place or remove a dot. Cursor at ${fmt(cursor.x)} east, ${fmt(cursor.y)} north.`}
        className="mx-auto block h-auto w-full cursor-crosshair select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)]"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (downRef.current = null)}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <rect x={sx(0)} y={sy(rows)} width={cols * CELL} height={rows * CELL} fill="var(--surface-plot)" />

        {halfLines && (
          <g stroke="var(--grid-line)" strokeWidth={0.6} opacity={0.35} strokeDasharray="2 3">
            {Array.from({ length: cols }, (_, i) => (
              <line key={`hx${i}`} x1={sx(i + 0.5)} x2={sx(i + 0.5)} y1={sy(0)} y2={sy(rows)} />
            ))}
            {Array.from({ length: rows }, (_, i) => (
              <line key={`hy${i}`} x1={sx(0)} x2={sx(cols)} y1={sy(i + 0.5)} y2={sy(i + 0.5)} />
            ))}
          </g>
        )}

        <g stroke="var(--grid-line)" strokeWidth={1}>
          {Array.from({ length: cols + 1 }, (_, i) => (
            <line key={`x${i}`} x1={sx(i)} x2={sx(i)} y1={sy(0)} y2={sy(rows)} />
          ))}
          {Array.from({ length: rows + 1 }, (_, i) => (
            <line key={`y${i}`} x1={sx(0)} x2={sx(cols)} y1={sy(i)} y2={sy(i)} />
          ))}
        </g>

        <g fontSize={11} fill="var(--text-muted)">
          {xLabels.map((x) => (
            <text key={`lx${x}`} x={sx(x)} y={sy(0) + 15} textAnchor="middle">
              {x}
            </text>
          ))}
          {yLabels.map((y) => (
            <text key={`ly${y}`} x={sx(0) - 7} y={sy(y) + 4} textAnchor="end">
              {y}
            </text>
          ))}
          <text x={sx(cols)} y={viewH - 6} textAnchor="end">
            east (m) →
          </text>
          <text x={10} y={sy(rows / 2)} textAnchor="middle" transform={`rotate(-90 10 ${sy(rows / 2)})`}>
            north (m) →
          </text>
        </g>

        {showAnswer && (
          <g>
            <polyline
              points={answerPath}
              fill="none"
              stroke="var(--accent-blue)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              opacity={0.6}
            />
            {answer.map((p, i) => (
              <g key={`a${i}`}>
                <circle cx={sx(p.x)} cy={sy(p.y)} r={8} fill="none" stroke="var(--accent-blue)" strokeWidth={2} />
                <text
                  x={sx(p.x) - 9}
                  y={sy(p.y) - 9}
                  textAnchor="end"
                  fontSize={11}
                  fontWeight={600}
                  fill="var(--accent-blue)"
                  stroke="var(--surface-plot)"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {i + 1} s
                </text>
              </g>
            ))}
          </g>
        )}

        {hover && !samePoint(hover, start) && (
          <circle cx={sx(hover.x)} cy={sy(hover.y)} r={5} fill="var(--text-primary)" opacity={0.25} pointerEvents="none" />
        )}

        {dots.map((dot) => (
          <circle
            key={`d${dot.x},${dot.y}`}
            cx={sx(dot.x)}
            cy={sy(dot.y)}
            r={5}
            fill={dotColor(dot)}
            stroke="var(--surface-plot)"
            strokeWidth={1.5}
          />
        ))}

        <circle cx={sx(start.x)} cy={sy(start.y)} r={6.5} fill="var(--text-primary)" />
        <text x={sx(start.x) + 9} y={sy(start.y) - 8} fontSize={11} fill="var(--text-muted)">
          t = 0 s
        </text>

        {focused && (
          <rect
            x={sx(cursor.x) - 9}
            y={sy(cursor.y) - 9}
            width={18}
            height={18}
            rx={4}
            fill="none"
            stroke="var(--accent-blue)"
            strokeWidth={2}
            pointerEvents="none"
          />
        )}
      </svg>

      <p
        aria-live="polite"
        className={`mt-3 mb-3 text-center text-sm ${
          grade ? (grade.correct ? 'font-semibold text-[var(--accent-green)]' : 'text-[var(--text-primary)]') : 'text-[var(--text-muted)]'
        }`}
      >
        {status}
      </p>

      <ControlBar>
        <Button type="button" onClick={() => setGrade(gradeDots(dots, answer))} disabled={dots.length === 0}>
          Check
        </Button>
        <Button type="button" variant="secondary" onClick={() => setShowAnswer((s) => !s)}>
          {showAnswer ? 'Hide answer' : 'Show answer'}
        </Button>
        <Button type="button" variant="secondary" onClick={reset} disabled={dots.length === 0 && !showAnswer}>
          Reset
        </Button>
      </ControlBar>
    </div>
  );
}
