import React, { startTransition, useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';

const STAGE = {
  width: 760,
  height: 470,
  shaftX: 84,
  shaftY: 28,
  shaftWidth: 592,
  shaftHeight: 394,
  cabinX: 128,
  cabinY: 54,
  cabinWidth: 504,
  cabinHeight: 320,
};

const INTERIOR = {
  x: STAGE.cabinX + 22,
  y: STAGE.cabinY + 20,
  width: STAGE.cabinWidth - 44,
  height: STAGE.cabinHeight - 40,
};

const ANCHOR = {
  x: INTERIOR.x + INTERIOR.width * 0.56,
  y: INTERIOR.y + 34,
};

const PENDULUM_LENGTH = 142;
const BOB_RADIUS = 18;
const DROP_RADIUS = 10;
const DROP_LIMIT = 14;

const PRESETS = {
  rocket_up: {
    label: 'Rocket Up',
    defaultMagnitude: 9.8,
    helper:
      'Deep space plus upward thrust makes dropped objects fall toward the floor even though there is no planetary gravity outside.',
    getVectors: (magnitude) => ({
      gravity: { x: 0, y: 0 },
      elevator: { x: 0, y: -magnitude },
    }),
  },
  planet_surface: {
    label: 'Planet Surface',
    defaultMagnitude: 9.8,
    helper:
      'Standing still in a uniform gravitational field produces the same local downward pull as the rocket-up case.',
    getVectors: (magnitude) => ({
      gravity: { x: 0, y: magnitude },
      elevator: { x: 0, y: 0 },
    }),
  },
  free_fall: {
    label: 'Free Fall',
    defaultMagnitude: 9.8,
    helper:
      'When the cabin and the dropped objects share the same downward acceleration, the apparent gravity almost disappears inside.',
    getVectors: (magnitude) => ({
      gravity: { x: 0, y: magnitude },
      elevator: { x: 0, y: magnitude },
    }),
  },
  sideways_burn: {
    label: 'Sideways Burn',
    defaultMagnitude: 5.2,
    helper:
      'A sideways-thrusting cabin creates an apparent gravity toward the back wall, tilting the pendulum and sliding dropped objects sideways.',
    getVectors: (magnitude) => ({
      gravity: { x: 0, y: 0 },
      elevator: { x: magnitude, y: 0 },
    }),
  },
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const formatSigned = (value, digits = 1) => {
  const fixed = value.toFixed(digits);
  if (fixed === '-0.0' || fixed === '-0.00') {
    return fixed.slice(1);
  }
  return value > 0 ? `+${fixed}` : fixed;
};

const normalizeVector = (x, y, fallback = { x: 0, y: 1 }) => {
  const magnitude = Math.hypot(x, y);

  if (magnitude < 1e-5) {
    return { ...fallback, magnitude: 0 };
  }

  return {
    x: x / magnitude,
    y: y / magnitude,
    magnitude,
  };
};

const clampPointToPendulum = (point) => {
  const dx = point.x - ANCHOR.x;
  const dy = point.y - ANCHOR.y;
  const magnitude = Math.hypot(dx, dy);

  if (magnitude < 1e-5) {
    return { x: ANCHOR.x, y: ANCHOR.y + PENDULUM_LENGTH };
  }

  const scale = PENDULUM_LENGTH / magnitude;
  return {
    x: ANCHOR.x + dx * scale,
    y: ANCHOR.y + dy * scale,
  };
};

const getEffectiveField = (presetKey, magnitude) => {
  const { gravity, elevator } = PRESETS[presetKey].getVectors(magnitude);
  return {
    gravity,
    elevator,
    effective: {
      x: gravity.x - elevator.x,
      y: gravity.y - elevator.y,
    },
  };
};

const getEquilibriumBob = (effectiveField) => {
  const direction = normalizeVector(effectiveField.x, effectiveField.y);

  if (direction.magnitude === 0) {
    return {
      x: ANCHOR.x,
      y: ANCHOR.y + PENDULUM_LENGTH,
    };
  }

  return {
    x: ANCHOR.x + direction.x * PENDULUM_LENGTH,
    y: ANCHOR.y + direction.y * PENDULUM_LENGTH,
  };
};

const createDrop = (x, y) => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  x,
  y,
  vx: 0,
  vy: 0,
  radius: DROP_RADIUS,
  color: ['#0f766e', '#f59e0b', '#3b82f6', '#ef4444'][Math.floor(Math.random() * 4)],
  trail: [{ x, y }],
});

