import { useMemo, useState, type PointerEvent, type ReactNode } from 'react';
import { add, formatScalar, formatVector, magnitude, scale, type Vector2 } from '../../lib/math/vectors';

const VIEW_WIDTH = 640;
const GRID_MIN_X = -6;
const GRID_MAX_X = 6;
const GRID_MIN_Y = -4;
const GRID_MAX_Y = 4;
const GRID_MARGIN = 36;
const PLOT_WIDTH = VIEW_WIDTH - GRID_MARGIN * 2;
const GRID_UNIT = PLOT_WIDTH / (GRID_MAX_X - GRID_MIN_X);
const PLOT_HEIGHT = GRID_UNIT * (GRID_MAX_Y - GRID_MIN_Y);
const VIEW_HEIGHT = PLOT_HEIGHT + GRID_MARGIN * 2;

// Keep the base tip in a region where doubling it still fits on the grid, so the
// scaled arrow never runs off the field for any allowed scalar.
const BASE_LIMIT = { x: 3, y: 2 };
const SCALAR_MIN = -2;
const SCALAR_MAX = 2;
const SCALAR_STEP = 0.5;

const COLORS = {
  base: '#2563eb',
  scaled: '#7c3aed',
  muted: '#64748b',
};

const ZERO: Vector2 = { x: 0, y: 0 };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const toScreen = (point: Vector2): Vector2 => ({
  x: GRID_MARGIN + ((point.x - GRID_MIN_X) / (GRID_MAX_X - GRID_MIN_X)) * PLOT_WIDTH,
  y: GRID_MARGIN + ((GRID_MAX_Y - point.y) / (GRID_MAX_Y - GRID_MIN_Y)) * PLOT_HEIGHT,
});

const snap = (value: number) => Math.round(value);

const pointerToBase = (event: PointerEvent<SVGCircleElement>): Vector2 => {
  const svg = event.currentTarget.ownerSVGElement;
  if (!svg) {
    return ZERO;
  }
  const rect = svg.getBoundingClientRect();
  const screenX = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * VIEW_WIDTH;
  const screenY = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * VIEW_HEIGHT;
  const worldX = GRID_MIN_X + ((screenX - GRID_MARGIN) / PLOT_WIDTH) * (GRID_MAX_X - GRID_MIN_X);
  const worldY = GRID_MAX_Y - ((screenY - GRID_MARGIN) / PLOT_HEIGHT) * (GRID_MAX_Y - GRID_MIN_Y);
  return {
    x: clamp(snap(worldX), -BASE_LIMIT.x, BASE_LIMIT.x),
    y: clamp(snap(worldY), -BASE_LIMIT.y, BASE_LIMIT.y),
  };
};

const PRESETS: { label: string; value: number }[] = [
  { label: '−1 (negate)', value: -1 },
  { label: '0', value: 0 },
  { label: '½', value: 0.5 },
  { label: '2', value: 2 },
];

export function ScalarScaler() {
  const [base, setBase] = useState<Vector2>({ x: 2, y: 1 });
  const [scalar, setScalar] = useState(2);
  const scaled = useMemo(() => scale(base, scalar), [base, scalar]);

  const dragHandlers = {
    onPointerDown: (event: PointerEvent<SVGCircleElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      setBase(pointerToBase(event));
    },
    onPointerMove: (event: PointerEvent<SVGCircleElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
        return;
      }
      setBase(pointerToBase(event));
    },
    onPointerUp: (event: PointerEvent<SVGCircleElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
  };

  const flipped = scalar < 0;

  return (
    <section className="not-prose my-8 overflow-hidden rounded-2xl border border-[var(--grid-line)] bg-[var(--sim-bg)] p-4 text-[var(--text-primary)] shadow-sm">
      <div className="mb-4">
        <h3 className="m-0 text-lg font-semibold">Scale a Vector</h3>
        <p className="mt-1 mb-0 text-sm leading-6 text-[var(--text-muted)]">
          Drag the blue tip to set the base hop, then slide the scalar. Stretching changes the
          length; a negative scalar flips the hop to point the opposite way.
        </p>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Readout label="base a" value={formatVector(base)} accent={COLORS.base} />
          <Readout label="scalar c" value={formatScalar(scalar, 1)} />
          <Readout
            label="c · a"
            value={formatVector(scaled)}
            accent={COLORS.scaled}
          />
        </div>

        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          role="img"
          aria-label={`Vector ${formatVector(base)} scaled by ${formatScalar(scalar, 1)} gives ${formatVector(scaled)}`}
          className="block h-auto w-full rounded-lg border border-[var(--grid-line)] bg-[var(--bg-primary)] shadow-sm"
          style={{ touchAction: 'none' }}
        >
          <Grid />
          {/* Both arrows are collinear, so they are drawn semi-transparent and
              their labels sit on opposite sides to stay readable when overlapping. */}
          <Arrow start={ZERO} vector={scaled} color={COLORS.scaled} label="c · a" width={4.2} opacity={0.75} labelSide={-1} />
          <Arrow start={ZERO} vector={base} color={COLORS.base} label="a" opacity={0.8} labelSide={1} />
          <Handle point={base} color={COLORS.base} {...dragHandlers} />
        </svg>

        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="scalar-range" className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              scalar c
            </label>
            <input
              id="scalar-range"
              type="range"
              min={SCALAR_MIN}
              max={SCALAR_MAX}
              step={SCALAR_STEP}
              value={scalar}
              onChange={(event) => setScalar(Number(event.target.value))}
              className="h-2 flex-1 cursor-pointer accent-[var(--accent-blue)]"
            />
            <span className="w-12 text-right font-mono text-sm font-semibold" style={{ color: COLORS.scaled }}>
              {formatScalar(scalar, 1)}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setScalar(preset.value)}
                aria-pressed={scalar === preset.value}
                className="rounded-lg border border-[var(--grid-line)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--accent-blue)] aria-pressed:border-[var(--accent-blue)] aria-pressed:text-[var(--accent-blue)]"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <p className="m-0 font-mono text-xs leading-6 text-[var(--text-muted)]">
          {formatScalar(scalar, 1)} · {formatVector(base)} {' = '}
          <span style={{ color: COLORS.scaled }}>{formatVector(scaled)}</span>
          {'   |c · a| = '}
          <span style={{ color: COLORS.scaled }}>{formatScalar(magnitude(scaled), 2)}</span>
          {flipped && ' — negative c points the hop the opposite way (negation).'}
        </p>
      </div>
    </section>
  );
}

