import { useEffect, useRef, useState, type PointerEvent } from 'react';

import { TAU, eccentricityFromFocusX, orbitPoint, semiMajorAxis } from '../../lib/home/orbit';
import { svgPoint, useInView, useReducedMotion } from './homeSimHooks';

// Landing-page astronomy miniature: a planet on a Kepler ellipse. Drag the empty
// focus to stretch the orbit; the planet speeds up near the Sun.

const W = 320;
const H = 150;
const CX = W / 2;
const CY = H / 2;
const B = 64; // fixed semi-minor axis; the semi-major axis grows with eccentricity
const PERIOD_MS = 7000;
const STATIC_ANOMALY = 0.9;

export default function OrbitSim() {
  const [ecc, setEcc] = useState(0.5);
  const [dragging, setDragging] = useState(false);
  // Reduced-motion visitors get a still orbit until they touch it; then it revolves.
  const [engaged, setEngaged] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const planetRef = useRef<SVGCircleElement>(null);
  const draggingRef = useRef(false);
  const eccRef = useRef(ecc);
  const anomalyRef = useRef(STATIC_ANOMALY);
  const reduced = useReducedMotion();
  const inView = useInView(svgRef);

  const a = semiMajorAxis(ecc, B);
  const sunX = CX + a * ecc;
  const focusX = CX - a * ecc;

  const draw = () => {
    const e = eccRef.current;
    const M = anomalyRef.current;
    const A = semiMajorAxis(e, B);
    const planet = orbitPoint(M, e, A, CX, CY);
    planetRef.current?.setAttribute('cx', planet.x.toFixed(2));
    planetRef.current?.setAttribute('cy', planet.y.toFixed(2));
  };

  useEffect(() => {
    eccRef.current = ecc;
    draw();
  }, [ecc]);

  useEffect(() => {
    if ((reduced && !engaged) || !inView) return;
    let raf = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      const dt = last === null ? 0 : Math.min(now - last, 100);
      last = now;
      anomalyRef.current = (anomalyRef.current + (dt / PERIOD_MS) * TAU) % TAU;
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced, engaged, inView]);

  const moveFocus = (event: PointerEvent<SVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    setEcc(eccentricityFromFocusX(svgPoint(svg, event.clientX, event.clientY).x, CX, B));
  };

  const endDrag = () => {
    draggingRef.current = false;
    setDragging(false);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="block h-full w-full"
      role="img"
      aria-label="A planet orbiting the Sun on an ellipse. Drag the empty focus to change the orbit's shape."
    >
      <ellipse cx={CX} cy={CY} rx={a} ry={B} fill="none" stroke="var(--accent-blue)" strokeWidth={2} />
      <circle cx={sunX} cy={CY} r={10} fill="#fbbf24" stroke="#f59e0b" strokeWidth={2} />
      <circle ref={planetRef} cx={CX + a} cy={CY} r={6} fill="#3b82f6" stroke="#1d4ed8" strokeWidth={1.5} />
      <g
        style={{ cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          draggingRef.current = true;
          setDragging(true);
          setEngaged(true);
          moveFocus(event);
        }}
        onPointerMove={(event) => {
          if (draggingRef.current) moveFocus(event);
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <circle cx={focusX} cy={CY} r={16} fill="transparent" />
        <circle cx={focusX} cy={CY} r={5} fill="var(--surface-plot)" stroke="var(--text-primary)" strokeWidth={1.75} />
        {!dragging && ecc === 0.5 ? (
          <circle cx={focusX} cy={CY} r={9} fill="none" stroke="var(--text-muted)" strokeWidth={1}>
            <animate attributeName="r" values="7;13;7" dur="2.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.8;0;0.8" dur="2.4s" repeatCount="indefinite" />
          </circle>
        ) : null}
      </g>
    </svg>
  );
}
