import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

// Three inline interactives, one per law, shown in a single-open accordion. The
// orbital math is small enough to keep local: solve Kepler's equation for the
// eccentric anomaly, then read positions off the ellipse.

const TAU = Math.PI * 2;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// Solve M = E - e*sin(E) for the eccentric anomaly E (Newton-Raphson).
const solveEccentricAnomaly = (meanAnomaly: number, e: number): number => {
  let E = meanAnomaly;
  for (let i = 0; i < 8; i += 1) {
    E -= (E - e * Math.sin(E) - meanAnomaly) / (1 - e * Math.cos(E));
  }
  return E;
};

// Ellipse point in centre-frame coordinates (x right, y up) for semi-major axis a
// and eccentricity e. The focus (the Sun) sits at (a*e, 0); perihelion is at E = 0.
const ellipseCentreFrame = (E: number, a: number, e: number) => ({
  x: a * Math.cos(E),
  y: a * Math.sqrt(1 - e * e) * Math.sin(E),
});

interface LawMeta {
  n: number;
  short: string;
  description: string;
}

const LAWS: LawMeta[] = [
  {
    n: 1,
    short: 'Orbits are ellipses',
    description:
      'Each planet moves on an ellipse with the Sun at one focus. Most planetary orbits are only slightly elongated, so they look almost circular, but the offset matters for precise predictions. Drag the slider to stretch the orbit and watch the Sun sit at a focus — never the centre.',
  },
  {
    n: 2,
    short: 'Equal areas in equal times',
    description:
      'The line from the Sun to a planet sweeps out equal areas in equal intervals. A planet therefore moves faster when closer to the Sun and slower when farther — a direct consequence of angular-momentum conservation. The two shaded wedges have equal area, and the planet crosses each in the same amount of time.',
  },
  {
    n: 3,
    short: 'Period and size are linked',
    description:
      "The square of the orbital period equals the cube of the orbit's average radius, in years and astronomical units. Slide the orbit out and the year grows much faster than the distance: doubling the radius nearly triples the period.",
  },
];

// ---------------------------------------------------------------------------
// Law 1 — the orbit is an ellipse with the Sun at a focus.
// ---------------------------------------------------------------------------

const ELLIPSE_VIEW_W = 360;
const ELLIPSE_VIEW_H = 240;
const ELLIPSE_PERIOD_MS = 7000;

