import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { add, formatVector, subtract, type Vector2 } from '../../lib/math/vectors';
import {
  FIELD_BOUNDS,
  FIELD_START,
  UNIT_STEPS,
  carrotReached,
  randomCarrot,
  stepBunny,
  type StepName,
} from '../../lib/math/bunnyField';
import { BunnySprite } from './BunnySprite';

const VIEW_WIDTH = 640;
const GRID_MARGIN = 36;
const PLOT_WIDTH = VIEW_WIDTH - GRID_MARGIN * 2;
const GRID_UNIT = PLOT_WIDTH / (FIELD_BOUNDS.maxX - FIELD_BOUNDS.minX);
const PLOT_HEIGHT = GRID_UNIT * (FIELD_BOUNDS.maxY - FIELD_BOUNDS.minY);
const VIEW_HEIGHT = PLOT_HEIGHT + GRID_MARGIN * 2;

const COLORS = {
  path: '#2563eb',
  carrot: '#ea580c',
  carrotLeaf: '#16a34a',
  success: '#16a34a',
  muted: '#64748b',
};

const toScreen = (point: Vector2): Vector2 => ({
  x: GRID_MARGIN + ((point.x - FIELD_BOUNDS.minX) / (FIELD_BOUNDS.maxX - FIELD_BOUNDS.minX)) * PLOT_WIDTH,
  y: GRID_MARGIN + ((FIELD_BOUNDS.maxY - point.y) / (FIELD_BOUNDS.maxY - FIELD_BOUNDS.minY)) * PLOT_HEIGHT,
});

// Map keyboard keys to unit-vector hops. Arrow keys and WASD both steer.
const KEY_STEPS: Record<string, StepName> = {
  ArrowRight: 'right',
  ArrowLeft: 'left',
  ArrowUp: 'up',
  ArrowDown: 'down',
  d: 'right',
  a: 'left',
  w: 'up',
  s: 'down',
};

// A fixed first carrot so the server and client render the same markup; every
// carrot after this one is placed randomly (after mount / on user actions).
const INITIAL_CARROT: Vector2 = { x: 3, y: 2 };

const STEP_LABELS: Record<StepName, string> = {
  right: '+î', // + i-hat
  left: '−î', // - i-hat
  up: '+ĵ', // + j-hat
  down: '−ĵ', // - j-hat
};

/** Render a vector as the unit-vector combination x i-hat + y j-hat. */
const unitVectorExpression = ({ x, y }: Vector2): string => {
  const iTerm = `${x} î`;
  const jTerm = `${Math.abs(y)} ĵ`;
  const sign = y < 0 ? '−' : '+';
  return `${iTerm} ${sign} ${jTerm}`;
};

