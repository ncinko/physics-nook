import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { formatVector, subtract, type Vector2 } from '../../lib/math/vectors';
import {
  isReached,
  moveIsBlocked,
  pathPositions,
  totalDisplacement,
  voyageLevels,
  type Rect,
} from '../../lib/math/vectorVoyage';
import { BunnySprite } from './BunnySprite';

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
  path: '#2563eb',
  start: '#475569',
  target: '#d97706',
  hedge: '#15803d',
  success: '#16a34a',
  invalid: '#dc2626',
  muted: '#64748b',
  carrotLeaf: '#16a34a',
  burrow: '#92400e',
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const toScreen = (point: Vector2): Vector2 => ({
  x: GRID_MARGIN + ((point.x - GRID_MIN_X) / (GRID_MAX_X - GRID_MIN_X)) * PLOT_WIDTH,
  y: GRID_MARGIN + ((GRID_MAX_Y - point.y) / (GRID_MAX_Y - GRID_MIN_Y)) * PLOT_HEIGHT,
});

const snap = (value: number) => Math.round(value * 2) / 2;

const pointerToWorld = (event: PointerEvent<SVGElement>): Vector2 => {
  const svg = event.currentTarget.ownerSVGElement ?? (event.currentTarget as SVGSVGElement);
  const rect = svg.getBoundingClientRect();
  const screenX = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * VIEW_WIDTH;
  const screenY = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * VIEW_HEIGHT;
  const worldX = GRID_MIN_X + ((screenX - GRID_MARGIN) / PLOT_WIDTH) * (GRID_MAX_X - GRID_MIN_X);
  const worldY = GRID_MAX_Y - ((screenY - GRID_MARGIN) / PLOT_HEIGHT) * (GRID_MAX_Y - GRID_MIN_Y);
  return {
    x: clamp(snap(worldX), GRID_MIN_X, GRID_MAX_X),
    y: clamp(snap(worldY), GRID_MIN_Y, GRID_MAX_Y),
  };
};