const buildSnapshot = (pendulumRef, dropsRef, shaftRef) => ({
  bob: { ...pendulumRef.current },
  drops: dropsRef.current.map((drop) => ({
    ...drop,
    trail: drop.trail.map((point) => ({ ...point })),
  })),
  shaft: { ...shaftRef.current },
});

const getSvgPoint = (svgElement, event) => {
  const rect = svgElement.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * STAGE.width,
    y: ((event.clientY - rect.top) / rect.height) * STAGE.height,
  };
};

const insideInterior = (point) =>
  point.x >= INTERIOR.x &&
  point.x <= INTERIOR.x + INTERIOR.width &&
  point.y >= INTERIOR.y &&
  point.y <= INTERIOR.y + INTERIOR.height;

const getPendulumNarrative = (effectiveField) => {
  const magnitude = Math.hypot(effectiveField.x, effectiveField.y);

  if (magnitude < 0.2) {
    return 'Inside free fall, the pendulum loses its preferred downward direction and the dropped objects float with the cabin.';
  }

  if (Math.abs(effectiveField.x) > Math.abs(effectiveField.y)) {
    return 'The apparent gravity points mostly sideways, so the pendulum leans and dropped objects drift toward the back wall.';
  }

  return 'The pendulum aligns with the apparent gravity and dropped objects curve toward the floor just as they would in a small laboratory on a planet.';
};

