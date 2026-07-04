import { useEffect, useRef, useState } from 'react';
import {
  angularMomentum,
  compositeMomentOfInertia,
  conservedOmega,
  rotationalKineticEnergy,
} from '../../lib/rotation';
import { Button, ControlBar, Slider } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 300;
const CENTER_X = VIEW_WIDTH / 2;
const CENTER_Y = 148;
const SCALE = 140; // px per meter

const CORE_INERTIA = 1.0; // kg·m², torso + legs about the spin axis
const HAND_MASS = 4; // kg, each arm lumped at the hand
const R_MIN = 0.2;
const R_MAX = 0.9;
const R_START = 0.7;
const OMEGA_START = 2; // rad/s when the arms are at R_START

const inertiaFor = (armRadius: number) =>
  CORE_INERTIA +
  compositeMomentOfInertia([
    { mass: HAND_MASS, radius: armRadius },
    { mass: HAND_MASS, radius: armRadius },
  ]);

// Angular momentum is locked in when the spin starts and never changes —
// that is the whole point.
const INERTIA_START = inertiaFor(R_START);
const L = angularMomentum(INERTIA_START, OMEGA_START);
const KE_START = rotationalKineticEnergy(INERTIA_START, OMEGA_START);

export default function SkaterSpin() {
  const [armRadius, setArmRadius] = useState(R_START);
  const [phi, setPhi] = useState(0);
  const [spinning, setSpinning] = useState(true);
  const lastFrameRef = useRef<number | null>(null);

  const inertia = inertiaFor(armRadius);
  const omega = conservedOmega(INERTIA_START, OMEGA_START, inertia);
  const kineticEnergy = rotationalKineticEnergy(inertia, omega);

  useEffect(() => {
    if (!spinning) {
      lastFrameRef.current = null;
      return;
    }

    let frameId = 0;
    const tick = (timestamp: number) => {
      if (lastFrameRef.current !== null) {
        const elapsed = Math.min(0.05, (timestamp - lastFrameRef.current) / 1000);
        setPhi((current) => (current + omega * elapsed) % (Math.PI * 2));
      }
      lastFrameRef.current = timestamp;
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [spinning, omega]);

  // SVG y points down; negate φ so positive spin looks counterclockwise.
  const dir = { x: Math.cos(-phi), y: Math.sin(-phi) };
  const hand1 = {
    x: CENTER_X + dir.x * armRadius * SCALE,
    y: CENTER_Y + dir.y * armRadius * SCALE,
  };
  const hand2 = {
    x: CENTER_X - dir.x * armRadius * SCALE,
    y: CENTER_Y - dir.y * armRadius * SCALE,
  };
  const nose = {
    x: CENTER_X + -dir.y * 26,
    y: CENTER_Y + dir.x * 26,
  };

  return (
    <div className="not-prose mx-auto my-8 flex max-w-[640px] flex-col gap-3 text-[var(--text-primary)]">
      <p className="m-0 text-center text-sm leading-6 text-[var(--text-muted)]">
        A skater seen from above. Pull the arms in and the spin speeds up on its
        own — no push needed. Angular momentum L = Iω cannot change without an
        external torque, so shrinking I forces ω up.
      </p>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label="Top-down view of a spinning figure skater whose rotation speeds up as the arms are pulled inward"
        className="block h-auto w-full"
      >
        {/* Reach circle */}
        <circle
          cx={CENTER_X}
          cy={CENTER_Y}
          r={armRadius * SCALE}
          fill="none"
          stroke="var(--grid-line)"
          strokeWidth="1.5"
          strokeDasharray="4 7"
        />

        {/* Arms */}
        <line
          x1={hand1.x}
          y1={hand1.y}
          x2={hand2.x}
          y2={hand2.y}
          stroke="var(--text-muted)"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <circle cx={hand1.x} cy={hand1.y} r="11" fill="var(--accent-blue)" stroke="var(--surface-elevated)" strokeWidth="3" />
        <circle cx={hand2.x} cy={hand2.y} r="11" fill="var(--accent-blue)" stroke="var(--surface-elevated)" strokeWidth="3" />

        {/* Torso and facing marker */}
        <circle
          cx={CENTER_X}
          cy={CENTER_Y}
          r="22"
          fill="var(--accent-purple)"
          stroke="var(--surface-elevated)"
          strokeWidth="3"
        />
        <circle cx={nose.x} cy={nose.y} r="6" fill="var(--accent-purple)" />
      </svg>

      <Readout variant="inline" className="justify-center font-mono tabular-nums">
        <Readout.Value label="L = Iω" value={L.toFixed(2)} unit="kg·m²/s" />
        <Readout.Value label="I" value={inertia.toFixed(2)} unit="kg·m²" />
        <Readout.Value label="ω" value={omega.toFixed(2)} unit="rad/s" />
        <Readout.Value label={<span>K<sub>rot</sub></span>} value={kineticEnergy.toFixed(1)} unit="J" />
      </Readout>

      {kineticEnergy > KE_START * 1.02 && (
        <p className="m-0 text-center text-sm font-medium text-[var(--accent-green)]">
          L stayed fixed, but the kinetic energy went up — the extra energy is
          the work your arm muscles did pulling the masses inward.
        </p>
      )}

      <ControlBar>
        <Slider
          label="Arm extension"
          unit="m"
          min={R_MIN}
          max={R_MAX}
          step={0.01}
          value={armRadius}
          onChange={setArmRadius}
          format={(value) => value.toFixed(2)}
        />
        <Button onClick={() => setSpinning((s) => !s)}>{spinning ? 'Pause' : 'Spin'}</Button>
        <Button
          variant="secondary"
          onClick={() => {
            setArmRadius(R_START);
            setPhi(0);
          }}
        >
          Reset
        </Button>
      </ControlBar>
    </div>
  );
}
