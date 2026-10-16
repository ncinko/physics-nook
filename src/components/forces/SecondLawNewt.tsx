import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Readout } from '../shared/Readout';
import { ForceArrow, FORCE_COLORS } from './ForceArrow';
import NewtSprite, { NEWT_FEET_OFFSET } from './NewtSprite';
import {
  accelerationFromForce,
  advanceWithDots,
  clamp,
  netForce1D,
  START_STATE,
  type MotionDot,
  type MotionState,
} from '../../lib/forces';

// Newt on a frictionless sled, always running. Each rope handle sets one of
// two opposing pulls (drag it farther out for a stronger pull), 1 kg crates
// dragged on or off the sled set the mass, and a motion map -- a dot every
// half second, left behind on the ice -- shows what the net force does to his
// velocity. The camera rides with the sled, so the ice streams past.

const VIEW = { width: 760, height: 340 };
const GROUND_Y = 262;
const MAP_Y = GROUND_Y + 56;
const BODY_X = VIEW.width / 2;
const SLED = { width: 124, height: 12 };
const CRATE = { width: 62, height: 20 };
const ROPE_Y = GROUND_Y - SLED.height / 2;
const BIN = { x: VIEW.width - 150, y: 14, width: 132, height: 92 };
const DROP_ZONE = { x: BODY_X - 100, y: GROUND_Y - 236, width: 200, height: 248 };
const BASE_MASS = 1;
const MAX_CRATES = 6;
const MAX_PULL = 10;
const PIXELS_PER_NEWTON = 8;
const HANDLE_GAP = 18;
const PIXELS_PER_METRE = 40;
const MAP_INTERVAL = 0.5;
const DOT_LIFETIME = 10;

const format = (value: number, digits = 1) => `${Number(value.toFixed(digits))}`;

type Side = 'left' | 'right';

type Drag = { kind: 'rope'; side: Side } | { kind: 'crate'; x: number; y: number };

interface Ghost {
  x: number;
  y: number;
  rot: number;
  phase: 'drag' | 'settle' | 'return';
}

interface Sim {
  state: MotionState;
  dots: MotionDot[];
}

const initialSim = (): Sim => ({ state: START_STATE, dots: [{ t: 0, x: 0 }] });

const svgPoint = (svg: SVGSVGElement, event: { clientX: number; clientY: number }) => {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = svg.getScreenCTM();
  const mapped = matrix ? point.matrixTransform(matrix.inverse()) : point;
  return { x: mapped.x, y: mapped.y };
};

const BIN_CRATE = { x: BIN.x + BIN.width / 2, y: BIN.y + 12 + (CRATE.height + 8) / 2 };
const stackSlot = (count: number) => ({
  x: BODY_X,
  y: GROUND_Y - SLED.height - (count + 0.5) * CRATE.height,
});

const overDropZone = (x: number, y: number) =>
  x >= DROP_ZONE.x && x <= DROP_ZONE.x + DROP_ZONE.width && y >= DROP_ZONE.y && y <= DROP_ZONE.y + DROP_ZONE.height;

