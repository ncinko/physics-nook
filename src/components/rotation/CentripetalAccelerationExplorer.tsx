import { useEffect, useRef, useState } from 'react';
import { uniformCircularMotion } from '../../lib/rotation';
import { ControlBar, Slider } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 340;
const CENTER_X = VIEW_WIDTH / 2;
const CENTER_Y = VIEW_HEIGHT / 2;

const RADIUS_MIN = 1;
const RADIUS_MAX = 4;
const OMEGA_MIN = -3;
const OMEGA_MAX = 3;

// Velocity and acceleration use separate scales because their units differ.
// Map the previous angular-velocity bound at maximum radius to twice the old
// 88 px vector maximum. Long vectors may clip against the compact fixed view.
const PREVIOUS_OMEGA_MAX = 2.5;
const PREVIOUS_MAX_VECTOR_LENGTH = 88;
const VECTOR_LENGTH_MULTIPLIER = 2;
const VELOCITY_LENGTH_SCALE =
  VECTOR_LENGTH_MULTIPLIER * PREVIOUS_MAX_VECTOR_LENGTH / (RADIUS_MAX * PREVIOUS_OMEGA_MAX);
const ACCELERATION_LENGTH_SCALE =
  VECTOR_LENGTH_MULTIPLIER * PREVIOUS_MAX_VECTOR_LENGTH /
  (RADIUS_MAX * PREVIOUS_OMEGA_MAX * PREVIOUS_OMEGA_MAX);
const ARROW_HEAD_LENGTH = 14;
const ARROW_HEAD_HALF_WIDTH = 8;

const orbitRadiusFor = (radius: number) =>
  64 + ((radius - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN)) * 78;

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
    {
      x: bodyEnd.x + normal.x * headHalfWidth,
      y: bodyEnd.y + normal.y * headHalfWidth,
    },
    {
      x: bodyEnd.x - normal.x * headHalfWidth,
      y: bodyEnd.y - normal.y * headHalfWidth,
    },
  ].map(({ x, y }) => `${x},${y}`).join(' ');

  return { tip, bodyEnd, headPoints };
};

