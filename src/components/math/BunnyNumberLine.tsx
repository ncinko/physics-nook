import { useEffect, useMemo, useRef, useState } from 'react';
import {
  hopLabel,
  hopLandings,
  hopPosition,
  hopStaysOnLine,
} from '../../lib/math/bunnyHops';
import { ControlBar, Button } from '../shared/InlineControls';
import { BunnySprite } from './BunnySprite';

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 260;
const LINE_MIN = -8;
const LINE_MAX = 8;
const MARGIN = 40;
const BASELINE_Y = 180;
const PLOT_WIDTH = VIEW_WIDTH - MARGIN * 2;

// Semantic hop-direction colors follow the active theme via CSS tokens.
const HOP_RIGHT = 'var(--accent-blue)';
const HOP_LEFT = 'var(--accent-purple)';
// Intrinsic colors for the drawn carrot illustration (like a sprite's own
// palette), not part of the themed UI surface.
const CARROT_BODY = '#ea580c';
const CARROT_LEAF = '#16a34a';

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
  const reached = position === target;

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
    <div className="not-prose mx-auto my-8 flex max-w-[640px] flex-col gap-4 text-[var(--text-primary)]">
      <p className="m-0 text-center text-sm leading-6 text-[var(--text-muted)]">
        Hop to the carrot. Each hop is a one-dimensional vector: a size (how far) and a
        direction (the sign).
      </p>

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

      {/* Running position: bunny = start + hop1 + hop2 + …, always rendered so
          growing the expression doesn't shift the controls below it. Each hop
          term is tinted to match its arc, and reaching the carrot caps the line
          with a highlighted "= carrot". */}
      <p className="m-0 text-center font-mono text-sm leading-7 text-[var(--text-muted)]">
        <span className="font-semibold text-[var(--text-primary)]">bunny</span>
        {' = '}
        <span>0</span>
        {hops.map((hop, index) => (
          <span key={index} style={{ color: hop >= 0 ? HOP_RIGHT : HOP_LEFT, fontWeight: 600 }}>
            {' '}
            {hop >= 0 ? '+' : '−'} {Math.abs(hop)}
          </span>
        ))}
        {reached && (
          <span style={{ color: CARROT_BODY, fontWeight: 700 }}> = carrot</span>
        )}
      </p>

      <ControlBar>
        <span className="inline-flex flex-wrap items-center justify-center gap-2 text-sm">
          <span className="font-medium">Hop</span>
          {HOP_CHOICES.map((hop) => (
            <Button
              key={hop}
              variant="secondary"
              onClick={() => addHop(hop)}
              disabled={reached || !hopStaysOnLine(position, hop, LINE_MIN, LINE_MAX)}
            >
              {hopLabel(hop)}
            </Button>
          ))}
        </span>
        <Button variant="secondary" onClick={undo} disabled={hops.length === 0}>
          Undo
        </Button>
        <Button variant="secondary" onClick={reset} disabled={hops.length === 0}>
          Reset
        </Button>
        <Button variant={reached ? 'primary' : 'secondary'} onClick={newCarrot}>
          New carrot
        </Button>
      </ControlBar>
    </div>
  );
}

function HopArc({ from, to, hop }: { from: number; to: number; hop: number }) {
  const x1 = toX(from);
  const x2 = toX(to);
  const color = hop >= 0 ? HOP_RIGHT : HOP_LEFT;
  const span = Math.abs(x2 - x1);
  const apexY = BASELINE_Y - 24 - span * 0.32;
  const midX = (x1 + x2) / 2;
  // Quadratic arc cresting above the line, with an arrowhead at the landing.
  const tipY = BASELINE_Y - 4;
  // At the end of a quadratic Bezier, the tangent points from its control
  // point to its endpoint. Build the arrowhead in that local direction so it
  // continues the curve instead of sitting horizontally across it.
  const tangentX = x2 - midX;
  const tangentY = tipY - apexY;
  const tangentLength = Math.hypot(tangentX, tangentY);
  const unitX = tangentX / tangentLength;
  const unitY = tangentY / tangentLength;
  const headLength = 10;
  const headWidth = 5;
  const baseX = x2 - unitX * headLength;
  const baseY = tipY - unitY * headLength;
  const normalX = -unitY * headWidth;
  const normalY = unitX * headWidth;
  return (
    <g>
      <path
        d={`M ${x1} ${BASELINE_Y - 4} Q ${midX} ${apexY} ${x2} ${tipY}`}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <polygon
        points={`${x2},${tipY} ${baseX + normalX},${baseY + normalY} ${baseX - normalX},${baseY - normalY}`}
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
        fill={CARROT_BODY}
      />
      <path
        d={`M ${x} ${topY - 30} l -7 -8 M ${x} ${topY - 30} l 0 -11 M ${x} ${topY - 30} l 7 -8`}
        stroke={CARROT_LEAF}
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
