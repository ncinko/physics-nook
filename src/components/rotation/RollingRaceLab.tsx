import { useEffect, useRef, useState } from 'react';
import {
  inertiaCoefficient,
  rollingAcceleration,
  rollingEnergyBreakdown,
  rollingRaceState,
  type RollingShape,
} from '../../lib/rotation';
import { Button, ControlBar, Slider, Toggle } from '../shared/InlineControls';

// Rolling Race Lab — four shapes with the same mass and radius race down an
// incline, rolling without slipping. All motion is closed-form in elapsed
// time (see rollingRaceState), so the race is deterministic: pausing,
// scrubbing the clock, or dropping frames can never change who wins.

const G = 9.8;
const SLOPE_LENGTH = 6; // m along the slope
const BODY_RADIUS = 0.35; // m, all racers
const BODY_MASS = 1; // kg, all racers
const SLOW_MO_FACTOR = 0.35;

const ANGLE_MIN = 5;
const ANGLE_MAX = 30;

const LANE_STEP_X = 26; // px pseudo-depth offset between lanes
const LANE_STEP_Y = -15;

interface RacerSpec {
  id: RollingShape;
  label: string;
  colorVar: string;
  fallback: string;
}

const RACERS: RacerSpec[] = [
  { id: 'solidSphere', label: 'Solid sphere', colorVar: '--accent-green', fallback: '#22c55e' },
  { id: 'disk', label: 'Solid disk', colorVar: '--accent-blue', fallback: '#3b82f6' },
  { id: 'hollowSphere', label: 'Hollow sphere', colorVar: '--accent-purple', fallback: '#7e57c2' },
  { id: 'hoop', label: 'Hoop', colorVar: '--accent-red', fallback: '#ef4444' },
];

const finishTime = (angleRad: number, c: number) =>
  Math.sqrt((2 * SLOPE_LENGTH) / rollingAcceleration(G, angleRad, c));

