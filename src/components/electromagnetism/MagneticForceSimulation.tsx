import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ControlBar, Select, Slider } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';
import { onThemeChange, themeColors } from '../shared/themeColors';
import {
  advanceParticle,
  cyclotronPeriod,
  cyclotronRadius,
  launchParticle,
  type Particle,
} from '../../lib/electromagnetism/lorentz';
import {
  pointerPosition,
  prepareCanvas,
  useCanvasSurface,
  usePrefersReducedMotion,
} from './useCanvasSurface';

// Charged particles in a uniform magnetic field perpendicular to the screen.
// Lengths are in pixels and the field, charge and mass are in arbitrary units,
// so the picture shows the shapes and ratios: r = mv/|q|B, and a period that
// does not depend on speed. All motion comes from lib/electromagnetism/lorentz.

type Direction = 'out' | 'in';

const DEFAULTS = { field: 1, direction: 'out' as Direction, speed: 120, charge: 1, mass: 1 };
const MAX_PARTICLES = 24;
const TRAIL_POINTS = 260;
const OFFSCREEN_MARGIN = 60;
const SYMBOL_SPACING = 56;

interface Tracked {
  particle: Particle;
  trail: { x: number; y: number }[];
}

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

export default function MagneticForceSimulation() {
  const { containerRef, canvasRef, size } = useCanvasSurface();
  const reducedMotion = usePrefersReducedMotion();

  const [field, setField] = useState(DEFAULTS.field);
  const [direction, setDirection] = useState<Direction>(DEFAULTS.direction);
  const [speed, setSpeed] = useState(DEFAULTS.speed);
  const [charge, setCharge] = useState(DEFAULTS.charge);
  const [mass, setMass] = useState(DEFAULTS.mass);
  const [running, setRunning] = useState(true);

  const tracked = useRef<Tracked[]>([]);
  const seeded = useRef(false);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  // Signed field out of the page: the single number the physics needs.
  const bz = field * (direction === 'out' ? 1 : -1);
  const settings = useRef({ bz, speed, charge, mass });
  settings.current = { bz, speed, charge, mass };

  const draw = useCallback(() => {
    const ctx = prepareCanvas(canvasRef.current, sizeRef.current);
    if (!ctx) return;
    const { width, height } = sizeRef.current;
    const palette = themeColors();
    const current = settings.current;

    // Field symbols: dots for out of the page, crosses for into it, fainter for a weaker field.
    const strength = Math.min(1, Math.abs(current.bz) / 2);
    if (strength > 0) {
      ctx.save();
      ctx.globalAlpha = 0.18 + 0.35 * strength;
      ctx.strokeStyle = palette.muted;
      ctx.fillStyle = palette.muted;
      ctx.lineWidth = 1.25;
      const cols = Math.floor(width / SYMBOL_SPACING);
      const rows = Math.floor(height / SYMBOL_SPACING);
      const x0 = (width - (cols - 1) * SYMBOL_SPACING) / 2;
      const y0 = (height - (rows - 1) * SYMBOL_SPACING) / 2;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = x0 + i * SYMBOL_SPACING;
          const y = y0 + j * SYMBOL_SPACING;
          if (current.bz > 0) {
            ctx.beginPath();
            ctx.arc(x, y, 2.2, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.beginPath();
            ctx.moveTo(x - 3.5, y - 3.5);
            ctx.lineTo(x + 3.5, y + 3.5);
            ctx.moveTo(x - 3.5, y + 3.5);
            ctx.lineTo(x + 3.5, y - 3.5);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }

    for (const item of tracked.current) {
      const color =
        item.particle.charge > 0 ? palette.positive : item.particle.charge < 0 ? palette.negative : palette.muted;
      const { trail } = item;
      // Fade the trail by drawing it in chunks of rising opacity, oldest first.
      const chunks = 5;
      const perChunk = Math.ceil(trail.length / chunks);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let c = 0; c < chunks; c++) {
        const from = c * perChunk;
        const to = Math.min(trail.length, from + perChunk + 1);
        if (to - from < 2) continue;
        ctx.globalAlpha = 0.12 + (0.7 * (c + 1)) / chunks;
        ctx.beginPath();
        ctx.moveTo(trail[from].x, trail[from].y);
        for (let k = from + 1; k < to; k++) ctx.lineTo(trail[k].x, trail[k].y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(item.particle.x, item.particle.y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = palette.bg;
      ctx.stroke();
    }
  }, [canvasRef]);

  const addParticle = useCallback((x: number, y: number, speedValue: number, chargeValue: number, massValue: number) => {
    const next = [
      ...tracked.current,
      {
        particle: launchParticle(x, y, speedValue, chargeValue, massValue),
        trail: [{ x, y }],
      },
    ];
    tracked.current = next.slice(-MAX_PARTICLES);
  }, []);

  // Start with one positive and one negative particle so the opposite bend is visible at once.
  useEffect(() => {
    if (seeded.current || size.width === 0) return;
    seeded.current = true;
    addParticle(size.width * 0.3, size.height * 0.34, DEFAULTS.speed, 1, DEFAULTS.mass);
    addParticle(size.width * 0.3, size.height * 0.66, DEFAULTS.speed, -1, DEFAULTS.mass);
    if (reducedMotion) setRunning(false);
    draw();
  }, [size.width, size.height, addParticle, draw, reducedMotion]);

  // Redraw whenever something changes that the animation loop is not covering.
  useEffect(() => {
    draw();
  }, [draw, size, field, direction, running]);
  useEffect(() => onThemeChange(draw), [draw]);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let last = 0;
    const tick = (time: number) => {
      const dt = last ? Math.min((time - last) / 1000, 0.032) : 0;
      last = time;
      const { width, height } = sizeRef.current;
      const kept: Tracked[] = [];
      for (const item of tracked.current) {
        const particle = advanceParticle(item.particle, settings.current.bz, dt);
        const trail = item.trail.length >= TRAIL_POINTS ? item.trail.slice(1) : item.trail.slice();
        trail.push({ x: particle.x, y: particle.y });
        const outside =
          particle.x < -OFFSCREEN_MARGIN ||
          particle.x > width + OFFSCREEN_MARGIN ||
          particle.y < -OFFSCREEN_MARGIN ||
          particle.y > height + OFFSCREEN_MARGIN;
        if (!outside) kept.push({ particle, trail });
      }
      tracked.current = kept;
      draw();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, draw]);

  const launchAt = (x: number, y: number) => {
    addParticle(x, y, speed, charge, mass);
    draw();
  };

  const launchRandom = () => {
    const { width, height } = sizeRef.current;
    addParticle(
      randomBetween(width * 0.15, width * 0.85),
      randomBetween(height * 0.15, height * 0.85),
      randomBetween(50, 200),
      Math.round(randomBetween(-3, 3) * 2) / 2 || 1,
      Math.round(randomBetween(0.5, 3) * 10) / 10,
    );
    draw();
  };

  const clear = () => {
    tracked.current = [];
    draw();
  };

  const radius = cyclotronRadius(speed, charge, mass, bz);
  const period = cyclotronPeriod(charge, mass, bz);
  const bends = Number.isFinite(radius);

  return (
    <div className="not-prose mx-auto max-w-5xl p-3 text-[var(--text-primary)]">
      <ControlBar>
        <Slider label="B" unit="arb." min={0} max={2} step={0.05} value={field} onChange={setField} format={(v) => v.toFixed(2)} />
        <Select
          label="Field"
          value={direction}
          onChange={(v) => setDirection(v as Direction)}
          options={[
            { value: 'out', label: 'Out of page (•)' },
            { value: 'in', label: 'Into page (×)' },
          ]}
        />
      </ControlBar>
      <div
        ref={containerRef}
        className="relative my-2 w-full overflow-hidden rounded-[var(--radius-control)] border border-[var(--grid-line)] bg-[var(--surface-plot)]"
        style={{ aspectRatio: '5 / 3', minHeight: 220 }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Charged particles curving through a uniform magnetic field. Click to launch a particle."
          className="absolute inset-0 h-full w-full cursor-crosshair"
          style={{ touchAction: 'pan-y' }}
          onClick={(event) => {
            const { x, y } = pointerPosition(event, event.currentTarget);
            launchAt(x, y);
          }}
        />
      </div>
      <ControlBar className="mb-2">
        <Slider label="Launch speed" min={40} max={220} step={5} value={speed} onChange={setSpeed} />
        <Slider label="Charge q" min={-3} max={3} step={0.5} value={charge} onChange={setCharge} format={(v) => v.toFixed(1)} />
        <Slider label="Mass m" min={0.5} max={3} step={0.1} value={mass} onChange={setMass} format={(v) => v.toFixed(1)} />
      </ControlBar>
      <ControlBar className="mb-2">
        <Button variant="secondary" onClick={() => setRunning((value) => !value)}>
          {running ? 'Pause' : 'Play'}
        </Button>
        <Button variant="secondary" onClick={launchRandom}>Launch random</Button>
        <Button variant="secondary" onClick={clear}>Clear</Button>
      </ControlBar>
      <Readout variant="inline" className="justify-center">
        <Readout.Value label="Next particle: r = mv/|q|B" value={bends ? radius.toFixed(0) : '∞'} unit={bends ? 'px' : '(straight line)'} />
        {bends ? <Readout.Value label="T" value={period.toFixed(1)} unit="s" /> : null}
      </Readout>
      <p className="type-supporting my-2 text-center">
        <span className="text-[var(--accent-red)]">Red: positive charge.</span>{' '}
        <span className="text-[var(--accent-blue)]">Blue: negative charge.</span> Click or tap the plot to launch a
        particle there; every particle starts moving to the right.
      </p>
    </div>
  );
}
