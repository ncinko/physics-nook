import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  SCENE,
  blocksGate,
  isMoving,
  releaseBall,
  startBall,
  stepBall,
  type Ball,
  type Point,
} from '../../lib/kinematics/rollingLaunch';

// Setup sketch for the photogate launch lab: ramp, two gates a spacing d apart
// near the table edge, table height h, and the landing distance left as a
// question mark on purpose.
//
// The ball can be picked up — drag it, or click it and click again where it
// should go — and let go anywhere. It then rolls, launches, and bounces by the
// physics in `lib/kinematics/rollingLaunch`, and each gate lights while the
// ball is in its beam.

const ink = 'var(--text-primary)';
const muted = 'var(--text-muted)';
const dimension = 'var(--accent-blue)';
const path = 'var(--accent-red)';
const lit = 'var(--accent-green)';

const { tableTop, floor, edge, radius, gates } = SCENE;
const landing = 505;

// Launch is horizontal, so the path is a parabola whose tangent at the edge is
// flat: a quadratic Bézier with its control point level with the start.
const launchY = tableTop - radius;
const trajectory = `M ${edge} ${launchY} Q ${(edge + landing) / 2} ${launchY} ${landing} ${floor - radius}`;

/** How long a gate keeps glowing after the ball leaves its beam. */
const AFTERGLOW_SECONDS = 0.6;
/** How long an empty picture waits before the ball reappears on the ramp. */
const RESPAWN_SECONDS = 0.8;
/** Pointer travel that turns a press into a drag, in SVG units. */
const DRAG_THRESHOLD = 4;
/** Frames longer than this (a background tab) are not simulated in full. */
const MAX_FRAME_SECONDS = 0.05;

type Grip = { pointerId: number; start: Point; dragged: boolean } | null;

