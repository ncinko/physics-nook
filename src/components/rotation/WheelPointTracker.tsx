import { useEffect, useRef, useState } from 'react';
import { cycloidPoint, cycloidVelocity } from '../../lib/rotation';
import { Button, ControlBar, Slider, Toggle } from '../shared/InlineControls';

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 300;
const GROUND_Y = 260;
const SCALE = 140; // px per meter

const WHEEL_RADIUS = 0.5; // m
const MID_RADIUS = WHEEL_RADIUS / 2;
const OMEGA_MIN = 0;
const OMEGA_MAX = 6;

const START_X = 90; // px, wheel center at θ = 0 in rolling mode
const END_X = 550; // px, wrap point for the rolling wheel
const SPIN_CENTER_X = VIEW_WIDTH / 2; // px, fixed center when spinning in place
const WRAP_THETA = (END_X - START_X) / (WHEEL_RADIUS * SCALE);

const VELOCITY_PX_PER_MPS = 26;
const ARROW_HEAD_LENGTH = 12;
const ARROW_HEAD_HALF_WIDTH = 7;
const TRACE_CAP = 240;

interface Point {
  x: number;
  y: number;
}

const arrowGeometry = (start: Point, direction: Point, length: number) => {
  const headLength = Math.min(ARROW_HEAD_LENGTH, length);
  const headHalfWidth = Math.min(ARROW_HEAD_HALF_WIDTH, headLength * 0.7);
  const tip = {
    x: start.x + direction.x * length,
    y: start.y + direction.y * length,
  };
  const bodyEnd = {
    x: tip.x - direction.x * headLength,
    y: tip.y - direction.y * headLength,
  };
  const normal = { x: -direction.y, y: direction.x };
  const headPoints = [
    tip,
    { x: bodyEnd.x + normal.x * headHalfWidth, y: bodyEnd.y + normal.y * headHalfWidth },
    { x: bodyEnd.x - normal.x * headHalfWidth, y: bodyEnd.y - normal.y * headHalfWidth },
  ].map(({ x, y }) => `${x},${y}`).join(' ');

  return { tip, bodyEnd, headPoints };
};

interface MarkerState {
  screen: Point;
  speed: number;
  arrow: ReturnType<typeof arrowGeometry> | null;
}