export default function CentripetalAccelerationExplorer() {
  const [radius, setRadius] = useState(3);
  const [omega, setOmega] = useState(1.5);
  const [angle, setAngle] = useState(0);
  const lastFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (omega === 0) {
      lastFrameRef.current = null;
      return;
    }

    let frameId = 0;
    const tick = (timestamp: number) => {
      if (lastFrameRef.current !== null) {
        const elapsed = Math.min(0.05, (timestamp - lastFrameRef.current) / 1000);
        setAngle((current) => (current + omega * elapsed) % (Math.PI * 2));
      }
      lastFrameRef.current = timestamp;
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [omega]);

  const motion = uniformCircularMotion(radius, omega, angle);
  const orbitRadius = orbitRadiusFor(radius);
  const radialUnit = {
    x: motion.position.x / radius,
    y: motion.position.y / radius,
  };
  const velocityUnit = motion.speed > 0
    ? { x: motion.velocity.x / motion.speed, y: motion.velocity.y / motion.speed }
    : { x: -radialUnit.y, y: radialUnit.x };
  const accelerationUnit = motion.centripetalAcceleration > 0
    ? {
        x: motion.acceleration.x / motion.centripetalAcceleration,
        y: motion.acceleration.y / motion.centripetalAcceleration,
      }
    : { x: -radialUnit.x, y: -radialUnit.y };

  const velocityScreenUnit = { x: velocityUnit.x, y: -velocityUnit.y };
  const accelerationScreenUnit = { x: accelerationUnit.x, y: -accelerationUnit.y };
  const velocityLength = motion.speed * VELOCITY_LENGTH_SCALE;
  const accelerationLength = motion.centripetalAcceleration * ACCELERATION_LENGTH_SCALE;

  const puck = {
    x: CENTER_X + radialUnit.x * orbitRadius,
    y: CENTER_Y - radialUnit.y * orbitRadius,
  };
  const velocityArrow = arrowGeometry(puck, velocityScreenUnit, velocityLength);
  const accelerationArrow = arrowGeometry(puck, accelerationScreenUnit, accelerationLength);
  const radiusLabel = {
    x: CENTER_X + orbitRadius * 0.5,
    y: CENTER_Y - 13,
  };
  const velocityLabel = {
    x: velocityArrow.tip.x + radialUnit.x * 14,
    y: velocityArrow.tip.y - radialUnit.y * 14,
  };
  const accelerationLabel = {
    x: (puck.x + accelerationArrow.tip.x) / 2 + radialUnit.y * 13,
    y: (puck.y + accelerationArrow.tip.y) / 2 + radialUnit.x * 13,
  };

  return (
    <div className="not-prose mx-auto my-8 flex max-w-[640px] flex-col gap-3 text-[var(--text-primary)]">
      <p className="m-0 text-center text-sm leading-6 text-[var(--text-muted)]">
        Change the radius or angular speed. Arrow lengths track their magnitudes:
        velocity stays tangent while acceleration points toward the center.
      </p>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label="An object moving around a circular track with a tangent velocity vector and an inward centripetal acceleration vector"
        className="block h-auto w-full"
      >
        <circle
          cx={CENTER_X}
          cy={CENTER_Y}
          r={orbitRadius}
          fill="none"
          stroke="var(--grid-line)"
          strokeWidth="2"
          strokeDasharray="5 7"
        />
        <line
          x1={CENTER_X}
          y1={CENTER_Y}
          x2={CENTER_X + orbitRadius}
          y2={CENTER_Y}
          stroke="var(--text-muted)"
          strokeWidth="2"
        />
        <text
          x={radiusLabel.x}
          y={radiusLabel.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--text-muted)"
          fontSize="17"
          fontStyle="italic"
          fontWeight="700"
        >
          r
        </text>

        <circle cx={CENTER_X} cy={CENTER_Y} r="5" fill="var(--text-primary)" />
        <circle
          cx={puck.x}
          cy={puck.y}
          r="12"
          fill="var(--accent-blue)"
          stroke="var(--surface-elevated)"
          strokeWidth="3"
        />

        {motion.speed > 0 && (
          <>
            <line
              x1={puck.x}
              y1={puck.y}
              x2={velocityArrow.bodyEnd.x}
              y2={velocityArrow.bodyEnd.y}
              stroke="var(--accent-green)"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <polygon points={velocityArrow.headPoints} fill="var(--accent-green)" />
            <text
              x={velocityLabel.x}
              y={velocityLabel.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="var(--accent-green)"
              fontSize="17"
              fontStyle="italic"
              fontWeight="800"
            >
              v
            </text>
          </>
        )}

        {motion.centripetalAcceleration > 0 && (
          <>
            <line
              x1={puck.x}
              y1={puck.y}
              x2={accelerationArrow.bodyEnd.x}
              y2={accelerationArrow.bodyEnd.y}
              stroke="var(--accent-red)"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <polygon points={accelerationArrow.headPoints} fill="var(--accent-red)" />
            <text
              x={accelerationLabel.x}
              y={accelerationLabel.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="var(--accent-red)"
              fontSize="17"
              fontStyle="italic"
              fontWeight="800"
            >
              a<tspan baselineShift="sub" fontSize="12">c</tspan>
            </text>
          </>
        )}

      </svg>

      <Readout variant="inline" className="justify-center font-mono tabular-nums">
        <Readout.Value label="v = rω" value={motion.speed.toFixed(2)} unit="m/s" />
        <Readout.Value
          label={<span><i>a</i><sub>c</sub> = v²/r = rω²</span>}
          value={motion.centripetalAcceleration.toFixed(2)}
          unit="m/s²"
        />
      </Readout>

      <ControlBar>
        <Slider
          label={<span>Radius <i>r</i></span>}
          unit="m"
          min={RADIUS_MIN}
          max={RADIUS_MAX}
          step={0.05}
          value={radius}
          onChange={setRadius}
          format={(value) => value.toFixed(2)}
        />
        <Slider
          label={<span>Angular speed <i>ω</i></span>}
          unit="rad/s"
          min={OMEGA_MIN}
          max={OMEGA_MAX}
          step={0.1}
          value={omega}
          onChange={setOmega}
          format={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}`}
        />
      </ControlBar>
    </div>
  );
}
