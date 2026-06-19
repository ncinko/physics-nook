import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import {
  add,
  directionDegrees,
  formatScalar,
  formatVector,
  magnitude,
  type Vector2,
} from '../../lib/math/vectors';
import { BunnySprite, type BunnyFrameName } from './BunnySprite';

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

const COLORS = {
  a: '#2563eb',
  b: '#dc2626',
  result: '#16a34a',
  scaled: '#7c3aed',
  muted: '#64748b',
  carrot: '#ea580c',
  carrotLeaf: '#16a34a',
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
      description="This graphical representation can also be described by its components, magnitude, and direction."
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

type BunnyState = { x: number; y: number; dir: number; frame: BunnyFrameName };

export function VectorAdditionDemo() {
  const [a, setA] = useState<Vector2>({ x: 3, y: 1.5 });
  const [b, setB] = useState<Vector2>({ x: 1.5, y: 2 });
  const [firstHop, setFirstHop] = useState<'hop1' | 'hop2'>('hop1');
  const [phase, setPhase] = useState<'idle' | 'hopping' | 'landed'>('idle');
  const sum = add(a, b);
  const dragA = useMemo(() => makeDragHandlers(setA), []);
  const dragB = useMemo(() => makeDragHandlers(setB), []);

  // The bunny shows the sum by actually taking the two hops, instead of the
  // resultant being drawn the moment the tips move.
  const [bunny, setBunny] = useState<BunnyState>(() => {
    const origin = toScreen(ZERO_VECTOR);
    return { x: origin.x, y: origin.y, dir: 1, frame: 'sit' };
  });
  const rafRef = useRef<number | null>(null);

  // Changing the hops or the order sends the bunny back to the start so the
  // resultant is re-discovered by hopping rather than pre-drawn.
  useEffect(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const origin = toScreen(ZERO_VECTOR);
    setPhase('idle');
    setBunny({ x: origin.x, y: origin.y, dir: 1, frame: 'sit' });
  }, [a, b, firstHop]);

  useEffect(
    () => () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    },
    [],
  );

  const hop = () => {
    if (phase === 'hopping') {
      return;
    }
    // Two waypoints between three corners: start → first hop's tip → carrot.
    const lead = firstHop === 'hop1' ? a : b;
    const route = [ZERO_VECTOR, lead, sum].map(toScreen);
    setPhase('hopping');

    const segDuration = 460;
    let seg = 0;
    let segStart = performance.now();

    const step = (now: number) => {
      const p0 = route[seg];
      const p1 = route[seg + 1];
      const span = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const hopHeight = Math.min(72, 22 + span * 0.18);
      const t = Math.min(1, (now - segStart) / segDuration);
      const lift = Math.sin(Math.PI * t) * hopHeight;
      const dir = p1.x - p0.x >= 0 ? 1 : -1;
      setBunny({
        x: p0.x + (p1.x - p0.x) * t,
        y: p0.y + (p1.y - p0.y) * t - lift,
        dir,
        frame: lift > 1 ? 'hop' : 'sit',
      });

      if (t >= 1) {
        seg += 1;
        if (seg >= route.length - 1) {
          const landing = route[route.length - 1];
          rafRef.current = null;
          setBunny({ x: landing.x, y: landing.y, dir, frame: 'sit' });
          setPhase('landed');
          return;
        }
        segStart = now;
      }
      rafRef.current = requestAnimationFrame(step);
    };

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(step);
  };

  const first = firstHop === 'hop1' ? a : b;
  const second = firstHop === 'hop1' ? b : a;
  const firstColor = firstHop === 'hop1' ? COLORS.a : COLORS.b;
  const secondColor = firstHop === 'hop1' ? COLORS.b : COLORS.a;
  const firstLabel = firstHop === 'hop1' ? 'hop 1' : 'hop 2';
  const secondLabel = firstHop === 'hop1' ? 'hop 2' : 'hop 1';
  const carrot = toScreen(sum);

  return (
    <DemoShell
      title="Add Two Hops"
      description="Adjust the hop vectors, and then press Hop! to send the bunny on its way. Swap the order — either route lands on the same carrot."
    >
      <ReadoutGrid>
        <Readout label="hop 1" value={formatVector(a)} accent={COLORS.a} />
        <Readout label="hop 2" value={formatVector(b)} accent={COLORS.b} />
        <Readout
          label="hop 1 + hop 2"
          value={
            phase === 'landed'
              ? `${formatVector(a)} + ${formatVector(b)} = ${formatVector(sum)}`
              : 'Press Hop! to combine the hops'
          }
          accent={phase === 'landed' ? COLORS.result : COLORS.muted}
        />
      </ReadoutGrid>

      <VectorSvg ariaLabel="Interactive bunny vector addition diagram">
        <Grid />
        <Carrot point={carrot} reached={phase === 'landed'} />
        {/* Alternate order, faded: the other hop first, completing the parallelogram. */}
        <Arrow start={ZERO_VECTOR} vector={second} color={secondColor} label="" faded />
        <Arrow start={second} vector={first} color={firstColor} label="" faded />
        {/* Active order, solid: the route the bunny is about to take. */}
        <Arrow start={ZERO_VECTOR} vector={first} color={firstColor} label={firstLabel} />
        <Arrow start={first} vector={second} color={secondColor} label={secondLabel} labelOffset={{ x: -4, y: 0 }} />
        {phase === 'landed' && (
          <Arrow
            start={ZERO_VECTOR}
            vector={sum}
            color={COLORS.result}
            label="hop 1 + hop 2"
            width={3.4}
            labelOffset={{ x: 0, y: 20 }}
          />
        )}
        <Handle point={a} color={COLORS.a} label="drag hop 1 tip" {...dragA} />
        <Handle point={b} color={COLORS.b} label="drag hop 2 tip" {...dragB} />
        <g transform={`translate(${bunny.x}, ${bunny.y}) scale(${bunny.dir}, 1)`}>
          <BunnySprite frame={bunny.frame} cell={2.5} />
        </g>
      </VectorSvg>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={hop}
          disabled={phase === 'hopping'}
          className="rounded-lg border border-[var(--accent-blue)] bg-[var(--accent-blue)] px-3 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          {phase === 'landed' ? 'Hop again' : 'Hop!'}
        </button>
        <button
          type="button"
          onClick={() => setFirstHop((current) => (current === 'hop1' ? 'hop2' : 'hop1'))}
          className="rounded-lg border border-[var(--grid-line)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--accent-blue)]"
        >
          Swap order
        </button>
        <span className="font-mono text-xs text-[var(--text-muted)]">
          hopping {firstLabel} → {secondLabel}
        </span>
      </div>

      {phase === 'landed' && (
        <p
          className="m-0 rounded-lg border px-3 py-2 text-sm font-semibold"
          style={{
            color: COLORS.result,
            borderColor: COLORS.result,
            background: 'color-mix(in srgb, #16a34a 12%, var(--bg-primary))',
          }}
        >
          Munch! Hop 1 then hop 2 — or hop 2 then hop 1 — both land on the carrot at {formatVector(sum)}. One
          combined hop of {formatVector(sum)} gets there directly.
        </p>
      )}
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

  // Open ring (transparent fill) so the arrow tip stays visible through it while
  // the whole disc remains grabbable.
  return (
    <circle
      cx={screen.x}
      cy={screen.y}
      r="10"
      fill="transparent"
      stroke={color}
      strokeWidth="3"
      className="cursor-grab"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}

function Carrot({ point, reached }: { point: Vector2; reached: boolean }) {
  const { x, y } = point;
  return (
    <g opacity={reached ? 0.3 : 1}>
      <polygon points={`${x - 7},${y - 30} ${x + 7},${y - 30} ${x},${y}`} fill={COLORS.carrot} />
      <path
        d={`M ${x} ${y - 30} l -7 -8 M ${x} ${y - 30} l 0 -11 M ${x} ${y - 30} l 7 -8`}
        stroke={COLORS.carrotLeaf}
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
      />
    </g>
  );
}

const ZERO_VECTOR: Vector2 = { x: 0, y: 0 };