export function VectorVoyage() {
  const [levelIndex, setLevelIndex] = useState(0);
  const [moves, setMoves] = useState<Vector2[]>([]);
  const [invalidTip, setInvalidTip] = useState<Vector2 | null>(null);
  const playTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const level = voyageLevels[levelIndex];
  const positions = useMemo(() => pathPositions(level.start, moves), [level, moves]);
  const current = positions[positions.length - 1];
  const reached = isReached(current, level.target);
  // The net displacement is the vector sum of every hop — the single arrow from
  // the burrow to the carrot that the chain of hops adds up to.
  const net = totalDisplacement(moves);

  // Animated bunny sprite that hops in an arc toward the current path tip.
  const [bunny, setBunny] = useState(() => {
    const start = toScreen(voyageLevels[0].start);
    return { x: start.x, y: start.y, lift: 0, dir: 1 };
  });
  const bunnyRef = useRef(bunny);
  const rafRef = useRef<number | null>(null);

  const stopPlayback = useCallback(() => {
    if (playTimer.current) {
      clearTimeout(playTimer.current);
      playTimer.current = null;
    }
  }, []);

  const resetLevel = useCallback(() => {
    stopPlayback();
    setMoves([]);
    setInvalidTip(null);
  }, [stopPlayback]);

  // Reset progress whenever the level changes, snap the bunny to the new burrow,
  // and clean up any pending playback.
  useEffect(() => {
    setMoves([]);
    setInvalidTip(null);
    const start = toScreen(level.start);
    const landed = { x: start.x, y: start.y, lift: 0, dir: 1 };
    bunnyRef.current = landed;
    setBunny(landed);
    return stopPlayback;
  }, [levelIndex, level.start, stopPlayback]);

  // Hop the bunny toward the current tip whenever a hop is added or revealed.
  useEffect(() => {
    const target = toScreen(current);
    const from = bunnyRef.current;
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 0.5) {
      const landed = { x: target.x, y: target.y, lift: 0, dir: from.dir };
      bunnyRef.current = landed;
      setBunny(landed);
      return;
    }

    const dir = dx >= 0 ? 1 : -1;
    const hopHeight = Math.min(48, 16 + dist * 0.16);
    const duration = 380;
    const startTime = performance.now();

    const tick = (now: number) => {
      const p = Math.min(1, (now - startTime) / duration);
      const next = {
        x: from.x + dx * p,
        y: from.y + dy * p,
        lift: Math.sin(Math.PI * p) * hopHeight,
        dir,
      };
      bunnyRef.current = next;
      setBunny(next);
      rafRef.current = p < 1 ? requestAnimationFrame(tick) : null;
    };

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.x, current.y]);

  const handleBoardClick = (event: PointerEvent<SVGSVGElement>) => {
    if (reached) {
      return;
    }
    stopPlayback();
    const tip = pointerToWorld(event);
    if (tip.x === current.x && tip.y === current.y) {
      return;
    }
    if (moveIsBlocked(current, tip, level.hedges)) {
      setInvalidTip(tip);
      return;
    }
    setInvalidTip(null);
    setMoves((prev) => [...prev, subtract(tip, current)]);
  };

  const undo = () => {
    stopPlayback();
    setInvalidTip(null);
    setMoves((prev) => prev.slice(0, -1));
  };

  const showRoute = () => {
    stopPlayback();
    setInvalidTip(null);
    setMoves([]);
    const route = level.solutionMoves;
    let step = 0;
    const tick = () => {
      step += 1;
      setMoves(route.slice(0, step));
      if (step < route.length) {
        playTimer.current = setTimeout(tick, 520);
      } else {
        playTimer.current = null;
      }
    };
    playTimer.current = setTimeout(tick, 280);
  };

  return (
    <section className="not-prose my-8 overflow-hidden rounded-2xl border border-[var(--grid-line)] bg-[var(--sim-bg)] p-4 text-[var(--text-primary)] shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-lg font-semibold">Bunny Hops</h3>
          <p className="mt-1 mb-0 text-sm leading-6 text-[var(--text-muted)]">
            Click to hop from the burrow to the carrot. Each successive hop adds an additional vector to the sum.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-[var(--grid-line)] bg-[var(--bg-primary)] p-1">
          {voyageLevels.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setLevelIndex(index)}
              aria-pressed={index === levelIndex}
              className="rounded-md px-3 py-1.5 text-sm font-semibold text-[var(--text-muted)] aria-pressed:bg-[var(--accent-blue)] aria-pressed:text-white"
            >
              {index + 1}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="m-0 font-semibold">
            {level.name}
            <span className="ml-2 font-normal text-[var(--text-muted)]">{level.hint}</span>
          </p>
          <p className="m-0 font-mono text-[var(--text-muted)]">
            hops {moves.length} 
          </p>
        </div>

        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          role="img"
          aria-label={`Bunny hop puzzle: ${level.name}`}
          className="block h-auto w-full rounded-lg border border-[var(--grid-line)] bg-[var(--bg-primary)] shadow-sm"
          style={{ touchAction: 'none', cursor: reached ? 'default' : 'crosshair' }}
          onPointerDown={handleBoardClick}
        >
          <Grid />
          {level.hedges.map((hedge, index) => (
            <Hedge key={index} rect={hedge} />
          ))}

          {moves.map((_move, index) => (
            <Arrow
              key={index}
              start={positions[index]}
              end={positions[index + 1]}
              color={COLORS.path}
              label={`${index + 1}`}
            />
          ))}

          {reached && (
            <Arrow
              start={level.start}
              end={level.target}
              color={COLORS.success}
              label="Σ"
              opacity={0.42}
            />
          )}

          {invalidTip && <BlockedHint start={current} end={invalidTip} />}

          <Burrow point={level.start} />
          <Carrot point={level.target} reached={reached} />
          <VoyageBunny x={bunny.x} y={bunny.y} lift={bunny.lift} dir={bunny.dir} />
        </svg>

        {/* Bunny = start + hop 1 + hop 2 + …, always rendered so growing the
            expression doesn't shift the controls below. Each hop is tinted to
            match its path arrow, and reaching the carrot caps the line with a
            highlighted "= carrot". */}
        <p className="m-0 font-mono text-sm leading-7 text-[var(--text-muted)]">
          <span className="font-semibold text-[var(--text-primary)]">Bunny</span>
          {' = '}
          <span style={{ color: COLORS.start }}>{formatVector(level.start)}</span>
          {moves.map((move, index) => (
            <span key={index} style={{ color: COLORS.path, fontWeight: 600 }}>
              {' + '}
              {formatVector(move)}
            </span>
          ))}
          {reached && (
            <span style={{ color: COLORS.target, fontWeight: 700 }}> = carrot</span>
          )}
        </p>

        {reached && (
          <p
            className="m-0 rounded-lg border px-3 py-2 text-sm font-semibold"
            style={{
              color: COLORS.success,
              borderColor: COLORS.success,
              background: 'color-mix(in srgb, #16a34a 12%, var(--bg-primary))',
            }}
          >
            Munch! Those {moves.length} {moves.length === 1 ? 'hop' : 'hops'} sum to a single
            net displacement of {formatVector(net)}.
          </p>
        )}

        {!reached && invalidTip && (
          <p className="m-0 text-sm font-semibold" style={{ color: COLORS.invalid }}>
            That hop crashes into a hedge. Pick a waypoint that hops around it.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <ControlButton onClick={undo} disabled={moves.length === 0}>
            Undo hop
          </ControlButton>
          <ControlButton onClick={resetLevel} disabled={moves.length === 0}>
            Reset
          </ControlButton>
          <ControlButton onClick={showRoute}>Show a route</ControlButton>
          {reached && levelIndex < voyageLevels.length - 1 && (
            <ControlButton onClick={() => setLevelIndex((index) => index + 1)} primary>
              Next level
            </ControlButton>
          )}
        </div>
      </div>
    </section>
  );
}

function ControlButton({
  onClick,
  disabled,
  primary,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        primary
          ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white'
          : 'border-[var(--grid-line)] bg-[var(--bg-primary)] text-[var(--text-primary)] hover:border-[var(--accent-blue)]'
      }`}
    >
      {children}
    </button>
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
    </g>
  );
}

function Hedge({ rect }: { rect: Rect }) {
  const topLeft = toScreen({ x: rect.minX, y: rect.maxY });
  const bottomRight = toScreen({ x: rect.maxX, y: rect.minY });
  return (
    <rect
      x={topLeft.x}
      y={topLeft.y}
      width={bottomRight.x - topLeft.x}
      height={bottomRight.y - topLeft.y}
      rx={8}
      fill="color-mix(in srgb, #15803d 22%, transparent)"
      stroke={COLORS.hedge}
      strokeWidth={2}
      strokeDasharray="2 5"
      strokeLinecap="round"
    />
  );
}

function Arrow({
  start,
  end,
  color,
  label,
  opacity = 1,
}: {
  start: Vector2;
  end: Vector2;
  color: string;
  label: string;
  opacity?: number;
}) {
  const screenStart = toScreen(start);
  const screenEnd = toScreen(end);
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
  const midX = (screenStart.x + screenEnd.x) / 2 - uy * 12;
  const midY = (screenStart.y + screenEnd.y) / 2 + ux * 12;
  return (
    <g opacity={opacity}>
      <line
        x1={screenStart.x}
        y1={screenStart.y}
        x2={shaftEnd.x}
        y2={shaftEnd.y}
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <polygon
        points={`${screenEnd.x},${screenEnd.y} ${left.x},${left.y} ${right.x},${right.y}`}
        fill={color}
      />
      <circle cx={midX} cy={midY} r={9} fill={color} />
      <text x={midX} y={midY + 4} textAnchor="middle" fill="#ffffff" fontSize="12" fontWeight="800">
        {label}
      </text>
    </g>
  );
}

function BlockedHint({ start, end }: { start: Vector2; end: Vector2 }) {
  const screenStart = toScreen(start);
  const screenEnd = toScreen(end);
  return (
    <g>
      <line
        x1={screenStart.x}
        y1={screenStart.y}
        x2={screenEnd.x}
        y2={screenEnd.y}
        stroke={COLORS.invalid}
        strokeWidth={2.5}
        strokeDasharray="7 6"
        strokeLinecap="round"
        opacity={0.85}
      />
      <line x1={screenEnd.x - 7} y1={screenEnd.y - 7} x2={screenEnd.x + 7} y2={screenEnd.y + 7} stroke={COLORS.invalid} strokeWidth={2.5} />
      <line x1={screenEnd.x - 7} y1={screenEnd.y + 7} x2={screenEnd.x + 7} y2={screenEnd.y - 7} stroke={COLORS.invalid} strokeWidth={2.5} />
    </g>
  );
}

function VoyageBunny({ x, y, lift, dir }: { x: number; y: number; lift: number; dir: number }) {
  // Side-on leaping pose while airborne, front-facing sit when grounded.
  const frame = lift > 0.5 ? 'hop' : 'sit';
  return (
    <g transform={`translate(${x}, ${y - lift}) scale(${dir}, 1)`}>
      {/* shadow on the ground, shrinking as the bunny rises */}
      <ellipse cx={0} cy={lift} rx={9 - lift * 0.06} ry={3} fill="#000000" opacity={0.14} />
      <BunnySprite frame={frame} cell={2.5} />
    </g>
  );
}

function Burrow({ point }: { point: Vector2 }) {
  const screen = toScreen(point);
  return (
    <g>
      {/* mound */}
      <path
        d={`M ${screen.x - 16} ${screen.y + 4} a 16 12 0 0 1 32 0 Z`}
        fill="color-mix(in srgb, #92400e 30%, var(--bg-primary))"
        stroke={COLORS.burrow}
        strokeWidth={1.5}
      />
      {/* hole the bunny hops out of */}
      <ellipse cx={screen.x} cy={screen.y + 3} rx={8} ry={5} fill={COLORS.burrow} opacity={0.85} />
    </g>
  );
}

function Carrot({ point, reached }: { point: Vector2; reached: boolean }) {
  const screen = toScreen(point);
  const tipY = screen.y + 13;
  const topY = screen.y - 11;
  return (
    <g opacity={reached ? 0.4 : 1}>
      <polygon
        points={`${screen.x - 7},${topY} ${screen.x + 7},${topY} ${screen.x},${tipY}`}
        fill={reached ? COLORS.success : COLORS.target}
      />
      <path
        d={`M ${screen.x} ${topY} l -7 -8 M ${screen.x} ${topY} l 0 -11 M ${screen.x} ${topY} l 7 -8`}
        stroke={COLORS.carrotLeaf}
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
      />
    </g>
  );
}
