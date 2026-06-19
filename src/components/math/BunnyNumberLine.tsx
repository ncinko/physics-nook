import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  hopLabel,
  hopLandings,
  hopPosition,
  hopStaysOnLine,
  totalHop,
} from '../../lib/math/bunnyHops';
import { BunnySprite } from './BunnySprite';

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 260;
const LINE_MIN = -8;
const LINE_MAX = 8;
const MARGIN = 40;
const BASELINE_Y = 180;
const PLOT_WIDTH = VIEW_WIDTH - MARGIN * 2;

const COLORS = {
  right: '#2563eb',
  left: '#d97706',
  carrot: '#ea580c',
  carrotLeaf: '#16a34a',
  bunny: '#475569',
  success: '#16a34a',
  muted: '#64748b',
};

const HOP_CHOICES = [-3, -2, -1, 1, 2, 3];

const toX = (value: number) =>
  MARGIN + ((value - LINE_MIN) / (LINE_MAX - LINE_MIN)) * PLOT_WIDTH;

const randomTarget = (avoid: number): number => {
  let next = avoid;
  while (next === avoid || next === 0) {
    next = Math.floor(Math.random() * (LINE_MAX - 1 - (LINE_MIN + 1) + 1)) + (LINE_MIN + 1);
  }
  return next;
};

