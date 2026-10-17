import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ForceArrow, FORCE_COLORS } from './ForceArrow';
import { Button, ControlBar, Slider } from '../shared/InlineControls';
import {
  advanceSpringChain,
  chainNodeCount,
  chainNodeMass,
  chainTotalMass,
  createSpringChain,
  formatMagnitude,
  logSliderToValue,
  springForces,
  steadyCutForce,
  valueToLogSlider,
  type SpringChainState,
} from '../../lib/forces';

// Three blocks drawn as chains of point masses joined by springs. A push on the
// left face squeezes the front springs first; the squeeze spreads back through
// the stack and settles where each spring carries exactly the force that the
// mass ahead of it needs to share the acceleration. Pick a cut anywhere to see
// that bookkeeping: force at the cut = (mass ahead) × a.

const VIEW = { width: 760, height: 400 };
const X0 = 150;
const SPACING = 23;
const BLOCKS = 3;
const NODES = 8;
const SCENE = { top: 62, bottom: 128, nodeY: 95, ground: 140 };
const PLOT = { x: X0 - SPACING / 2, y: 232, width: 24 * SPACING, height: 108 };
const STIFFNESS_RANGE = { min: 200, max: 4000 };
const FORCE_RANGE = { min: 0, max: 192 };
const DEFAULT_FORCE = 96;
const DEFAULT_STIFFNESS = 400;
const DEFAULT_CUT = 7;
const ARROW_LENGTH = 100;
const ARROW_STUB = 12;
const GROUND_TICK = 46;
const PIXELS_PER_METER = 24;

/** A zigzag spring between two points, as in the other force demos. */
const springPath = (from: { x: number; y: number }, to: { x: number; y: number }, coils = 2, amplitude = 4) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const pad = Math.min(6, length * 0.2);
  const start = { x: from.x + (dx / length) * pad, y: from.y + (dy / length) * pad };
  const points = [`M ${from.x} ${from.y}`, `L ${start.x} ${start.y}`];
  const body = length - 2 * pad;
  for (let index = 1; index <= coils * 2; index += 1) {
    const along = (index / (coils * 2 + 1)) * body;
    const side = index % 2 === 0 ? -amplitude : amplitude;
    points.push(`L ${start.x + (dx / length) * along + nx * side} ${start.y + (dy / length) * along + ny * side}`);
  }
  points.push(`L ${to.x - (dx / length) * pad} ${to.y - (dy / length) * pad} L ${to.x} ${to.y}`);
  return points.join(' ');
};

/** Stiff chains barely squeeze, so enlarge the squeeze for display, but only as the square root. */
const exaggerationFor = (stiffness: number) => Math.max(1, Math.sqrt((0.45 * stiffness) / FORCE_RANGE.max));

const newChain = (stiffness: number): SpringChainState =>
  createSpringChain({ blocks: BLOCKS, nodesPerBlock: NODES, stiffness, contactStiffness: stiffness });