export default function SecondLawNewt() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [pullRight, setPullRight] = useState(0);
  const [pullLeft, setPullLeft] = useState(0);
  const [crates, setCrates] = useState(1);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [touched, setTouched] = useState(false);
  const [sim, setSim] = useState<Sim>(initialSim);
  const [ghost, setGhost] = useState<Ghost | null>(null);

  const net = netForce1D(pullRight, pullLeft);
  const mass = BASE_MASS + crates;
  const acceleration = accelerationFromForce(net, mass);

  const simRef = useRef<Sim>(sim);
  const inputsRef = useRef({ net, mass });
  inputsRef.current = { net, mass };

  // The crate in flight: it eases toward `targetRef` (the pointer while held,
  // then the stack slot or the bin once released) and leans with its motion.
  const ghostRef = useRef<Ghost | null>(null);
  const targetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    let frame = 0;
    let last: number | null = null;

    const tick = (time: number) => {
      const dt = Math.min((time - (last ?? time)) / 1000, 0.033);
      last = time;
      const { net: force, mass: kilograms } = inputsRef.current;
      const { state, dots } = simRef.current;

      // At rest with nothing pulling there is nothing to advance or redraw.
      if (dt > 0 && (force !== 0 || state.v !== 0)) {
        const next = advanceWithDots(state, dots, force, kilograms, dt, MAP_INTERVAL);
        simRef.current = {
          state: next.state,
          dots: next.dots.filter((dot) => next.state.t - dot.t <= DOT_LIFETIME),
        };
        setSim(simRef.current);
      }

      const flying = ghostRef.current;
      if (flying) {
        const target = targetRef.current;
        const ease = 1 - Math.exp(-dt * (flying.phase === 'drag' ? 16 : 20));
        const x = flying.x + (target.x - flying.x) * ease;
        const y = flying.y + (target.y - flying.y) * ease;
        const lean = flying.phase === 'drag' ? clamp((target.x - flying.x) * 0.2, -14, 14) : 0;
        const rot = flying.rot + (lean - flying.rot) * ease;

        if (flying.phase !== 'drag' && Math.hypot(target.x - x, target.y - y) < 1.5) {
          if (flying.phase === 'settle') {
            setCrates((count) => Math.min(MAX_CRATES, count + 1));
          }
          ghostRef.current = null;
        } else {
          ghostRef.current = { ...flying, x, y, rot };
        }
        setGhost(ghostRef.current);
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const handleX = (side: Side, newtons: number) =>
    side === 'right'
      ? BODY_X + SLED.width / 2 + HANDLE_GAP + newtons * PIXELS_PER_NEWTON
      : BODY_X - SLED.width / 2 - HANDLE_GAP - newtons * PIXELS_PER_NEWTON;

  const setPull = (side: Side, newtons: number) => {
    const value = clamp(Math.round(newtons), 0, MAX_PULL);
    (side === 'right' ? setPullRight : setPullLeft)(value);
    setTouched(true);
  };

  const startRope = (side: Side) => (event: ReactPointerEvent<SVGElement>) => {
    svgRef.current?.setPointerCapture(event.pointerId);
    setDrag({ kind: 'rope', side });
    setTouched(true);
  };

  const startCrate = (fromStack: boolean) => (event: ReactPointerEvent<SVGElement>) => {
    const svg = svgRef.current;
    if (!svg || (!fromStack && crates >= MAX_CRATES)) {
      return;
    }
    svg.setPointerCapture(event.pointerId);
    // A crate still settling from an earlier drop lands before the next is lifted.
    if (ghostRef.current?.phase === 'settle') {
      setCrates((count) => Math.min(MAX_CRATES, count + 1));
    }
    const point = svgPoint(svg, event);
    const origin = fromStack ? stackSlot(crates - 1) : BIN_CRATE;
    if (fromStack) {
      setCrates((count) => Math.max(0, count - 1));
    }
    ghostRef.current = { ...origin, rot: 0, phase: 'drag' };
    targetRef.current = point;
    setGhost(ghostRef.current);
    setDrag({ kind: 'crate', x: point.x, y: point.y });
    setTouched(true);
  };

  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag || !svgRef.current) {
      return;
    }
    const point = svgPoint(svgRef.current, event);
    if (drag.kind === 'rope') {
      const outward = drag.side === 'right' ? point.x - handleX('right', 0) : handleX('left', 0) - point.x;
      setPull(drag.side, outward / PIXELS_PER_NEWTON);
    } else {
      targetRef.current = point;
      setDrag({ kind: 'crate', x: point.x, y: point.y });
    }
  };

  const endDrag = () => {
    if (drag?.kind === 'crate' && ghostRef.current) {
      const lands = overDropZone(drag.x, drag.y) && crates < MAX_CRATES;
      targetRef.current = lands ? stackSlot(crates) : BIN_CRATE;
      ghostRef.current = { ...ghostRef.current, phase: lands ? 'settle' : 'return' };
    }
    setDrag(null);
  };

  const nudgePull = (side: Side, current: number) => (event: KeyboardEvent<SVGGElement>) => {
    const outward = side === 'right' ? 'ArrowRight' : 'ArrowLeft';
    const inward = side === 'right' ? 'ArrowLeft' : 'ArrowRight';
    if (event.key === outward || event.key === 'ArrowUp') {
      event.preventDefault();
      setPull(side, current + 1);
    } else if (event.key === inward || event.key === 'ArrowDown') {
      event.preventDefault();
      setPull(side, current - 1);
    }
  };

  const { state, dots } = sim;
  const toScreen = (metres: number) => BODY_X + (metres - state.x) * PIXELS_PER_METRE;

  // Ice ticks every metre, labelled every five, scrolling past the sled.
  const firstTick = Math.floor(state.x - BODY_X / PIXELS_PER_METRE);
  const lastTick = Math.ceil(state.x + (VIEW.width - BODY_X) / PIXELS_PER_METRE);
  const ticks = Array.from({ length: lastTick - firstTick + 1 }, (_, index) => firstTick + index);

  const carried = drag?.kind === 'crate' ? drag : null;
  const stackHeight = crates * CRATE.height;
  const newtY = GROUND_Y - SLED.height - stackHeight - NEWT_FEET_OFFSET;
  const netY = Math.max(44, newtY - 56);
  const hovering = carried ? overDropZone(carried.x, carried.y) && crates < MAX_CRATES : false;
  const px = (newtons: number) => newtons * PIXELS_PER_NEWTON;

  const renderRope = (side: Side, newtons: number) => {
    const sign = side === 'right' ? 1 : -1;
    const x = handleX(side, newtons);
    return (
      <g key={side}>
        <line
          x1={BODY_X + sign * (SLED.width / 2)}
          y1={ROPE_Y}
          x2={x}
          y2={ROPE_Y}
          stroke="var(--text-muted)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <g
          role="slider"
          tabIndex={0}
          aria-label={`${side} pull`}
          aria-valuemin={0}
          aria-valuemax={MAX_PULL}
          aria-valuenow={newtons}
          aria-valuetext={`${newtons} newtons toward the ${side}`}
          onKeyDown={nudgePull(side, newtons)}
          onPointerDown={startRope(side)}
          className="cursor-grab outline-none focus-visible:[&>circle:first-child]:stroke-[var(--accent-blue)]"
        >
          <circle cx={x} cy={ROPE_Y} r="26" fill="transparent" stroke="transparent" strokeWidth="3" />
          <circle cx={x} cy={ROPE_Y} r="12" fill={FORCE_COLORS.applied} stroke="var(--surface-plot)" strokeWidth="3" />
          <path
            d={`M ${x - sign * 3} ${ROPE_Y - 5} L ${x + sign * 3} ${ROPE_Y} L ${x - sign * 3} ${ROPE_Y + 5}`}
            fill="none"
            stroke="var(--surface-plot)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        {newtons > 0 && (
          <text
            x={x}
            y={ROPE_Y - 24}
            textAnchor="middle"
            fontSize="14"
            fontWeight="700"
            fill={FORCE_COLORS.applied}
            paintOrder="stroke"
            stroke="var(--surface-plot)"
            strokeWidth="4"
          >
            {newtons} N
          </text>
        )}
      </g>
    );
  };

  return (
    <div className="not-prose my-8 grid gap-4">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        role="group"
        aria-label={`Newt on a frictionless sled of ${mass} kilograms with a net force of ${format(net)} newtons and acceleration ${format(acceleration, 2)} metres per second squared`}
        className="block h-auto w-full touch-none select-none"
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* Ice with metre ticks. */}
        <line x1="0" y1={GROUND_Y} x2={VIEW.width} y2={GROUND_Y} stroke="var(--grid-line)" strokeWidth="3" />
        {ticks.map((tick) => {
          const x = toScreen(tick);
          const major = tick % 5 === 0;
          return (
            <g key={tick}>
              <line x1={x} y1={GROUND_Y} x2={x} y2={GROUND_Y + (major ? 12 : 6)} stroke="var(--grid-line)" strokeWidth="2" />
              {major && (
                <text x={x} y={GROUND_Y + 28} textAnchor="middle" fontSize="12" fill="var(--text-muted)">
                  {tick} m
                </text>
              )}
            </g>
          );
        })}

        {/* Crate bin. */}
        <rect
          x={BIN.x}
          y={BIN.y}
          width={BIN.width}
          height={BIN.height}
          rx="10"
          fill="none"
          stroke="var(--grid-line)"
          strokeWidth="2"
          strokeDasharray="5 5"
        />
        <g
          onPointerDown={startCrate(false)}
          className={crates >= MAX_CRATES ? 'opacity-40' : 'cursor-grab'}
        >
          <rect
            x={BIN.x + (BIN.width - CRATE.width) / 2}
            y={BIN.y + 12}
            width={CRATE.width}
            height={CRATE.height + 8}
            rx="3"
            fill="color-mix(in srgb, var(--grid-line) 28%, transparent)"
            stroke="var(--grid-line)"
            strokeWidth="2"
          />
          <text x={BIN.x + BIN.width / 2} y={BIN.y + 31} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text-muted)">
            1 kg
          </text>
        </g>
        <text x={BIN.x + BIN.width / 2} y={BIN.y + 66} textAnchor="middle" fontSize="12" fill="var(--text-muted)">
          {crates >= MAX_CRATES ? 'sled is full' : 'drag a crate'}
        </text>
        <text x={BIN.x + BIN.width / 2} y={BIN.y + 82} textAnchor="middle" fontSize="12" fill="var(--text-muted)">
          {crates >= MAX_CRATES ? 'drag one off' : 'onto the sled'}
        </text>

        {carried && (
          <rect
            x={DROP_ZONE.x}
            y={DROP_ZONE.y}
            width={DROP_ZONE.width}
            height={DROP_ZONE.height}
            rx="14"
            fill={hovering ? 'color-mix(in srgb, var(--accent-blue) 12%, transparent)' : 'none'}
            stroke={hovering ? 'var(--accent-blue)' : 'var(--grid-line)'}
            strokeWidth="2"
            strokeDasharray="6 6"
            pointerEvents="none"
          />
        )}

        {/* Sled, crates (the added mass), and Newt riding on top. */}
        <rect
          x={BODY_X - SLED.width / 2}
          y={GROUND_Y - SLED.height}
          width={SLED.width}
          height={SLED.height}
          rx="5"
          fill="color-mix(in srgb, var(--grid-line) 55%, transparent)"
          stroke="var(--grid-line)"
          strokeWidth="2"
        />
        {Array.from({ length: crates }, (_, index) => (
          <g key={index} onPointerDown={startCrate(true)} className="cursor-grab">
            <rect
              x={BODY_X - CRATE.width / 2}
              y={GROUND_Y - SLED.height - (index + 1) * CRATE.height}
              width={CRATE.width}
              height={CRATE.height}
              rx="3"
              fill="color-mix(in srgb, var(--grid-line) 28%, transparent)"
              stroke="var(--grid-line)"
              strokeWidth="2"
            />
            <text
              x={BODY_X}
              y={GROUND_Y - SLED.height - (index + 1) * CRATE.height + CRATE.height / 2 + 4}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill="var(--text-muted)"
              pointerEvents="none"
            >
              1 kg
            </text>
          </g>
        ))}
        <NewtSprite x={BODY_X} y={newtY} />

        {renderRope('left', pullLeft)}
        {renderRope('right', pullRight)}

        {ghost && (
          <g transform={`translate(${ghost.x} ${ghost.y}) rotate(${ghost.rot})`} pointerEvents="none">
            <rect
              x={-CRATE.width / 2}
              y={-CRATE.height / 2}
              width={CRATE.width}
              height={CRATE.height}
              rx="3"
              fill="color-mix(in srgb, var(--grid-line) 45%, var(--surface-plot))"
              stroke="var(--grid-line)"
              strokeWidth="2"
            />
            <text y="4" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--text-muted)">
              1 kg
            </text>
          </g>
        )}

        <ForceArrow
          origin={{ x: BODY_X, y: netY }}
          vector={{ x: Math.sign(net), y: 0 }}
          scale={px(Math.abs(net))}
          maxLength={px(Math.abs(net))}
          color={FORCE_COLORS.net}
          label="ΣF"
          labelBounds={VIEW}
          labelAt={net === 0 ? { x: BODY_X, y: netY, anchor: 'middle' } : undefined}
        />

        {!touched && (
          <text x={handleX('right', 0) + 28} y={ROPE_Y + 5} fontSize="13" fill="var(--text-muted)">
            drag a handle
          </text>
        )}

        {/* Motion map: a dot every half second, left where Newt was. */}
        <line x1="20" y1={MAP_Y} x2={VIEW.width - 20} y2={MAP_Y} stroke="var(--grid-line)" strokeWidth="1" strokeDasharray="3 5" />
        {dots.map((dot) => {
          const x = toScreen(dot.x);
          return x < 0 || x > VIEW.width ? null : (
            <circle
              key={dot.t}
              cx={x}
              cy={MAP_Y}
              r="5"
              fill="var(--accent-blue)"
              opacity={Math.max(0.15, 1 - (state.t - dot.t) / DOT_LIFETIME)}
            />
          );
        })}
        <circle cx={BODY_X} cy={MAP_Y} r="7" fill="none" stroke={FORCE_COLORS.net} strokeWidth="2.5" />

        <text x="20" y="30" fontSize="14" fill="var(--text-muted)">
          v = {format(state.v, 1)} m/s
        </text>
      </svg>

      <Readout variant="inline" className="justify-center">
        <Readout.Value label="ΣF" value={format(net)} unit="N" />
        <Readout.Value label="m" value={mass} unit="kg" />
        <Readout.Value label="a = ΣF / m" value={format(acceleration, 2)} unit="m/s²" />
      </Readout>
    </div>
  );
}
