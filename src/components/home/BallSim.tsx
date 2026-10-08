import { useEffect, useRef, useState, type PointerEvent } from 'react';

import {
  BALL_RADIUS,
  BOWL_H,
  BOWL_W,
  isAtRest,
  rampPath,
  settleAboveRamp,
  stepBall,
  surfaceY,
  type BallState,
} from '../../lib/home/ballBowl';
import { svgPoint, useInView, useReducedMotion } from './homeSimHooks';

// Landing-page mechanics miniature: a ball in a U-shaped ramp. Pick it up, drop
// or throw it, and watch it bounce and roll back and forth until it settles.

const MAX_THROW = 450; // px/s
const RAMP = rampPath();
const FILL_PATH = `${RAMP}L${BOWL_W} ${BOWL_H}L0 ${BOWL_H}Z`;

const REST_X = BOWL_W / 2;
const RESTING: BallState = { x: REST_X, y: surfaceY(REST_X) - BALL_RADIUS, vx: 0, vy: 0, angle: 0 };
const START: BallState = { x: 36, y: surfaceY(36) - BALL_RADIUS, vx: 0, vy: 0, angle: 0 };

export default function BallSim() {
  const [grabbed, setGrabbed] = useState(false);
  const [touched, setTouched] = useState(false);
  const [asleep, setAsleep] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const ballRef = useRef<SVGGElement>(null);
  const reduced = useReducedMotion();
  const inView = useInView(svgRef);
  const state = useRef<BallState>(RESTING);
  const grab = useRef<{ dx: number; dy: number; lastX: number; lastY: number; lastT: number; vx: number; vy: number } | null>(
    null,
  );
  const sleeping = useRef(false);
  const wakeLoop = useRef<() => void>(() => {});

  const draw = () => {
    const b = state.current;
    const deg = (b.angle * 180) / Math.PI;
    ballRef.current?.setAttribute('transform', `translate(${b.x.toFixed(2)} ${b.y.toFixed(2)}) rotate(${deg.toFixed(1)})`);
  };

  // The ball begins on the left slope and rolls itself down; reduced motion starts it at rest.
  useEffect(() => {
    state.current = reduced ? RESTING : START;
    sleeping.current = reduced;
    setAsleep(reduced);
    draw();
  }, [reduced]);

  useEffect(() => {
    if (!inView) return;
    let raf = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      raf = 0;
      if (grab.current || sleeping.current) {
        last = null;
        return;
      }
      const dt = last === null ? 1 / 60 : Math.min((now - last) / 1000, 0.05);
      last = now;
      state.current = stepBall(state.current, dt);
      draw();
      if (isAtRest(state.current)) {
        sleeping.current = true;
        state.current = { ...state.current, vx: 0, vy: 0 };
        setAsleep(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    wakeLoop.current = () => {
      sleeping.current = false;
      setAsleep(false);
      last = null;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    if (!sleeping.current) raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
  }, [inView]);

  const onDown = (event: PointerEvent<SVGGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = svgPoint(svg, event.clientX, event.clientY);
    grab.current = {
      dx: state.current.x - p.x,
      dy: state.current.y - p.y,
      lastX: p.x,
      lastY: p.y,
      lastT: performance.now(),
      vx: 0,
      vy: 0,
    };
    setGrabbed(true);
    setTouched(true);
  };

  const onMove = (event: PointerEvent<SVGGElement>) => {
    const g = grab.current;
    const svg = svgRef.current;
    if (!g || !svg) return;
    const p = svgPoint(svg, event.clientX, event.clientY);
    const now = performance.now();
    const dt = Math.max((now - g.lastT) / 1000, 1e-3);
    // Smoothed pointer velocity, so a flick carries into the throw.
    g.vx = 0.5 * g.vx + 0.5 * ((p.x - g.lastX) / dt);
    g.vy = 0.5 * g.vy + 0.5 * ((p.y - g.lastY) / dt);
    g.lastX = p.x;
    g.lastY = p.y;
    g.lastT = now;
    state.current = settleAboveRamp({ ...state.current, x: p.x + g.dx, y: p.y + g.dy, vx: 0, vy: 0 });
    draw();
  };

  const onUp = () => {
    const g = grab.current;
    if (!g) return;
    const stale = performance.now() - g.lastT > 80; // paused before letting go: a plain drop
    const clampSpeed = (v: number) => Math.max(-MAX_THROW, Math.min(MAX_THROW, v));
    state.current = {
      ...state.current,
      vx: stale ? 0 : clampSpeed(g.vx),
      vy: stale ? 0 : clampSpeed(g.vy),
    };
    grab.current = null;
    setGrabbed(false);
    wakeLoop.current();
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${BOWL_W} ${BOWL_H}`}
      className="block h-full w-full"
      role="img"
      aria-label="A ball in a U-shaped ramp. Drag the ball to pick it up, then let go to drop it and watch it bounce and roll."
    >
      <path d={FILL_PATH} fill="var(--grid-line)" fillOpacity={0.35} />
      <path d={RAMP} fill="none" stroke="var(--text-muted)" strokeWidth={2.5} strokeLinecap="round" />
      <g
        ref={ballRef}
        transform={`translate(${RESTING.x} ${RESTING.y})`}
        style={{ cursor: grabbed ? 'grabbing' : 'grab', touchAction: 'none' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <circle r={BALL_RADIUS + 9} fill="transparent" />
        <circle r={BALL_RADIUS} fill="var(--accent-green)" stroke="var(--surface-plot)" strokeWidth={1.5} />
        <path d={`M0 0L${BALL_RADIUS - 1.5} 0`} stroke="var(--surface-plot)" strokeWidth={2} strokeLinecap="round" />
        {!touched && asleep ? (
          <circle r={BALL_RADIUS + 3} fill="none" stroke="var(--text-muted)" strokeWidth={1}>
            <animate attributeName="r" values={`${BALL_RADIUS + 2};${BALL_RADIUS + 9};${BALL_RADIUS + 2}`} dur="2.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.8;0;0.8" dur="2.4s" repeatCount="indefinite" />
          </circle>
        ) : null}
      </g>
    </svg>
  );
}
