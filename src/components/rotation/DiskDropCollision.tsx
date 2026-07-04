import { useEffect, useRef, useState } from 'react';
import { angularCollision, diskMomentOfInertia } from '../../lib/rotation';
import { Button, ControlBar, Slider } from '../shared/InlineControls';

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 310;
const CENTER_X = VIEW_WIDTH / 2;

const DISK_RX = 120; // px, ellipse half-width
const DISK_RY = 32; // px, ellipse half-height (perspective squash)
const BOTTOM_CY = 232;
const TOP_READY_CY = 84;
const TOP_LANDED_CY = 196;
const DROP_DURATION = 0.35; // s

const DISK_RADIUS = 0.3; // m, both disks
const BOTTOM_MASS = 2; // kg
const TOP_MASS_MIN = 0.5;
const TOP_MASS_MAX = 4;

type Phase = 'ready' | 'dropping' | 'coupled';

export default function DiskDropCollision() {
  const [omega1, setOmega1] = useState(8);
  const [topMass, setTopMass] = useState(2);
  const [phase, setPhase] = useState<Phase>('ready');
  const [phiBottom, setPhiBottom] = useState(0);
  const [phiTop, setPhiTop] = useState(0.9);
  const [dropProgress, setDropProgress] = useState(0);
  const lastFrameRef = useRef<number | null>(null);

  const inertiaBottom = diskMomentOfInertia(BOTTOM_MASS, DISK_RADIUS);
  const inertiaTop = diskMomentOfInertia(topMass, DISK_RADIUS);
  const collision = angularCollision(inertiaBottom, omega1, inertiaTop, 0);

  useEffect(() => {
    let frameId = 0;
    const tick = (timestamp: number) => {
      if (lastFrameRef.current !== null) {
        const dt = Math.min(0.05, (timestamp - lastFrameRef.current) / 1000);
        const spinning = phase === 'coupled' ? collision.omegaFinal : omega1;
        setPhiBottom((current) => (current + spinning * dt) % (Math.PI * 2));
        if (phase === 'coupled') {
          setPhiTop((current) => (current + collision.omegaFinal * dt) % (Math.PI * 2));
        }
        if (phase === 'dropping') {
          setDropProgress((current) => {
            const next = current + dt / DROP_DURATION;
            if (next >= 1) {
              setPhase('coupled');
              return 1;
            }
            return next;
          });
        }
      }
      lastFrameRef.current = timestamp;
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frameId);
      lastFrameRef.current = null;
    };
  }, [phase, omega1, collision.omegaFinal]);

  const reset = () => {
    setPhase('ready');
    setDropProgress(0);
    setPhiTop(0.9);
  };

  // Ease the fall quadratically so it reads as gravity.
  const eased = dropProgress * dropProgress;
  const topCy =
    phase === 'ready' ? TOP_READY_CY : TOP_READY_CY + (TOP_LANDED_CY - TOP_READY_CY) * (phase === 'coupled' ? 1 : eased);

  const diskView = (cy: number, phi: number, color: string, label: string) => {
    const marker = {
      x: CENTER_X + DISK_RX * Math.cos(phi),
      y: cy - DISK_RY * Math.sin(phi),
    };
    return (
      <g>
        <ellipse
          cx={CENTER_X}
          cy={cy}
          rx={DISK_RX}
          ry={DISK_RY}
          fill="var(--sim-bg)"
          stroke={color}
          strokeWidth="3.5"
        />
        <line
          x1={CENTER_X}
          y1={cy}
          x2={marker.x}
          y2={marker.y}
          stroke={color}
          strokeWidth="2.5"
          strokeOpacity="0.6"
        />
        <circle cx={marker.x} cy={marker.y} r="7" fill={color} />
        <text
          x={CENTER_X - DISK_RX - 14}
          y={cy + 5}
          textAnchor="end"
          fill={color}
          fontSize="14"
          fontWeight="700"
        >
          {label}
        </text>
      </g>
    );
  };

  const cell = 'px-3 py-1 text-right';

  return (
    <div className="not-prose mx-auto my-8 flex max-w-[640px] flex-col gap-3 text-[var(--text-primary)]">
      <p className="m-0 text-center text-sm leading-6 text-[var(--text-muted)]">
        Drop a stationary disk onto a spinning one and they lock together — the
        rotational version of a perfectly inelastic collision. Watch what the
        ledger says survives the landing.
      </p>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label="A stationary disk dropping onto a spinning disk; after landing both rotate together at a slower rate"
        className="block h-auto w-full"
      >
        {/* Axle */}
        <line
          x1={CENTER_X}
          y1={30}
          x2={CENTER_X}
          y2={BOTTOM_CY + 40}
          stroke="var(--grid-line)"
          strokeWidth="3"
        />
        {diskView(BOTTOM_CY, phiBottom, 'var(--accent-blue)', 'spinning')}
        {diskView(topCy, phiTop, 'var(--accent-red)', phase === 'coupled' ? 'locked on' : 'at rest')}
      </svg>

      <table className="mx-auto border-collapse text-center font-mono text-sm tabular-nums">
        <thead>
          <tr className="text-[var(--text-muted)]">
            <th className="px-3 py-1 text-left font-semibold"> </th>
            <th className={`${cell} font-semibold`}>before</th>
            <th className={`${cell} font-semibold`}>after</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-theme-grid">
            <td className="px-3 py-1 text-left text-[var(--text-muted)]">L (kg·m²/s)</td>
            <td className={cell}>{collision.angularMomentum.toFixed(2)}</td>
            <td className={`${cell} ${phase === 'coupled' ? 'font-semibold text-[var(--accent-green)]' : 'text-[var(--text-muted)]'}`}>
              {phase === 'coupled' ? collision.angularMomentum.toFixed(2) : '—'}
            </td>
          </tr>
          <tr className="border-t border-theme-grid">
            <td className="px-3 py-1 text-left text-[var(--text-muted)]">KE (J)</td>
            <td className={cell}>{collision.keInitial.toFixed(2)}</td>
            <td className={`${cell} ${phase === 'coupled' ? 'font-semibold text-[var(--accent-red)]' : 'text-[var(--text-muted)]'}`}>
              {phase === 'coupled' ? collision.keFinal.toFixed(2) : '—'}
            </td>
          </tr>
          <tr className="border-t border-theme-grid">
            <td className="px-3 py-1 text-left text-[var(--text-muted)]">ω (rad/s)</td>
            <td className={cell}>{omega1.toFixed(2)}</td>
            <td className={`${cell} ${phase === 'coupled' ? 'font-semibold' : 'text-[var(--text-muted)]'}`}>
              {phase === 'coupled' ? collision.omegaFinal.toFixed(2) : '—'}
            </td>
          </tr>
        </tbody>
      </table>

      <ControlBar>
        <Slider
          label={<span>Spin <i>ω</i>₁</span>}
          unit="rad/s"
          min={2}
          max={10}
          step={0.5}
          value={omega1}
          onChange={setOmega1}
          format={(value) => value.toFixed(1)}
          disabled={phase !== 'ready'}
        />
        <Slider
          label="Dropped disk mass"
          unit="kg"
          min={TOP_MASS_MIN}
          max={TOP_MASS_MAX}
          step={0.25}
          value={topMass}
          onChange={setTopMass}
          format={(value) => value.toFixed(2)}
          disabled={phase !== 'ready'}
        />
        <Button onClick={() => setPhase('dropping')} disabled={phase !== 'ready'}>
          Drop disk
        </Button>
        <Button variant="secondary" onClick={reset}>
          Reset
        </Button>
      </ControlBar>
    </div>
  );
}