export default function BlockChainSoftBody() {
  const [force, setForce] = useState(DEFAULT_FORCE);
  const [stiffnessPosition, setStiffnessPosition] = useState(valueToLogSlider(DEFAULT_STIFFNESS, STIFFNESS_RANGE.min, STIFFNESS_RANGE.max));
  const [cut, setCut] = useState(DEFAULT_CUT);
  const [, setFrame] = useState(0);

  const stiffness = logSliderToValue(stiffnessPosition, STIFFNESS_RANGE.min, STIFFNESS_RANGE.max);
  const stateRef = useRef<SpringChainState | null>(null);
  if (stateRef.current === null) {
    stateRef.current = newChain(DEFAULT_STIFFNESS);
  }
  const lastTimeRef = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // The loop reads the latest controls through refs so it never has to restart.
  const forceRef = useRef(force);
  forceRef.current = force;
  const stiffnessRef = useRef(stiffness);
  stiffnessRef.current = stiffness;

  useEffect(() => {
    let frame = 0;
    const tick = (time: number) => {
      const last = lastTimeRef.current ?? time;
      const dt = Math.min((time - last) / 1000, 0.033);
      lastTimeRef.current = time;
      const state = stateRef.current;
      if (state && dt > 0) {
        state.params.stiffness = stiffnessRef.current;
        state.params.contactStiffness = stiffnessRef.current;
        advanceSpringChain(state, forceRef.current, dt);
      }
      setFrame((value) => value + 1);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const restart = () => {
    stateRef.current = newChain(stiffnessRef.current);
  };

  const pickCut = (event: PointerEvent<SVGRectElement>) => {
    if (event.type === 'pointermove' && event.buttons === 0) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * VIEW.width;
    const spring = Math.round((x - X0) / SPACING - 0.5);
    setCut(Math.max(0, Math.min(BLOCKS * NODES - 2, spring)));
  };

  // The block's left face moves with the squeeze, so the arrow tip follows it.
  const faceX0 = X0 - 9 + exaggerationFor(stiffness) * SPACING * (stateRef.current?.u[0] ?? 0);
  // The tip always rests on the block face; the tail slides back as the push grows.
  const pushLength = (force / FORCE_RANGE.max) * ARROW_LENGTH + ARROW_STUB;
  const pushTailX = faceX0 - pushLength;
  const pickForce = (event: PointerEvent<SVGRectElement>) => {
    if (event.type === 'pointermove' && event.buttons === 0) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * VIEW.width;
    const raw = ((faceX0 - ARROW_STUB - x) / ARROW_LENGTH) * FORCE_RANGE.max;
    setForce(Math.max(FORCE_RANGE.min, Math.min(FORCE_RANGE.max, Math.round(raw / 4) * 4)));
  };

  const state = stateRef.current;
  const { params } = state;
  const count = chainNodeCount(params);
  const nodeMass = chainNodeMass(params);
  const totalMass = chainTotalMass(params);
  const forces = springForces(state);
  const acceleration = force / totalMass;
  const exaggeration = exaggerationFor(stiffness);

  const restX = (index: number) => X0 + index * SPACING;
  const nodeX = (index: number) => restX(index) + exaggeration * SPACING * state.u[index];
  const forceScale = Math.max(force, 1);

  const massAhead = (count - 1 - cut) * nodeMass;
  const predictedAtCut = steadyCutForce(force, massAhead, totalMass);
  const cutX = (nodeX(cut) + nodeX(cut + 1)) / 2;
  const sceneRight = nodeX(count - 1) + 9;

  // Force against position: the applied push at the left face, then each spring.
  const yMax = Math.max(force, 10) * 1.12;
  const plotY = (value: number) => PLOT.y + PLOT.height - (Math.max(0, Math.min(value, yMax)) / yMax) * PLOT.height;
  const springX = (index: number) => restX(index) + SPACING / 2;
  const faceX = PLOT.x;
  const liveTrace = [`${faceX},${plotY(force)}`, ...forces.map((value, index) => `${springX(index)},${plotY(value)}`)].join(' ');
  const contactSprings = Array.from({ length: BLOCKS - 1 }, (_, block) => (block + 1) * NODES - 1);

  // The ground scrolls back as the stack speeds up.
  const groundShift = -(state.cmPosition * PIXELS_PER_METER) % GROUND_TICK;
  const groundTicks: number[] = [];
  for (let x = PLOT.x - GROUND_TICK + groundShift; x < VIEW.width; x += GROUND_TICK) {
    if (x > 20) groundTicks.push(x);
  }

  return (
    <div className="not-prose my-8 grid gap-4">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        role="img"
        aria-label="Three 10 kg blocks drawn as chains of springs, pushed from the left. The force exerted by each spring falls in a straight line from the push to zero at the far end."
        className="block h-auto w-full select-none"
      >
        {/* Ground */}
        <line x1="20" y1={SCENE.ground} x2={VIEW.width - 20} y2={SCENE.ground} stroke="var(--text-muted)" strokeWidth="1.5" />
        {groundTicks.map((x) => (
          <line key={x.toFixed(1)} x1={x} y1={SCENE.ground} x2={x - 6} y2={SCENE.ground + 8} stroke="var(--text-muted)" strokeWidth="1.5" opacity="0.6" />
        ))}

        {/* The mass ahead of the cut */}
        <rect
          x={cutX}
          y={SCENE.top - 8}
          width={Math.max(0, sceneRight - cutX)}
          height={SCENE.bottom - SCENE.top + 16}
          rx="8"
          fill="var(--accent-blue)"
          opacity="0.13"
        />

        {Array.from({ length: BLOCKS }, (_, block) => {
          const first = block * NODES;
          const last = first + NODES - 1;
          const left = nodeX(first) - 9;
          const right = nodeX(last) + 9;
          return (
            <g key={block}>
              <rect
                x={left}
                y={SCENE.top}
                width={right - left}
                height={SCENE.bottom - SCENE.top}
                rx="6"
                fill="color-mix(in srgb, var(--grid-line) 26%, transparent)"
                stroke="var(--grid-line)"
                strokeWidth="2"
              />
              <text x={(left + right) / 2} y={SCENE.top - 14} textAnchor="middle" fill="var(--text-muted)" fontSize="13" fontWeight="600">
                {params.blockMass} kg
              </text>
            </g>
          );
        })}

        {forces.map((value, index) => {
          const strength = Math.max(0, Math.min(1, Math.abs(value) / forceScale));
          return (
            <path
              key={index}
              d={springPath({ x: nodeX(index), y: SCENE.nodeY }, { x: nodeX(index + 1), y: SCENE.nodeY })}
              fill="none"
              stroke={FORCE_COLORS.spring}
              strokeWidth={1.2 + 2.2 * strength}
              strokeLinejoin="round"
              opacity={0.2 + 0.8 * strength}
            />
          );
        })}
        {state.u.map((_, index) => (
          <circle key={index} cx={nodeX(index)} cy={SCENE.nodeY} r="3.6" fill="var(--text-primary)" opacity="0.85" />
        ))}

        <ForceArrow
          origin={{ x: pushTailX, y: SCENE.nodeY }}
          vector={{ x: pushLength, y: 0 }}
          maxLength={ARROW_LENGTH + ARROW_STUB}
          color={FORCE_COLORS.applied}
          label={`${Math.round(force)} N`}
          labelAt={{ x: pushTailX, y: SCENE.nodeY - 18, anchor: 'start' }}
          labelBounds={VIEW}
        />

        {/* The cut */}
        <line x1={cutX} y1={SCENE.top - 24} x2={cutX} y2={SCENE.ground - 4} stroke={FORCE_COLORS.applied} strokeWidth="2.5" strokeDasharray="6 5" />
        <text x={cutX} y={SCENE.ground + 22} textAnchor="middle" fill={FORCE_COLORS.applied} fontSize="13" fontWeight="700">
          cut
        </text>
        <text x={(cutX + sceneRight) / 2} y={SCENE.bottom + 36} textAnchor="middle" fill="var(--accent-blue)" fontSize="13" fontWeight="700">
          {Number(massAhead.toFixed(2))} kg ahead
        </text>

        {/* Drag anywhere along the blocks to move the cut. */}
        <rect
          x="0"
          y={SCENE.top - 28}
          width={VIEW.width}
          height={SCENE.ground - SCENE.top + 34}
          fill="transparent"
          style={{ cursor: 'ew-resize', touchAction: 'pan-y' }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            pickCut(event);
          }}
          onPointerMove={pickCut}
        />
        <circle cx={cutX} cy={SCENE.top - 24} r="6" fill={FORCE_COLORS.applied} pointerEvents="none" />

        {/* Drag the push arrow longer or shorter to change the force. */}
        <circle cx={pushTailX} cy={SCENE.nodeY} r="7" fill={FORCE_COLORS.applied} stroke="var(--bg-primary)" strokeWidth="2" pointerEvents="none" />
        <rect
          x="0"
          y={SCENE.nodeY - 18}
          width={faceX0}
          height="36"
          fill="transparent"
          style={{ cursor: 'ew-resize', touchAction: 'pan-y' }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            pickForce(event);
          }}
          onPointerMove={pickForce}
        />

        {/* Force through every spring against position along the stack. */}
        <line x1={PLOT.x} y1={PLOT.y + PLOT.height} x2={PLOT.x + PLOT.width} y2={PLOT.y + PLOT.height} stroke="var(--text-muted)" strokeWidth="1.5" />
        <line x1={PLOT.x} y1={PLOT.y} x2={PLOT.x} y2={PLOT.y + PLOT.height} stroke="var(--text-muted)" strokeWidth="1.5" />
        <text x={PLOT.x + PLOT.width} y={PLOT.y + 12} textAnchor="end" fill="var(--text-muted)" fontSize="12" fontWeight="600">
          force exerted by each spring
        </text>
        <text x={PLOT.x + PLOT.width} y={PLOT.y + PLOT.height + 34} textAnchor="end" fill="var(--text-muted)" fontSize="12" fontWeight="600">
          position along the stack
        </text>
        {contactSprings.map((index) => (
          <line key={index} x1={springX(index)} y1={PLOT.y + 18} x2={springX(index)} y2={PLOT.y + PLOT.height} stroke="var(--grid-line)" strokeWidth="1.5" strokeDasharray="3 5" />
        ))}
        {Array.from({ length: BLOCKS }, (_, block) => (
          <text
            key={block}
            x={restX(block * NODES + (NODES - 1) / 2)}
            y={PLOT.y + PLOT.height + 16}
            textAnchor="middle"
            fill="var(--text-muted)"
            fontSize="12"
            fontWeight="600"
          >
            block {block + 1}
          </text>
        ))}
        <polyline points={liveTrace} fill="none" stroke={FORCE_COLORS.spring} strokeWidth="2.5" strokeLinejoin="round" />
        {contactSprings.map((index) => (
          <g key={index}>
            <circle cx={springX(index)} cy={plotY(forces[index])} r="4.5" fill={FORCE_COLORS.spring} />
            <text
              x={springX(index) + 8}
              y={plotY(forces[index]) - 9}
              fill={FORCE_COLORS.spring}
              fontSize="13"
              fontWeight="700"
              paintOrder="stroke"
              stroke="var(--bg-primary)"
              strokeWidth="4"
            >
              {Math.round(forces[index])} N
            </text>
          </g>
        ))}
        <circle cx={springX(cut)} cy={plotY(forces[cut])} r="6" fill="none" stroke={FORCE_COLORS.applied} strokeWidth="2.5" />
      </svg>

      <p className="type-supporting m-0 text-center">
        Everything ahead of the cut is <strong>{Number(massAhead.toFixed(2))} kg</strong>. At <strong>{acceleration.toFixed(1)} m/s²</strong> it needs{' '}
        <strong>{predictedAtCut.toFixed(1)} N</strong>, and the spring at the cut is pushing with <strong>{Math.max(0, forces[cut]).toFixed(1)} N</strong>.
      </p>

      <ControlBar>
        <Slider
          label="stiffness"
          min={0}
          max={1}
          step={0.01}
          value={stiffnessPosition}
          onChange={setStiffnessPosition}
          format={(value) => formatMagnitude(logSliderToValue(value, STIFFNESS_RANGE.min, STIFFNESS_RANGE.max))}
        />
        <Button variant="secondary" onClick={restart}>
          Push again
        </Button>
      </ControlBar>
    </div>
  );
}