export function BunnyField() {
  const [position, setPosition] = useState<Vector2>(FIELD_START);
  // Where the current displacement leg starts: the bunny's spot when the carrot
  // was placed. Displacement and the drawn hop vectors are measured from here.
  const [anchor, setAnchor] = useState<Vector2>(FIELD_START);
  const [hops, setHops] = useState<Vector2[]>([]);
  const [carrot, setCarrot] = useState<Vector2>(INITIAL_CARROT);
  const [score, setScore] = useState(0);
  const [lastStep, setLastStep] = useState<StepName | null>(null);
  const [munched, setMunched] = useState(false);
  const [focused, setFocused] = useState(false);

  // Refs mirror state so the keydown handler reads current values without going
  // stale between renders, and so rapid key-repeats compound correctly.
  const positionRef = useRef(position);
  const anchorRef = useRef(anchor);
  const hopsRef = useRef(hops);
  const carrotRef = useRef(INITIAL_CARROT);
  const munchedRef = useRef(munched);

  const displacement = subtract(position, anchor);
  // Tip positions of each hop, head-to-tail from the anchor, for drawing.
  const hopPositions = useMemo(() => {
    const points = [anchor];
    for (const hop of hops) {
      points.push(add(points[points.length - 1], hop));
    }
    return points;
  }, [anchor, hops]);

  const step = useCallback((stepName: StepName) => {
    const previous = positionRef.current;
    const next = stepBunny(previous, UNIT_STEPS[stepName]);
    if (next.x === previous.x && next.y === previous.y) {
      return; // clamped at the field edge — no hop
    }
    positionRef.current = next;
    hopsRef.current = [...hopsRef.current, UNIT_STEPS[stepName]];
    setPosition(next);
    setHops(hopsRef.current);
    setLastStep(stepName);

    if (!munchedRef.current && carrotReached(next, carrotRef.current)) {
      munchedRef.current = true;
      setMunched(true);
      setScore((count) => count + 1);
    }
  }, []);

  // Place a fresh carrot and reset the displacement leg to the bunny's spot, so
  // the next trip's hops and sum are measured from here. Clears the drawn hops.
  const newCarrot = useCallback(() => {
    const here = positionRef.current;
    const next = randomCarrot(here);
    carrotRef.current = next;
    anchorRef.current = here;
    hopsRef.current = [];
    munchedRef.current = false;
    setCarrot(next);
    setAnchor(here);
    setHops([]);
    setLastStep(null);
    setMunched(false);
  }, []);

  const reset = useCallback(() => {
    positionRef.current = FIELD_START;
    anchorRef.current = FIELD_START;
    hopsRef.current = [];
    munchedRef.current = false;
    setPosition(FIELD_START);
    setAnchor(FIELD_START);
    setHops([]);
    setScore(0);
    setLastStep(null);
    setMunched(false);
    const next = randomCarrot(FIELD_START);
    carrotRef.current = next;
    setCarrot(next);
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      newCarrot();
      return;
    }
    const stepName = KEY_STEPS[event.key];
    if (stepName) {
      event.preventDefault(); // keep arrow keys from scrolling the page
      step(stepName);
    }
  };

  // Animate the bunny sprite hopping in an arc toward its current cell.
  const [bunny, setBunny] = useState(() => {
    const start = toScreen(FIELD_START);
    return { x: start.x, y: start.y, lift: 0, dir: 1 };
  });
  const bunnyRef = useRef(bunny);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const target = toScreen(position);
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

    const dir = dx > 0 ? 1 : dx < 0 ? -1 : from.dir;
    const hopHeight = Math.min(44, 18 + dist * 0.18);
    const duration = 320;
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
  }, [position.x, position.y]);

  return (
    <section className="not-prose my-8 overflow-hidden rounded-2xl border border-[var(--grid-line)] bg-[var(--sim-bg)] p-4 text-[var(--text-primary)] shadow-sm">
      <div className="mb-4">
        <h3 className="m-0 text-lg font-semibold">Bunny Hops</h3>
        <p className="mt-1 mb-0 text-sm leading-6 text-[var(--text-muted)]">
          Click the field, then steer with the <strong>arrow keys</strong> or <strong>WASD</strong>.
          Each hop adds one unit vector. Munch the carrot, then press <strong>Space</strong> for a
          new one.
        </p>
      </div>

      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="m-0 font-mono text-[var(--text-muted)]">
            last hop{' '}
            <span style={{ color: COLORS.path }}>{lastStep ? STEP_LABELS[lastStep] : '—'}</span>
          </p>
          <p className="m-0 font-mono text-[var(--text-muted)]">
            hops {hops.length} · carrots{' '}
            <span style={{ color: score > 0 ? COLORS.success : 'inherit' }}>{score}</span>
          </p>
        </div>

        <div
          role="application"
          aria-label="Keyboard bunny field. Use arrow keys or WASD to hop; press space for a new carrot."
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="relative rounded-lg outline-none ring-offset-2 ring-offset-[var(--bg-primary)] focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)]"
        >
          <svg
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            role="img"
            aria-label={`Bunny at ${formatVector(position)}, carrot at ${formatVector(carrot)}`}
            className="block h-auto w-full rounded-lg border border-[var(--grid-line)] bg-[var(--bg-primary)] shadow-sm"
          >
            <Grid />
            {hops.map((_hop, index) => (
              <Arrow
                key={index}
                start={hopPositions[index]}
                end={hopPositions[index + 1]}
                color={COLORS.path}
              />
            ))}
            {munched && (
              <Arrow
                start={anchor}
                end={position}
                color={COLORS.success}
                width={3.4}
                opacity={0.5}
                label="Σ"
              />
            )}
            <Carrot point={carrot} reached={munched} />
            <FieldBunny x={bunny.x} y={bunny.y} lift={bunny.lift} dir={bunny.dir} />
          </svg>

          {!focused && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--bg-primary)_55%,transparent)]">
              <span className="rounded-full border border-[var(--grid-line)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--text-primary)] shadow-sm">
                Click to steer with the keyboard
              </span>
            </div>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <Readout label="position" value={formatVector(position)} accent={COLORS.muted} />
          <Readout label="displacement" value={formatVector(displacement)} accent={COLORS.path} />
          <Readout label="as unit vectors" value={unitVectorExpression(displacement)} accent={COLORS.path} />
        </div>

        {munched && (
          <p
            className="m-0 rounded-lg border px-3 py-2 text-sm font-semibold"
            style={{
              color: COLORS.success,
              borderColor: COLORS.success,
              background: 'color-mix(in srgb, #16a34a 12%, var(--bg-primary))',
            }}
          >
            Munch! Press <strong>Space</strong> (or "New carrot") to send another one out into the
            field.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <DPad onStep={step} />
          <div className="flex flex-wrap gap-2">
            <ControlButton onClick={newCarrot} primary={munched}>
              New carrot
            </ControlButton>
            <ControlButton onClick={reset} disabled={hops.length === 0 && score === 0}>
              Reset
            </ControlButton>
          </div>
        </div>
      </div>
    </section>
  );
}