function EllipseLaw() {
  const [eccentricity, setEccentricity] = useState(0.5);
  const planetRef = useRef<SVGCircleElement>(null);
  const cx = ELLIPSE_VIEW_W / 2;
  const cy = ELLIPSE_VIEW_H / 2;
  // Semi-major axis sized so the e = 0 circle fits the viewBox height with margin.
  const a = 104;
  const b = a * Math.sqrt(1 - eccentricity * eccentricity);
  const c = a * eccentricity;
  const sunX = cx + c; // Sun at the right focus
  const otherFocusX = cx - c;
  const perihelionX = cx + a; // closest point to the Sun

  // Animate the planet at a constant areal rate, so it speeds up near the Sun.
  useEffect(() => {
    let raf = 0;
    let start: number | null = null;
    const tick = (timestamp: number) => {
      if (start === null) start = timestamp;
      const M = (((timestamp - start) / ELLIPSE_PERIOD_MS) % 1) * TAU;
      const E = solveEccentricAnomaly(M, eccentricity);
      const planet = planetRef.current;
      if (planet) {
        planet.setAttribute('cx', (cx + a * Math.cos(E)).toFixed(2));
        planet.setAttribute('cy', (cy - b * Math.sin(E)).toFixed(2));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [eccentricity, a, b, cx, cy]);

  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${ELLIPSE_VIEW_W} ${ELLIPSE_VIEW_H}`}
        className="w-full"
        role="img"
        aria-label={`Elliptical orbit with eccentricity ${eccentricity.toFixed(2)}, Sun at one focus.`}
      >
        {/* major axis */}
        <line x1={cx - a} y1={cy} x2={cx + a} y2={cy} stroke="var(--grid-line)" strokeWidth={1} strokeDasharray="3 5" />
        {/* the orbit */}
        <ellipse cx={cx} cy={cy} rx={a} ry={b} fill="none" stroke="var(--accent-blue)" strokeWidth={2.5} />
        {/* centre of the ellipse */}
        <circle cx={cx} cy={cy} r={2.5} fill="var(--text-muted)" />
        {/* empty (second) focus */}
        <circle cx={otherFocusX} cy={cy} r={5} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} />
        {/* Sun at the focus */}
        <circle cx={sunX} cy={cy} r={11} fill="#fbbf24" stroke="#f59e0b" strokeWidth={2} />
        {/* orbiting planet */}
        <circle ref={planetRef} cx={perihelionX} cy={cy} r={7} fill="#3b82f6" stroke="#1d4ed8" strokeWidth={1.5} />
        <text x={sunX} y={cy + 28} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--text-muted)">
          Sun (focus)
        </text>
      </svg>

      <label className="flex flex-wrap items-center gap-3 text-sm text-[var(--text-muted)]">
        <span className="font-medium">Eccentricity</span>
        <input
          type="range"
          min={0}
          max={0.8}
          step={0.01}
          value={eccentricity}
          onChange={(event) => setEccentricity(Number(event.target.value))}
          className="h-2 flex-1 cursor-pointer accent-[var(--accent-blue)]"
          aria-label="Orbit eccentricity"
        />
        <span className="w-28 text-right tabular-nums text-[color:var(--text-primary)]">
          e = {eccentricity.toFixed(2)}
          {eccentricity < 0.005 ? ' (circle)' : ''}
        </span>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Law 2 — the Sun–planet line sweeps equal areas in equal times.
// ---------------------------------------------------------------------------

const AREA_VIEW_W = 360;
const AREA_VIEW_H = 240;
const AREA_ECC = 0.6;
const AREA_PERIOD_MS = 9000;
const WEDGE_HALF_WIDTH = 0.5; // half-window in mean anomaly (equal => equal area/time)

function EqualAreasLaw() {
  const [playing, setPlaying] = useState(true);
  const planetRef = useRef<SVGCircleElement>(null);

  const cx = AREA_VIEW_W / 2;
  const cy = AREA_VIEW_H / 2;
  const a = 120;
  const b = a * Math.sqrt(1 - AREA_ECC * AREA_ECC);
  const c = a * AREA_ECC;
  const sunX = cx + c;
  const sunY = cy;

  const toScreen = (E: number) => {
    const p = ellipseCentreFrame(E, a, AREA_ECC);
    return { x: cx + p.x, y: cy - p.y };
  };

  // A shaded wedge from the Sun across the arc spanned by a mean-anomaly window.
  const wedgePoints = (centerMeanAnomaly: number) => {
    const pts: string[] = [`${sunX},${sunY}`];
    const steps = 28;
    for (let i = 0; i <= steps; i += 1) {
      const M = centerMeanAnomaly - WEDGE_HALF_WIDTH + (2 * WEDGE_HALF_WIDTH * i) / steps;
      const screen = toScreen(solveEccentricAnomaly(M, AREA_ECC));
      pts.push(`${screen.x.toFixed(1)},${screen.y.toFixed(1)}`);
    }
    return pts.join(' ');
  };

  // Animate the planet at a constant areal rate (mean anomaly grows linearly).
  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    let start: number | null = null;
    const tick = (timestamp: number) => {
      if (start === null) start = timestamp;
      const M = (((timestamp - start) / AREA_PERIOD_MS) % 1) * TAU;
      const screen = toScreen(solveEccentricAnomaly(M, AREA_ECC));
      const planet = planetRef.current;
      if (planet) {
        planet.setAttribute('cx', screen.x.toFixed(2));
        planet.setAttribute('cy', screen.y.toFixed(2));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${AREA_VIEW_W} ${AREA_VIEW_H}`}
        className="w-full"
        role="img"
        aria-label="A planet on an elliptical orbit sweeping two equal areas in equal times."
      >
        <ellipse cx={cx} cy={cy} rx={a} ry={b} fill="none" stroke="var(--grid-line)" strokeWidth={2} />
        {/* equal-area wedges: perihelion (M=0) and aphelion (M=PI) */}
        <polygon points={wedgePoints(0)} fill="#fbbf24" fillOpacity={0.32} stroke="#f59e0b" strokeOpacity={0.5} />
        <polygon points={wedgePoints(Math.PI)} fill="#3b82f6" fillOpacity={0.28} stroke="#1d4ed8" strokeOpacity={0.5} />
        <circle cx={sunX} cy={sunY} r={11} fill="#fbbf24" stroke="#f59e0b" strokeWidth={2} />
        <circle ref={planetRef} cx={cx + a} cy={cy} r={7} fill="#3b82f6" stroke="#1d4ed8" strokeWidth={1.5} />
        <text x={sunX - c - 6} y={cy + 4} textAnchor="end" fontSize={12} fill="var(--text-muted)">
          slow, far
        </text>
        <text x={cx + a + 4} y={cy + 4} textAnchor="start" fontSize={12} fill="var(--text-muted)">
          fast, near
        </text>
      </svg>

      <div className="flex items-center justify-between gap-3 text-sm text-[var(--text-muted)]">
        <span>Both shaded wedges have equal area — and equal time.</span>
        <button
          type="button"
          onClick={() => setPlaying((value) => !value)}
          className="rounded-full border border-[var(--grid-line)] bg-[var(--bg-primary)] px-3.5 py-1.5 font-medium text-[color:var(--text-primary)] transition-all hover:-translate-y-0.5 hover:shadow-md"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Law 3 — T^2 = a^3 (years, AU).
// ---------------------------------------------------------------------------

const PERIOD_VIEW_W = 360;
const PERIOD_VIEW_H = 240;
const PERIOD_A_MIN = 0.4;
const PERIOD_A_MAX = 6;
const PERIOD_EARTH_MS = 4000; // one Earth year (a = 1) takes this long on screen

const REFERENCE_PLANETS: { label: string; a: number }[] = [
  { label: 'Mercury', a: 0.39 },
  { label: 'Earth', a: 1 },
  { label: 'Mars', a: 1.52 },
  { label: 'Jupiter', a: 5.2 },
];

const periodRadiusPx = (a: number) => 16 + (a / PERIOD_A_MAX) * 104;

// Invert periodRadiusPx: pixel distance from the Sun back to a in AU.
const auFromRadiusPx = (px: number) => ((px - 16) / 104) * PERIOD_A_MAX;

function PeriodLaw() {
  const [semiMajor, setSemiMajor] = useState(1);
  const planetGroupRef = useRef<SVGGElement>(null);
  const draggingRef = useRef(false);
  const phaseRef = useRef(0);
  const lastTsRef = useRef<number | null>(null);

  const cx = PERIOD_VIEW_W / 2;
  const cy = PERIOD_VIEW_H / 2;
  const period = Math.pow(semiMajor, 1.5);
  const orbitRadius = periodRadiusPx(semiMajor);
  const earthRadius = periodRadiusPx(1);

  const placePlanet = (radiusPx: number, angle: number) => {
    const g = planetGroupRef.current;
    if (g) {
      g.setAttribute(
        'transform',
        `translate(${(cx + radiusPx * Math.cos(angle)).toFixed(2)} ${(cy + radiusPx * Math.sin(angle)).toFixed(2)})`,
      );
    }
  };

  // Angular speed scales as 1/T, so larger orbits visibly crawl. Tracking phase
  // incrementally (rather than from a start time) keeps motion smooth when the
  // orbit is dragged to a new radius.
  useEffect(() => {
    let raf = 0;
    lastTsRef.current = null;
    const tick = (timestamp: number) => {
      const last = lastTsRef.current;
      lastTsRef.current = timestamp;
      if (last !== null && !draggingRef.current) {
        phaseRef.current += ((timestamp - last) / PERIOD_EARTH_MS / period) * TAU;
        placePlanet(orbitRadius, phaseRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [period, orbitRadius, cx, cy]);

  const pointerToOrbit = (event: PointerEvent<SVGGElement>) => {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * PERIOD_VIEW_W;
    const py = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * PERIOD_VIEW_H;
    const dx = px - cx;
    const dy = py - cy;
    return {
      a: clamp(auFromRadiusPx(Math.hypot(dx, dy)), PERIOD_A_MIN, PERIOD_A_MAX),
      angle: Math.atan2(dy, dx),
    };
  };

  const applyDrag = (event: PointerEvent<SVGGElement>) => {
    const next = pointerToOrbit(event);
    if (!next) return;
    phaseRef.current = next.angle;
    setSemiMajor(next.a);
    placePlanet(periodRadiusPx(next.a), next.angle);
  };

  const dragHandlers = {
    onPointerDown: (event: PointerEvent<SVGGElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      draggingRef.current = true;
      applyDrag(event);
    },
    onPointerMove: (event: PointerEvent<SVGGElement>) => {
      if (!draggingRef.current) return;
      applyDrag(event);
    },
    onPointerUp: (event: PointerEvent<SVGGElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      draggingRef.current = false;
    },
  };

  const handleKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    const step = event.shiftKey ? 0.5 : 0.1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      setSemiMajor((value) => clamp(value + step, PERIOD_A_MIN, PERIOD_A_MAX));
      event.preventDefault();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      setSemiMajor((value) => clamp(value - step, PERIOD_A_MIN, PERIOD_A_MAX));
      event.preventDefault();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${PERIOD_VIEW_W} ${PERIOD_VIEW_H}`}
        className="w-full"
        role="img"
        aria-label={`Circular orbit of radius ${semiMajor.toFixed(2)} astronomical units with period ${period.toFixed(2)} years.`}
      >
        {/* Earth reference orbit */}
        <circle cx={cx} cy={cy} r={earthRadius} fill="none" stroke="var(--grid-line)" strokeWidth={1} strokeDasharray="3 5" />
        {/* the chosen orbit */}
        <circle cx={cx} cy={cy} r={orbitRadius} fill="none" stroke="var(--accent-blue)" strokeWidth={2.5} />
        <circle cx={cx} cy={cy} r={11} fill="#fbbf24" stroke="#f59e0b" strokeWidth={2} />
        {/* Draggable planet — drop it onto a different orbit. */}
        <g
          ref={planetGroupRef}
          // Constant initial transform: position is owned imperatively (rAF + drag),
          // so React must not re-apply it on every semiMajor change mid-drag.
          transform={`translate(${cx + earthRadius} ${cy})`}
          {...dragHandlers}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="slider"
          aria-label="Planet orbit radius in astronomical units"
          aria-valuemin={PERIOD_A_MIN}
          aria-valuemax={PERIOD_A_MAX}
          aria-valuenow={Number(semiMajor.toFixed(2))}
          aria-valuetext={`${semiMajor.toFixed(2)} AU`}
          className="cursor-grab outline-none focus-visible:[&>circle:last-child]:stroke-[var(--accent-blue)]"
        >
          <circle r={18} fill="transparent" />
          <circle r={7} fill="#3b82f6" stroke="#1d4ed8" strokeWidth={1.5} />
        </g>
      </svg>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--text-muted)]">
        <span className="font-medium">Drag the planet to a new orbit</span>
        <span className="flex flex-wrap gap-2">
          {REFERENCE_PLANETS.map((planet) => (
            <button
              key={planet.label}
              type="button"
              onClick={() => setSemiMajor(planet.a)}
              className="rounded-full border border-[var(--grid-line)] bg-[var(--bg-primary)] px-2.5 py-1 text-xs font-medium transition-colors hover:text-[var(--accent-blue)]"
            >
              {planet.label}
            </button>
          ))}
        </span>
      </div>

      <p className="text-center text-sm tabular-nums text-[color:var(--text-primary)]">
        a = {semiMajor.toFixed(2)} AU &nbsp;⟶&nbsp; T = a<sup>3/2</sup> = {period.toFixed(2)} yr
        &nbsp;<span className="text-[var(--text-muted)]">(T² = a³)</span>
      </p>
    </div>
  );
}

const renderLawInteractive = (n: number) => {
  if (n === 1) return <EllipseLaw />;
  if (n === 2) return <EqualAreasLaw />;
  return <PeriodLaw />;
};

export default function KeplerLaws() {
  const [openLaw, setOpenLaw] = useState(1);

  return (
    <div className="not-prose my-8 flex flex-col gap-3 text-[color:var(--text-primary)]">
      {LAWS.map((law) => {
        const isOpen = law.n === openLaw;
        return (
          <div
            key={law.n}
            className={`overflow-hidden rounded-2xl border transition-colors ${
              isOpen ? 'border-[var(--accent-blue)]' : 'border-[var(--grid-line)]'
            }`}
          >
            <button
              type="button"
              onClick={() => setOpenLaw(law.n)}
              aria-expanded={isOpen}
              className={`flex w-full items-center gap-4 px-4 py-3 text-left transition-colors ${
                isOpen
                  ? 'bg-[color-mix(in_srgb,var(--accent-blue)_12%,var(--bg-primary))]'
                  : 'bg-[var(--bg-primary)] hover:bg-[var(--sim-bg)]'
              }`}
            >
              <span
                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  isOpen ? 'bg-[var(--accent-blue)] text-white' : 'bg-[var(--sim-bg)] text-[var(--text-muted)]'
                }`}
              >
                {law.n}
              </span>
              <span className="flex-1 font-semibold">{law.short}</span>
              <span aria-hidden className={`text-[var(--text-muted)] transition-transform ${isOpen ? 'rotate-90' : ''}`}>
                ▸
              </span>
            </button>

            {isOpen && (
              <div className="flex flex-col gap-4 border-t border-[var(--grid-line)] bg-[color:var(--sim-bg)] p-4 md:flex-row md:items-center">
                <p className="flex-1 text-sm leading-7">{law.description}</p>
                <div className="md:w-[360px] md:flex-shrink-0">{renderLawInteractive(law.n)}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
