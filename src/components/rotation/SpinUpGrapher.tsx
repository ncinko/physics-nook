import { useEffect, useRef, useState } from 'react';
import { angularKinematics } from '../../lib/rotation';
import { Button, ControlBar, Slider } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 250;
const T_MAX = 8; // s
const SAMPLES = 64;

const ALPHA_MIN = -3;
const ALPHA_MAX = 3;
const OMEGA0_MIN = 0;
const OMEGA0_MAX = 8;

const WHEEL_CX = 46;
const WHEEL_CY = 118;
const WHEEL_R = 34;

interface Panel {
  x0: number;
  x1: number;
  y0: number; // top
  y1: number; // bottom
}

const THETA_PANEL: Panel = { x0: 116, x1: 356, y0: 24, y1: 210 };
const OMEGA_PANEL: Panel = { x0: 396, x1: 636, y0: 24, y1: 210 };

// Map a series of (t, value) samples into an SVG polyline within a panel,
// scaled so the whole curve (and zero) stays visible.
function panelSeries(panel: Panel, values: number[]) {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const xFor = (i: number) => panel.x0 + (i / (values.length - 1)) * (panel.x1 - panel.x0);
  const yFor = (v: number) => panel.y1 - ((v - min) / span) * (panel.y1 - panel.y0);
  return {
    points: values.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' '),
    xFor,
    yFor,
    zeroY: yFor(0),
  };
}

export default function SpinUpGrapher() {
  const [alpha, setAlpha] = useState(1.5);
  const [omega0, setOmega0] = useState(0);
  const [time, setTime] = useState(3);
  const [playing, setPlaying] = useState(false);
  const lastFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) {
      lastFrameRef.current = null;
      return;
    }

    let frameId = 0;
    const tick = (timestamp: number) => {
      if (lastFrameRef.current !== null) {
        const elapsed = Math.min(0.05, (timestamp - lastFrameRef.current) / 1000);
        setTime((current) => {
          const next = current + elapsed;
          if (next >= T_MAX) {
            setPlaying(false);
            return T_MAX;
          }
          return next;
        });
      }
      lastFrameRef.current = timestamp;
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [playing]);

  const thetaValues: number[] = [];
  const omegaValues: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const t = (i / (SAMPLES - 1)) * T_MAX;
    const state = angularKinematics(0, omega0, alpha, t);
    thetaValues.push(state.theta);
    omegaValues.push(state.omega);
  }

  const thetaSeries = panelSeries(THETA_PANEL, thetaValues);
  const omegaSeries = panelSeries(OMEGA_PANEL, omegaValues);

  const now = angularKinematics(0, omega0, alpha, time);
  const revolutions = now.theta / (2 * Math.PI);
  const markerX = (panel: Panel) => panel.x0 + (time / T_MAX) * (panel.x1 - panel.x0);

  const spokeAngle = -now.theta; // SVG y is down; positive θ turns counterclockwise
  const spoke = {
    x: WHEEL_CX + WHEEL_R * Math.cos(spokeAngle),
    y: WHEEL_CY + WHEEL_R * Math.sin(spokeAngle),
  };

  const panelFrame = (panel: Panel, label: string, color: string, zeroY: number) => (
    <>
      <rect
        x={panel.x0}
        y={panel.y0}
        width={panel.x1 - panel.x0}
        height={panel.y1 - panel.y0}
        fill="none"
        stroke="var(--grid-line)"
        strokeWidth="1.5"
      />
      {zeroY < panel.y1 - 1 && (
        <line
          x1={panel.x0}
          y1={zeroY}
          x2={panel.x1}
          y2={zeroY}
          stroke="var(--grid-line)"
          strokeWidth="1"
          strokeDasharray="4 5"
        />
      )}
      <text
        x={(panel.x0 + panel.x1) / 2}
        y={panel.y1 + 22}
        textAnchor="middle"
        fill={color}
        fontSize="15"
        fontStyle="italic"
        fontWeight="700"
      >
        {label}
      </text>
    </>
  );

  return (
    <div className="not-prose mx-auto my-8 flex max-w-[640px] flex-col gap-3 text-[var(--text-primary)]">
      <p className="m-0 text-center text-sm leading-6 text-[var(--text-muted)]">
        A wheel spins up with constant angular acceleration. Scrub or play time
        and compare the curves: ω(t) is a straight line, θ(t) a parabola — the
        same shapes as v(t) and x(t) in linear kinematics.
      </p>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label="Graphs of angular position and angular velocity versus time for constant angular acceleration, next to a spinning wheel"
        className="block h-auto w-full"
      >
        {/* Wheel glyph showing the accumulated angle */}
        <circle
          cx={WHEEL_CX}
          cy={WHEEL_CY}
          r={WHEEL_R}
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth="3"
        />
        <line
          x1={WHEEL_CX}
          y1={WHEEL_CY}
          x2={spoke.x}
          y2={spoke.y}
          stroke="var(--accent-blue)"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <circle cx={WHEEL_CX} cy={WHEEL_CY} r="4" fill="var(--text-primary)" />

        {panelFrame(THETA_PANEL, 'θ(t)', 'var(--accent-blue)', thetaSeries.zeroY)}
        <polyline
          points={thetaSeries.points}
          fill="none"
          stroke="var(--accent-blue)"
          strokeWidth="3"
        />
        <circle
          cx={markerX(THETA_PANEL)}
          cy={thetaSeries.yFor(now.theta)}
          r="6"
          fill="var(--accent-blue)"
          stroke="var(--surface-elevated)"
          strokeWidth="2"
        />

        {panelFrame(OMEGA_PANEL, 'ω(t)', 'var(--accent-green)', omegaSeries.zeroY)}
        <polyline
          points={omegaSeries.points}
          fill="none"
          stroke="var(--accent-green)"
          strokeWidth="3"
        />
        <circle
          cx={markerX(OMEGA_PANEL)}
          cy={omegaSeries.yFor(now.omega)}
          r="6"
          fill="var(--accent-green)"
          stroke="var(--surface-elevated)"
          strokeWidth="2"
        />
      </svg>

      <Readout variant="inline" className="justify-center font-mono tabular-nums">
        <Readout.Value label="t" value={time.toFixed(2)} unit="s" />
        <Readout.Value label="θ" value={now.theta.toFixed(1)} unit="rad" />
        <Readout.Value label="θ/2π" value={revolutions.toFixed(2)} unit="rev" />
        <Readout.Value label="ω" value={now.omega.toFixed(2)} unit="rad/s" />
      </Readout>

      <ControlBar>
        <Slider
          label={<span>Angular acceleration <i>α</i></span>}
          unit="rad/s²"
          min={ALPHA_MIN}
          max={ALPHA_MAX}
          step={0.1}
          value={alpha}
          onChange={setAlpha}
          format={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}`}
        />
        <Slider
          label={<span>Initial <i>ω</i>₀</span>}
          unit="rad/s"
          min={OMEGA0_MIN}
          max={OMEGA0_MAX}
          step={0.5}
          value={omega0}
          onChange={setOmega0}
          format={(value) => value.toFixed(1)}
        />
        <Slider
          label={<span>Time <i>t</i></span>}
          unit="s"
          min={0}
          max={T_MAX}
          step={0.02}
          value={time}
          onChange={(value) => {
            setPlaying(false);
            setTime(value);
          }}
          format={(value) => value.toFixed(1)}
        />
        <Button onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play'}</Button>
        <Button
          variant="secondary"
          onClick={() => {
            setPlaying(false);
            setTime(0);
          }}
        >
          Reset
        </Button>
      </ControlBar>
    </div>
  );
}
