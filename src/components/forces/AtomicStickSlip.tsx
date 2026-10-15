import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, ControlBar, Slider } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';
import { ForceArrow, FORCE_COLORS } from './ForceArrow';
import { advanceStickSlip, createStickSlip, type StickSlipParams, type StickSlipState } from '../../lib/forces';

// The block's bottom atoms bonded to the floor's top atoms through atomic
// springs. The floor is dragged out from under the block: each bond stretches
// until it lets go, and a new one can only form once the next floor atom slides
// under the block atom. The block feels the sum of the stretched bonds.

const VIEW = { width: 760, height: 390 };
const LATTICE = 8;
const BLOCK_SPACING = 4 * LATTICE;
const CENTER_X = 380;
const BLOCK_ATOM_Y = 128;
const FLOOR_ATOM_Y = 190;
const ATOM_RADIUS = 6;
const PLOT = { x: 60, y: 268, width: 640, height: 92 };
const WINDOW_SECONDS = 12;
const LOAD_PER_BOND = 12;
const SEED = 5;

interface Sample {
  t: number;
  x: number;
  force: number;
}

const format = (value: number, digits = 1) => value.toFixed(digits);

/** A zigzag spring between two points, as in the other force demos. */
const springPath = (from: { x: number; y: number }, to: { x: number; y: number }, coils = 5, amplitude = 4) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const pad = Math.min(8, length * 0.2);
  const points = [`M ${from.x} ${from.y}`];
  const start = { x: from.x + (dx / length) * pad, y: from.y + (dy / length) * pad };
  points.push(`L ${start.x} ${start.y}`);
  const body = length - 2 * pad;
  for (let index = 1; index <= coils * 2; index += 1) {
    const along = (index / (coils * 2 + 1)) * body;
    const side = index % 2 === 0 ? -amplitude : amplitude;
    points.push(`L ${start.x + (dx / length) * along + nx * side} ${start.y + (dy / length) * along + ny * side}`);
  }
  points.push(`L ${to.x - (dx / length) * pad} ${to.y - (dy / length) * pad} L ${to.x} ${to.y}`);
  return points.join(' ');
};