export default function PhotogateLaunchDiagram() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [ball, setBall] = useState<Ball>(startBall);
  const [glow, setGlow] = useState<number[]>(() => gates.map(() => 0));

  const ballRef = useRef(ball);
  const gripRef = useRef<Grip>(null);
  /** Seconds since each gate last had the ball in it; Infinity for never. */
  const sinceBlockedRef = useRef<number[]>(gates.map(() => Infinity));
  const goneForRef = useRef(0);
  const frameRef = useRef<number | null>(null);

  const commit = useCallback((next: Ball) => {
    ballRef.current = next;
    setBall(next);
  }, []);

  const tick = useCallback(
    (dt: number) => {
      let next = ballRef.current;
      if (isMoving(next)) next = stepBall(next, dt);

      if (next.mode === 'gone') {
        goneForRef.current += dt;
        if (goneForRef.current >= RESPAWN_SECONDS) {
          goneForRef.current = 0;
          next = startBall();
        }
      }

      sinceBlockedRef.current = gates.map((gate, index) =>
        blocksGate(next, gate.x) ? 0 : sinceBlockedRef.current[index] + dt,
      );
      setGlow(sinceBlockedRef.current.map((since) => Math.max(0, 1 - since / AFTERGLOW_SECONDS)));
      commit(next);
    },
    [commit],
  );

  /** Runs frames only while something is changing: motion, a glow, a respawn. */
  const animate = useCallback(() => {
    if (frameRef.current !== null) return;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
      last = now;
      tick(dt);

      const current = ballRef.current;
      const glowing = sinceBlockedRef.current.some((since) => since < AFTERGLOW_SECONDS);
      if (isMoving(current) || current.mode === 'gone' || glowing) {
        frameRef.current = requestAnimationFrame(frame);
      } else {
        frameRef.current = null;
      }
    };
    frameRef.current = requestAnimationFrame(frame);
  }, [tick]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const toScene = (event: PointerEvent): Point | null => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return {
      x: Math.min(Math.max(point.x, radius), SCENE.width - radius),
      y: Math.min(Math.max(point.y, radius), floor - radius),
    };
  };

  const hold = (at: Point) => {
    commit({ mode: 'held', x: at.x, y: at.y, vx: 0, vy: 0 });
    animate(); // Lets a gate light while the ball is held in it.
  };

  const letGo = (at: Point) => {
    gripRef.current = null;
    commit(releaseBall(at));
    animate();
  };

  const onBallPointerDown = (event: PointerEvent<SVGGElement>) => {
    if (ballRef.current.mode === 'held') return; // The svg's handler places it.
    const at = toScene(event);
    if (!at) return;
    event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    gripRef.current = { pointerId: event.pointerId, start: at, dragged: false };
    hold({ x: ballRef.current.x, y: ballRef.current.y });
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    // Carrying the ball after a click: this click puts it down.
    if (ballRef.current.mode !== 'held' || gripRef.current) return;
    const at = toScene(event);
    if (at) letGo(at);
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (ballRef.current.mode !== 'held') return;
    const at = toScene(event);
    if (!at) return;
    const grip = gripRef.current;
    if (grip && !grip.dragged && Math.hypot(at.x - grip.start.x, at.y - grip.start.y) > DRAG_THRESHOLD) {
      gripRef.current = { ...grip, dragged: true };
    }
    hold(at);
  };

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const grip = gripRef.current;
    if (!grip || grip.pointerId !== event.pointerId) return;
    if (grip.dragged) {
      const at = toScene(event);
      if (at) letGo(at);
    } else {
      // A click without a drag picks the ball up to carry; the next click places it.
      gripRef.current = null;
    }
  };

  const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      gripRef.current = null;
      commit(releaseBall(startBall()));
      animate();
    } else if (event.key === 'Escape' && ballRef.current.mode === 'held') {
      gripRef.current = null;
      commit(startBall());
    }
  };

  const held = ball.mode === 'held';

  return (
    <figure className="photogate-launch-diagram m-0 py-3">
      <svg
        ref={svgRef}
        viewBox="0 0 580 320"
        className="mx-auto block h-auto w-full max-w-[36rem] select-none"
        role="group"
        aria-labelledby="photogate-launch-diagram-title"
        style={{ cursor: held ? 'grabbing' : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <title id="photogate-launch-diagram-title">
          A ball rolls down a ramp, through photogates A and B spaced d apart near the table edge,
          then off a table of height h. How far from the table it lands is unknown.
        </title>

        <defs>
          <marker
            id="pgl-arrow"
            viewBox="0 0 10 10"
            refX="5"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" fill={dimension} />
          </marker>
        </defs>

        {/* floor */}
        <line x1="10" y1={floor} x2="570" y2={floor} stroke={ink} strokeWidth="2" />

        {/* table */}
        <rect x="20" y={tableTop} width={edge - 20} height="10" fill={muted} opacity="0.35" stroke={ink} />
        <line x1="40" y1={tableTop + 10} x2="40" y2={floor} stroke={ink} strokeWidth="3" />
        <line x1={edge - 20} y1={tableTop + 10} x2={edge - 20} y2={floor} stroke={ink} strokeWidth="3" />

        {/* ramp */}
        <path d={`M 30 ${tableTop - 70} L 30 ${tableTop} L 140 ${tableTop} Z`} fill={muted} opacity="0.2" stroke={ink} />

        {/* gates, lit while the ball cuts their beam */}
        {gates.map(({ x, label }, index) => {
          const frame = `M ${x - 14} ${tableTop} L ${x - 14} ${tableTop - 36} L ${x + 14} ${tableTop - 36} L ${x + 14} ${tableTop}`;
          const intensity = glow[index];
          return (
            <g key={label}>
              <path d={frame} fill="none" stroke={ink} strokeWidth="3" strokeLinejoin="round" />
              <line
                x1={x - 12}
                y1={tableTop - radius}
                x2={x + 12}
                y2={tableTop - radius}
                stroke={path}
                strokeDasharray="2 2"
              />
              {intensity > 0 && (
                <g opacity={intensity} aria-hidden="true">
                  <path
                    d={frame}
                    fill="none"
                    stroke={lit}
                    strokeWidth="7"
                    strokeLinejoin="round"
                    opacity="0.35"
                  />
                  <path d={frame} fill="none" stroke={lit} strokeWidth="3" strokeLinejoin="round" />
                  <line
                    x1={x - 12}
                    y1={tableTop - radius}
                    x2={x + 12}
                    y2={tableTop - radius}
                    stroke={lit}
                    strokeWidth="2"
                  />
                </g>
              )}
              <text
                x={x}
                y={tableTop - 44}
                textAnchor="middle"
                fontSize="14"
                fontWeight="700"
                fill={intensity > 0.5 ? lit : ink}
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* gate spacing d */}
        <line
          x1={gates[0].x}
          y1={tableTop - 64}
          x2={gates[1].x}
          y2={tableTop - 64}
          stroke={dimension}
          strokeWidth="1.5"
          markerStart="url(#pgl-arrow)"
          markerEnd="url(#pgl-arrow)"
        />
        <text
          x={(gates[0].x + gates[1].x) / 2}
          y={tableTop - 70}
          textAnchor="middle"
          fontSize="15"
          fontStyle="italic"
          fill={dimension}
        >
          d
        </text>

        {/* plumb line and height h */}
        <line x1={edge} y1={tableTop} x2={edge} y2={floor} stroke={muted} strokeDasharray="4 4" />
        <line
          x1={edge + 16}
          y1={tableTop}
          x2={edge + 16}
          y2={floor}
          stroke={dimension}
          strokeWidth="1.5"
          markerStart="url(#pgl-arrow)"
          markerEnd="url(#pgl-arrow)"
        />
        <text x={edge + 26} y={(tableTop + floor) / 2 + 5} fontSize="15" fontStyle="italic" fill={dimension}>
          h
        </text>

        {/* flight */}
        <path d={trajectory} fill="none" stroke={path} strokeWidth="2" strokeDasharray="6 5" />
        <rect x={landing - 30} y={floor - 3} width="60" height="3" fill={ink} />

        {/* landing distance: the unknown */}
        <line
          x1={edge}
          y1={floor + 20}
          x2={landing}
          y2={floor + 20}
          stroke={dimension}
          strokeWidth="1.5"
          markerStart="url(#pgl-arrow)"
          markerEnd="url(#pgl-arrow)"
        />
        <text x={(edge + landing) / 2} y={floor + 38} textAnchor="middle" fontSize="16" fontWeight="700" fill={dimension}>
          ?
        </text>

        {/* the ball, drawn last so it passes in front of the gates */}
        {ball.mode !== 'gone' && (
          <g
            role="button"
            tabIndex={0}
            aria-label="Ball. Drag it anywhere and let go, or press Enter to roll it from the top of the ramp."
            onPointerDown={onBallPointerDown}
            onKeyDown={onKeyDown}
            // The focus ring is drawn on the ball itself; a browser outline on an SVG
            // group lands on its bounding box, not the circle.
            style={{ cursor: held ? 'grabbing' : 'grab', touchAction: 'none', outline: 'none' }}
            className="group"
          >
            {/* A larger invisible target, so the ball is easy to catch on a phone. */}
            <circle cx={ball.x} cy={ball.y} r={radius * 2.25} fill="transparent" />
            <circle
              cx={ball.x}
              cy={ball.y}
              r={radius}
              fill={muted}
              stroke={ink}
              className="group-focus-visible:stroke-[var(--accent-blue)] group-focus-visible:[stroke-width:3]"
            />
          </g>
        )}
      </svg>
      <figcaption className="type-supporting mt-1 text-center">
        Drag the ball anywhere and let go, or click it and click where it should go.
      </figcaption>
    </figure>
  );
}