export default function WheelPointTracker() {
  const [omega, setOmega] = useState(3);
  const [rolling, setRolling] = useState(true);
  const [theta, setTheta] = useState(0);
  const lastFrameRef = useRef<number | null>(null);
  const traceRef = useRef<Point[]>([]);

  useEffect(() => {
    if (omega === 0) {
      lastFrameRef.current = null;
      return;
    }

    let frameId = 0;
    const tick = (timestamp: number) => {
      if (lastFrameRef.current !== null) {
        const elapsed = Math.min(0.05, (timestamp - lastFrameRef.current) / 1000);
        setTheta((current) => {
          const next = current + omega * elapsed;
          if (rolling && next >= WRAP_THETA) {
            traceRef.current = [];
            return next - WRAP_THETA;
          }
          return next % (Math.PI * 2 * 1000);
        });
      }
      lastFrameRef.current = timestamp;
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [omega, rolling]);

  const clearTrace = () => {
    traceRef.current = [];
  };

  const handleRollingChange = (next: boolean) => {
    traceRef.current = [];
    setTheta(0);
    setRolling(next);
  };

  // World coordinates: x along the ground, y up from the ground. cycloidPoint
  // gives the rolling-wheel path; subtracting the R·θ translation recovers
  // spinning in place about a fixed center.
  const markerFor = (pointRadius: number): MarkerState => {
    const p = cycloidPoint(WHEEL_RADIUS, pointRadius, theta);
    const v = cycloidVelocity(WHEEL_RADIUS, pointRadius, theta, omega);
    const worldX = rolling
      ? START_X / SCALE + p.x
      : SPIN_CENTER_X / SCALE + (p.x - WHEEL_RADIUS * theta);
    const vx = rolling ? v.x : v.x - omega * WHEEL_RADIUS;
    const vy = v.y;
    const speed = Math.hypot(vx, vy);
    const screen = { x: worldX * SCALE, y: GROUND_Y - p.y * SCALE };
    const arrow =
      speed > 0.01
        ? arrowGeometry(
            screen,
            { x: vx / speed, y: -vy / speed },
            speed * VELOCITY_PX_PER_MPS,
          )
        : null;
    return { screen, speed, arrow };
  };

  const centerP = markerFor(0);
  const rim = markerFor(WHEEL_RADIUS);
  const mid = markerFor(MID_RADIUS);

  // Reset the trace whenever θ restarts so the polyline never spans a wrap.
  if (theta === 0) traceRef.current = [];
  const lastTrace = traceRef.current[traceRef.current.length - 1];
  if (!lastTrace || Math.hypot(lastTrace.x - rim.screen.x, lastTrace.y - rim.screen.y) > 1.5) {
    traceRef.current.push(rim.screen);
    if (traceRef.current.length > TRACE_CAP) traceRef.current.shift();
  }

  const wheelCenter = centerP.screen;
  const tracePoints = traceRef.current.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  const markerLabel = (marker: MarkerState, dy: number) => ({
    x: Math.min(VIEW_WIDTH - 56, Math.max(56, marker.screen.x)),
    y: Math.max(16, marker.screen.y + dy),
  });
  const rimLabel = markerLabel(rim, -58);
  const midLabel = markerLabel(mid, 24);

  return (
    <div className="not-prose mx-auto my-8 flex max-w-[640px] flex-col gap-3 text-[var(--text-primary)]">
      <p className="m-0 text-center text-sm leading-6 text-[var(--text-muted)]">
        Two markers ride the same wheel, so they share the same ω — but the outer
        one moves faster, since v = rω. Switch to rolling and watch the rim
        marker stop dead each time it touches the ground.
      </p>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label="A wheel with two markers at different radii, showing their velocity vectors and the path traced by the rim marker"
        className="block h-auto w-full"
      >
        {/* Ground */}
        <line
          x1="0"
          y1={GROUND_Y}
          x2={VIEW_WIDTH}
          y2={GROUND_Y}
          stroke="var(--grid-line)"
          strokeWidth="2"
        />

        {/* Trace of the rim marker (a cycloid when rolling) */}
        {traceRef.current.length > 1 && (
          <polyline
            points={tracePoints}
            fill="none"
            stroke="var(--accent-purple)"
            strokeWidth="2"
            strokeOpacity="0.55"
          />
        )}

        {/* Wheel */}
        <circle
          cx={wheelCenter.x}
          cy={wheelCenter.y}
          r={WHEEL_RADIUS * SCALE}
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth="3"
        />
        {/* Spoke through both markers */}
        <line
          x1={wheelCenter.x}
          y1={wheelCenter.y}
          x2={rim.screen.x}
          y2={rim.screen.y}
          stroke="var(--grid-line)"
          strokeWidth="2"
        />
        <circle cx={wheelCenter.x} cy={wheelCenter.y} r="5" fill="var(--text-primary)" />

        {/* Mid marker (r = R/2) */}
        <circle
          cx={mid.screen.x}
          cy={mid.screen.y}
          r="8"
          fill="var(--accent-blue)"
          stroke="var(--surface-elevated)"
          strokeWidth="2.5"
        />
        {mid.arrow && (
          <>
            <line
              x1={mid.screen.x}
              y1={mid.screen.y}
              x2={mid.arrow.bodyEnd.x}
              y2={mid.arrow.bodyEnd.y}
              stroke="var(--accent-blue)"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            <polygon points={mid.arrow.headPoints} fill="var(--accent-blue)" />
          </>
        )}
        <text
          x={midLabel.x}
          y={midLabel.y}
          textAnchor="middle"
          fill="var(--accent-blue)"
          fontSize="14"
          fontWeight="700"
          className="font-mono"
        >
          v = {mid.speed.toFixed(1)} m/s
        </text>

        {/* Rim marker (r = R) */}
        <circle
          cx={rim.screen.x}
          cy={rim.screen.y}
          r="9"
          fill="var(--accent-purple)"
          stroke="var(--surface-elevated)"
          strokeWidth="2.5"
        />
        {rim.arrow && (
          <>
            <line
              x1={rim.screen.x}
              y1={rim.screen.y}
              x2={rim.arrow.bodyEnd.x}
              y2={rim.arrow.bodyEnd.y}
              stroke="var(--accent-purple)"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            <polygon points={rim.arrow.headPoints} fill="var(--accent-purple)" />
          </>
        )}
        <text
          x={rimLabel.x}
          y={rimLabel.y}
          textAnchor="middle"
          fill="var(--accent-purple)"
          fontSize="14"
          fontWeight="700"
          className="font-mono"
        >
          v = {rim.speed.toFixed(1)} m/s
        </text>

        {/* Shared angular speed label */}
        <text
          x={VIEW_WIDTH / 2}
          y="26"
          textAnchor="middle"
          fill="var(--text-muted)"
          fontSize="15"
          fontWeight="600"
          className="font-mono"
        >
          ω = {omega.toFixed(1)} rad/s — the same for every point
        </text>
      </svg>

      <ControlBar>
        <Slider
          label={<span>Angular speed <i>ω</i></span>}
          unit="rad/s"
          min={OMEGA_MIN}
          max={OMEGA_MAX}
          step={0.1}
          value={omega}
          onChange={setOmega}
          format={(value) => value.toFixed(1)}
        />
        <Toggle label="Roll along the ground" checked={rolling} onChange={handleRollingChange} />
        <Button variant="secondary" onClick={clearTrace}>
          Clear trace
        </Button>
      </ControlBar>
    </div>
  );
}
