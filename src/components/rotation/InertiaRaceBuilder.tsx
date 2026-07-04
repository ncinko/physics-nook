import { useEffect, useState } from 'react';
import { angularAccel, compositeMomentOfInertia } from '../../lib/rotation';
import { Button, ControlBar, Slider } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 300;
const SCALE = 105; // px per meter
const ROD_HALF = 1.0; // m

const MASS = 1; // kg per ball, two balls per rod
const TORQUE = 1.5; // N·m
const TORQUE_DURATION = 2; // s

const ROD_A = { cx: 170, cy: 150, r: 0.5 }; // fixed reference rod
const ROD_B_CX = 470;
const ROD_B_CY = 150;

type Phase = 'idle' | 'torquing' | 'coasting';

interface SpinState {
  thetaA: number;
  omegaA: number;
  thetaB: number;
  omegaB: number;
  elapsed: number;
}

const REST: SpinState = { thetaA: 0, omegaA: 0, thetaB: 0, omegaB: 0, elapsed: 0 };

const inertiaFor = (r: number) =>
  compositeMomentOfInertia([
    { mass: MASS, radius: r },
    { mass: MASS, radius: r },
  ]);

export default function InertiaRaceBuilder() {
  const [radiusB, setRadiusB] = useState(1.0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [spin, setSpin] = useState<SpinState>(REST);

  const inertiaA = inertiaFor(ROD_A.r);
  const inertiaB = inertiaFor(radiusB);
  const alphaA = angularAccel(TORQUE, inertiaA);
  const alphaB = angularAccel(TORQUE, inertiaB);

  useEffect(() => {
    if (phase === 'idle') return;

    let frameId = 0;
    let lastStamp: number | null = null;
    const tick = (timestamp: number) => {
      if (lastStamp !== null) {
        const dt = Math.min(0.05, (timestamp - lastStamp) / 1000);
        setSpin((prev) => {
          const torqueOn = phase === 'torquing';
          const nextOmegaA = prev.omegaA + (torqueOn ? alphaA * dt : 0);
          const nextOmegaB = prev.omegaB + (torqueOn ? alphaB * dt : 0);
          const elapsed = prev.elapsed + dt;
          if (torqueOn && elapsed >= TORQUE_DURATION) setPhase('coasting');
          return {
            thetaA: prev.thetaA + nextOmegaA * dt,
            omegaA: nextOmegaA,
            thetaB: prev.thetaB + nextOmegaB * dt,
            omegaB: nextOmegaB,
            elapsed,
          };
        });
      }
      lastStamp = timestamp;
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [phase, alphaA, alphaB]);

  const applyTorque = () => {
    setSpin(REST);
    setPhase('torquing');
  };

  const reset = () => {
    setPhase('idle');
    setSpin(REST);
  };

  const running = phase !== 'idle';

  const rodView = (
    cx: number,
    cy: number,
    theta: number,
    massRadius: number,
    color: string,
    label: string,
  ) => {
    // SVG y points down; negate θ so positive spin looks counterclockwise.
    const dir = { x: Math.cos(-theta), y: Math.sin(-theta) };
    const end1 = { x: cx + dir.x * ROD_HALF * SCALE, y: cy + dir.y * ROD_HALF * SCALE };
    const end2 = { x: cx - dir.x * ROD_HALF * SCALE, y: cy - dir.y * ROD_HALF * SCALE };
    const mass1 = { x: cx + dir.x * massRadius * SCALE, y: cy + dir.y * massRadius * SCALE };
    const mass2 = { x: cx - dir.x * massRadius * SCALE, y: cy - dir.y * massRadius * SCALE };
    return (
      <g key={label}>
        <circle
          cx={cx}
          cy={cy}
          r={ROD_HALF * SCALE}
          fill="none"
          stroke="var(--grid-line)"
          strokeWidth="1.5"
          strokeDasharray="4 7"
        />
        <line
          x1={end1.x}
          y1={end1.y}
          x2={end2.x}
          y2={end2.y}
          stroke="var(--text-muted)"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <circle cx={mass1.x} cy={mass1.y} r="13" fill={color} stroke="var(--surface-elevated)" strokeWidth="3" />
        <circle cx={mass2.x} cy={mass2.y} r="13" fill={color} stroke="var(--surface-elevated)" strokeWidth="3" />
        <circle cx={cx} cy={cy} r="6" fill="var(--text-primary)" />
        <text
          x={cx}
          y={cy + ROD_HALF * SCALE + 28}
          textAnchor="middle"
          fill={color}
          fontSize="15"
          fontWeight="700"
        >
          {label}
        </text>
      </g>
    );
  };

  return (
    <div className="not-prose mx-auto my-8 flex max-w-[640px] flex-col gap-3 text-[var(--text-primary)]">
      <p className="m-0 text-center text-sm leading-6 text-[var(--text-muted)]">
        Both rods carry the same total mass and feel the same torque. Slide rod
        B's masses outward, apply the torque, and see which one is harder to
        spin up.
      </p>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label="Two rods with point masses seen from above; the same torque spins the rod with its masses closer to the axle much faster"
        className="block h-auto w-full"
      >
        {phase === 'torquing' && (
          <text
            x={VIEW_WIDTH / 2}
            y="26"
            textAnchor="middle"
            fill="var(--accent-red)"
            fontSize="15"
            fontWeight="700"
            className="font-mono"
          >
            τ = {TORQUE.toFixed(1)} N·m applied to both…
          </text>
        )}
        {rodView(ROD_A.cx, ROD_A.cy, spin.thetaA, ROD_A.r, 'var(--accent-blue)', 'Rod A (fixed)')}
        {rodView(ROD_B_CX, ROD_B_CY, spin.thetaB, radiusB, 'var(--accent-green)', 'Rod B (yours)')}
      </svg>

      <Readout className="font-mono tabular-nums">
        <Readout.Group label="Rod A">
          <Readout.Value label={<span><i>I</i></span>} value={inertiaA.toFixed(2)} unit="kg·m²" />
          <Readout.Value label={<span><i>α</i> = τ/I</span>} value={alphaA.toFixed(2)} unit="rad/s²" />
        </Readout.Group>
        <Readout.Group label="Rod B">
          <Readout.Value label={<span><i>I</i></span>} value={inertiaB.toFixed(2)} unit="kg·m²" />
          <Readout.Value label={<span><i>α</i> = τ/I</span>} value={alphaB.toFixed(2)} unit="rad/s²" />
        </Readout.Group>
      </Readout>

      <ControlBar>
        <Slider
          label="Rod B mass position"
          unit="m"
          min={0.1}
          max={ROD_HALF}
          step={0.05}
          value={radiusB}
          onChange={setRadiusB}
          format={(value) => value.toFixed(2)}
          disabled={running}
        />
        <Button onClick={applyTorque} disabled={phase === 'torquing'}>
          Apply torque
        </Button>
        <Button variant="secondary" onClick={reset}>
          Reset
        </Button>
      </ControlBar>
    </div>
  );
}