export default function AtomicStickSlip() {
  const [bondCount, setBondCount] = useState(12);
  const [strength, setStrength] = useState(10);
  const [speed, setSpeed] = useState(30);
  const [runId, setRunId] = useState(0);
  const [, setFrame] = useState(0);

  const params = useMemo<StickSlipParams>(() => ({ breakStretch: strength, latticeSpacing: LATTICE }), [strength]);
  const stateRef = useRef<StickSlipState | null>(null);
  if (stateRef.current === null) {
    stateRef.current = createStickSlip(SEED, bondCount, params);
  }
  const samplesRef = useRef<Sample[]>([]);
  const peakRef = useRef(0);
  const forceRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // Any change to the interface starts a fresh pull from rest.
  useEffect(() => {
    stateRef.current = createStickSlip(SEED, bondCount, params);
    samplesRef.current = [];
    peakRef.current = 0;
    forceRef.current = 0;
    lastTimeRef.current = null;
    setFrame((value) => value + 1);
  }, [bondCount, params, runId]);

  useEffect(() => {
    let frame = 0;

    const tick = (time: number) => {
      const last = lastTimeRef.current ?? time;
      const dt = Math.min((time - last) / 1000, 0.033);
      lastTimeRef.current = time;

      const state = stateRef.current;
      if (!state) {
        frame = window.requestAnimationFrame(tick);
        return;
      }
      const force = advanceStickSlip(state, speedRef.current * dt, dt, paramsRef.current);
      forceRef.current = force;
      peakRef.current = Math.max(peakRef.current, force);
      const samples = samplesRef.current;
      samples.push({ t: state.time, x: state.x, force });
      while (samples.length > 0 && samples[0].t < state.time - WINDOW_SECONDS) {
        samples.shift();
      }

      setFrame((value) => value + 1);
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const state = stateRef.current;
  const samples = samplesRef.current;
  const load = bondCount * LOAD_PER_BOND;
  const firstX = CENTER_X - ((bondCount - 1) * BLOCK_SPACING) / 2;
  const blockLeft = firstX - 34;
  const blockRight = firstX + (bondCount - 1) * BLOCK_SPACING + 34;
  const yMax = 0.75 * bondCount * strength;
  const forceScale = 130 / yMax;

  // Kinetic friction: average once the block has slid well past the first stick.
  const sliding = samples.filter((sample) => sample.x > 2.5 * strength && sample.t > state.time - 6);
  const kineticMean = sliding.length > 30 ? sliding.reduce((sum, sample) => sum + sample.force, 0) / sliding.length : null;
  const peak = peakRef.current;

  // Floor atoms scroll left by the distance pulled; they are aligned with the
  // block atoms so a bond that forms stays on one floor atom.
  const floorAtoms: number[] = [];
  const firstIndex = Math.floor((60 - firstX + state.x) / LATTICE);
  for (let j = firstIndex; firstX + j * LATTICE - state.x <= VIEW.width - 60; j += 1) {
    const x = firstX + j * LATTICE - state.x;
    if (x >= 60) floorAtoms.push(x);
  }

  const timeStart = Math.max(0, state.time - WINDOW_SECONDS);
  const plotX = (t: number) => PLOT.x + ((t - timeStart) / WINDOW_SECONDS) * PLOT.width;
  const plotY = (f: number) => PLOT.y + PLOT.height - (Math.min(f, yMax) / yMax) * PLOT.height;
  const trace = samples.map((sample) => `${plotX(sample.t).toFixed(1)},${plotY(sample.force).toFixed(1)}`).join(' ');

  return (
    <div className="not-prose my-8 grid gap-4">
      <svg
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        role="img"
        aria-label={`${bondCount} atomic bonds between a block and a floor being dragged past it, with the total bond force plotted over time`}
        className="block h-auto w-full select-none"
      >
        <rect x={blockLeft} y="64" width={blockRight - blockLeft} height={BLOCK_ATOM_Y - 64 - ATOM_RADIUS + 2} rx="6" fill="color-mix(in srgb, var(--grid-line) 26%, transparent)" stroke="var(--grid-line)" strokeWidth="2" />
        <rect x="60" y={FLOOR_ATOM_Y + ATOM_RADIUS - 2} width="640" height="34" rx="6" fill="color-mix(in srgb, var(--grid-line) 26%, transparent)" stroke="var(--grid-line)" strokeWidth="2" />

        {floorAtoms.map((x) => (
          <circle key={x.toFixed(2)} cx={x} cy={FLOOR_ATOM_Y} r={ATOM_RADIUS - 1} fill="var(--text-muted)" opacity="0.55" />
        ))}

        {state.bonds.map((bond, index) => {
          const blockX = firstX + index * BLOCK_SPACING;
          const stretch = state.x - bond.site;
          const floorX = blockX - stretch;
          return (
            <g key={index}>
              {bond.attached && (
                <>
                  <path
                    d={springPath({ x: blockX, y: BLOCK_ATOM_Y + ATOM_RADIUS }, { x: floorX, y: FLOOR_ATOM_Y - ATOM_RADIUS })}
                    fill="none"
                    stroke={FORCE_COLORS.friction}
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                    opacity={0.3 + 0.7 * Math.min(1, stretch / strength)}
                  />
                  <circle cx={floorX} cy={FLOOR_ATOM_Y} r={ATOM_RADIUS} fill={FORCE_COLORS.friction} />
                </>
              )}
              <circle cx={blockX} cy={BLOCK_ATOM_Y} r={ATOM_RADIUS} fill={bond.attached ? FORCE_COLORS.friction : 'var(--text-primary)'} opacity={bond.attached ? 1 : 0.75} />
            </g>
          );
        })}

        <ForceArrow
          origin={{ x: blockLeft, y: 86 }}
          vector={{ x: -forceRef.current, y: 0 }}
          scale={forceScale}
          maxLength={150}
          color={FORCE_COLORS.friction}
          label="friction"
          labelBounds={VIEW}
        />

        {/* Total bond force against time. */}
        <line x1={PLOT.x} y1={PLOT.y + PLOT.height} x2={PLOT.x + PLOT.width} y2={PLOT.y + PLOT.height} stroke="var(--text-muted)" strokeWidth="1.5" />
        <line x1={PLOT.x} y1={PLOT.y} x2={PLOT.x} y2={PLOT.y + PLOT.height} stroke="var(--text-muted)" strokeWidth="1.5" />
        <text x={PLOT.x + 6} y={PLOT.y + 12} fill="var(--text-muted)" fontSize="12" fontWeight="600">
          total friction force
        </text>
        <text x={PLOT.x + PLOT.width} y={PLOT.y + PLOT.height + 16} textAnchor="end" fill="var(--text-muted)" fontSize="12" fontWeight="600">
          time
        </text>
        {peak > 0 && (
          <>
            <line x1={PLOT.x} y1={plotY(peak)} x2={PLOT.x + PLOT.width} y2={plotY(peak)} stroke={FORCE_COLORS.friction} strokeWidth="1.5" strokeDasharray="5 5" opacity="0.8" />
            <text x={PLOT.x + PLOT.width - 4} y={plotY(peak) - 5} textAnchor="end" fill={FORCE_COLORS.friction} fontSize="12" fontWeight="700">
              static peak
            </text>
          </>
        )}
        {kineticMean !== null && (
          <>
            <line x1={PLOT.x} y1={plotY(kineticMean)} x2={PLOT.x + PLOT.width} y2={plotY(kineticMean)} stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="5 5" />
            <text x={PLOT.x + PLOT.width - 4} y={plotY(kineticMean) + 15} textAnchor="end" fill="var(--text-muted)" fontSize="12" fontWeight="700">
              sliding average
            </text>
          </>
        )}
        <polyline points={trace} fill="none" stroke={FORCE_COLORS.applied} strokeWidth="2" strokeLinejoin="round" />
      </svg>

      <ControlBar>
        <Slider label="bonds in contact" min={4} max={20} step={1} value={bondCount} onChange={setBondCount} />
        <Slider label="bond strength" min={6} max={16} step={1} value={strength} onChange={setStrength} />
        <Slider label="pull speed" min={10} max={60} step={5} value={speed} onChange={setSpeed} />
        <Button variant="secondary" onClick={() => setRunId((value) => value + 1)}>
          Pull again
        </Button>
      </ControlBar>

      <Readout variant="inline" className="justify-center">
        <Readout.Value label="load N" value={format(load, 0)} />
        <Readout.Value label="static peak" value={format(peak, 0)} />
        <Readout.Value label="sliding average" value={kineticMean === null ? '–' : format(kineticMean, 0)} />
        <Readout.Value label="μs" value={format(peak / load, 2)} />
        <Readout.Value label="μk" value={kineticMean === null ? '–' : format(kineticMean / load, 2)} />
      </Readout>
    </div>
  );
}
