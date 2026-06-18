import { useMemo, useState, type PointerEvent, type ReactNode } from 'react';
import {
  add,
  directionDegrees,
  formatScalar,
  formatVector,
  magnitude,
  type Vector2,
} from '../../lib/math/vectors';

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 360;
const GRID_MIN_X = -6;
const GRID_MAX_X = 6;
const GRID_MIN_Y = -4;
const GRID_MAX_Y = 4;
const GRID_MARGIN = 36;
const PLOT_WIDTH = VIEW_WIDTH - GRID_MARGIN * 2;
const PLOT_HEIGHT = VIEW_HEIGHT - GRID_MARGIN * 2;

const COLORS = {
  a: '#2563eb',
  b: '#dc2626',
  result: '#16a34a',
  scaled: '#7c3aed',
  muted: '#64748b',
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const toScreen = (point: Vector2): Vector2 => ({
  x: GRID_MARGIN + ((point.x - GRID_MIN_X) / (GRID_MAX_X - GRID_MIN_X)) * PLOT_WIDTH,
  y: GRID_MARGIN + ((GRID_MAX_Y - point.y) / (GRID_MAX_Y - GRID_MIN_Y)) * PLOT_HEIGHT,
});

const toWorld = (point: Vector2): Vector2 => ({
  x: GRID_MIN_X + ((point.x - GRID_MARGIN) / PLOT_WIDTH) * (GRID_MAX_X - GRID_MIN_X),
  y: GRID_MAX_Y - ((point.y - GRID_MARGIN) / PLOT_HEIGHT) * (GRID_MAX_Y - GRID_MIN_Y),
});

const pointerToWorld = <T extends SVGElement>(event: PointerEvent<T>): Vector2 => {
  const svg = event.currentTarget.ownerSVGElement;
  if (!svg) {
    return { x: 0, y: 0 };
  }

  const rect = svg.getBoundingClientRect();
  const screenPoint = {
    x: ((event.clientX - rect.left) / Math.max(rect.width, 1)) * VIEW_WIDTH,
    y: ((event.clientY - rect.top) / Math.max(rect.height, 1)) * VIEW_HEIGHT,
  };
  const worldPoint = toWorld(screenPoint);

  return {
    x: clamp(worldPoint.x, GRID_MIN_X, GRID_MAX_X),
    y: clamp(worldPoint.y, GRID_MIN_Y, GRID_MAX_Y),
  };
};

const snapVector = (vector: Vector2): Vector2 => ({
  x: Math.round(vector.x * 2) / 2,
  y: Math.round(vector.y * 2) / 2,
});

const makeDragHandlers = (setVector: (vector: Vector2) => void) => ({
  onPointerDown: (event: PointerEvent<SVGCircleElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setVector(snapVector(pointerToWorld(event)));
  },
  onPointerMove: (event: PointerEvent<SVGCircleElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      return;
    }

    setVector(snapVector(pointerToWorld(event)));
  },
  onPointerUp: (event: PointerEvent<SVGCircleElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  },
});

export function VectorReaderDemo() {
  const [vector, setVector] = useState<Vector2>({ x: 4, y: 2 });
  const dragHandlers = useMemo(() => makeDragHandlers(setVector), []);

  return (
    <DemoShell
      title="Read a Vector"
      description="Drag the tip. The same arrow can be described by its components, magnitude, and direction."
    >
      <ReadoutGrid>
        <Readout label="components" value={formatVector(vector)} accent={COLORS.a} />
        <Readout label="magnitude" value={formatScalar(magnitude(vector), 2)} />
        <Readout label="direction" value={`${formatScalar(directionDegrees(vector), 0)} deg`} />
      </ReadoutGrid>

      <VectorSvg ariaLabel="Interactive vector reader">
        <Grid />
        <Arrow start={{ x: 0, y: 0 }} vector={vector} color={COLORS.a} label="a" />
        <ComponentLegs vector={vector} />
        <Handle point={vector} color={COLORS.a} label="drag vector tip" {...dragHandlers} />
      </VectorSvg>
    </DemoShell>
  );
}

export function VectorAdditionDemo() {
  const [a, setA] = useState<Vector2>({ x: 3, y: 1.5 });
  const [b, setB] = useState<Vector2>({ x: 1.5, y: 2 });
  const sum = add(a, b);
  const dragA = useMemo(() => makeDragHandlers(setA), []);
  const dragB = useMemo(() => makeDragHandlers(setB), []);

  return (
    <DemoShell
      title="Add Vectors"
      description="Move either tip. The green vector is the graphical and symbolic sum."
    >
      <ReadoutGrid>
        <Readout label="a" value={formatVector(a)} accent={COLORS.a} />
        <Readout label="b" value={formatVector(b)} accent={COLORS.b} />
        <Readout label="a + b" value={`${formatVector(a)} + ${formatVector(b)} = ${formatVector(sum)}`} accent={COLORS.result} />
      </ReadoutGrid>

      <VectorSvg ariaLabel="Interactive vector addition diagram">
        <Grid />
        <Arrow start={{ x: 0, y: 0 }} vector={a} color={COLORS.a} label="a" />
        <Arrow start={a} vector={b} color={COLORS.b} label="copy of b" dashed labelOffset={{ x: -68, y: -34 }} />
        <Arrow start={{ x: 0, y: 0 }} vector={b} color={COLORS.b} label="b" faded />
        <Arrow start={{ x: 0, y: 0 }} vector={sum} color={COLORS.result} label="a + b" width={3.4} />
        <Handle point={a} color={COLORS.a} label="drag vector a" {...dragA} />
        <Handle point={b} color={COLORS.b} label="drag vector b" {...dragB} />
      </VectorSvg>
    </DemoShell>
  );
}

function DemoShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="not-prose my-8 overflow-hidden rounded-2xl border border-[var(--grid-line)] bg-[var(--sim-bg)] p-4 text-[var(--text-primary)] shadow-sm">
      <div className="mb-4">
        <h3 className="m-0 text-lg font-semibold">{title}</h3>
        <p className="mt-1 mb-0 text-sm leading-6 text-[var(--text-muted)]">{description}</p>
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

function ReadoutGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 md:grid-cols-3">{children}</div>;
}

function Readout({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--grid-line)] bg-[var(--bg-primary)] p-3 shadow-sm">
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 mb-0 break-words font-mono text-sm font-semibold md:text-base" style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}

function VectorSvg({ ariaLabel, children }: { ariaLabel: string; children: ReactNode }) {
  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      role="img"
      aria-label={ariaLabel}
      className="block h-auto w-full rounded-lg border border-[var(--grid-line)] bg-[var(--bg-primary)] shadow-sm"
      style={{ touchAction: 'none' }}
    >
      {children}
    </svg>
  );
}

function Grid() {
  const verticalLines = [];
  for (let x = GRID_MIN_X; x <= GRID_MAX_X; x += 1) {
    const screenX = toScreen({ x, y: 0 }).x;
    verticalLines.push(
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

  const horizontalLines = [];
  for (let y = GRID_MIN_Y; y <= GRID_MAX_Y; y += 1) {
    const screenY = toScreen({ x: 0, y }).y;
    horizontalLines.push(
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
      {verticalLines}
      {horizontalLines}
      <text x={VIEW_WIDTH - GRID_MARGIN + 10} y={toScreen({ x: 0, y: 0 }).y + 5} fill="var(--text-muted)" fontSize="13" fontWeight="700">
        x
      </text>
      <text x={toScreen({ x: 0, y: 0 }).x + 8} y={GRID_MARGIN - 12} fill="var(--text-muted)" fontSize="13" fontWeight="700">
        y
      </text>
    </g>
  );
}

function ComponentLegs({ vector }: { vector: Vector2 }) {
  const origin = toScreen({ x: 0, y: 0 });
  const xTip = toScreen({ x: vector.x, y: 0 });
  const tip = toScreen(vector);

  return (
    <g opacity="0.75">
      <line x1={origin.x} y1={origin.y} x2={xTip.x} y2={xTip.y} stroke={COLORS.result} strokeWidth="2" strokeDasharray="6 5" />
      <line x1={xTip.x} y1={xTip.y} x2={tip.x} y2={tip.y} stroke={COLORS.b} strokeWidth="2" strokeDasharray="6 5" />
      <text x={(origin.x + xTip.x) / 2 - 12} y={origin.y - 8} fill={COLORS.result} fontSize="13" fontWeight="700">
        x
      </text>
      <text x={xTip.x + 8} y={(xTip.y + tip.y) / 2} fill={COLORS.b} fontSize="13" fontWeight="700">
        y
      </text>
    </g>
  );
}

function Arrow({
  start,
  vector,
  end,
  color,
  label,
  width = 2.8,
  dashed = false,
  faded = false,
  labelOffset = { x: 0, y: 0 },
}: {
  start: Vector2;
  vector?: Vector2;
  end?: Vector2;
  color: string;
  label: string;
  width?: number;
  dashed?: boolean;
  faded?: boolean;
  labelOffset?: Vector2;
}) {
  const worldEnd = end ?? add(start, vector ?? ZERO_VECTOR);
  const screenStart = toScreen(start);
  const screenEnd = toScreen(worldEnd);
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
  const shaftEnd = {
    x: screenEnd.x - ux * headLength,
    y: screenEnd.y - uy * headLength,
  };
  const left = {
    x: shaftEnd.x - uy * headWidth,
    y: shaftEnd.y + ux * headWidth,
  };
  const right = {
    x: shaftEnd.x + uy * headWidth,
    y: shaftEnd.y - ux * headWidth,
  };
  const labelX = screenEnd.x + (ux >= 0 ? 10 : -44) + labelOffset.x;
  const labelY = screenEnd.y + (uy >= 0 ? 18 : -10) + labelOffset.y;

  return (
    <g opacity={faded ? 0.48 : 1}>
      <line
        x1={screenStart.x}
        y1={screenStart.y}
        x2={shaftEnd.x}
        y2={shaftEnd.y}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={dashed ? '8 7' : undefined}
      />
      <polygon
        points={`${screenEnd.x},${screenEnd.y} ${left.x},${left.y} ${right.x},${right.y}`}
        fill={color}
      />
      <text x={labelX} y={labelY} fill={color} fontSize="13" fontWeight="800">
        {label}
      </text>
    </g>
  );
}

function Handle({
  point,
  color,
  label,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  point: Vector2;
  color: string;
  label: string;
  onPointerDown: (event: PointerEvent<SVGCircleElement>) => void;
  onPointerMove: (event: PointerEvent<SVGCircleElement>) => void;
  onPointerUp: (event: PointerEvent<SVGCircleElement>) => void;
}) {
  const screen = toScreen(point);

  return (
    <circle
      cx={screen.x}
      cy={screen.y}
      r="9"
      fill="var(--bg-primary)"
      stroke={color}
      strokeWidth="4"
      className="cursor-grab"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}

const ZERO_VECTOR: Vector2 = { x: 0, y: 0 };