export default function EquivalenceElevatorLab() {
  const [presetKey, setPresetKey] = useState('rocket_up');
  const [magnitude, setMagnitude] = useState(PRESETS.rocket_up.defaultMagnitude);
  const [isPlaying, setIsPlaying] = useState(true);
  const [snapshot, setSnapshot] = useState(() => {
    const field = getEffectiveField('rocket_up', PRESETS.rocket_up.defaultMagnitude);
    const bob = getEquilibriumBob(field.effective);
    return {
      bob: { ...bob, vx: 0, vy: 0 },
      drops: [],
      shaft: { x: 0, y: 0 },
    };
  });

  const svgRef = useRef(null);
  const pendulumRef = useRef({ ...snapshot.bob });
  const dropsRef = useRef([]);
  const shaftRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef({
    active: false,
    pointerId: null,
    lastPoint: { x: 0, y: 0 },
    lastAt: 0,
  });

  const resetLab = (nextPresetKey = presetKey, nextMagnitude = magnitude) => {
    const field = getEffectiveField(nextPresetKey, nextMagnitude);
    const bob = getEquilibriumBob(field.effective);

    pendulumRef.current = {
      ...bob,
      vx: 0,
      vy: 0,
    };
    dropsRef.current = [];
    shaftRef.current = { x: 0, y: 0 };
    dragRef.current = {
      active: false,
      pointerId: null,
      lastPoint: { x: 0, y: 0 },
      lastAt: 0,
    };
    setSnapshot(buildSnapshot(pendulumRef, dropsRef, shaftRef));
  };

  const applyPreset = (nextPresetKey) => {
    const nextMagnitude = PRESETS[nextPresetKey].defaultMagnitude;

    startTransition(() => {
      setPresetKey(nextPresetKey);
      setMagnitude(nextMagnitude);
      setIsPlaying(true);
    });

    resetLab(nextPresetKey, nextMagnitude);
  };

  useEffect(() => {
    let animationFrame = null;
    let lastFrameTime = null;

    const animate = (timestamp) => {
      const previous = lastFrameTime ?? timestamp;
      const dt = clamp((timestamp - previous) / 1000, 0.001, 0.024);
      lastFrameTime = timestamp;

      const { effective, elevator } = getEffectiveField(presetKey, magnitude);

      if (isPlaying) {
        shaftRef.current.x += elevator.x * dt * 7.5;
        shaftRef.current.y += elevator.y * dt * 7.5;

        const bob = pendulumRef.current;
        if (!dragRef.current.active) {
          bob.vx += (effective.x - 0.95 * bob.vx) * dt;
          bob.vy += (effective.y - 0.95 * bob.vy) * dt;
          bob.x += bob.vx * dt * 28;
          bob.y += bob.vy * dt * 28;

          const constrained = clampPointToPendulum({ x: bob.x, y: bob.y });
          const radial = normalizeVector(constrained.x - ANCHOR.x, constrained.y - ANCHOR.y, { x: 0, y: 1 });
          const radialVelocity = bob.vx * radial.x + bob.vy * radial.y;

          bob.x = constrained.x;
          bob.y = constrained.y;
          bob.vx -= radialVelocity * radial.x;
          bob.vy -= radialVelocity * radial.y;
        }

        dropsRef.current.forEach((drop) => {
          drop.vx += effective.x * dt * 22;
          drop.vy += effective.y * dt * 22;
          drop.x += drop.vx * dt;
          drop.y += drop.vy * dt;

          const left = INTERIOR.x + drop.radius;
          const right = INTERIOR.x + INTERIOR.width - drop.radius;
          const top = INTERIOR.y + drop.radius;
          const bottom = INTERIOR.y + INTERIOR.height - drop.radius;

          if (drop.x < left) {
            drop.x = left;
            drop.vx = Math.abs(drop.vx) * 0.56;
          }

          if (drop.x > right) {
            drop.x = right;
            drop.vx = -Math.abs(drop.vx) * 0.56;
          }

          if (drop.y < top) {
            drop.y = top;
            drop.vy = Math.abs(drop.vy) * 0.56;
          }

          if (drop.y > bottom) {
            drop.y = bottom;
            drop.vy = -Math.abs(drop.vy) * 0.48;
            drop.vx *= 0.9;
          }

          drop.trail.push({ x: drop.x, y: drop.y });
          if (drop.trail.length > 18) {
            drop.trail.shift();
          }
        });
      }

      setSnapshot(buildSnapshot(pendulumRef, dropsRef, shaftRef));
      animationFrame = window.requestAnimationFrame(animate);
    };

    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [isPlaying, presetKey, magnitude]);

  const handlePointerDown = (event) => {
    if (!svgRef.current) {
      return;
    }

    const point = getSvgPoint(svgRef.current, event);
    const bob = pendulumRef.current;
    const distanceToBob = Math.hypot(point.x - bob.x, point.y - bob.y);

    if (distanceToBob <= BOB_RADIUS + 8) {
      dragRef.current = {
        active: true,
        pointerId: event.pointerId,
        lastPoint: point,
        lastAt: event.timeStamp,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }

    if (!insideInterior(point)) {
      return;
    }

    const newDrop = createDrop(point.x, point.y);
    dropsRef.current = [...dropsRef.current.slice(-(DROP_LIMIT - 1)), newDrop];
    setSnapshot(buildSnapshot(pendulumRef, dropsRef, shaftRef));
  };

  const handlePointerMove = (event) => {
    if (!dragRef.current.active || dragRef.current.pointerId !== event.pointerId || !svgRef.current) {
      return;
    }

    const point = getSvgPoint(svgRef.current, event);
    const clampedPoint = clampPointToPendulum(point);
    const elapsed = Math.max((event.timeStamp - dragRef.current.lastAt) / 1000, 0.001);
    const bob = pendulumRef.current;

    bob.vx = ((clampedPoint.x - dragRef.current.lastPoint.x) / elapsed) * 0.045;
    bob.vy = ((clampedPoint.y - dragRef.current.lastPoint.y) / elapsed) * 0.045;
    bob.x = clampedPoint.x;
    bob.y = clampedPoint.y;

    dragRef.current.lastPoint = clampedPoint;
    dragRef.current.lastAt = event.timeStamp;
    setSnapshot(buildSnapshot(pendulumRef, dropsRef, shaftRef));
  };

  const handlePointerUp = (event) => {
    if (!dragRef.current.active || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = {
      active: false,
      pointerId: null,
      lastPoint: { x: 0, y: 0 },
      lastAt: 0,
    };

    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const clearDrops = () => {
    dropsRef.current = [];
    setSnapshot(buildSnapshot(pendulumRef, dropsRef, shaftRef));
  };

  const field = getEffectiveField(presetKey, magnitude);
  const effective = field.effective;
  const apparentMagnitude = Math.hypot(effective.x, effective.y);
  const arrowScale = apparentMagnitude < 0.01 ? 0 : Math.min(apparentMagnitude * 8.5, 110);
  const arrowDirection = normalizeVector(effective.x, effective.y, { x: 0, y: 1 });
  const arrowStart = {
    x: INTERIOR.x + 64,
    y: INTERIOR.y + 58,
  };
  const arrowEnd = {
    x: arrowStart.x + arrowDirection.x * arrowScale,
    y: arrowStart.y + arrowDirection.y * arrowScale,
  };
  const narrative = getPendulumNarrative(effective);

  const shaftLines = [];
  for (let index = -2; index <= 11; index += 1) {
    const y =
      STAGE.shaftY +
      ((((index * 38 + snapshot.shaft.y) % 38) + 38) % 38) +
      10;
    shaftLines.push(
      <line
        key={`shaft-horizontal-${index}`}
        x1={STAGE.shaftX + 8}
        y1={y}
        x2={STAGE.shaftX + STAGE.shaftWidth - 8}
        y2={y}
        stroke="rgba(148, 163, 184, 0.18)"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />,
    );
  }

  for (let index = -1; index <= 6; index += 1) {
    const x =
      STAGE.shaftX +
      ((((index * 72 + snapshot.shaft.x) % 72) + 72) % 72) +
      18;
    shaftLines.push(
      <line
        key={`shaft-vertical-${index}`}
        x1={x}
        y1={STAGE.shaftY + 6}
        x2={x}
        y2={STAGE.shaftY + STAGE.shaftHeight - 6}
        stroke="rgba(148, 163, 184, 0.12)"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />,
    );
  }

  return (
    <div className="flex h-full flex-col gap-5 bg-[radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--accent-blue)_12%,transparent),transparent_36%),radial-gradient(circle_at_bottom_left,color-mix(in_srgb,var(--accent-red)_10%,transparent),transparent_34%),var(--sim-bg)] p-5 text-[color:var(--text-primary)] md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[16rem] flex-1">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
            Equivalence Principle Lab
          </p>
          <h2 className="mt-3 mb-0 text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">
            Inside an Accelerating Elevator
          </h2>
          <p className="mt-3 mb-0 max-w-3xl text-sm leading-7 text-[color:var(--text-muted)]">
            The pendulum and the dropped balls respond only to the effective field inside the cabin. Compare a rocket in deep space, a stationary elevator on a planet, and free fall to see what local experiments can and cannot distinguish.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsPlaying((current) => !current)}
            className="flex items-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            onClick={() => resetLab()}
            className="rounded-full border border-[var(--grid-line)] bg-[var(--bg-primary)] p-2.5 text-[color:var(--text-muted)] shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
            aria-label="Reset elevator lab"
            title="Reset elevator lab"
          >
            <RotateCcw className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_22rem]">
        <div className="overflow-hidden rounded-[1.75rem] border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--surface-elevated)_92%,transparent)] shadow-sm">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${STAGE.width} ${STAGE.height}`}
            className="block h-full w-full touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            <defs>
              <linearGradient id="elevator-floor-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="rgba(255, 255, 255, 0.08)" />
                <stop offset="100%" stopColor="rgba(15, 23, 42, 0.06)" />
              </linearGradient>
              <clipPath id="elevator-interior-clip">
                <rect
                  x={INTERIOR.x}
                  y={INTERIOR.y}
                  width={INTERIOR.width}
                  height={INTERIOR.height}
                  rx="24"
                />
              </clipPath>
            </defs>

            <rect x="0" y="0" width={STAGE.width} height={STAGE.height} fill="transparent" />

            <rect
              x={STAGE.shaftX}
              y={STAGE.shaftY}
              width={STAGE.shaftWidth}
              height={STAGE.shaftHeight}
              rx="34"
              fill="color-mix(in srgb, var(--bg-primary) 86%, transparent)"
              stroke="var(--grid-line)"
              strokeWidth="1.5"
            />

            {shaftLines}

            <rect
              x={STAGE.cabinX}
              y={STAGE.cabinY}
              width={STAGE.cabinWidth}
              height={STAGE.cabinHeight}
              rx="30"
              fill="color-mix(in srgb, var(--surface-elevated) 95%, transparent)"
              stroke="rgba(15, 23, 42, 0.18)"
              strokeWidth="2"
            />

            <rect
              x={INTERIOR.x}
              y={INTERIOR.y}
              width={INTERIOR.width}
              height={INTERIOR.height}
              rx="24"
              fill="rgba(255, 255, 255, 0.22)"
              stroke="rgba(148, 163, 184, 0.22)"
              strokeWidth="1.2"
            />

            <g clipPath="url(#elevator-interior-clip)">
              <rect
                x={INTERIOR.x}
                y={INTERIOR.y}
                width={INTERIOR.width}
                height={INTERIOR.height}
                fill="url(#elevator-floor-gradient)"
              />

              {snapshot.drops.map((drop) => (
                <g key={drop.id}>
                  <path
                    d={drop.trail
                      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
                      .join(' ')}
                    fill="none"
                    stroke={drop.color}
                    strokeWidth="2"
                    strokeOpacity="0.22"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle cx={drop.x} cy={drop.y} r={drop.radius + 6} fill={drop.color} opacity="0.12" />
                  <circle cx={drop.x} cy={drop.y} r={drop.radius} fill={drop.color} opacity="0.9" />
                </g>
              ))}
            </g>

            <line
              x1={INTERIOR.x + 22}
              y1={ANCHOR.y}
              x2={INTERIOR.x + INTERIOR.width - 22}
              y2={ANCHOR.y}
              stroke="rgba(15, 23, 42, 0.22)"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
            />

            <line
              x1={ANCHOR.x}
              y1={ANCHOR.y}
              x2={snapshot.bob.x}
              y2={snapshot.bob.y}
              stroke="rgba(15, 23, 42, 0.28)"
              strokeWidth="2.8"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={ANCHOR.x} cy={ANCHOR.y} r="5.5" fill="rgba(15, 23, 42, 0.28)" />
            <circle cx={snapshot.bob.x} cy={snapshot.bob.y} r={BOB_RADIUS + 8} fill="rgba(15, 118, 110, 0.08)" />
            <circle cx={snapshot.bob.x} cy={snapshot.bob.y} r={BOB_RADIUS} fill="rgba(15, 118, 110, 0.92)" />
            <circle
              cx={snapshot.bob.x - BOB_RADIUS * 0.32}
              cy={snapshot.bob.y - BOB_RADIUS * 0.32}
              r={BOB_RADIUS * 0.26}
              fill="rgba(255, 255, 255, 0.22)"
            />

            {arrowScale > 0.1 && (
              <>
                <line
                  x1={arrowStart.x}
                  y1={arrowStart.y}
                  x2={arrowEnd.x}
                  y2={arrowEnd.y}
                  stroke="#0f766e"
                  strokeWidth="4"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={(() => {
                    const headDirection = normalizeVector(arrowEnd.x - arrowStart.x, arrowEnd.y - arrowStart.y, {
                      x: 0,
                      y: 1,
                    });
                    const leftX = arrowEnd.x - headDirection.x * 14 - headDirection.y * 7;
                    const leftY = arrowEnd.y - headDirection.y * 14 + headDirection.x * 7;
                    const rightX = arrowEnd.x - headDirection.x * 14 + headDirection.y * 7;
                    const rightY = arrowEnd.y - headDirection.y * 14 - headDirection.x * 7;
                    return `M ${arrowEnd.x} ${arrowEnd.y} L ${leftX} ${leftY} L ${rightX} ${rightY} Z`;
                  })()}
                  fill="#0f766e"
                  opacity="0.94"
                />
              </>
            )}

            <text
              x={arrowStart.x + 14}
              y={arrowStart.y - 10}
              fill="#0f766e"
              fontSize="13"
              fontWeight="700"
            >
              g_eff
            </text>

            <text
              x={INTERIOR.x + 18}
              y={INTERIOR.y + INTERIOR.height - 16}
              fill="rgba(71, 85, 105, 0.82)"
              fontSize="12"
              fontWeight="600"
            >
              Click inside the cabin to drop a ball. Drag the pendulum bob to release it from a new angle.
            </text>
          </svg>
        </div>

        <div className="space-y-4">
          <div className="rounded-[1.5rem] border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--surface-elevated)_94%,transparent)] p-4 shadow-sm">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
              Local Scenarios
            </p>
            <div className="mt-3 grid gap-2">
              {Object.entries(PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyPreset(key)}
                  className={`rounded-2xl border px-4 py-3 text-left transition-all duration-300 ${
                    presetKey === key
                      ? 'border-[color:color-mix(in_srgb,var(--accent-blue)_36%,var(--grid-line))] bg-[color-mix(in_srgb,var(--accent-blue)_10%,var(--surface-elevated))] shadow-sm'
                      : 'border-[var(--grid-line)] bg-[var(--bg-primary)] hover:-translate-y-0.5 hover:border-[var(--accent-blue)]'
                  }`}
                >
                  <span className="block text-sm font-semibold text-[color:var(--text-primary)]">{preset.label}</span>
                  <span className="mt-1 block text-sm leading-6 text-[color:var(--text-muted)]">{preset.helper}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
            <label className="block">
              <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                <span className="font-medium text-[color:var(--text-primary)]">Scenario strength</span>
                <span className="font-mono text-[color:var(--text-muted)]">{formatSigned(magnitude, 1)} m/s^2</span>
              </div>
              <input
                type="range"
                min="0"
                max="12"
                step="0.1"
                value={magnitude}
                onChange={(event) => setMagnitude(parseFloat(event.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-700"
              />
            </label>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const x = INTERIOR.x + INTERIOR.width * 0.5;
                  const y = INTERIOR.y + 56;
                  const newDrop = createDrop(x, y);
                  dropsRef.current = [...dropsRef.current.slice(-(DROP_LIMIT - 1)), newDrop];
                  setSnapshot(buildSnapshot(pendulumRef, dropsRef, shaftRef));
                }}
                className="rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-semibold text-[color:var(--text-primary)] shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
              >
                Drop center ball
              </button>
              <button
                type="button"
                onClick={clearDrops}
                className="rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-semibold text-[color:var(--text-primary)] shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
              >
                Clear drops
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">
                External gravity
              </p>
              <p className="mt-2 mb-0 text-lg font-semibold text-[color:var(--text-primary)]">
                ({formatSigned(field.gravity.x)}, {formatSigned(field.gravity.y)}) m/s^2
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">
                Elevator acceleration
              </p>
              <p className="mt-2 mb-0 text-lg font-semibold text-[color:var(--text-primary)]">
                ({formatSigned(field.elevator.x)}, {formatSigned(field.elevator.y)}) m/s^2
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--accent-blue)_8%,var(--bg-primary))] p-4 shadow-sm">
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent-blue)]">
                Effective field
              </p>
              <p className="mt-2 mb-0 text-lg font-semibold text-[color:var(--text-primary)]">
                ({formatSigned(effective.x)}, {formatSigned(effective.y)}) m/s^2
              </p>
              <p className="mt-2 mb-0 text-sm leading-6 text-[color:var(--text-muted)]">
                Magnitude: {formatSigned(apparentMagnitude, 2)} m/s^2
              </p>
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--surface-elevated)_94%,transparent)] p-4 shadow-sm">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">Interpretation</p>
            <p className="mt-3 mb-0 text-sm leading-7 text-[color:var(--text-primary)]">{narrative}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
