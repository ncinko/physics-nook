import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import NewtSprite, { NEWT_MOUTH_OFFSET, NEWT_RADIUS } from './NewtSprite';
import { ForceArrow, FORCE_COLORS, type ForceVector } from './ForceArrow';
import { Button } from '../shared/InlineControls';
import {
  add,
  clamp,
  clampMagnitude,
  contactNormalForce,
  dot,
  frictionForce,
  gravityForce,
  hookeForce,
  integrateBody,
  magnitude,
  netForce,
  normalize,
  resolveWallBounce,
  scale,
  subtract,
  tongueTensionForce,
  type Bounds,
  type BodyState,
  type Vector2,
} from '../../lib/forces';

const VIEW = { width: 760, height: 360 };
const STAGE_BOUNDS = { left: 34, right: VIEW.width - 34, top: 34, bottom: VIEW.height - 34 };
const NORMAL_VIEW = { width: 820, height: 440 };
const NORMAL_MATTRESS_THICKNESS = 42;
const NORMAL_SURFACES = { left: 58, right: 762, top: 50, bottom: 386 };
const NORMAL_HARD_BOUNDS = {
  left: NORMAL_SURFACES.left - NORMAL_MATTRESS_THICKNESS,
  right: NORMAL_SURFACES.right + NORMAL_MATTRESS_THICKNESS,
  top: NORMAL_SURFACES.top - NORMAL_MATTRESS_THICKNESS,
  bottom: NORMAL_SURFACES.bottom + NORMAL_MATTRESS_THICKNESS,
};
const TENSION_VIEW = { width: 760, height: 440 };
const TENSION_BOUNDS = { left: 34, right: TENSION_VIEW.width - 34, top: 34, bottom: TENSION_VIEW.height - 34 };
const TENSION_DYNAMICS_FORCE_SCALE = 82;
const TENSION_PIXEL_GRAVITY = 620;
const TENSION_WEIGHT_ARROW_SCALE = 2.7;
const TENSION_REST_LENGTH = 200;
const TENSION_START = { x: 210, y: 292 };

interface TimedVector extends ForceVector {
  ttl: number;
}

interface ForcePanelProps {
  title: string;
  prompt: string;
  children: ReactNode;
  controls?: ReactNode;
}

interface RangeControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}

interface DragState {
  active: boolean;
  pointerId: number | null;
  lastPoint: Vector2;
  lastAt: number;
  velocity: Vector2;
}

const format = (value: number, digits = 1) => {
  const rounded = Number(value.toFixed(digits));
  return `${rounded}`;
};

const ForcePanel = ({ title, prompt, children, controls }: ForcePanelProps) => (
  <section className="not-prose my-8 select-none overflow-hidden rounded-xl border border-[var(--grid-line)] bg-[color:var(--sim-bg)] shadow-sm">
    <div className="flex flex-col gap-3 border-b border-[var(--grid-line)] bg-[color:var(--surface-elevated)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="m-0 text-base font-semibold text-[color:var(--text-primary)]">{title}</h3>
        <p className="mt-1 mb-0 text-sm leading-6 text-[color:var(--text-muted)]">{prompt}</p>
      </div>
      {controls && <div className="flex flex-wrap items-center gap-2">{controls}</div>}
    </div>
    <div className="bg-[radial-gradient(circle_at_18%_16%,rgba(59,130,246,0.1),transparent_28%),linear-gradient(180deg,color-mix(in_srgb,var(--sim-bg)_94%,white),var(--sim-bg))]">
      {children}
    </div>
  </section>
);

const RangeControl = ({ label, value, min, max, step, unit = '', onChange }: RangeControlProps) => (
  <label className="grid min-w-[9.5rem] gap-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
    <span className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="font-mono text-[color:var(--text-primary)]">
        {format(value, step < 1 ? 1 : 0)}
        {unit}
      </span>
    </span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
      className="w-full accent-[var(--accent-blue)]"
    />
  </label>
);

const Readout = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-[var(--grid-line)] bg-[color:color-mix(in_srgb,var(--surface-elevated)_88%,transparent)] px-3 py-2">
    <div className="text-[0.68rem] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">{label}</div>
    <div className="font-mono text-sm font-semibold text-[color:var(--text-primary)]">{value}</div>
  </div>
);

const getSvgPoint = (svg: SVGSVGElement, event: ReactPointerEvent<SVGSVGElement>): Vector2 => {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = svg.getScreenCTM();
  const transformed = matrix ? point.matrixTransform(matrix.inverse()) : point;
  return { x: transformed.x, y: transformed.y };
};

const emptyDragState = (): DragState => ({
  active: false,
  pointerId: null,
  lastPoint: { x: 0, y: 0 },
  lastAt: 0,
  velocity: { x: 0, y: 0 },
});

const updateDragVelocity = (drag: DragState, point: Vector2, now: number) => {
  const dt = Math.max((now - drag.lastAt) / 1000, 1 / 120);
  const rawVelocity = scale(subtract(point, drag.lastPoint), 1 / dt);
  drag.velocity = clampMagnitude(rawVelocity, 760);
  drag.lastPoint = point;
  drag.lastAt = now;
};

const clampPointToBounds = (point: Vector2, radius = NEWT_RADIUS, bounds = STAGE_BOUNDS): Vector2 => ({
  x: clamp(point.x, bounds.left + radius, bounds.right - radius),
  y: clamp(point.y, bounds.top + radius, bounds.bottom - radius),
});

const clampMouthToTongueLimit = (
  desiredNewt: Vector2,
  anchor: Vector2,
  restLength: number,
  maxStretch: number,
  bounds = STAGE_BOUNDS,
): Vector2 => {
  const desiredMouth = add(desiredNewt, NEWT_MOUTH_OFFSET);
  const fromAnchor = subtract(desiredMouth, anchor);
  const distance = magnitude(fromAnchor);
  const maxLength = restLength + maxStretch;

  if (distance <= maxLength || distance === 0) {
    return clampPointToBounds(desiredNewt, NEWT_RADIUS, bounds);
  }

  const constrainedMouth = add(anchor, scale(fromAnchor, maxLength / distance));
  return clampPointToBounds(subtract(constrainedMouth, NEWT_MOUTH_OFFSET), NEWT_RADIUS, bounds);
};

const springPath = (start: Vector2, end: Vector2, coils = 9, amplitude = 9) => {
  const delta = subtract(end, start);
  const length = magnitude(delta);

  if (length < 1) {
    return `M ${start.x} ${start.y}`;
  }

  const direction = scale(delta, 1 / length);
  const normal = { x: -direction.y, y: direction.x };
  const lead = Math.min(18, length * 0.18);
  const points: Vector2[] = [start, add(start, scale(direction, lead))];
  const innerLength = Math.max(0, length - lead * 2);
  const steps = Math.max(2, coils * 2);

  for (let index = 1; index < steps; index += 1) {
    const along = lead + (innerLength * index) / steps;
    const side = index % 2 === 0 ? -1 : 1;
    points.push(add(add(start, scale(direction, along)), scale(normal, amplitude * side)));
  }

  points.push(add(start, scale(direction, length - lead)), end);
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
};