function Readout({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--grid-line)] bg-[var(--bg-primary)] p-3 shadow-sm">
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </p>
      <p className="mt-1 mb-0 break-words font-mono text-sm font-semibold md:text-base" style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}

function Grid() {
  const lines: ReactNode[] = [];
  for (let x = GRID_MIN_X; x <= GRID_MAX_X; x += 1) {
    const screenX = toScreen({ x, y: 0 }).x;
    lines.push(
      <line
        key={`x-${x}`}
        x1={screenX}
        y1={GRID_MARGIN}
        x2={screenX}
        y2={VIEW_HEIGHT - GRID_MARGIN}
        stroke="var(--grid-line)"
        strokeWidth={x === 0 ? 2 : 1}
      />,
    );
  }
  for (let y = GRID_MIN_Y; y <= GRID_MAX_Y; y += 1) {
    const screenY = toScreen({ x: 0, y }).y;
    lines.push(
      <line
        key={`y-${y}`}
        x1={GRID_MARGIN}
        y1={screenY}
        x2={VIEW_WIDTH - GRID_MARGIN}
        y2={screenY}
        stroke="var(--grid-line)"
        strokeWidth={y === 0 ? 2 : 1}
      />,
    );
  }
  return (
    <g>
      <rect
        x={GRID_MARGIN}
        y={GRID_MARGIN}
        width={PLOT_WIDTH}
        height={PLOT_HEIGHT}
        fill="transparent"
        stroke="var(--grid-line)"
      />
      {lines}
      <text x={VIEW_WIDTH - GRID_MARGIN + 10} y={toScreen({ x: 0, y: 0 }).y + 5} fill="var(--text-muted)" fontSize="13" fontWeight="700">
        x
      </text>
      <text x={toScreen({ x: 0, y: 0 }).x + 8} y={GRID_MARGIN - 12} fill="var(--text-muted)" fontSize="13" fontWeight="700">
        y
      </text>
    </g>
  );
}

function Arrow({
  start,
  vector,
  color,
  label,
  width = 2.8,
  opacity = 1,
  labelSide = 1,
}: {
  start: Vector2;
  vector: Vector2;
  color: string;
  label: string;
  width?: number;
  opacity?: number;
  /** Which side of the shaft the label sits on (+1 or -1) so labels never collide. */
  labelSide?: number;
}) {
  const screenStart = toScreen(start);
  const screenEnd = toScreen(add(start, vector));
  const dx = screenEnd.x - screenStart.x;
  const dy = screenEnd.y - screenStart.y;
  const length = Math.hypot(dx, dy);
  if (length < 2) {
    return null;
  }
  const ux = dx / length;
  const uy = dy / length;
  const headLength = 13;
  const headWidth = 8;
  const shaftEnd = { x: screenEnd.x - ux * headLength, y: screenEnd.y - uy * headLength };
  const left = { x: shaftEnd.x - uy * headWidth, y: shaftEnd.y + ux * headWidth };
  const right = { x: shaftEnd.x + uy * headWidth, y: shaftEnd.y - ux * headWidth };
  // Offset the label perpendicular to the shaft (and a touch past the tip) so it
  // sits beside the arrow instead of under it; opposite sides keep the two
  // collinear arrows' labels apart.
  const labelX = screenEnd.x - uy * 18 * labelSide + ux * 6;
  const labelY = screenEnd.y + ux * 18 * labelSide + uy * 6 + 4;
  return (
    <g opacity={opacity}>
      <line
        x1={screenStart.x}
        y1={screenStart.y}
        x2={shaftEnd.x}
        y2={shaftEnd.y}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
      />
      <polygon points={`${screenEnd.x},${screenEnd.y} ${left.x},${left.y} ${right.x},${right.y}`} fill={color} />
      <text x={labelX} y={labelY} textAnchor="middle" fill={color} fontSize="13" fontWeight="800">
        {label}
      </text>
    </g>
  );
}

function Handle({
  point,
  color,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  point: Vector2;
  color: string;
  onPointerDown: (event: PointerEvent<SVGCircleElement>) => void;
  onPointerMove: (event: PointerEvent<SVGCircleElement>) => void;
  onPointerUp: (event: PointerEvent<SVGCircleElement>) => void;
}) {
  const screen = toScreen(point);
  return (
    <circle
      cx={screen.x}
      cy={screen.y}
      r="11"
      fill="transparent"
      stroke={color}
      strokeWidth="3"
      className="cursor-grab"
      aria-label="drag base vector tip"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}
