import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ControlBar, Slider } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';
import { G, potentialEnergy, stepFall } from '../../lib/energy/drop';

// Inline "pick up and drop" explorer. Drag the ball to a height (storing
// gravitational potential energy), let go, and watch that energy convert into
// kinetic energy as it falls — read off a stacked energy bar chart whose total
// height never changes. Physics lives in lib/energy/drop; this island owns
// rendering, dragging, and the animation loop.

const H_MAX = 5; // m
const MASS_MIN = 1;
const MASS_MAX = 5;
const E_MAX = MASS_MAX * G * H_MAX; // joules — fixed scale for the bar chart

// Scene geometry (SVG user units).
const SCENE_W = 240;
const SCENE_H = 340;
const TOP_Y = 26;
const GROUND_Y = 300;
const BALL_X = 150;
const AXIS_X = 60;
const PX_PER_M = (GROUND_Y - TOP_Y) / H_MAX;

const heightToY = (h) => GROUND_Y - h * PX_PER_M;
const ballRadius = (mass) => 8 + 2.2 * mass;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const round = (x) => Math.round(x);

export default function EnergyDropExplorer() {
  const [mass, setMass] = useState(2);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [sim, setSim] = useState({
    height: 0,
    velocity: 0,
    phase: 'held', // 'held' | 'falling'
    releaseHeight: 0,
  });

  const sceneRef = useRef(null);
  const draggingRef = useRef(false);
  const rafRef = useRef(0);

  // Convert a pointer event to a clamped height using the scene's screen box.
  const pointerToHeight = (clientY) => {
    const svg = sceneRef.current;
    if (!svg) return sim.height;
    const rect = svg.getBoundingClientRect();
    const yUser = ((clientY - rect.top) / rect.height) * SCENE_H;
    // The cursor tracks the ball's centre, which sits one radius above its
    // contact height — subtract the radius so the height maps consistently.
    const radiusInM = ballRadius(mass) / PX_PER_M;
    return clamp((GROUND_Y - yUser) / PX_PER_M - radiusInM, 0, H_MAX);
  };

  // Animation loop: only integrates while falling.
  useEffect(() => {
    let last = performance.now();
    const loop = (t) => {
      const dt = Math.min(0.04, (t - last) / 1000);
      last = t;
      setSim((prev) => {
        if (prev.phase !== 'falling') return prev;
        const next = stepFall(
          { height: prev.height, velocity: prev.velocity },
          dt,
          { releaseHeight: prev.releaseHeight },
        );
        return { ...prev, height: next.height, velocity: next.velocity };
      });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Pointer drag wiring (window-level so the drag survives leaving the ball).
  useEffect(() => {
    const onMove = (e) => {
      if (!draggingRef.current) return;
      const h = pointerToHeight(e.clientY);
      setSim((prev) => ({ ...prev, height: h, releaseHeight: h, velocity: 0 }));
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setSim((prev) => ({ ...prev, phase: 'falling', releaseHeight: prev.height, velocity: 0 }));
    };
    const onTouchMove = (e) => {
      if (!draggingRef.current || !e.touches[0]) return;
      e.preventDefault();
      onMove(e.touches[0]);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grab = (e) => {
    draggingRef.current = true;
    setHasInteracted(true);
    const h = pointerToHeight(e.clientY ?? e.touches?.[0]?.clientY ?? 0);
    setSim((prev) => ({ ...prev, phase: 'held', height: h, releaseHeight: h, velocity: 0 }));
  };

  // Energies. Total is held fixed at the release-height value so the chart shows
  // exact conservation; kinetic energy is whatever the object is no longer
  // storing as height.
  const { totalE, pe, ke, speed } = useMemo(() => {
    const total = potentialEnergy(mass, sim.releaseHeight);
    const potential = potentialEnergy(mass, sim.height);
    const kinetic = Math.max(0, total - potential);
    return {
      totalE: total,
      pe: potential,
      ke: kinetic,
      speed: Math.sqrt((2 * kinetic) / mass),
    };
  }, [mass, sim.height, sim.releaseHeight]);

  const r = ballRadius(mass);
  // `height` is the ball's contact point above the ground, so its centre sits one
  // radius higher. Drawing it this way keeps the physics (which bounces at
  // height 0) and the rendering in lockstep — no brief "stick" as it lands.
  const ballY = heightToY(sim.height) - r;

  return (
    <div style={{ width: '100%', maxWidth: 640, margin: '0 auto', color: 'var(--text-primary)' }}>
      <ControlBar className="mb-3">
        <Slider
          label="Mass"
          unit="kg"
          min={MASS_MIN}
          max={MASS_MAX}
          step={0.5}
          value={mass}
          onChange={setMass}
          format={(v) => v.toFixed(1)}
        />
      </ControlBar>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'stretch', justifyContent: 'center' }}>
        {/* Drop scene */}
        <svg
          ref={sceneRef}
          viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
          role="img"
          aria-label="A ball you can drag to a height and drop"
          style={{
            // Transparent scene: it sits in the reading flow rather than being
            // boxed in a panel. The bar chart keeps its faint frame because that
            // frame conveys the full energy scale.
            flex: '1 1 260px',
            maxWidth: 360,
            height: 'auto',
            touchAction: 'none',
          }}
        >
          {/* Height axis with metre ticks */}
          <line x1={AXIS_X} y1={TOP_Y} x2={AXIS_X} y2={GROUND_Y} style={{ stroke: 'var(--grid-line)' }} strokeWidth="1.5" />
          {Array.from({ length: H_MAX + 1 }, (_, i) => i).map((m) => (
            <g key={m}>
              <line
                x1={AXIS_X - 5}
                y1={heightToY(m)}
                x2={SCENE_W - 16}
                y2={heightToY(m)}
                style={{ stroke: 'var(--grid-line)' }}
                strokeWidth="1"
                strokeDasharray="2 5"
              />
              <text
                x={AXIS_X - 10}
                y={heightToY(m) + 4}
                textAnchor="end"
                style={{ fill: 'var(--text-muted)', fontSize: 11 }}
              >
                {m} m
              </text>
            </g>
          ))}

          {/* Release-height marker while falling */}
          {sim.phase === 'falling' && sim.releaseHeight > 0.05 && (
            <line
              x1={AXIS_X}
              y1={heightToY(sim.releaseHeight)}
              x2={SCENE_W - 16}
              y2={heightToY(sim.releaseHeight)}
              style={{ stroke: 'var(--accent-purple)' }}
              strokeWidth="1.25"
              strokeDasharray="4 4"
              opacity="0.7"
            />
          )}

          {/* Ground */}
          <rect x={AXIS_X} y={GROUND_Y} width={SCENE_W - AXIS_X - 12} height="8" style={{ fill: 'var(--grid-line)' }} />

          {/* Drop line from the ball's base to the ground (its height) */}
          <line x1={BALL_X} y1={ballY + r} x2={BALL_X} y2={GROUND_Y} style={{ stroke: 'var(--text-muted)' }} strokeWidth="1" strokeDasharray="2 4" opacity="0.5" />

          {/* Idle pulse to invite interaction, until the first grab */}
          {!hasInteracted && (
            <circle
              cx={BALL_X}
              cy={ballY}
              r={r}
              fill="none"
              strokeWidth="2"
              style={{ stroke: 'var(--accent-blue)', pointerEvents: 'none' }}
            >
              <animate attributeName="r" values={`${r};${r + 14}`} dur="1.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.55;0" dur="1.6s" repeatCount="indefinite" />
            </circle>
          )}

          {/* The draggable ball (with a larger invisible hit area) */}
          <g
            onPointerDown={grab}
            onTouchStart={grab}
            style={{ cursor: sim.phase === 'held' ? 'grab' : 'pointer' }}
          >
            <circle cx={BALL_X} cy={ballY} r={r + 16} fill="transparent" />
            <circle
              cx={BALL_X}
              cy={ballY}
              r={r}
              data-testid="drop-ball"
              style={{ fill: 'var(--accent-blue)' }}
              stroke="var(--surface-elevated)"
              strokeWidth="2"
            />
          </g>
        </svg>

        {/* Stacked energy bar chart */}
        <EnergyBarChart pe={pe} ke={ke} totalE={totalE} />
      </div>

      <Readout variant="inline" className="mt-3 justify-center">
        <Readout.Value label="height" value={sim.height.toFixed(2)} unit="m" />
        <Readout.Value label="speed" value={speed.toFixed(2)} unit="m/s" />
        <Readout.Value label="total energy" value={round(totalE)} unit="J" />
      </Readout>
    </div>
  );
}

// A single stacked bar: gravitational PE on the bottom, kinetic energy on top,
// with a dashed line marking the (conserved) total. The full bar height is a
// fixed energy scale so heavier / higher drops make visibly taller bars.
function EnergyBarChart({ pe, ke, totalE }) {
  const W = 168;
  const H = 340;
  const top = TOP_Y;
  const bottom = GROUND_Y;
  const fullH = bottom - top;
  const colX = 52;
  const colW = 46;

  const toH = (e) => (e / E_MAX) * fullH;
  const peH = toH(pe);
  const keH = toH(ke);
  const peY = bottom - peH;
  const keY = peY - keH;
  const totalY = bottom - toH(totalE);

  const swatch = (color, label, value) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
      <span style={{ width: 11, height: 11, borderRadius: 2, background: color, flex: '0 0 auto' }} />
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{round(value)} J</span>
    </div>
  );

  return (
    <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Stacked energy bar chart" style={{ width: 168, maxWidth: '100%', height: 'auto' }}>
        {/* Outline of the full energy scale */}
        <rect x={colX} y={top} width={colW} height={fullH} style={{ fill: 'color-mix(in srgb, var(--text-primary) 7%, transparent)', stroke: 'var(--grid-line)' }} strokeWidth="1" rx="4" />

        {/* PE (bottom) */}
        <rect x={colX} y={peY} width={colW} height={Math.max(0, peH)} style={{ fill: 'var(--accent-purple)' }} rx="2" data-testid="pe-bar" data-height={peH.toFixed(1)} />
        {/* KE (stacked on top) */}
        <rect x={colX} y={keY} width={colW} height={Math.max(0, keH)} style={{ fill: 'var(--accent-green)' }} rx="2" data-testid="ke-bar" data-height={keH.toFixed(1)} />

        {/* Conserved-total line */}
        <line x1={colX - 8} y1={totalY} x2={colX + colW + 8} y2={totalY} style={{ stroke: 'var(--text-primary)' }} strokeWidth="1.5" strokeDasharray="5 4" />
        <text x={colX + colW + 12} y={totalY + 4} style={{ fill: 'var(--text-primary)', fontSize: 11, fontWeight: 600 }}>total</text>

        {/* Scale ticks */}
        <text x={colX - 8} y={top + 4} textAnchor="end" style={{ fill: 'var(--text-muted)', fontSize: 10 }}>{round(E_MAX)} J</text>
        <text x={colX - 8} y={bottom + 2} textAnchor="end" style={{ fill: 'var(--text-muted)', fontSize: 10 }}>0</text>
      </svg>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {swatch('var(--accent-green)', 'Kinetic', ke)}
        {swatch('var(--accent-purple)', 'Potential', pe)}
      </div>
    </div>
  );
}