const tonguePath = (start: Vector2, end: Vector2, slack = false) => {
  const delta = subtract(end, start);
  const length = magnitude(delta);

  if (length < 1) {
    return `M ${start.x} ${start.y}`;
  }

  const direction = scale(delta, 1 / length);
  const normal = { x: -direction.y, y: direction.x };
  const sag = slack ? Math.min(54, length * 0.22) : Math.min(12, length * 0.04);
  const bend = slack ? 18 : 6;
  const c1 = add(add(start, scale(delta, 0.32)), scale(normal, bend));
  const c2 = add(add(start, scale(delta, 0.68)), scale(normal, -bend));
  const c2Sag = add(c2, { x: 0, y: sag });

  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2Sag.x} ${c2Sag.y} ${end.x} ${end.y}`;
};

const TongueBandMarks = ({ start, end, count = 13 }: { start: Vector2; end: Vector2; count?: number }) => {
  const delta = subtract(end, start);
  const length = magnitude(delta);

  if (length < 1) {
    return null;
  }

  const direction = scale(delta, 1 / length);
  const normal = { x: -direction.y, y: direction.x };

  return (
    <g opacity="0.42">
      {Array.from({ length: count }, (_, index) => {
        const t = (index + 1) / (count + 1);
        const center = add(start, scale(delta, t));
        const half = 3.2;
        const p1 = add(center, scale(normal, half));
        const p2 = subtract(center, scale(normal, half));
        return (
          <line
            key={index}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke="#be185d"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
        );
      })}
    </g>
  );
};

const localMattressCompression = (coordinate: number, center: number, compression: number) => {
  const spread = 82;
  const falloff = Math.exp(-((coordinate - center) ** 2) / (2 * spread ** 2));
  return Math.min(38, compression * 4.2) * falloff;
};

const pointsPath = (points: Vector2[]) =>
  points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');

type WallSide = 'bottom' | 'top' | 'left' | 'right';

const wallNormal = (side: WallSide): Vector2 => {
  switch (side) {
    case 'left':
      return { x: 1, y: 0 };
    case 'right':
      return { x: -1, y: 0 };
    case 'top':
      return { x: 0, y: 1 };
    case 'bottom':
    default:
      return { x: 0, y: -1 };
  }
};

const wallOutward = (side: WallSide): Vector2 => scale(wallNormal(side), -1);

const wallCompressions = (position: Vector2, bounds: Bounds) => ({
  bottom: Math.max(0, position.y + NEWT_RADIUS - bounds.bottom),
  top: Math.max(0, bounds.top - (position.y - NEWT_RADIUS)),
  left: Math.max(0, bounds.left - (position.x - NEWT_RADIUS)),
  right: Math.max(0, position.x + NEWT_RADIUS - bounds.right),
});

const normalContactForces = (
  position: Vector2,
  velocity: Vector2,
  bounds: Bounds,
  stiffness: number,
  damping = 0,
) =>
  (Object.entries(wallCompressions(position, bounds)) as Array<[WallSide, number]>)
    .filter(([, compression]) => compression > 0)
    .map(([side, compression]) => {
      const normal = wallNormal(side);
      const spring = contactNormalForce(compression, normal, stiffness);
      const speedIntoSurface = Math.max(0, -dot(velocity, normal));
      return add(spring, scale(normal, speedIntoSurface * damping));
    });

const FlexibleWall = ({
  side,
  bounds,
  center,
  compression,
  thickness = NORMAL_MATTRESS_THICKNESS,
}: {
  side: WallSide;
  bounds: Bounds;
  center: number;
  compression: number;
  thickness?: number;
}) => {
  const horizontal = side === 'bottom' || side === 'top';
  const outward = wallOutward(side);
  const start = horizontal ? bounds.left : bounds.top;
  const end = horizontal ? bounds.right : bounds.bottom;
  const fixed = side === 'bottom' ? bounds.bottom : side === 'top' ? bounds.top : side === 'left' ? bounds.left : bounds.right;
  const segments = horizontal ? 27 : 15;
  const surfacePoints = Array.from({ length: segments }, (_, index) => {
    const coordinate = start + ((end - start) * index) / (segments - 1);
    const local = localMattressCompression(coordinate, center, compression);
    return horizontal
      ? { x: coordinate, y: fixed + outward.y * local }
      : { x: fixed + outward.x * local, y: coordinate };
  });
  const outerPoints = Array.from({ length: segments }, (_, index) => {
    const coordinate = end - ((end - start) * index) / (segments - 1);
    return horizontal
      ? { x: coordinate, y: fixed + outward.y * thickness }
      : { x: fixed + outward.x * thickness, y: coordinate };
  });
  const surfacePath = pointsPath(surfacePoints);
  const fillPath = `${surfacePath} ${outerPoints.map((point) => `L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')} Z`;
  const springCount = horizontal ? 19 : 9;

  return (
    <g>
      <path d={fillPath} fill="color-mix(in srgb, var(--grid-line) 34%, transparent)" stroke="var(--grid-line)" strokeWidth="2" />
      {Array.from({ length: springCount }, (_, index) => {
        const coordinate = start + 24 + ((end - start - 48) * index) / Math.max(1, springCount - 1);
        const local = localMattressCompression(coordinate, center, compression);
        const outer = horizontal
          ? { x: coordinate, y: fixed + outward.y * (thickness - 5) }
          : { x: fixed + outward.x * (thickness - 5), y: coordinate };
        const inner = horizontal
          ? { x: coordinate, y: fixed + outward.y * (local + 9) }
          : { x: fixed + outward.x * (local + 9), y: coordinate };
        return (
          <g key={index}>
            <path
              d={springPath(outer, inner, 5, 4.5)}
              fill="none"
              stroke={local > 1 ? '#0891b2' : '#94a3b8'}
              strokeWidth={local > 1 ? 2.4 : 1.8}
              strokeLinecap="round"
              opacity={0.48 + Math.min(local / 28, 0.42)}
            />
          </g>
        );
      })}
      <path d={surfacePath} fill="none" stroke="#334155" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.5" />
    </g>
  );
};

const Grid = ({ width = VIEW.width, height = VIEW.height }: { width?: number; height?: number }) => (
  <g opacity="0.55">
    {Array.from({ length: Math.ceil((width - 80) / 45) + 1 }, (_, index) => (
      <line
        key={`v-${index}`}
        x1={40 + index * 45}
        y1="28"
        x2={40 + index * 45}
        y2={height - 28}
        stroke="var(--grid-line)"
        strokeWidth="1"
      />
    ))}
    {Array.from({ length: Math.ceil((height - 96) / 44) + 1 }, (_, index) => (
      <line
        key={`h-${index}`}
        x1="28"
        y1={48 + index * 44}
        x2={width - 28}
        y2={48 + index * 44}
        stroke="var(--grid-line)"
        strokeWidth="1"
      />
    ))}
  </g>
);

export function ForceFreeNewt() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const bodyRef = useRef<BodyState>({
    position: { x: 380, y: 178 },
    velocity: { x: 92, y: -58 },
    angle: -8,
    angularVelocity: 34,
  });
  const vectorsRef = useRef<TimedVector[]>([]);
  const lastTimeRef = useRef<number | null>(null);
  const [snapshot, setSnapshot] = useState(bodyRef.current);
  const [vectors, setVectors] = useState<TimedVector[]>([]);

  useEffect(() => {
    let frame = 0;

    const tick = (time: number) => {
      const last = lastTimeRef.current ?? time;
      const dt = Math.min((time - last) / 1000, 0.033);
      lastTimeRef.current = time;

      const advanced = integrateBody(bodyRef.current, { x: 0, y: 0 }, 1, dt);
      const bounced = resolveWallBounce(advanced, NEWT_RADIUS, STAGE_BOUNDS, 0.88);
      bodyRef.current = {
        ...bounced.state,
        angularVelocity: (advanced.angularVelocity ?? 0) * 0.999,
      };

      if (bounced.impulses.length > 0) {
        vectorsRef.current = [
          ...vectorsRef.current,
          ...bounced.impulses.map((impulse, index) => ({
            id: `wall-${time}-${index}`,
            origin: bodyRef.current.position,
            vector: scale(impulse.impulse, 0.8),
            color: FORCE_COLORS.contact,
            label: 'wall force',
            ttl: 0.48,
            scale: 0.65,
          })),
        ];
      }

      vectorsRef.current = vectorsRef.current
        .map((vector) => ({ ...vector, ttl: vector.ttl - dt }))
        .filter((vector) => vector.ttl > 0);

      setSnapshot(bodyRef.current);
      setVectors(vectorsRef.current);

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frame);
  }, []);

  const knockNewt = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }

    const point = getSvgPoint(svg, event);
    const fromClick = subtract(bodyRef.current.position, point);
    const direction = normalize(fromClick, { x: 1, y: -0.2 });
    const hitOffset = clampMagnitude(subtract(point, bodyRef.current.position), NEWT_RADIUS);
    const tangent = { x: -direction.y, y: direction.x };
    const tangentSign = Math.sign(hitOffset.x * 0.9 - hitOffset.y * 0.35) || 1;
    const impulse = add(scale(direction, 170), scale(tangent, tangentSign * 18));
    const torqueKick = (hitOffset.x * impulse.y - hitOffset.y * impulse.x) * 0.014;
    bodyRef.current = {
      ...bodyRef.current,
      velocity: add(bodyRef.current.velocity, impulse),
      angularVelocity: clamp((bodyRef.current.angularVelocity ?? 0) + torqueKick, -260, 260),
    };
    vectorsRef.current = [
      ...vectorsRef.current,
      {
        id: `knock-${Date.now()}`,
        origin: bodyRef.current.position,
        vector: impulse,
        color: FORCE_COLORS.applied,
        label: 'applied knock',
        ttl: 0.55,
        scale: 0.55,
      },
    ];
  };

  return (
    <ForcePanel
      title="Force-Free Newt"
      prompt="Tap anywhere to give Newt a short knock."
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        role="img"
        aria-label="Newt floating in a force-free box"
        className="block h-auto w-full touch-none select-none"
        onPointerDown={knockNewt}
      >
        <rect x="22" y="22" width="716" height="316" rx="18" fill="transparent" stroke="var(--grid-line)" strokeWidth="2" />
        <Grid />

        <NewtSprite
          x={snapshot.position.x}
          y={snapshot.position.y}
          angle={snapshot.angle ?? 0}
          scale={1}
        />
        {vectors.map((vector) => (
          <ForceArrow key={vector.id} {...vector} opacity={clamp(vector.ttl / 0.35, 0.2, 1)} />
        ))}
      </svg>
    </ForcePanel>
  );
}

