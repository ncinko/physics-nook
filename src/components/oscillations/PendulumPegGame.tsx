import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  MapPin,
  Play,
  RotateCcw,
  Scissors,
  Target,
  Trophy,
} from 'lucide-react';
import {
  clamp,
  clampPointToZone,
  createRopeNodes,
  cutRopeAtSegment,
  findNearestRopeSegment,
  getLandingScore,
  hasLanded,
  stepRope,
  type Circle,
  type Point,
  type RectZone,
  type RopeNode,
} from '../../lib/oscillations/pendulumPeg';

type GamePhase = 'placing' | 'ready' | 'swinging' | 'cut' | 'landed';

interface StageLayout {
  width: number;
  height: number;
  anchor: Point;
  initialBob: Point;
  groundY: number;
  targetX: number;
  targetRadius: number;
  bobRadius: number;
  pegRadius: number;
  segmentCount: number;
  segmentLength: number;
  pegZone: RectZone;
  defaultPeg: Circle;
}

interface GameRuntime {
  layout: StageLayout;
  rope: RopeNode[];
  peg: Circle;
  phase: GamePhase;
  snipUsed: boolean;
  hasPlacedPeg: boolean;
  score: number | null;
  best: number | null;
}

interface Snapshot {
  phase: GamePhase;
  snipUsed: boolean;
  hasPlacedPeg: boolean;
  score: number | null;
  best: number | null;
}

interface DragState {
  active: boolean;
  pointerId: number | null;
}

const STORAGE_KEY = 'physics-nook-pendulum-peg-best';
const INITIAL_ANGLE = -0.82;
const SEGMENT_COUNT = 36;
const GRAVITY = 980;
const ROPE_DAMPING = 0.996;
const ROPE_ITERATIONS = 12;
const STRING_CUT_HIT_RADIUS = 20;

const emptyDragState = (): DragState => ({
  active: false,
  pointerId: null,
});

const getPointInElement = (
  element: HTMLDivElement,
  event: ReactPointerEvent<HTMLDivElement>,
): Point => {
  const rect = element.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
};

const formatPixels = (value: number | null) =>
  value === null ? '--' : `${Math.round(value)} px`;

const getCssColor = (name: string, fallback: string) => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

const buildLayout = (width: number, height: number): StageLayout => {
  const safeWidth = Math.max(width, 320);
  const safeHeight = Math.max(height, 460);
  const bobRadius = clamp(Math.min(safeWidth, safeHeight) * 0.026, 12, 20);
  const pegRadius = clamp(Math.min(safeWidth, safeHeight) * 0.032, 16, 26);
  const groundY = safeHeight - clamp(safeHeight * 0.13, 72, 116);
  const anchor = {
    x: clamp(safeWidth * 0.25, 86, safeWidth * 0.44),
    y: clamp(safeHeight * 0.16, 82, 138),
  };
  const availableLength = Math.max(180, groundY - anchor.y - bobRadius - 42);
  const ropeLength = Math.min(
    clamp(Math.min(safeWidth * 0.58, safeHeight * 0.52), 190, 430),
    availableLength,
  );
  const initialBob = {
    x: anchor.x + Math.sin(INITIAL_ANGLE) * ropeLength,
    y: anchor.y + Math.cos(INITIAL_ANGLE) * ropeLength,
  };
  const targetX = clamp(safeWidth * 0.77, 210, safeWidth - 58);
  const targetRadius = clamp(Math.min(safeWidth, safeHeight) * 0.04, 18, 34);
  const zoneMargin = clamp(safeWidth * 0.08, 36, 92);
  const zoneMinX = clamp(anchor.x + 44, zoneMargin, safeWidth - zoneMargin);
  const zoneMaxX = Math.max(zoneMinX, Math.min(safeWidth - zoneMargin, targetX - 28));
  const pegZone = {
    minX: zoneMinX,
    maxX: zoneMaxX,
    minY: anchor.y + 46,
    maxY: Math.max(anchor.y + 46, groundY - 78),
  };
  const defaultPeg = {
    ...clampPointToZone(
      {
        x: anchor.x + ropeLength * 0.74,
        y: anchor.y + ropeLength * 0.58,
      },
      pegZone,
    ),
    radius: pegRadius,
  };

  return {
    width: safeWidth,
    height: safeHeight,
    anchor,
    initialBob,
    groundY,
    targetX,
    targetRadius,
    bobRadius,
    pegRadius,
    segmentCount: SEGMENT_COUNT,
    segmentLength: ropeLength / SEGMENT_COUNT,
    pegZone,
    defaultPeg,
  };
};