function DPad({ onStep }: { onStep: (step: StepName) => void }) {
  const pad =
    'flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--grid-line)] bg-[var(--bg-primary)] text-base font-bold text-[var(--text-primary)] transition hover:border-[var(--accent-blue)]';
  return (
    <div className="grid grid-cols-3 grid-rows-2 gap-1.5" aria-hidden="true">
      <span />
      <button type="button" tabIndex={-1} className={pad} onClick={() => onStep('up')}>
        {'↑'}
      </button>
      <span />
      <button type="button" tabIndex={-1} className={pad} onClick={() => onStep('left')}>
        {'←'}
      </button>
      <button type="button" tabIndex={-1} className={pad} onClick={() => onStep('down')}>
        {'↓'}
      </button>
      <button type="button" tabIndex={-1} className={pad} onClick={() => onStep('right')}>
        {'→'}
      </button>
    </div>
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

function Arrow({
  start,
  end,
  color,
  width = 3,
  opacity = 1,
  label,
}: {
  start: Vector2;
  end: Vector2;
  color: string;
  width?: number;
  opacity?: number;
  label?: string;
}) {
  const a = toScreen(start);
  const b = toScreen(end);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 2) {
    return null;
  }
  const ux = dx / length;
  const uy = dy / length;
  const headLength = 12;
  const headWidth = 7;
  const shaftEnd = { x: b.x - ux * headLength, y: b.y - uy * headLength };
  const left = { x: shaftEnd.x - uy * headWidth, y: shaftEnd.y + ux * headWidth };
  const right = { x: shaftEnd.x + uy * headWidth, y: shaftEnd.y - ux * headWidth };
  // Label nudged perpendicular to the shaft so the arrow doesn't cover it.
  const labelX = (a.x + b.x) / 2 - uy * 13;
  const labelY = (a.y + b.y) / 2 + ux * 13;
  return (
    <g opacity={opacity}>
      <line
        x1={a.x}
        y1={a.y}
        x2={shaftEnd.x}
        y2={shaftEnd.y}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
      />
      <polygon points={`${b.x},${b.y} ${left.x},${left.y} ${right.x},${right.y}`} fill={color} />
      {label && (
        <text x={labelX} y={labelY + 4} textAnchor="middle" fill={color} fontSize="14" fontWeight="800">
          {label}
        </text>
      )}
    </g>
  );
}

function Grid() {
  const lines: ReactNode[] = [];
  for (let x = FIELD_BOUNDS.minX; x <= FIELD_BOUNDS.maxX; x += 1) {
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
  for (let y = FIELD_BOUNDS.minY; y <= FIELD_BOUNDS.maxY; y += 1) {
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

function FieldBunny({ x, y, lift, dir }: { x: number; y: number; lift: number; dir: number }) {
  // Side-on leaping pose while airborne, front-facing sit when grounded.
  const frame = lift > 0.5 ? 'hop' : 'sit';
  return (
    <g transform={`translate(${x}, ${y - lift}) scale(${dir}, 1)`}>
      <ellipse cx={0} cy={lift} rx={9 - lift * 0.06} ry={3} fill="#000000" opacity={0.14} />
      <BunnySprite frame={frame} cell={2.5} />
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
        fill={reached ? COLORS.success : COLORS.carrot}
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
