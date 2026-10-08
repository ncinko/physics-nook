import { useEffect, useRef, useState, type PointerEvent } from 'react';

import {
  HISTORY_SECONDS,
  pushSample,
  retardedField,
  stepCharge,
  type Bounds,
  type ChargeBody,
  type Sample,
} from '../../lib/home/retardedField';
import { svgPoint, useInView } from './homeSimHooks';

// Landing-page electromagnetism miniature: one positive charge and a grid of
// electric-field arrows. The field is the retarded one, so when the charge moves
// or stops, the change spreads outward as a shell at the signal speed.

const W = 320;
const H = 150;
const R = 9;
const BOUNDS: Bounds = { minX: R, maxX: W - R, minY: R, maxY: H - R };
const COLS = 16;
const ROWS = 7;
const SPACING = 20;
const ORIGIN_X = (W - (COLS - 1) * SPACING) / 2;
const ORIGIN_Y = (H - (ROWS - 1) * SPACING) / 2;
const ARROW_MAX = 15; // px, full-strength arrow length
const E_REF = 1 / 30 ** 2; // field strength that draws a full-length arrow
const HIDE_RADIUS = R + 5;
const MAX_STEP = 0.05;

const GRID = Array.from({ length: COLS * ROWS }, (_, i) => ({
  x: ORIGIN_X + (i % COLS) * SPACING,
  y: ORIGIN_Y + Math.floor(i / COLS) * SPACING,
}));

const START: ChargeBody = { x: W / 2, y: H / 2, vx: 0, vy: 0 };

/** Path for an arrow centred on (x, y) pointing along (ux, uy). */
function arrowPath(x: number, y: number, ux: number, uy: number, length: number): string {
  const hx = (ux * length) / 2;
  const hy = (uy * length) / 2;
  const tipX = x + hx;
  const tipY = y + hy;
  const head = Math.min(4, length * 0.45);
  const px = -uy;
  const py = ux;
  const bx = tipX - ux * head;
  const by = tipY - uy * head;
  return (
    `M${(x - hx).toFixed(1)} ${(y - hy).toFixed(1)}L${tipX.toFixed(1)} ${tipY.toFixed(1)}` +
    `M${(bx + px * head * 0.6).toFixed(1)} ${(by + py * head * 0.6).toFixed(1)}L${tipX.toFixed(1)} ${tipY.toFixed(1)}` +
    `L${(bx - px * head * 0.6).toFixed(1)} ${(by - py * head * 0.6).toFixed(1)}`
  );
}

export default function ChargeSim() {
  const [grabbed, setGrabbed] = useState(false);
  const [touched, setTouched] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const chargeRef = useRef<SVGGElement>(null);
  const arrowRefs = useRef<(SVGPathElement | null)[]>([]);
  const inView = useInView(svgRef);

  const body = useRef<ChargeBody>(START);
  const clock = useRef(0);
  const history = useRef<Sample[]>([{ t: 0, ...START, ax: 0, ay: 0 }]);
  const target = useRef<{ x: number; y: number } | null>(null);
  const grabOffset = useRef({ dx: 0, dy: 0 });
  const lastActive = useRef(-Infinity);
  const wakeLoop = useRef<() => void>(() => {});

  const draw = () => {
    const now = clock.current;
    chargeRef.current?.setAttribute('transform', `translate(${body.current.x.toFixed(2)} ${body.current.y.toFixed(2)})`);
    GRID.forEach((p, i) => {
      const el = arrowRefs.current[i];
      if (!el) return;
      const dxc = p.x - body.current.x;
      const dyc = p.y - body.current.y;
      if (Math.hypot(dxc, dyc) < HIDE_RADIUS) {
        el.setAttribute('d', '');
        return;
      }
      const { ex, ey } = retardedField(history.current, now, p.x, p.y);
      const mag = Math.hypot(ex, ey);
      if (mag < 1e-9) {
        el.setAttribute('d', '');
        return;
      }
      const strength = Math.min(1, Math.sqrt(mag / E_REF));
      el.setAttribute('d', arrowPath(p.x, p.y, ex / mag, ey / mag, Math.max(3, ARROW_MAX * strength)));
      el.setAttribute('opacity', (0.3 + 0.6 * strength).toFixed(2));
    });
  };

  useEffect(() => {
    draw();
  }, []);

  useEffect(() => {
    if (!inView) return;
    let raf = 0;
    let last: number | null = null;
    const tick = (frame: number) => {
      raf = 0;
      const dt = last === null ? 1 / 60 : Math.min((frame - last) / 1000, MAX_STEP);
      last = frame;
      clock.current += dt;
      const step = stepCharge(body.current, target.current, dt, BOUNDS);
      body.current = step.body;
      if (target.current || Math.hypot(step.body.vx, step.body.vy) > 0.5) lastActive.current = clock.current;
      pushSample(history.current, { t: clock.current, ...step.body, ax: step.ax, ay: step.ay });
      draw();
      // Idle once the last disturbance has swept past the whole panel.
      if (!target.current && clock.current - lastActive.current > HISTORY_SECONDS) return;
      raf = requestAnimationFrame(tick);
    };
    wakeLoop.current = () => {
      last = null;
      if (!raf) raf = requestAnimationFrame(tick);
    };
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
    grabOffset.current = { dx: body.current.x - p.x, dy: body.current.y - p.y };
    target.current = { x: body.current.x, y: body.current.y };
    lastActive.current = clock.current;
    setGrabbed(true);
    setTouched(true);
    wakeLoop.current();
  };

  const onMove = (event: PointerEvent<SVGGElement>) => {
    const svg = svgRef.current;
    if (!target.current || !svg) return;
    const p = svgPoint(svg, event.clientX, event.clientY);
    target.current = { x: p.x + grabOffset.current.dx, y: p.y + grabOffset.current.dy };
  };

  const onUp = () => {
    target.current = null;
    setGrabbed(false);
    wakeLoop.current();
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="block h-full w-full"
      role="img"
      aria-label="A positive charge surrounded by a grid of electric-field arrows. Drag the charge and the field updates outward from it at a finite speed."
    >
      {GRID.map((_, i) => (
        <path
          key={i}
          ref={(el) => {
            arrowRefs.current[i] = el;
          }}
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      <g
        ref={chargeRef}
        transform={`translate(${START.x} ${START.y})`}
        style={{ cursor: grabbed ? 'grabbing' : 'grab', touchAction: 'none' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <circle r={R + 8} fill="transparent" />
        <circle r={R} fill="var(--accent-red)" stroke="var(--surface-plot)" strokeWidth={2} />
        <path d="M-4.5 0H4.5M0 -4.5V4.5" stroke="#fff" strokeWidth={2.25} strokeLinecap="round" fill="none" />
        {!touched ? (
          <circle r={R + 3} fill="none" stroke="var(--accent-red)" strokeWidth={1}>
            <animate attributeName="r" values={`${R + 2};${R + 9};${R + 2}`} dur="2.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.8;0;0.8" dur="2.4s" repeatCount="indefinite" />
          </circle>
        ) : null}
      </g>
    </svg>
  );
}
