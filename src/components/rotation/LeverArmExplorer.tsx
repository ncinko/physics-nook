import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { torqueFromForce } from '../../lib/rotation';
import { ControlBar, Slider } from '../shared/InlineControls';

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 320;
const PIVOT_X = 110;
const PIVOT_Y = 210;
const SCALE = 1300; // px per meter

const HANDLE_LENGTH = 0.3; // m
const R_MIN = 0.05;
const R_MAX = HANDLE_LENGTH;
const FORCE_MIN = 5;
const FORCE_MAX = 60;
const FORCE_PX_PER_N = 2.4;
const ARROW_HEAD_LENGTH = 13;
const ARROW_HEAD_HALF_WIDTH = 7.5;

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

export default function LeverArmExplorer() {
  const [radius, setRadius] = useState(0.24);
  const [angleDeg, setAngleDeg] = useState(60);
  const [force, setForce] = useState(40);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const angle = (angleDeg * Math.PI) / 180;
  const torque = torqueFromForce(radius, force, angle);

  const applyPoint = { x: PIVOT_X + radius * SCALE, y: PIVOT_Y };
  // Screen y grows downward, so a positive angle tips the force upward.
  const forceDir = { x: Math.cos(angle), y: -Math.sin(angle) };
  const forceArrow = arrowGeometry(applyPoint, forceDir, force * FORCE_PX_PER_N);

  // Foot of the perpendicular from the pivot onto the force's line of action:
  // its length is the lever arm r⊥ = r sin θ.
  const toPivot = { x: PIVOT_X - applyPoint.x, y: PIVOT_Y - applyPoint.y };
  const along = toPivot.x * forceDir.x + toPivot.y * forceDir.y;
  const foot = {
    x: applyPoint.x + forceDir.x * along,
    y: applyPoint.y + forceDir.y * along,
  };
  const leverArm = radius * Math.sin(angle);

  // Component of the force along the wrench handle — the part that makes no torque.
  const parallelComponent = force * Math.cos(angle);
  const parallelArrow = arrowGeometry(
    applyPoint,
    { x: Math.sign(parallelComponent) || 1, y: 0 },
    Math.abs(parallelComponent) * FORCE_PX_PER_N,
  );

  const lineOfAction = {
    x1: applyPoint.x - forceDir.x * 300,
    y1: applyPoint.y - forceDir.y * 300,
    x2: applyPoint.x + forceDir.x * 300,
    y2: applyPoint.y + forceDir.y * 300,
  };

  const radiusFromPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return radius;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH;
    const r = (x - PIVOT_X) / SCALE;
    return Math.min(R_MAX, Math.max(R_MIN, r));
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragging) return;
    setRadius(radiusFromPointer(event));
  };

  return (
    <div className="not-prose mx-auto my-8 flex max-w-[640px] flex-col gap-3 text-[var(--text-primary)]">
      <p className="m-0 text-center text-sm leading-6 text-[var(--text-muted)]">
        Drag the grip along the wrench and tilt the force. Only the lever arm
        r⊥ = r sin θ — the perpendicular distance from the bolt to the force's
        line of action — produces torque.
      </p>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label="A wrench on a bolt with a draggable force, showing the lever arm as the perpendicular distance from the bolt to the force's line of action"
        className="block h-auto w-full touch-none"
        onPointerMove={handlePointerMove}
        onPointerUp={() => setDragging(false)}
        onPointerLeave={() => setDragging(false)}
      >
        {/* Line of action */}
        <line
          {...lineOfAction}
          stroke="var(--accent-red)"
          strokeWidth="1.5"
          strokeDasharray="5 7"
          strokeOpacity="0.5"
        />

        {/* Lever arm construction */}
        <line
          x1={PIVOT_X}
          y1={PIVOT_Y}
          x2={foot.x}
          y2={foot.y}
          stroke="var(--accent-purple)"
          strokeWidth="2.5"
          strokeDasharray="6 5"
        />
        <text
          x={(PIVOT_X + foot.x) / 2 - 30}
          y={(PIVOT_Y + foot.y) / 2 - 12}
          textAnchor="middle"
          fill="var(--accent-purple)"
          fontSize="15"
          fontWeight="700"
          className="font-mono"
        >
          r⊥ = {leverArm.toFixed(2)} m
        </text>

        {/* Wrench handle */}
        <rect
          x={PIVOT_X}
          y={PIVOT_Y - 9}
          width={HANDLE_LENGTH * SCALE + 18}
          height="18"
          rx="9"
          fill="var(--surface-elevated)"
          stroke="var(--text-muted)"
          strokeWidth="2.5"
        />

        {/* Bolt */}
        <circle
          cx={PIVOT_X}
          cy={PIVOT_Y}
          r="17"
          fill="var(--sim-bg)"
          stroke="var(--text-primary)"
          strokeWidth="3"
        />
        <circle cx={PIVOT_X} cy={PIVOT_Y} r="6" fill="var(--text-primary)" />

        {/* Wasted (parallel) component of the force */}
        {Math.abs(parallelComponent) > 2 && (
          <>
            <line
              x1={applyPoint.x}
              y1={applyPoint.y}
              x2={parallelArrow.bodyEnd.x}
              y2={parallelArrow.bodyEnd.y}
              stroke="var(--text-muted)"
              strokeWidth="3"
              strokeOpacity="0.45"
              strokeLinecap="round"
            />
            <polygon points={parallelArrow.headPoints} fill="var(--text-muted)" fillOpacity="0.45" />
            <text
              x={parallelArrow.tip.x + (parallelComponent > 0 ? 8 : -8)}
              y={parallelArrow.tip.y + 22}
              textAnchor={parallelComponent > 0 ? 'start' : 'end'}
              fill="var(--text-muted)"
              fontSize="12.5"
            >
              F cos θ — no torque
            </text>
          </>
        )}

        {/* Force arrow */}
        <line
          x1={applyPoint.x}
          y1={applyPoint.y}
          x2={forceArrow.bodyEnd.x}
          y2={forceArrow.bodyEnd.y}
          stroke="var(--accent-red)"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <polygon points={forceArrow.headPoints} fill="var(--accent-red)" />
        <text
          x={forceArrow.tip.x + forceDir.x * 16}
          y={forceArrow.tip.y + forceDir.y * 16}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--accent-red)"
          fontSize="17"
          fontStyle="italic"
          fontWeight="800"
        >
          F
        </text>

        {/* Draggable grip */}
        <circle
          cx={applyPoint.x}
          cy={applyPoint.y}
          r="11"
          fill="var(--accent-blue)"
          stroke="var(--surface-elevated)"
          strokeWidth="3"
          className="cursor-grab"
          onPointerDown={(event) => {
            (event.target as Element).setPointerCapture?.(event.pointerId);
            setDragging(true);
          }}
        />

        {/* Radius bracket under the handle */}
        <line
          x1={PIVOT_X}
          y1={PIVOT_Y + 32}
          x2={applyPoint.x}
          y2={PIVOT_Y + 32}
          stroke="var(--text-muted)"
          strokeWidth="1.5"
        />
        <text
          x={(PIVOT_X + applyPoint.x) / 2}
          y={PIVOT_Y + 50}
          textAnchor="middle"
          fill="var(--text-muted)"
          fontSize="14"
          className="font-mono"
        >
          r = {radius.toFixed(2)} m
        </text>
      </svg>

      <p className="m-0 text-center font-mono text-sm tabular-nums">
        τ = rF sin θ = ({radius.toFixed(2)} m)({force.toFixed(0)} N)(sin {angleDeg.toFixed(0)}°) ={' '}
        <strong>{torque.toFixed(1)} N·m</strong>
      </p>

      <ControlBar>
        <Slider
          label={<span>Force angle <i>θ</i></span>}
          unit="°"
          min={0}
          max={180}
          step={1}
          value={angleDeg}
          onChange={setAngleDeg}
          format={(value) => value.toFixed(0)}
        />
        <Slider
          label={<span>Force <i>F</i></span>}
          unit="N"
          min={FORCE_MIN}
          max={FORCE_MAX}
          step={1}
          value={force}
          onChange={setForce}
          format={(value) => value.toFixed(0)}
        />
      </ControlBar>
    </div>
  );
}