export function SpringForceNewt() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const bodyRef = useRef<BodyState>({
    position: { x: 475, y: 192 },
    velocity: { x: 0, y: 0 },
    angle: 0,
    angularVelocity: 0,
  });
  const dragRef = useRef<DragState>(emptyDragState());
  const lastTimeRef = useRef<number | null>(null);
  const [body, setBody] = useState(bodyRef.current);
  const [stiffness, setStiffness] = useState(0.42);
  const equilibrium = { x: 390, y: 192 };
  const anchor = { x: 118, y: equilibrium.y };
  const displacement = body.position.x - equilibrium.x;
  const newt = { x: body.position.x, y: equilibrium.y };
  const force = hookeForce({ x: displacement, y: 0 }, stiffness);

  useEffect(() => {
    let frame = 0;

    const tick = (time: number) => {
      const last = lastTimeRef.current ?? time;
      const dt = Math.min((time - last) / 1000, 0.033);
      lastTimeRef.current = time;

      if (!dragRef.current.active) {
        const currentDisplacement = bodyRef.current.position.x - equilibrium.x;
        const acceleration = -stiffness * 7.4 * currentDisplacement - bodyRef.current.velocity.x * 1.35;
        const velocityX = bodyRef.current.velocity.x + acceleration * dt;
        const positionX = clamp(bodyRef.current.position.x + velocityX * dt, equilibrium.x - 190, equilibrium.x + 190);
        const hitLimit = positionX === equilibrium.x - 190 || positionX === equilibrium.x + 190;

        bodyRef.current = {
          position: { x: positionX, y: equilibrium.y },
          velocity: { x: hitLimit ? -velocityX * 0.35 : velocityX, y: 0 },
          angle: clamp(currentDisplacement * 0.07 + velocityX * 0.018, -18, 18),
          angularVelocity: 0,
        };
        setBody(bodyRef.current);
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frame);
  }, [stiffness]);

  const updateFromPointer = (event: ReactPointerEvent<SVGSVGElement>, trackVelocity: boolean) => {
    const svg = svgRef.current;
    if (!svg || !dragRef.current.active) {
      return;
    }

    const point = getSvgPoint(svg, event);
    const now = performance.now();
    const nextPosition = {
      x: clamp(point.x, equilibrium.x - 190, equilibrium.x + 190),
      y: equilibrium.y,
    };

    if (trackVelocity) {
      updateDragVelocity(dragRef.current, nextPosition, now);
    }

    bodyRef.current = {
      position: nextPosition,
      velocity: { x: 0, y: 0 },
      angle: clamp((nextPosition.x - equilibrium.x) * 0.07, -18, 18),
      angularVelocity: 0,
    };
    setBody(bodyRef.current);
  };

  return (
    <ForcePanel
      title="Spring-Like Force"
      prompt="Drag Newt, then release. The spring force always redirects Newt's motion toward the relaxed position."
      controls={
        <>
          <RangeControl
            label="stiffness"
            value={stiffness}
            min={0.15}
            max={0.8}
            step={0.05}
            unit=" k"
            onChange={setStiffness}
          />
        </>
      }
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        role="img"
        aria-label="Newt attached to a spring"
        className="block h-auto w-full touch-none select-none cursor-grab active:cursor-grabbing"
        onPointerDown={(event) => {
          const point = getSvgPoint(event.currentTarget, event);
          const nextPosition = {
            x: clamp(point.x, equilibrium.x - 190, equilibrium.x + 190),
            y: equilibrium.y,
          };
          dragRef.current = {
            active: true,
            pointerId: event.pointerId,
            lastPoint: nextPosition,
            lastAt: performance.now(),
            velocity: { x: 0, y: 0 },
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromPointer(event, false);
        }}
        onPointerMove={(event) => updateFromPointer(event, true)}
        onPointerUp={(event) => {
          if (dragRef.current.active) {
            bodyRef.current = {
              ...bodyRef.current,
              velocity: { x: dragRef.current.velocity.x, y: 0 },
            };
            setBody(bodyRef.current);
          }
          dragRef.current = emptyDragState();
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          dragRef.current = emptyDragState();
        }}
      >
        <rect x="44" y="76" width="58" height="168" rx="10" fill="color-mix(in srgb, var(--grid-line) 48%, transparent)" />
        <line x1={equilibrium.x} y1="86" x2={equilibrium.x} y2="276" stroke="var(--grid-line)" strokeDasharray="8 8" strokeWidth="2" />
        <text x={equilibrium.x + 10} y="106" fill="var(--text-muted)" fontSize="13" fontWeight="700">
          relaxed
        </text>
        <path d={springPath(anchor, { x: newt.x - 34, y: newt.y }, 13, 11)} fill="none" stroke={FORCE_COLORS.spring} strokeWidth="5" strokeLinecap="round" />
        <line x1="78" y1={equilibrium.y - 72} x2="78" y2={equilibrium.y + 72} stroke="var(--text-muted)" strokeWidth="5" strokeLinecap="round" />
        <NewtSprite x={newt.x} y={newt.y} angle={body.angle ?? 0} />
        <ForceArrow
          origin={{ x: newt.x, y: newt.y - 48 }}
          vector={force}
          color={FORCE_COLORS.spring}
          label="spring force"
          scale={2.2}
          maxLength={112}
        />
        <g>
          <line x1={equilibrium.x} y1="292" x2={newt.x} y2="292" stroke="var(--text-muted)" strokeWidth="2" strokeDasharray="5 6" />
          <text x={(equilibrium.x + newt.x) / 2} y="316" fill="var(--text-muted)" fontSize="14" fontWeight="700" textAnchor="middle">
            x = {format(displacement, 0)} px
          </text>
        </g>
        <foreignObject x="515" y="42" width="190" height="120">
          <div className="grid gap-2">
          </div>
        </foreignObject>
      </svg>
    </ForcePanel>
  );
}

export function NormalForceNewt() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const bodyRef = useRef<BodyState>({
    position: { x: 410, y: NORMAL_SURFACES.bottom - NEWT_RADIUS },
    velocity: { x: 0, y: 0 },
    angle: 0,
    angularVelocity: 0,
  });
  const dragRef = useRef<DragState>(emptyDragState());
  const lastTimeRef = useRef<number | null>(null);
  const [body, setBody] = useState(bodyRef.current);
  const [mass, setMass] = useState(2.2);
  const [stiffness, setStiffness] = useState(90);
  const compressions = wallCompressions(body.position, NORMAL_SURFACES);
  const maxCompression = Math.max(compressions.bottom, compressions.top, compressions.left, compressions.right);
  const weight = gravityForce(mass, 9.8);
  const normal = netForce(normalContactForces(body.position, { x: 0, y: 0 }, NORMAL_SURFACES, stiffness * 0.12));
  const newt = body.position;

  useEffect(() => {
    let frame = 0;

    const tick = (time: number) => {
      const last = lastTimeRef.current ?? time;
      const dt = Math.min((time - last) / 1000, 0.033);
      lastTimeRef.current = time;

      if (!dragRef.current.active) {
        const currentCompressions = wallCompressions(bodyRef.current.position, NORMAL_SURFACES);
        const activeContact = Object.values(currentCompressions).some((compression) => compression > 0);
        const bottomContact = currentCompressions.bottom > 0;
        const gravity = { x: 0, y: mass * 680 };
        const contacts = normalContactForces(bodyRef.current.position, bodyRef.current.velocity, NORMAL_SURFACES, stiffness * 8, 18);
        const wallDamping = activeContact ? 0.988 : 0.999;
        const force = netForce([gravity, ...contacts]);
        const advanced = integrateBody(bodyRef.current, force, mass, dt);
        let next = resolveWallBounce(advanced, NEWT_RADIUS, NORMAL_HARD_BOUNDS, 0.22).state;
        next = {
          ...next,
          velocity: {
            x: next.velocity.x * wallDamping,
            y: Math.abs(next.velocity.y) < 4 && bottomContact ? 0 : next.velocity.y,
          },
          angle: clamp(next.velocity.x * 0.04, -14, 14),
        };
        bodyRef.current = next;
        setBody(bodyRef.current);
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frame);
  }, [mass, stiffness]);

  const updateFromPointer = (event: ReactPointerEvent<SVGSVGElement>, trackVelocity: boolean) => {
    const svg = svgRef.current;
    if (!svg || !dragRef.current.active) {
      return;
    }

    const point = clampPointToBounds(getSvgPoint(svg, event), NEWT_RADIUS, NORMAL_HARD_BOUNDS);
    const now = performance.now();

    if (trackVelocity) {
      updateDragVelocity(dragRef.current, point, now);
    }

    bodyRef.current = {
      position: point,
      velocity: { x: 0, y: 0 },
      angle: clamp((point.x - dragRef.current.lastPoint.x) * 0.2, -15, 15),
      angularVelocity: 0,
    };
    setBody(bodyRef.current);
  };

  return (
    <ForcePanel
      title="Normal Force From Microscopic Springs"
      prompt="Drag Newt around the springy room, then release. Each wall compresses locally and pushes perpendicular to its surface."
      controls={
        <>
          <RangeControl label="mass" value={mass} min={1} max={4} step={0.1} unit=" kg" onChange={setMass} />
          <RangeControl label="surface k" value={stiffness} min={55} max={150} step={5} onChange={setStiffness} />
        </>
      }
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${NORMAL_VIEW.width} ${NORMAL_VIEW.height}`}
        role="img"
        aria-label="Normal force as microscopic compression"
        className="block h-auto w-full touch-none select-none cursor-grab active:cursor-grabbing"
        onPointerDown={(event) => {
          const point = clampPointToBounds(getSvgPoint(event.currentTarget, event), NEWT_RADIUS, NORMAL_HARD_BOUNDS);
          dragRef.current = {
            active: true,
            pointerId: event.pointerId,
            lastPoint: point,
            lastAt: performance.now(),
            velocity: { x: 0, y: 0 },
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromPointer(event, false);
        }}
        onPointerMove={(event) => updateFromPointer(event, true)}
        onPointerUp={(event) => {
          if (dragRef.current.active) {
            bodyRef.current = {
              ...bodyRef.current,
              velocity: dragRef.current.velocity,
            };
            setBody(bodyRef.current);
          }
          dragRef.current = emptyDragState();
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          dragRef.current = emptyDragState();
        }}
      >
        <Grid width={NORMAL_VIEW.width} height={NORMAL_VIEW.height} />
        <FlexibleWall side="bottom" bounds={NORMAL_SURFACES} center={newt.x} compression={compressions.bottom} />
        <FlexibleWall side="top" bounds={NORMAL_SURFACES} center={newt.x} compression={compressions.top} />
        <FlexibleWall side="left" bounds={NORMAL_SURFACES} center={newt.y} compression={compressions.left} />
        <FlexibleWall side="right" bounds={NORMAL_SURFACES} center={newt.y} compression={compressions.right} />
        <NewtSprite x={newt.x} y={newt.y} angle={body.angle ?? 0} />
        <ForceArrow origin={{ x: newt.x - 42, y: newt.y }} vector={weight} color={FORCE_COLORS.gravity} label="weight" scale={3.3} maxLength={90} labelBounds={NORMAL_VIEW} />
        <ForceArrow origin={{ x: newt.x + 42, y: newt.y }} vector={normal} color={FORCE_COLORS.normal} label="normal" scale={3.3} maxLength={90} labelBounds={NORMAL_VIEW} />


      </svg>
    </ForcePanel>
  );
}

export function TongueTensionNewt() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const bodyRef = useRef<BodyState>({
    position: TENSION_START,
    velocity: { x: 0, y: 0 },
    angle: 0,
    angularVelocity: 0,
  });
  const dragRef = useRef<DragState>(emptyDragState());
  const lastTimeRef = useRef<number | null>(null);
  const [body, setBody] = useState(bodyRef.current);
  const [stiffness, setStiffness] = useState(0.7);
  const restLength = TENSION_REST_LENGTH;
  const anchor = { x: 210, y: 78 };
  const maxTongueStretch = 24;
  const newt = body.position;
  const mouth = add(newt, NEWT_MOUTH_OFFSET);
  const tension = tongueTensionForce(mouth, anchor, restLength, stiffness);
  const displayedTension = tongueTensionForce(mouth, anchor, restLength, stiffness * TENSION_DYNAMICS_FORCE_SCALE);
  const gravity = gravityForce(2, 9.8);
  const tensionArrowScale = (magnitude(gravity) * TENSION_WEIGHT_ARROW_SCALE) / (2 * TENSION_PIXEL_GRAVITY);
  const tongueDirection = normalize(subtract(anchor, mouth), { x: -1, y: 0 });
  const tongueJoin = add(mouth, scale(tongueDirection, 20));
  const tongueMouthAngle =
    (Math.atan2(anchor.y - mouth.y, anchor.x - mouth.x) * 180) / Math.PI - (body.angle ?? 0);

  useEffect(() => {
    let frame = 0;

    const tick = (time: number) => {
      const last = lastTimeRef.current ?? time;
      const dt = Math.min((time - last) / 1000, 0.033);
      lastTimeRef.current = time;

      if (!dragRef.current.active) {
        const currentMouth = add(bodyRef.current.position, NEWT_MOUTH_OFFSET);
        const currentTension = tongueTensionForce(currentMouth, anchor, restLength, stiffness * TENSION_DYNAMICS_FORCE_SCALE);
        const gravityForcePx = { x: 0, y: 2 * TENSION_PIXEL_GRAVITY };
        const damping = scale(bodyRef.current.velocity, -0.75);
        const force = netForce([currentTension.force, gravityForcePx, damping]);
        let next = integrateBody(bodyRef.current, force, 2, dt);
        next = resolveWallBounce(next, NEWT_RADIUS, TENSION_BOUNDS, 0.35).state;

        const mouthAfterStep = add(next.position, NEWT_MOUTH_OFFSET);
        const fromAnchor = subtract(mouthAfterStep, anchor);
        const distance = magnitude(fromAnchor);
        const maxLength = restLength + maxTongueStretch;

        if (distance > maxLength && distance > 0) {
          const radial = scale(fromAnchor, 1 / distance);
          const constrainedMouth = add(anchor, scale(radial, maxLength));
          const outwardSpeed = Math.max(0, next.velocity.x * radial.x + next.velocity.y * radial.y);
          next = {
            ...next,
            position: subtract(constrainedMouth, NEWT_MOUTH_OFFSET),
            velocity: subtract(next.velocity, scale(radial, outwardSpeed * 1.08)),
          };
        }

        next = {
          ...next,
          angle: clamp(next.velocity.x * 0.035 + next.velocity.y * 0.012, -20, 20),
        };
        bodyRef.current = next;
        setBody(bodyRef.current);
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frame);
  }, [stiffness]);

  const updateFromPointer = (event: ReactPointerEvent<SVGSVGElement>, trackVelocity: boolean) => {
    const svg = svgRef.current;
    if (!svg || !dragRef.current.active) {
      return;
    }

    const point = clampMouthToTongueLimit(getSvgPoint(svg, event), anchor, restLength, maxTongueStretch, TENSION_BOUNDS);
    const now = performance.now();

    if (trackVelocity) {
      updateDragVelocity(dragRef.current, point, now);
    }

    bodyRef.current = {
      position: point,
      velocity: { x: 0, y: 0 },
      angle: clamp((point.x - dragRef.current.lastPoint.x) * 0.16, -18, 18),
      angularVelocity: 0,
    };
    setBody(bodyRef.current);
  };

  return (
    <ForcePanel
      title="Tension Through Newt's Tongue"
      prompt="Drag Newt and release. His tongue swings like a rope made from tiny stretched spring-like segments."
      controls={
        <>
          <RangeControl label="tongue k" value={stiffness} min={0.35} max={1.25} step={0.05} onChange={setStiffness} />
        </>
      }
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${TENSION_VIEW.width} ${TENSION_VIEW.height}`}
        role="img"
        aria-label="Newt using his tongue as a tension rope"
        className="block h-auto w-full touch-none select-none cursor-grab active:cursor-grabbing"
        onPointerDown={(event) => {
          const point = clampMouthToTongueLimit(
            getSvgPoint(event.currentTarget, event),
            anchor,
            restLength,
            maxTongueStretch,
            TENSION_BOUNDS,
          );
          dragRef.current = {
            active: true,
            pointerId: event.pointerId,
            lastPoint: point,
            lastAt: performance.now(),
            velocity: { x: 0, y: 0 },
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromPointer(event, false);
        }}
        onPointerMove={(event) => updateFromPointer(event, true)}
        onPointerUp={(event) => {
          if (dragRef.current.active) {
            bodyRef.current = {
              ...bodyRef.current,
              velocity: dragRef.current.velocity,
            };
            setBody(bodyRef.current);
          }
          dragRef.current = emptyDragState();
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          dragRef.current = emptyDragState();
        }}
      >
        <Grid width={TENSION_VIEW.width} height={TENSION_VIEW.height} />
        <circle cx={anchor.x} cy={anchor.y} r="16" fill="#f59e0b" stroke="#92400e" strokeWidth="3" />
        <circle cx={anchor.x} cy={anchor.y} r={restLength} fill="none" stroke="var(--grid-line)" strokeDasharray="7 8" strokeWidth="2" />
        <text x={anchor.x + 22} y={anchor.y - 18} fill="var(--text-muted)" fontSize="13" fontWeight="700">
          anchor
        </text>
        <path
          d={tonguePath(anchor, tongueJoin, !tension.taut)}
          fill="none"
          stroke="#f9a8d4"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={tension.taut ? 10 : 8}
        />
        <path
          d={tonguePath(anchor, tongueJoin, !tension.taut)}
          fill="none"
          stroke="#ec4899"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={tension.taut ? 5 : 4}
          opacity={tension.taut ? 0.9 : 0.72}
        />
        {tension.taut && <TongueBandMarks start={anchor} end={tongueJoin} />}
        <circle cx={anchor.x} cy={anchor.y} r="6.5" fill="#f9a8d4" stroke="#be185d" strokeWidth="1.5" />
        <NewtSprite x={newt.x} y={newt.y} angle={body.angle ?? 0}>
          <g transform={`translate(${NEWT_MOUTH_OFFSET.x} ${NEWT_MOUTH_OFFSET.y}) rotate(${tongueMouthAngle})`}>
            <path
              d="M 0 0 C 6 -1.5 14 -1.5 21 0"
              fill="none"
              stroke="#ec4899"
              strokeLinecap="round"
              strokeWidth="5.5"
              opacity="0.86"
            />
            <ellipse cx="1.5" cy="0" rx="4" ry="2.5" fill="#be185d" opacity="0.55" />
          </g>
        </NewtSprite>
        <ForceArrow origin={mouth} vector={displayedTension.force} color={FORCE_COLORS.spring} label="tension" scale={tensionArrowScale} maxLength={76} />
        <ForceArrow origin={{ x: newt.x - 42, y: newt.y + 6 }} vector={gravity} color={FORCE_COLORS.gravity} label="weight" scale={TENSION_WEIGHT_ARROW_SCALE} maxLength={76} />
        <foreignObject x="540" y="42" width="170" height="124">
          <div className="grid gap-2">
            <Readout label="stretch" value={`${format(tension.stretch, 0)} px`} />
            <Readout label="state" value={tension.taut ? 'taut' : 'slack'} />
          </div>
        </foreignObject>
      </svg>
    </ForcePanel>
  );
}

export function GravityForceNewt() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState>(emptyDragState());
  const vectorsRef = useRef<TimedVector[]>([]);
  const bodyRef = useRef<BodyState>({
    position: { x: 190, y: 120 },
    velocity: { x: 118, y: -24 },
    angle: 6,
    angularVelocity: 30,
  });
  const lastTimeRef = useRef<number | null>(null);
  const [snapshot, setSnapshot] = useState(bodyRef.current);
  const [vectors, setVectors] = useState<TimedVector[]>([]);
  const [g, setG] = useState(9.8);

  useEffect(() => {
    let frame = 0;

    const tick = (time: number) => {
      const last = lastTimeRef.current ?? time;
      const dt = Math.min((time - last) / 1000, 0.033);
      lastTimeRef.current = time;

      if (!dragRef.current.active) {
        const force = gravityForce(1, g * 30);
        const advanced = integrateBody(bodyRef.current, force, 1, dt);
        const bounced = resolveWallBounce(advanced, NEWT_RADIUS, STAGE_BOUNDS, 0.48);
        const bottomContact = bounced.impulses.some((impulse) => impulse.normal.y < 0);
        const restingOnGround = bottomContact && Math.abs(bounced.state.velocity.y) < 18;
        const nextVelocity = {
          x: bounced.state.velocity.x * (restingOnGround ? 0.94 : 0.995),
          y: restingOnGround && Math.abs(bounced.state.velocity.y) < 10 ? 0 : bounced.state.velocity.y,
        };
        let nextAngle = bounced.state.angle ?? 0;
        let nextAngularVelocity = (bounced.state.angularVelocity ?? 0) * (restingOnGround ? 0.78 : 0.995);

        if (restingOnGround) {
          nextAngle *= 0.88;
          if (Math.abs(nextAngularVelocity) < 2) {
            nextAngularVelocity = 0;
          }
          if (Math.abs(nextAngle) < 0.8 && nextAngularVelocity === 0) {
            nextAngle = 0;
          }
        }

        bodyRef.current = {
          ...bounced.state,
          velocity: nextVelocity,
          angle: nextAngle,
          angularVelocity: nextAngularVelocity,
        };

        if (bounced.impulses.length > 0) {
          const visibleImpulses = bounced.impulses.filter((impulse) => magnitude(impulse.impulse) > 22);
          vectorsRef.current = [
            ...vectorsRef.current,
            ...visibleImpulses.map((impulse, index) => ({
              id: `gravity-wall-${time}-${index}`,
              origin: bodyRef.current.position,
              vector: scale(impulse.impulse, 0.8),
              color: FORCE_COLORS.contact,
              label: 'wall force',
              ttl: 0.42,
              scale: 0.65,
            })),
          ].slice(-5);
        }

        vectorsRef.current = vectorsRef.current
          .map((vector) => ({ ...vector, ttl: vector.ttl - dt }))
          .filter((vector) => vector.ttl > 0);

        setSnapshot(bodyRef.current);
        setVectors(vectorsRef.current);
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frame);
  }, [g]);

  const updateFromPointer = (event: ReactPointerEvent<SVGSVGElement>, trackVelocity: boolean) => {
    const svg = svgRef.current;
    if (!svg || !dragRef.current.active) {
      return;
    }

    const point = getSvgPoint(svg, event);
    const nextPosition = clampPointToBounds(point);
    const now = performance.now();

    if (trackVelocity) {
      updateDragVelocity(dragRef.current, nextPosition, now);
    }

    bodyRef.current = {
      ...bodyRef.current,
      position: nextPosition,
      velocity: { x: 0, y: 0 },
      angle: clamp((nextPosition.x - dragRef.current.lastPoint.x) * 0.16, -18, 18),
      angularVelocity: 0,
    };
    setSnapshot(bodyRef.current);
  };
  const groundedSupport =
    snapshot.position.y + NEWT_RADIUS >= STAGE_BOUNDS.bottom - 0.75 &&
    Math.abs(snapshot.velocity.y) < 2 &&
    !dragRef.current.active;

  return (
    <ForcePanel
      title="Gravity As a Downward Force"
      prompt="Drag Newt and release."
      controls={
        <>
          <RangeControl label="g" value={g} min={1.6} max={16} step={0.2} unit=" m/s2" onChange={setG} />
        </>
      }
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        role="img"
        aria-label="Newt moving under gravity"
        className="block h-auto w-full touch-none select-none cursor-grab active:cursor-grabbing"
        onPointerDown={(event) => {
          const point = clampPointToBounds(getSvgPoint(event.currentTarget, event));
          dragRef.current = {
            active: true,
            pointerId: event.pointerId,
            lastPoint: point,
            lastAt: performance.now(),
            velocity: { x: 0, y: 0 },
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromPointer(event, false);
        }}
        onPointerMove={(event) => updateFromPointer(event, true)}
        onPointerUp={(event) => {
          if (dragRef.current.active) {
            bodyRef.current = {
              ...bodyRef.current,
              velocity: dragRef.current.velocity,
              angularVelocity: clamp(dragRef.current.velocity.x * 0.42, -190, 190),
            };
            setSnapshot(bodyRef.current);
          }
          dragRef.current = emptyDragState();
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          dragRef.current = emptyDragState();
        }}
      >
        <Grid />
        <rect x="34" y="34" width="692" height="292" rx="16" fill="transparent" stroke="var(--grid-line)" strokeWidth="2" />
        <NewtSprite x={snapshot.position.x} y={snapshot.position.y} angle={snapshot.angle ?? 0} />
        <ForceArrow origin={{ x: snapshot.position.x + 42, y: snapshot.position.y }} vector={{ x: 0, y: g }} color={FORCE_COLORS.gravity} label="weight" scale={8} maxLength={92} />
        {groundedSupport && (
          <ForceArrow
            origin={{ x: snapshot.position.x - 42, y: snapshot.position.y }}
            vector={{ x: 0, y: -g }}
            color={FORCE_COLORS.contact}
            label="wall force"
            scale={8}
            maxLength={92}
          />
        )}
        {vectors.map((vector) => (
          <ForceArrow key={vector.id} {...vector} opacity={clamp(vector.ttl / 0.3, 0.2, 1)} />
        ))}
      </svg>
    </ForcePanel>
  );
}

// The friction demo runs taller than the other panels: the track on top, and
// below it the same four forces laid out tip to tail, so "net force" reads as
// the sum of the arrows rather than a fifth arrow that appeared from nowhere.
const FRICTION_VIEW = { width: 760, height: 540 };
const FRICTION_SCENE_HEIGHT = 336;
// One scale for every arrow in the sum, or the addition would be a lie.
const SUM_SCALE = 2.8;
const SUM_ORIGIN = { x: 340, y: 430 };
const SUM_NET_Y = 388;
// How far apart the two vertical arrows need to sit before their 4px bodies
// stop covering each other.
const SUM_MIN_SEPARATION = 11;

export function FrictionForceNewt() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const bodyRef = useRef({ x: 380, vx: 0 });
  const pointerHeldRef = useRef(false);
  const lastTimeRef = useRef<number | null>(null);
  const [body, setBody] = useState(bodyRef.current);
  const [pushStrength, setPushStrength] = useState(9);
  const [pushDirection, setPushDirection] = useState(0);
  const [roughness, setRoughness] = useState(0.45);
  const [paused, setPaused] = useState(false);
  const mass = 2;
  const applied = pushDirection * pushStrength;
  const weight = gravityForce(mass, 9.8);
  const normalMagnitude = magnitude(weight);
  const normal = { x: 0, y: -magnitude(weight) };
  const appliedForce = { x: applied, y: 0 };
  const friction = frictionForce({
    normalMagnitude,
    velocity: { x: body.vx, y: 0 },
    appliedForce,
    muStatic: roughness + 0.12,
    muKinetic: roughness,
    restSpeedThreshold: 2,
  });
  const total = netForce([appliedForce, friction.force]);
  const newtY = 238;

  useEffect(() => {
    let frame = 0;

    const tick = (time: number) => {
      const last = lastTimeRef.current ?? time;
      const dt = Math.min((time - last) / 1000, 0.033);
      lastTimeRef.current = time;

      if (!paused) {
        const currentFriction = frictionForce({
          normalMagnitude,
          velocity: { x: bodyRef.current.vx, y: 0 },
          appliedForce: { x: applied, y: 0 },
          muStatic: roughness + 0.12,
          muKinetic: roughness,
          restSpeedThreshold: 2,
        });
        const horizontalForce = applied + currentFriction.force.x;
        let vx = bodyRef.current.vx;
        let x = bodyRef.current.x;

        if (currentFriction.mode === 'static') {
          vx = 0;
        } else {
          vx += (horizontalForce / mass) * 42 * dt;
          if (Math.abs(vx) < 0.15 && Math.abs(applied) < 0.2) {
            vx = 0;
          }
          x += vx * dt;
        }

        if (x < 95 || x > 665) {
          x = clamp(x, 95, 665);
          vx *= -0.36;
        }

        bodyRef.current = { x, vx };
        setBody(bodyRef.current);
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frame);
  }, [applied, normalMagnitude, paused, roughness]);

  useEffect(() => {
    if (!paused && !pointerHeldRef.current) {
      setPushDirection(0);
    }
  }, [paused]);

  // Space toggles the pause, but only while this panel is on screen and only
  // when the key is not already doing something for a focused control.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ') {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) {
        return;
      }

      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) {
        return;
      }

      event.preventDefault();
      setPaused((value) => !value);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Press and hold on the side you want Newt pushed toward. Letting go removes
  // the force -- the point being that the push is something someone is doing,
  // not a property Newt carries around.
  const beginPush = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }

    const point = getSvgPoint(svg, event);
    pointerHeldRef.current = true;
    setPushDirection(point.x < bodyRef.current.x ? -1 : 1);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const endPush = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointerHeldRef.current = false;
    // Letting go while paused keeps the push on the frozen diagram -- you have
    // to release the pointer to reach the pause control, and the whole point of
    // pausing is to study all four forces at once.
    if (!paused) {
      setPushDirection(0);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // Tip to tail, ordered weight, applied, normal, friction, so the four arrows
  // trace the four sides of a rectangle rather than doubling back along one
  // another. The resultant runs on its own line above the rectangle, tied to
  // the ends of the chain by dashed guides, because along the chain it would
  // lie on top of the friction arrow.
  const sumStep = (from: Vector2, vector: Vector2) => add(from, scale(vector, SUM_SCALE));
  const afterWeight = sumStep(SUM_ORIGIN, weight);
  const afterApplied = sumStep(afterWeight, appliedForce);
  const afterNormal = sumStep(afterApplied, normal);
  const afterFriction = sumStep(afterNormal, friction.force);
  // Only the applied force separates the two vertical arrows, so with little or
  // no push they land on top of each other -- whether Newt is at rest or
  // coasting on kinetic friction alone. Nudge just the drawn arrows apart by
  // the few pixels their bodies need; every vertex, and so the resultant and
  // its guides, stays exactly where the arithmetic puts it.
  const nudge = Math.max(0, SUM_MIN_SEPARATION - Math.abs(applied) * SUM_SCALE) / 2;
  const nudgeSign = applied < 0 ? -1 : 1;
  const weightStart = { x: SUM_ORIGIN.x - nudgeSign * nudge, y: SUM_ORIGIN.y };
  const normalStart = { x: afterApplied.x + nudgeSign * nudge, y: afterApplied.y };
  const netLength = Math.abs(total.x);
  const netVisible = netLength > 0.05;

  return (
    <ForcePanel
      title="Friction and the Net Force"
      prompt="Press and hold to the side you want Newt pushed toward. Static friction can exactly cancel a small push; kinetic friction opposes sliding."
      controls={
        <>
          <RangeControl label="push" value={pushStrength} min={0} max={18} step={1} unit=" N" onChange={setPushStrength} />
          <RangeControl label="roughness" value={roughness} min={0.08} max={0.8} step={0.02} onChange={setRoughness} />
          <Button variant="secondary" onClick={() => setPaused((value) => !value)} aria-pressed={paused}>
            {paused ? 'Play' : 'Pause'}
          </Button>
        </>
      }
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${FRICTION_VIEW.width} ${FRICTION_VIEW.height}`}
        role="img"
        aria-label="Friction force diagram with Newt, and the same forces added tip to tail below"
        className="block h-auto w-full cursor-pointer touch-none select-none"
        onPointerDown={beginPush}
        onPointerUp={endPush}
        onPointerCancel={endPush}
      >
        <Grid height={FRICTION_SCENE_HEIGHT} />
        <rect x="74" y="268" width="612" height="28" rx="8" fill="color-mix(in srgb, var(--grid-line) 40%, transparent)" stroke="var(--grid-line)" strokeWidth="2" />
        {Array.from({ length: 22 }, (_, index) => (
          <line
            key={index}
            x1={96 + index * 26}
            y1="268"
            x2={107 + index * 26}
            y2="253"
            stroke="#94a3b8"
            strokeWidth="2"
            strokeLinecap="round"
          />
        ))}
        <NewtSprite x={body.x} y={newtY} />
        <ForceArrow origin={{ x: body.x, y: newtY - 44 }} vector={appliedForce} color={FORCE_COLORS.applied} label="applied" scale={5.1} maxLength={96} labelBounds={FRICTION_VIEW} />
        <ForceArrow origin={{ x: body.x, y: newtY - 8 }} vector={friction.force} color={FORCE_COLORS.friction} label="friction" scale={5.1} maxLength={96} labelBounds={FRICTION_VIEW} />
        <ForceArrow origin={{ x: body.x - 42, y: newtY }} vector={weight} color={FORCE_COLORS.gravity} label="weight" scale={3.1} maxLength={78} labelBounds={FRICTION_VIEW} />
        <ForceArrow origin={{ x: body.x + 42, y: newtY }} vector={normal} color={FORCE_COLORS.normal} label="normal" scale={3.1} maxLength={78} labelBounds={FRICTION_VIEW} />

        {(paused || pushDirection === 0) && (
          <text x={FRICTION_VIEW.width / 2} y="60" textAnchor="middle" fill="var(--text-muted)" fontSize="15" fontWeight="600">
            {paused ? 'paused — press space to resume' : 'press and hold beside Newt to push'}
          </text>
        )}

        <foreignObject x="514" y="88" width="174" height="56">
          <div className="grid gap-2">
            <Readout label="friction mode" value={friction.mode} />
          </div>
        </foreignObject>

        {/* The same forces, added tip to tail. */}
        <line x1="40" y1={FRICTION_SCENE_HEIGHT} x2={FRICTION_VIEW.width - 40} y2={FRICTION_SCENE_HEIGHT} stroke="var(--grid-line)" strokeWidth="2" />
        <text x="40" y={FRICTION_SCENE_HEIGHT + 26} fill="var(--text-muted)" fontSize="14" fontWeight="700">
          The same four forces, tip to tail
        </text>

        {netVisible && (
          <>
            <line
              x1={SUM_ORIGIN.x}
              y1={SUM_ORIGIN.y}
              x2={SUM_ORIGIN.x}
              y2={SUM_NET_Y}
              stroke="var(--grid-line)"
              strokeWidth="1.5"
              strokeDasharray="4 5"
            />
            <line
              x1={afterFriction.x}
              y1={afterFriction.y}
              x2={afterFriction.x}
              y2={SUM_NET_Y}
              stroke="var(--grid-line)"
              strokeWidth="1.5"
              strokeDasharray="4 5"
            />
            <ForceArrow
              origin={{ x: SUM_ORIGIN.x, y: SUM_NET_Y }}
              vector={total}
              color={FORCE_COLORS.net}
              label=""
              scale={SUM_SCALE}
              maxLength={999}
              labelBounds={FRICTION_VIEW}
            />
          </>
        )}

        <ForceArrow origin={weightStart} vector={weight} color={FORCE_COLORS.gravity} label="" scale={SUM_SCALE} maxLength={999} labelBounds={FRICTION_VIEW} />
        <ForceArrow origin={afterWeight} vector={appliedForce} color={FORCE_COLORS.applied} label="" scale={SUM_SCALE} maxLength={999} labelBounds={FRICTION_VIEW} />
        <ForceArrow origin={normalStart} vector={normal} color={FORCE_COLORS.normal} label="" scale={SUM_SCALE} maxLength={999} labelBounds={FRICTION_VIEW} />
        <ForceArrow origin={afterNormal} vector={friction.force} color={FORCE_COLORS.friction} label="" scale={SUM_SCALE} maxLength={999} labelBounds={FRICTION_VIEW} />

        <text x="40" y={FRICTION_VIEW.height - 22} fill="var(--text-muted)" fontSize="14">
          {netVisible
            ? `The chain does not close. Net force = ${format(netLength)} N ${total.x > 0 ? 'right' : 'left'}.`
            : 'The chain closes back on its own tail: the four forces add to zero, so there is no net arrow to draw.'}
        </text>
      </svg>
    </ForcePanel>
  );
}