export default function RollingRaceLab() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 900, h: 500 });
  const [dpiScale, setDpiScale] = useState(1);

  const [angleDeg, setAngleDeg] = useState(15);
  const [running, setRunning] = useState(false);
  const [slowMo, setSlowMo] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [enabled, setEnabled] = useState<Record<RollingShape, boolean>>({
    hoop: true,
    disk: true,
    solidSphere: true,
    hollowSphere: true,
  });

  const angleRad = (angleDeg * Math.PI) / 180;
  const activeRacers = RACERS.filter((r) => enabled[r.id]);

  // ---------- sizing ----------
  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      const maxW = container ? container.clientWidth : 900;
      const w = Math.floor(Math.max(560, Math.min(maxW, 1100)));
      const h = Math.floor(Math.max(400, Math.min(window.innerHeight * 0.66, 560)));
      setSize({ w, h });
      setDpiScale(window.devicePixelRatio || 1);
    };
    handleResize();
    const ro = new ResizeObserver(handleResize);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.floor(size.w * dpiScale);
    canvas.height = Math.floor(size.h * dpiScale);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
  }, [size, dpiScale]);

  // ---------- clock ----------
  useEffect(() => {
    if (!running) return;

    let frameId = 0;
    let lastStamp: number | null = null;
    const slowest = Math.max(
      ...RACERS.map((r) => finishTime(angleRad, inertiaCoefficient(r.id))),
    );
    const tick = (timestamp: number) => {
      if (lastStamp !== null) {
        const dt = Math.min(0.05, (timestamp - lastStamp) / 1000) * (slowMo ? SLOW_MO_FACTOR : 1);
        setElapsed((current) => {
          const next = current + dt;
          if (next >= slowest + 0.8) {
            setRunning(false);
            return slowest + 0.8;
          }
          return next;
        });
      }
      lastStamp = timestamp;
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [running, slowMo, angleRad]);

  const reset = () => {
    setRunning(false);
    setElapsed(0);
  };

  // ---------- drawing ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const styles = getComputedStyle(container);
    const cssVar = (name: string, fallback: string) => {
      const value = styles.getPropertyValue(name).trim();
      return value || fallback;
    };
    const textColor = cssVar('--text-primary', '#111827');
    const mutedColor = cssVar('--text-muted', '#4b5563');
    const gridColor = cssVar('--grid-line', '#d1d5db');
    const surfaceColor = cssVar('--sim-bg', '#f9fafb');

    const w = size.w;
    const h = size.h;
    ctx.setTransform(dpiScale, 0, 0, dpiScale, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = surfaceColor;
    ctx.fillRect(0, 0, w, h);

    const laneCount = RACERS.length;
    const depthX = LANE_STEP_X * (laneCount - 1);
    const depthY = LANE_STEP_Y * (laneCount - 1);

    // Fit the front lane's slope inside the canvas, leaving room for the
    // depth offsets, the energy panel, and the racers themselves.
    const marginLeft = 70;
    const marginRight = 60;
    const marginTop = 90;
    const marginBottom = 130;
    const scale = Math.min(
      (w - marginLeft - marginRight - depthX) / (SLOPE_LENGTH * Math.cos(angleRad)),
      (h - marginTop - marginBottom - Math.abs(depthY)) / (SLOPE_LENGTH * Math.sin(angleRad)),
    );
    const slopeDir = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
    const bodyR = Math.max(14, BODY_RADIUS * scale);

    // Front-lane start point (top of the incline).
    const start = { x: marginLeft, y: marginTop + Math.abs(depthY) };
    const end = {
      x: start.x + SLOPE_LENGTH * Math.cos(angleRad) * scale,
      y: start.y + SLOPE_LENGTH * Math.sin(angleRad) * scale,
    };

    const laneOrigin = (lane: number) => ({
      x: start.x + LANE_STEP_X * lane,
      y: start.y + LANE_STEP_Y * lane,
    });

    // Ramp surface (a parallelogram between the front and back lanes).
    const backStart = laneOrigin(laneCount - 1);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.lineTo(end.x + depthX, end.y + depthY);
    ctx.lineTo(backStart.x, backStart.y);
    ctx.closePath();
    ctx.fillStyle = gridColor;
    ctx.globalAlpha = 0.28;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Lane lines and finish line.
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1.5;
    for (let lane = 0; lane < laneCount; lane += 1) {
      const o = laneOrigin(lane);
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(o.x + (end.x - start.x), o.y + (end.y - start.y));
      ctx.stroke();
    }
    ctx.strokeStyle = textColor;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x + depthX, end.y + depthY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = mutedColor;
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText('finish', end.x + depthX + 8, end.y + depthY + 4);

    // Ground under the incline base.
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(start.x - 40, end.y + bodyR + 4);
    ctx.lineTo(w - 20, end.y + bodyR + 4);
    ctx.stroke();

    // Angle arc label at the base of the front lane.
    ctx.fillStyle = mutedColor;
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText(`θ = ${angleDeg.toFixed(0)}°`, end.x - 78, end.y - 12);

    // Racers, back lane first so the front lane draws on top.
    const totalEnergy = BODY_MASS * G * SLOPE_LENGTH * Math.sin(angleRad);
    for (let lane = laneCount - 1; lane >= 0; lane -= 1) {
      const spec = RACERS[lane];
      if (!enabled[spec.id]) continue;
      const c = inertiaCoefficient(spec.id);
      const tFinish = finishTime(angleRad, c);
      const state = rollingRaceState(G, angleRad, c, Math.min(elapsed, tFinish));
      const s = Math.min(state.distance, SLOPE_LENGTH);
      const phi = s / BODY_RADIUS; // rolling constraint: rotation tracks distance

      // Center sits one radius off the slope surface, along the outward
      // normal n = (sin θ, −cos θ) in screen coordinates.
      const o = laneOrigin(lane);
      const center = {
        x: o.x + s * scale * slopeDir.x + Math.sin(angleRad) * bodyR,
        y: o.y + s * scale * slopeDir.y - Math.cos(angleRad) * bodyR,
      };

      const color = cssVar(spec.colorVar, spec.fallback);

      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.rotate(phi); // rolling "downhill" turns clockwise on screen

      if (spec.id === 'hoop') {
        ctx.strokeStyle = color;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(0, 0, bodyR - 3, 0, Math.PI * 2);
        ctx.stroke();
      } else if (spec.id === 'hollowSphere') {
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, bodyR - 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(0, 0, bodyR - 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = color;
        ctx.globalAlpha = spec.id === 'disk' ? 0.85 : 1;
        ctx.beginPath();
        ctx.arc(0, 0, bodyR, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Spoke marker so the spin rate is visible.
      ctx.strokeStyle = spec.id === 'hoop' || spec.id === 'hollowSphere' ? color : surfaceColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(bodyR - 4, 0);
      ctx.stroke();
      ctx.fillStyle = spec.id === 'hoop' || spec.id === 'hollowSphere' ? color : surfaceColor;
      ctx.beginPath();
      ctx.arc(bodyR - 7, 0, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // Energy bars: PE remaining → translational KE → rotational KE.
      const split = rollingEnergyBreakdown(BODY_MASS, state.speed, c);
      const peRemaining = Math.max(0, totalEnergy - split.total);
      const barX = 24 + lane * 42;
      const barBottom = h - 26;
      const barH = 96;
      const segment = (fraction: number) => (fraction / totalEnergy) * barH;

      let y = barBottom;
      const drawSegment = (value: number, fill: string, alpha = 1) => {
        const segH = segment(value);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = fill;
        ctx.fillRect(barX, y - segH, 26, segH);
        ctx.globalAlpha = 1;
        y -= segH;
      };
      drawSegment(split.translational, color);
      drawSegment(split.rotational, color, 0.45);
      drawSegment(peRemaining, gridColor, 0.8);
      ctx.strokeStyle = mutedColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barBottom - barH, 26, barH);
    }

    // Energy panel caption.
    ctx.fillStyle = mutedColor;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText('energy: solid = K_trans, faded = K_rot, gray = PE left', 24, h - 8);

    // Clock.
    ctx.fillStyle = textColor;
    ctx.font = '700 16px ui-monospace, monospace';
    ctx.fillText(`t = ${elapsed.toFixed(2)} s${slowMo ? '  (slow-mo)' : ''}`, w - 190, 30);
  }, [size, dpiScale, angleDeg, angleRad, elapsed, enabled, slowMo]);

  // Analytic finish order — derived, never accumulated.
  const finished = activeRacers
    .map((spec) => ({ spec, t: finishTime(angleRad, inertiaCoefficient(spec.id)) }))
    .filter(({ t }) => elapsed >= t)
    .sort((a, b) => a.t - b.t);

  return (
    <div ref={containerRef} className="flex flex-col gap-3 p-4 text-[var(--text-primary)]">
      <canvas ref={canvasRef} className="mx-auto block rounded-lg" />

      <ControlBar>
        <Slider
          label={<span>Incline angle <i>θ</i></span>}
          unit="°"
          min={ANGLE_MIN}
          max={ANGLE_MAX}
          step={1}
          value={angleDeg}
          onChange={setAngleDeg}
          format={(value) => value.toFixed(0)}
          disabled={running || elapsed > 0}
        />
        <Button onClick={() => setRunning((r) => !r)}>
          {running ? 'Pause' : elapsed > 0 ? 'Resume' : 'Start race'}
        </Button>
        <Button variant="secondary" onClick={reset}>
          Reset
        </Button>
        <Toggle label="Slow motion" checked={slowMo} onChange={setSlowMo} />
      </ControlBar>

      <ControlBar>
        {RACERS.map((spec) => (
          <Toggle
            key={spec.id}
            label={spec.label}
            checked={enabled[spec.id]}
            onChange={(checked) => {
              reset();
              setEnabled((prev) => ({ ...prev, [spec.id]: checked }));
            }}
          />
        ))}
      </ControlBar>

      {finished.length > 0 && (
        <ol className="mx-auto my-0 flex list-none flex-wrap justify-center gap-x-6 gap-y-1 p-0 font-mono text-sm tabular-nums">
          {finished.map(({ spec, t }, index) => (
            <li key={spec.id} className="flex items-center gap-2">
              <span className="font-bold">{index + 1}.</span>
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ background: `var(${spec.colorVar}, ${spec.fallback})` }}
              />
              {spec.label} — {t.toFixed(2)} s
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