const createRuntime = (width: number, height: number, best: number | null): GameRuntime => {
  const layout = buildLayout(width, height);

  return {
    layout,
    rope: createRopeNodes(layout.anchor, layout.initialBob, layout.segmentCount),
    peg: layout.defaultPeg,
    phase: 'placing',
    snipUsed: false,
    hasPlacedPeg: false,
    score: null,
    best,
  };
};

const traceRope = (context: CanvasRenderingContext2D, rope: RopeNode[]) => {
  if (rope.length === 0) {
    return;
  }

  context.beginPath();
  context.moveTo(rope[0].x, rope[0].y);

  if (rope.length === 2) {
    context.lineTo(rope[1].x, rope[1].y);
    return;
  }

  for (let index = 1; index < rope.length - 1; index += 1) {
    const current = rope[index];
    const next = rope[index + 1];
    context.quadraticCurveTo(
      current.x,
      current.y,
      (current.x + next.x) * 0.5,
      (current.y + next.y) * 0.5,
    );
  }

  const last = rope[rope.length - 1];
  context.lineTo(last.x, last.y);
};

export default function PendulumPegGame() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<GameRuntime | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const dragRef = useRef<DragState>(emptyDragState());
  const bestRef = useRef<number | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>({
    phase: 'placing',
    snipUsed: false,
    hasPlacedPeg: false,
    score: null,
    best: null,
  });

  const publishSnapshot = () => {
    const runtime = runtimeRef.current;

    if (!runtime) {
      return;
    }

    setSnapshot({
      phase: runtime.phase,
      snipUsed: runtime.snipUsed,
      hasPlacedPeg: runtime.hasPlacedPeg,
      score: runtime.score,
      best: runtime.best,
    });
  };

  const resetAttempt = () => {
    const container = containerRef.current;
    const rect = container?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    runtimeRef.current = createRuntime(rect.width, rect.height, bestRef.current);
    lastFrameTimeRef.current = null;
    publishSnapshot();
  };

  const releasePendulum = () => {
    const runtime = runtimeRef.current;

    if (!runtime || runtime.phase !== 'ready') {
      return;
    }

    runtime.phase = 'swinging';
    runtime.score = null;
    runtime.snipUsed = false;
    runtime.rope.forEach((node) => {
      node.previousX = node.x;
      node.previousY = node.y;
    });
    publishSnapshot();
  };

  const cutString = (segmentIndex?: number) => {
    const runtime = runtimeRef.current;

    if (!runtime || runtime.snipUsed || runtime.phase !== 'swinging') {
      return;
    }

    const index = segmentIndex ?? runtime.rope.length - 2;
    runtime.rope = cutRopeAtSegment(runtime.rope, index);
    runtime.phase = 'cut';
    runtime.snipUsed = true;
    publishSnapshot();
  };

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const parsedBest = stored === null ? null : Number(stored);
    bestRef.current =
      typeof parsedBest === 'number' && Number.isFinite(parsedBest) ? parsedBest : null;

    if (runtimeRef.current) {
      runtimeRef.current.best = bestRef.current;
      publishSnapshot();
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;

    if (!container || !canvas) {
      return undefined;
    }

    const context = canvas.getContext('2d');

    if (!context) {
      return undefined;
    }

    let dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(rect.width, 1);
      const height = Math.max(rect.height, 1);
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      runtimeRef.current = createRuntime(width, height, bestRef.current);
      lastFrameTimeRef.current = null;
      publishSnapshot();
    };

    const drawBackground = (layout: StageLayout) => {
      const bg = getCssColor('--bg-primary', '#ffffff');
      const grid = getCssColor('--grid-line', '#d1d5db');
      const sim = getCssColor('--sim-bg', '#f9fafb');

      context.clearRect(0, 0, layout.width, layout.height);
      context.fillStyle = bg;
      context.fillRect(0, 0, layout.width, layout.height);

      const gradient = context.createLinearGradient(0, 0, layout.width, layout.height);
      gradient.addColorStop(0, 'rgba(59, 130, 246, 0.14)');
      gradient.addColorStop(0.52, sim);
      gradient.addColorStop(1, 'rgba(15, 118, 110, 0.12)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, layout.width, layout.height);

      context.save();
      context.globalAlpha = 0.42;
      context.strokeStyle = grid;
      context.lineWidth = 1;
      const spacing = 48;

      for (let x = -spacing; x < layout.width + spacing; x += spacing) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, layout.height);
        context.stroke();
      }

      for (let y = -spacing; y < layout.height + spacing; y += spacing) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(layout.width, y);
        context.stroke();
      }

      context.restore();
    };

    const drawTarget = (layout: StageLayout) => {
      context.save();
      context.strokeStyle = '#dc2626';
      context.fillStyle = '#dc2626';
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(layout.targetX, layout.groundY - layout.targetRadius * 2.8);
      context.lineTo(layout.targetX, layout.groundY + 7);
      context.stroke();
      context.beginPath();
      context.moveTo(layout.targetX, layout.groundY - layout.targetRadius * 2.8);
      context.lineTo(layout.targetX + layout.targetRadius * 1.24, layout.groundY - layout.targetRadius * 2.36);
      context.lineTo(layout.targetX, layout.groundY - layout.targetRadius * 1.92);
      context.closePath();
      context.fill();

      for (let ring = 0; ring < 3; ring += 1) {
        context.beginPath();
        context.arc(
          layout.targetX,
          layout.groundY,
          layout.targetRadius * (1 - ring * 0.28),
          Math.PI,
          Math.PI * 2,
        );
        context.strokeStyle = ring % 2 === 0 ? '#dc2626' : '#f8fafc';
        context.lineWidth = ring === 0 ? 3 : 2;
        context.stroke();
      }

      context.restore();
    };

    const drawRuntime = () => {
      const runtime = runtimeRef.current;

      if (!runtime) {
        return;
      }

      const { layout, rope, peg } = runtime;
      const text = getCssColor('--text-primary', '#111827');
      const grid = getCssColor('--grid-line', '#d1d5db');

      drawBackground(layout);

      context.save();
      context.strokeStyle = grid;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(0, layout.groundY);
      context.lineTo(layout.width, layout.groundY);
      context.stroke();
      context.restore();

      drawTarget(layout);

      if (runtime.phase === 'placing' || runtime.phase === 'ready') {
        context.save();
        context.fillStyle = 'rgba(59, 130, 246, 0.06)';
        context.strokeStyle = 'rgba(59, 130, 246, 0.3)';
        context.setLineDash([7, 8]);
        context.lineWidth = 2;
        context.strokeRect(
          layout.pegZone.minX,
          layout.pegZone.minY,
          layout.pegZone.maxX - layout.pegZone.minX,
          layout.pegZone.maxY - layout.pegZone.minY,
        );
        context.fillRect(
          layout.pegZone.minX,
          layout.pegZone.minY,
          layout.pegZone.maxX - layout.pegZone.minX,
          layout.pegZone.maxY - layout.pegZone.minY,
        );
        context.restore();
      }

      context.save();
      context.strokeStyle = text;
      context.fillStyle = text;
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(layout.anchor.x - 76, layout.anchor.y - 18);
      context.lineTo(layout.anchor.x + 76, layout.anchor.y - 18);
      context.stroke();
      context.beginPath();
      context.arc(layout.anchor.x, layout.anchor.y, 7, 0, Math.PI * 2);
      context.fill();
      context.restore();

      context.save();
      context.shadowColor = 'rgba(234, 88, 12, 0.32)';
      context.shadowBlur = 16;
      context.fillStyle = '#f97316';
      context.strokeStyle = '#7c2d12';
      context.lineWidth = 3;
      context.beginPath();
      context.arc(peg.x, peg.y, peg.radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.shadowBlur = 0;
      context.strokeStyle = 'rgba(255, 255, 255, 0.72)';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(peg.x, peg.y, peg.radius * 0.54, 0, Math.PI * 2);
      context.stroke();
      context.restore();

      context.save();
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.shadowColor = 'rgba(15, 23, 42, 0.16)';
      context.shadowBlur = 8;
      context.strokeStyle = runtime.snipUsed ? '#64748b' : '#0f766e';
      context.lineWidth = 4;
      traceRope(context, rope);
      context.stroke();
      context.shadowBlur = 0;
      context.strokeStyle = 'rgba(255, 255, 255, 0.62)';
      context.lineWidth = 1.4;
      traceRope(context, rope);
      context.stroke();
      context.restore();

      const bob = rope[rope.length - 1];
      const bobGradient = context.createRadialGradient(
        bob.x - layout.bobRadius * 0.35,
        bob.y - layout.bobRadius * 0.38,
        layout.bobRadius * 0.12,
        bob.x,
        bob.y,
        layout.bobRadius,
      );
      bobGradient.addColorStop(0, '#bfdbfe');
      bobGradient.addColorStop(0.44, '#3b82f6');
      bobGradient.addColorStop(1, '#1d4ed8');
      context.save();
      context.shadowColor = 'rgba(59, 130, 246, 0.34)';
      context.shadowBlur = 18;
      context.fillStyle = bobGradient;
      context.beginPath();
      context.arc(bob.x, bob.y, layout.bobRadius, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      context.strokeStyle = 'rgba(15, 23, 42, 0.32)';
      context.lineWidth = 2;
      context.stroke();
      context.restore();
    };

    const step = (dt: number) => {
      const runtime = runtimeRef.current;

      if (!runtime || (runtime.phase !== 'swinging' && runtime.phase !== 'cut')) {
        return;
      }

      const fixedStart = runtime.phase === 'swinging';

      if (fixedStart) {
        const anchor = runtime.rope[0];
        anchor.x = runtime.layout.anchor.x;
        anchor.y = runtime.layout.anchor.y;
        anchor.previousX = runtime.layout.anchor.x;
        anchor.previousY = runtime.layout.anchor.y;
      }

      stepRope(runtime.rope, {
        dt,
        gravity: GRAVITY,
        damping: ROPE_DAMPING,
        segmentLength: runtime.layout.segmentLength,
        iterations: ROPE_ITERATIONS,
        fixedStart,
        peg: runtime.peg,
        pegPadding: 3,
      });

      if (fixedStart) {
        const anchor = runtime.rope[0];
        anchor.x = runtime.layout.anchor.x;
        anchor.y = runtime.layout.anchor.y;
      }

      const bob = runtime.rope[runtime.rope.length - 1];

      if (hasLanded(bob, runtime.layout.bobRadius, runtime.layout.groundY)) {
        bob.y = runtime.layout.groundY - runtime.layout.bobRadius;
        bob.previousX = bob.x;
        bob.previousY = bob.y;
        runtime.score = getLandingScore(bob.x, runtime.layout.targetX);
        runtime.phase = 'landed';

        if (runtime.best === null || runtime.score < runtime.best) {
          runtime.best = runtime.score;
          bestRef.current = runtime.score;
          window.localStorage.setItem(STORAGE_KEY, String(runtime.score));
        }

        publishSnapshot();
      }
    };

    const animate = (timestamp: number) => {
      const previous = lastFrameTimeRef.current ?? timestamp;
      lastFrameTimeRef.current = timestamp;
      const dt = clamp((timestamp - previous) / 1000, 0.001, 0.024);

      step(dt);
      drawRuntime();
      animationRef.current = window.requestAnimationFrame(animate);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    animationRef.current = window.requestAnimationFrame(animate);

    return () => {
      observer.disconnect();

      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
      }

      animationRef.current = null;
      lastFrameTimeRef.current = null;
    };
  }, []);

  const placePeg = (point: Point) => {
    const runtime = runtimeRef.current;

    if (!runtime || (runtime.phase !== 'placing' && runtime.phase !== 'ready')) {
      return;
    }

    runtime.peg = {
      ...clampPointToZone(point, runtime.layout.pegZone),
      radius: runtime.layout.pegRadius,
    };
    runtime.phase = 'ready';
    runtime.hasPlacedPeg = true;
    publishSnapshot();
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const container = containerRef.current;
    const runtime = runtimeRef.current;

    if (!container || !runtime) {
      return;
    }

    const point = getPointInElement(container, event);

    if (runtime.phase === 'placing' || runtime.phase === 'ready') {
      event.preventDefault();
      placePeg(point);
      dragRef.current = {
        active: true,
        pointerId: event.pointerId,
      };
      container.setPointerCapture(event.pointerId);
      return;
    }

    if (runtime.phase === 'swinging' && !runtime.snipUsed) {
      const nearestSegment = findNearestRopeSegment(
        runtime.rope,
        point,
        STRING_CUT_HIT_RADIUS,
      );

      if (nearestSegment) {
        event.preventDefault();
        cutString(nearestSegment.index);
      }
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    const container = containerRef.current;

    if (!container) {
      return;
    }

    event.preventDefault();
    placePeg(getPointInElement(container, event));
  };

  const finishPointer = (pointerId: number) => {
    if (!containerRef.current || dragRef.current.pointerId !== pointerId) {
      return;
    }

    if (containerRef.current.hasPointerCapture(pointerId)) {
      containerRef.current.releasePointerCapture(pointerId);
    }

    dragRef.current = emptyDragState();
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    finishPointer(event.pointerId);
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    finishPointer(event.pointerId);
  };

  const phaseLabel: Record<GamePhase, string> = {
    placing: 'Place peg',
    ready: 'Ready',
    swinging: 'Swinging',
    cut: 'In flight',
    landed: 'Landed',
  };
  const releaseDisabled = snapshot.phase !== 'ready' || !snapshot.hasPlacedPeg;
  const snipDisabled = snapshot.phase !== 'swinging' || snapshot.snipUsed;

  return (
    <div
      ref={containerRef}
      data-testid="pendulum-peg-game"
      className="relative isolate min-h-[100svh] overflow-hidden bg-theme-bg text-theme-text"
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      aria-label="Pendulum peg challenge"
    >
      <canvas
        ref={canvasRef}
        data-testid="pendulum-peg-canvas"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      />

      <div
        data-testid="pendulum-peg-hud"
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-4 sm:p-6"
      >
        <a
          href="/oscillations"
          className="pointer-events-auto inline-flex min-h-10 items-center gap-2 rounded-lg border border-theme-grid bg-[color-mix(in_srgb,var(--surface-elevated)_88%,transparent)] px-3 py-2 text-sm font-medium text-theme-text shadow-sm backdrop-blur transition-colors hover:border-theme-blue hover:text-theme-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-blue focus-visible:ring-offset-2 focus-visible:ring-offset-theme-bg"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span aria-hidden="true">&larr;</span>
          <span>Oscillations</span>
        </a>

        <div
          data-testid="pendulum-peg-metrics"
          className="pointer-events-auto flex flex-wrap justify-end gap-2"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-theme-grid bg-[color-mix(in_srgb,var(--surface-elevated)_84%,transparent)] px-3 py-2 text-sm font-semibold shadow-sm backdrop-blur">
            <MapPin className="h-4 w-4 text-orange-600" aria-hidden="true" />
            <span>{phaseLabel[snapshot.phase]}</span>
          </div>
          <div className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-theme-grid bg-[color-mix(in_srgb,var(--surface-elevated)_84%,transparent)] px-3 py-2 text-sm font-semibold shadow-sm backdrop-blur">
            <Target className="h-4 w-4 text-red-600" aria-hidden="true" />
            <span>{formatPixels(snapshot.score)}</span>
          </div>
          <div className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-theme-grid bg-[color-mix(in_srgb,var(--surface-elevated)_84%,transparent)] px-3 py-2 text-sm font-semibold shadow-sm backdrop-blur">
            <Trophy className="h-4 w-4 text-amber-600" aria-hidden="true" />
            <span>{formatPixels(snapshot.best)}</span>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-4 sm:p-6">
        <div
          data-testid="pendulum-peg-toolbar"
          className="pointer-events-auto flex w-full max-w-xl flex-wrap items-center justify-center gap-2 rounded-lg border border-theme-grid bg-[color-mix(in_srgb,var(--surface-elevated)_88%,transparent)] p-2 shadow-sm backdrop-blur"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            data-testid="pendulum-peg-release"
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-theme-grid bg-[var(--bg-primary)] px-3 text-sm font-semibold text-theme-text transition-colors hover:border-theme-blue hover:text-theme-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-blue disabled:cursor-not-allowed disabled:opacity-45 sm:flex-none"
            onClick={releasePendulum}
            disabled={releaseDisabled}
            title="Release pendulum"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            <span>Release</span>
          </button>
          <button
            type="button"
            data-testid="pendulum-peg-snip"
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-theme-grid bg-[var(--bg-primary)] px-3 text-sm font-semibold text-theme-text transition-colors hover:border-theme-red hover:text-theme-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-red disabled:cursor-not-allowed disabled:opacity-45 sm:flex-none"
            onClick={() => cutString()}
            disabled={snipDisabled}
            title="Snip string"
          >
            <Scissors className="h-4 w-4" aria-hidden="true" />
            <span>Snip</span>
          </button>
          <button
            type="button"
            data-testid="pendulum-peg-reset"
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-theme-grid bg-[var(--bg-primary)] px-3 text-sm font-semibold text-theme-text transition-colors hover:border-theme-blue hover:text-theme-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-blue sm:flex-none"
            onClick={resetAttempt}
            title="Reset"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            <span>Reset</span>
          </button>
        </div>
      </div>
    </div>
  );
}