export function BunnyNumberLine() {
  const [hops, setHops] = useState<number[]>([]);
  const [target, setTarget] = useState(5);

  const landings = useMemo(() => hopLandings(0, hops), [hops]);
  const position = hopPosition(0, hops);
  const sum = totalHop(hops);
  const reached = position === target;
  const remaining = target - position;

  // Animate the bunny hopping in an arc toward its current logical position.
  const [bunny, setBunny] = useState({ x: toX(0), lift: 0, dir: 1 });
  const bunnyRef = useRef(bunny);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const targetX = toX(position);
    const fromX = bunnyRef.current.x;
    const delta = targetX - fromX;

    if (Math.abs(delta) < 0.5) {
      const landed = { x: targetX, lift: 0, dir: bunnyRef.current.dir };
      bunnyRef.current = landed;
      setBunny(landed);
      return;
    }

    const dir = delta >= 0 ? 1 : -1;
    const hopHeight = Math.min(64, 26 + Math.abs(delta) * 0.3);
    const duration = 360;
    const startTime = performance.now();

    const tick = (now: number) => {
      const p = Math.min(1, (now - startTime) / duration);
      const next = {
        x: fromX + delta * p,
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
  }, [position]);

  const addHop = (hop: number) => {
    if (reached || !hopStaysOnLine(position, hop, LINE_MIN, LINE_MAX)) {
      return;
    }
    setHops((prev) => [...prev, hop]);
  };

  const undo = () => setHops((prev) => prev.slice(0, -1));
  const reset = () => setHops([]);
  const newCarrot = () => {
    setHops([]);
    setTarget((current) => randomTarget(current));
  };

  return (
    <section className="not-prose my-8 overflow-hidden rounded-2xl border border-[var(--grid-line)] bg-[var(--sim-bg)] p-4 text-[var(--text-primary)] shadow-sm">
      <div className="mb-4">
        <h3 className="m-0 text-lg font-semibold">Bunny Arithmetic</h3>
        <p className="mt-1 mb-0 text-sm leading-6 text-[var(--text-muted)]">
          Hop to the carrot. Each hop is a one-dimensional vector: a size (how far) and
          a direction (the sign). The hops sum up to the total displacement, exactly like vector addition.
        </p>
      </div>

      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="m-0 font-mono text-[var(--text-muted)]">
            bunny at <span style={{ color: COLORS.bunny }}>{position}</span> · carrot at{' '}
            <span style={{ color: COLORS.carrot }}>{target}</span>
          </p>
          <p className="m-0 font-mono text-[var(--text-muted)]">hops {hops.length}</p>
        </div>

        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          role="img"
          aria-label={`Number line with bunny at ${position} and carrot at ${target}`}
          className="block h-auto w-full rounded-lg border border-[var(--grid-line)] bg-[var(--bg-primary)] shadow-sm"
        >
          {/* number line */}
          <line
            x1={MARGIN}
            y1={BASELINE_Y}
            x2={VIEW_WIDTH - MARGIN}
            y2={BASELINE_Y}
            stroke="var(--text-muted)"
            strokeWidth={2}
          />
          {Array.from({ length: LINE_MAX - LINE_MIN + 1 }, (_, index) => {
            const value = LINE_MIN + index;
            const x = toX(value);
            return (
              <g key={value}>
                <line
                  x1={x}
                  y1={BASELINE_Y - 6}
                  x2={x}
                  y2={BASELINE_Y + 6}
                  stroke="var(--text-muted)"
                  strokeWidth={value === 0 ? 2.5 : 1.5}
                />
                <text
                  x={x}
                  y={BASELINE_Y + 24}
                  textAnchor="middle"
                  fill="var(--text-muted)"
                  fontSize="12"
                  fontWeight={value === 0 ? 800 : 500}
                >
                  {value}
                </text>
              </g>
            );
          })}

          {/* hop arcs */}
          {hops.map((hop, index) => (
            <HopArc key={index} from={landings[index]} to={landings[index + 1]} hop={hop} />
          ))}

          <Carrot value={target} reached={reached} />
          <Bunny x={bunny.x} lift={bunny.lift} dir={bunny.dir} />
        </svg>

        <div className="grid gap-3 sm:grid-cols-3">
          <Readout label="start" value="0" />
          <Readout label="hops add to" value={hopLabel(sum)} accent={COLORS.right} />
          <Readout
            label={reached ? 'landed!' : 'still to hop'}
            value={reached ? hopLabel(0) : hopLabel(remaining)}
            accent={reached ? COLORS.success : COLORS.muted}
          />
        </div>

        {hops.length > 0 && (
          <p className="m-0 font-mono text-xs leading-6 text-[var(--text-muted)]">
            0
            {hops.map((hop, index) => (
              <span key={index}> {hop >= 0 ? '+' : '−'} {Math.abs(hop)}</span>
            ))}
            {' = '}
            <span style={{ color: COLORS.right }}>{position}</span>
          </p>
        )}

        {reached && (
          <p
            className="m-0 rounded-lg border px-3 py-2 text-sm font-semibold"
            style={{
              color: COLORS.success,
              borderColor: COLORS.success,
              background: 'color-mix(in srgb, #16a34a 12%, var(--bg-primary))',
            }}
          >
            Munch! The bunny reached the carrot in {hops.length}{' '}
            {hops.length === 1 ? 'hop' : 'hops'}. Those hops added to {hopLabel(sum)}.
          </p>
        )}

        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              hop
            </span>
            {HOP_CHOICES.map((hop) => {
              const allowed = !reached && hopStaysOnLine(position, hop, LINE_MIN, LINE_MAX);
              return (
                <button
                  key={hop}
                  type="button"
                  onClick={() => addHop(hop)}
                  disabled={!allowed}
                  className="rounded-lg border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-30"
                  style={{
                    borderColor: hop > 0 ? COLORS.right : COLORS.left,
                    color: hop > 0 ? COLORS.right : COLORS.left,
                  }}
                >
                  {hopLabel(hop)}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <ControlButton onClick={undo} disabled={hops.length === 0}>
              Undo hop
            </ControlButton>
            <ControlButton onClick={reset} disabled={hops.length === 0}>
              Reset
            </ControlButton>
            <ControlButton onClick={newCarrot} primary={reached}>
              New carrot
            </ControlButton>
          </div>
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

function HopArc({ from, to, hop }: { from: number; to: number; hop: number }) {
  const x1 = toX(from);
  const x2 = toX(to);
  const color = hop >= 0 ? COLORS.right : COLORS.left;
  const span = Math.abs(x2 - x1);
  const apexY = BASELINE_Y - 24 - span * 0.32;
  const midX = (x1 + x2) / 2;
  // Quadratic arc cresting above the line, with an arrowhead at the landing.
  const ux = x2 >= x1 ? 1 : -1;
  const headLength = 10;
  const tipX = x2 - ux * 2;
  return (
    <g>
      <path
        d={`M ${x1} ${BASELINE_Y - 4} Q ${midX} ${apexY} ${tipX} ${BASELINE_Y - 4}`}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <polygon
        points={`${x2},${BASELINE_Y - 2} ${tipX - ux * headLength},${BASELINE_Y - 4 - 5} ${tipX - ux * headLength},${BASELINE_Y - 4 + 5}`}
        fill={color}
      />
      <text x={midX} y={apexY - 6} textAnchor="middle" fill={color} fontSize="13" fontWeight="800">
        {hopLabel(hop)}
      </text>
    </g>
  );
}

function Carrot({ value, reached }: { value: number; reached: boolean }) {
  const x = toX(value);
  const topY = BASELINE_Y - 2;
  const opacity = reached ? 0.35 : 1;
  return (
    <g opacity={opacity}>
      <polygon
        points={`${x - 7},${topY - 30} ${x + 7},${topY - 30} ${x},${topY}`}
        fill={COLORS.carrot}
      />
      <path
        d={`M ${x} ${topY - 30} l -7 -8 M ${x} ${topY - 30} l 0 -11 M ${x} ${topY - 30} l 7 -8`}
        stroke={COLORS.carrotLeaf}
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
      />
    </g>
  );
}

function Bunny({ x, lift, dir }: { x: number; lift: number; dir: number }) {
  const footY = BASELINE_Y - 2 - lift;
  // Side-on leaping pose while airborne, front-facing sit when grounded.
  const frame = lift > 0.5 ? 'hop' : 'sit';
  return (
    <g transform={`translate(${x}, ${footY}) scale(${dir}, 1)`}>
      <BunnySprite frame={frame} cell={3} />
    </g>
  );
}
