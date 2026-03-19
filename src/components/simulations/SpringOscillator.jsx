import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Pause, Play, RotateCcw } from 'lucide-react';

const DISPLAY_RANGE = 2.2;
const VELOCITY_PLOT_RANGE = 12.5;
const HISTORY_WINDOW = 6;
const CRITICAL_DAMPING_RATIO = 0.9999;
const ARROW_HEAD_LENGTH = 15;
const ARROW_HEAD_HALF_HEIGHT = 6;
const ARROW_MIN_TOTAL_LENGTH = 5;
const ARROW_MAX_TOTAL_LENGTH = 168;

const COLORS = {
  position: '#3b82f6',
  velocity: '#0f766e',
  acceleration: '#ef4444',
  force: '#f59e0b',
  neutral: '#475569',
};

const TRACK = {
  width: 960,
  height: 320,
  wallX: 52,
  anchorX: 92,
  equilibriumX: 560,
  travel: 220,
  massWidth: 128,
  massHeight: 92,
  springY: 176,
};

const VECTOR_OPTIONS = [
  {
    key: 'none',
    label: 'Hidden',
    shortLabel: 'hidden',
    accent: COLORS.neutral,
    stroke: COLORS.neutral,
    helper: 'Hide the arrow until you want to inspect one vector at a time.',
    units: '',
    threshold: Number.POSITIVE_INFINITY,
  },
  {
    key: 'position',
    label: 'Position',
    shortLabel: 'x',
    accent: COLORS.position,
    stroke: COLORS.position,
    helper: 'Shows the displacement from equilibrium.',
    units: 'm',
    threshold: 0.03,
  },
  {
    key: 'velocity',
    label: 'Velocity',
    shortLabel: 'v',
    accent: COLORS.velocity,
    stroke: COLORS.velocity,
    helper: '',
    units: 'm/s',
    threshold: 0.04,
  },
  {
    key: 'force',
    label: 'Restoring Force',
    shortLabel: 'Fs',
    accent: COLORS.force,
    stroke: COLORS.force,
    helper: 'Shows the spring force, which always points back toward equilibrium.',
    units: 'N',
    threshold: 0.08,
  },
  {
    key: 'acceleration',
    label: 'Acceleration',
    shortLabel: 'a',
    accent: COLORS.acceleration,
    stroke: COLORS.acceleration,
    helper: 'Shows the net acceleration coming from the spring and the damping term together.',
    units: 'm/s^2',
    threshold: 0.08,
  },
];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const formatNumber = (value, digits = 2) => {
  const fixed = value.toFixed(digits);
  if (fixed === '-0.00' || fixed === '-0.0') {
    return fixed.slice(1);
  }
  return fixed;
};

const formatSigned = (value, digits = 2) => {
  const normalized = Number(formatNumber(value, digits));
  if (Math.abs(normalized) < 1e-9) {
    return formatNumber(0, digits);
  }
  const formatted = formatNumber(normalized, digits);
  return normalized > 0 ? `+${formatted}` : formatted;
};

const createSpringPoints = (startX, endX, y) => {
  const lead = 34;
  const tail = 22;
  const coilCount = 12;
  const usable = Math.max(26, endX - startX - lead - tail);
  const points = [
    [startX, y],
    [startX + lead * 0.35, y],
    [startX + lead, y],
  ];

  for (let index = 0; index < coilCount; index += 1) {
    const x = startX + lead + usable * ((index + 0.5) / coilCount);
    const offset = index % 2 === 0 ? -20 : 20;
    points.push([x, y + offset]);
  }

  points.push([endX - tail, y]);
  points.push([endX, y]);

  return points.map(([xPoint, yPoint]) => `${xPoint},${yPoint}`).join(' ');
};

const createInitialSimState = () => ({
  time: 0,
  position: 0,
  velocity: 0,
  history: [
    {
      time: 0,
      position: 0,
      velocity: 0,
    },
  ],
});

const getOscillatorTerms = ({ mass, springConstant, dampingRatio }) => {
  const clampedDampingRatio = clamp(dampingRatio, 0, 1);
  const omega0 = Math.sqrt(springConstant / mass);
  const alpha = clampedDampingRatio * omega0;
  const isCriticallyDamped = clampedDampingRatio >= CRITICAL_DAMPING_RATIO;
  const dampedOmega = isCriticallyDamped ? 0 : omega0 * Math.sqrt(Math.max(0, 1 - clampedDampingRatio * clampedDampingRatio));

  return {
    omega0,
    alpha,
    dampedOmega,
    dampingRatio: clampedDampingRatio,
    isCriticallyDamped,
  };
};

const getAcceleration = ({ position, velocity, omega0, alpha }) => -2 * alpha * velocity - omega0 * omega0 * position;

const advanceOscillatorState = ({ position, velocity, dt, omega0, alpha, dampedOmega, isCriticallyDamped }) => {
  if (dt <= 0) {
    return { position, velocity };
  }

  const previousPosition = position;
  const previousVelocity = velocity;

  if (isCriticallyDamped) {
    const expTerm = Math.exp(-omega0 * dt);
    return {
      position: expTerm * (previousPosition * (1 + omega0 * dt) + previousVelocity * dt),
      velocity: expTerm * (previousVelocity * (1 - omega0 * dt) - previousPosition * omega0 * omega0 * dt),
    };
  }

  const sinTerm = Math.sin(dampedOmega * dt);
  const cosTerm = Math.cos(dampedOmega * dt);
  const expTerm = Math.exp(-alpha * dt);
  const alphaOverOmega = alpha / dampedOmega;

  return {
    position:
      expTerm *
      (previousPosition * (cosTerm + alphaOverOmega * sinTerm) + previousVelocity * (sinTerm / dampedOmega)),
    velocity:
      expTerm *
      (previousVelocity * (cosTerm - alphaOverOmega * sinTerm) - previousPosition * ((omega0 * omega0) / dampedOmega) * sinTerm),
  };
};

const getMechanicalEnergy = ({ position, velocity, mass, springConstant }) =>
  0.5 * springConstant * position * position + 0.5 * mass * velocity * velocity;

const getEnergySummary = ({ position, velocity, equivalentAmplitude }) => {
  if (equivalentAmplitude < 0.06) {
    return 'Release the mass to define a launch, then watch the spring and kinetic energy swap roles.';
  }

  if (Math.abs(position) < Math.max(0.12, equivalentAmplitude * 0.18)) {
    return 'Near equilibrium, the spring is closest to relaxed and the kinetic energy peaks.';
  }

  if (Math.abs(velocity) < 0.12) {
    return 'Near a turning point, the mass pauses and the spring stores most of the mechanical energy.';
  }

  return 'Between the center and the edge, stored spring energy and motion are continuously trading places.';
};

const getLaunchVelocityLimit = ({ position, mass, springConstant }) => {
  const remainingAmplitudeSquared = Math.max(0, DISPLAY_RANGE * DISPLAY_RANGE - position * position);
  return Math.sqrt((springConstant / mass) * remainingAmplitudeSquared);
};

function ControlSlider({ label, value, valueLabel, min, max, step, onChange }) {
  return (
    <label className="block">
      <div className="mb-2 flex items-center justify-between gap-4 text-sm">
        <span className="font-medium text-[color:var(--text-primary)]">{label}</span>
        <span className="font-mono text-[color:var(--text-muted)]">{valueLabel}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-700"
      />
    </label>
  );
}

function CollapsiblePanel({ title, accentColor, preview, description, badge, isOpen, onToggle, children, className = '' }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] shadow-sm ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-start justify-between gap-4 p-5 text-left"
      >
        <div>
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: accentColor }}>
            {title}
          </p>
          {isOpen ? <p className="mt-2 mb-0 text-sm leading-7 text-[color:var(--text-muted)]">{description}</p> : null}
        </div>

        <div className="flex flex-shrink-0 items-center gap-3">
          {badge ? (
            <span className="rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-3 py-1 text-xs font-medium text-[color:var(--text-muted)]">
              {badge}
            </span>
          ) : null}
          <span className="rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-2 text-[color:var(--text-muted)]">
            <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
          </span>
        </div>
      </button>

      {isOpen ? <div className="border-t border-[var(--grid-line)] px-5 pb-5 pt-4">{children}</div> : null}
    </div>
  );
}

function HistoryChart({ history, accessor, valueRange, stroke, markerFill }) {
  const plotWidth = 340;
  const plotHeight = 150;
  const plotPadding = 18;
  const plotMidY = plotHeight / 2;
  const plotAmplitude = plotHeight * 0.34;
  const firstTime = history[0]?.time ?? 0;
  const lastTime = history[history.length - 1]?.time ?? 0;
  const timeSpan = Math.max(lastTime - firstTime, 0.001);

  const toY = (sample) => plotMidY - (clamp(accessor(sample), -valueRange, valueRange) / valueRange) * plotAmplitude;
  const points =
    history.length <= 1
      ? [
          `${plotPadding},${toY(history[0] ?? { position: 0, velocity: 0 })}`,
          `${plotWidth - plotPadding},${toY(history[0] ?? { position: 0, velocity: 0 })}`,
        ]
      : history.map((sample) => {
          const x = plotPadding + ((sample.time - firstTime) / timeSpan) * (plotWidth - plotPadding * 2);
          return `${x},${toY(sample)}`;
        });

  return (
    <svg viewBox={`0 0 ${plotWidth} ${plotHeight}`} className="h-auto w-full">
      <rect x="0" y="0" width={plotWidth} height={plotHeight} rx="18" fill="color-mix(in srgb, var(--sim-bg) 78%, white)" />
      <line
        x1={plotPadding}
        x2={plotWidth - plotPadding}
        y1={plotMidY}
        y2={plotMidY}
        stroke="rgba(71, 85, 105, 0.35)"
        strokeWidth="1.5"
        strokeDasharray="5 6"
      />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={plotWidth - plotPadding} cy={toY(history[history.length - 1] ?? { position: 0, velocity: 0 })} r="5" fill={markerFill} />
    </svg>
  );
}

export default function SpringOscillator() {
  const [mass, setMass] = useState(2);
  const [springConstant, setSpringConstant] = useState(10);
  const [dampingRatio, setDampingRatio] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [energyReference, setEnergyReference] = useState(0);
  const [activeVector, setActiveVector] = useState('none');
  const [isVectorPanelOpen, setIsVectorPanelOpen] = useState(false);
  const [openSections, setOpenSections] = useState({
    kinematics: false,
    parameters: false,
    positionHistory: true,
    velocityHistory: false,
    energy: false,
  });

  const requestRef = useRef();
  const lastTimeRef = useRef();
  const stageRef = useRef(null);
  const dragRef = useRef({
    active: false,
    pointerId: null,
    lastX: 0,
    lastAt: 0,
  });
  const simStateRef = useRef(createInitialSimState());
  const [simState, setSimState] = useState(() => simStateRef.current);

  const commitSimState = (nextState) => {
    simStateRef.current = nextState;
    setSimState(nextState);
  };

  useEffect(() => {
    if (!isPlaying) {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
      lastTimeRef.current = undefined;
      return undefined;
    }

    const animate = (timestamp) => {
      const previousTimestamp = lastTimeRef.current ?? timestamp;
      lastTimeRef.current = timestamp;

      if (!dragRef.current.active) {
        const dt = clamp((timestamp - previousTimestamp) / 1000, 0.001, 0.04);
        const terms = getOscillatorTerms({
          mass,
          springConstant,
          dampingRatio,
        });
        const previous = simStateRef.current;
        const nextMotion = advanceOscillatorState({
          position: previous.position,
          velocity: previous.velocity,
          dt,
          omega0: terms.omega0,
          alpha: terms.alpha,
          dampedOmega: terms.dampedOmega,
          isCriticallyDamped: terms.isCriticallyDamped,
        });
        const time = previous.time + dt;
        const nextSample = {
          time,
          position: nextMotion.position,
          velocity: nextMotion.velocity,
        };
        const history = [...previous.history, nextSample].filter((sample) => time - sample.time <= HISTORY_WINDOW);

        commitSimState({
          time,
          position: nextMotion.position,
          velocity: nextMotion.velocity,
          history,
        });
      }

      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
      requestRef.current = undefined;
    };
  }, [isPlaying, mass, springConstant, dampingRatio]);

  const resetMotion = () => {
    dragRef.current = {
      active: false,
      pointerId: null,
      lastX: 0,
      lastAt: 0,
    };
    setIsPlaying(false);
    setEnergyReference(0);
    lastTimeRef.current = undefined;
    commitSimState(createInitialSimState());
  };

  const toggleSection = (section) => {
    setOpenSections((previous) => ({
      ...previous,
      [section]: !previous[section],
    }));
  };

  const getStagePoint = (event) => {
    const stage = stageRef.current;
    if (!stage) {
      return null;
    }

    const rect = stage.getBoundingClientRect();
    const scaleX = TRACK.width / rect.width;
    const scaleY = TRACK.height / rect.height;

    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (event) => {
    if (event.button !== 0) {
      return;
    }

    if (event.target instanceof Element && event.target.closest('[data-ui-control="true"]')) {
      return;
    }

    const point = getStagePoint(event);
    const stage = stageRef.current;

    if (!point || !stage) {
      return;
    }

    const currentState = simStateRef.current;
    const massCenterX = TRACK.equilibriumX + (currentState.position / DISPLAY_RANGE) * TRACK.travel;
    const massLeftX = massCenterX - TRACK.massWidth / 2;
    const massTopY = TRACK.springY - TRACK.massHeight / 2;

    if (
      point.x < massLeftX ||
      point.x > massLeftX + TRACK.massWidth ||
      point.y < massTopY ||
      point.y > massTopY + TRACK.massHeight
    ) {
      return;
    }

    event.preventDefault();
    setIsPlaying(false);
    lastTimeRef.current = undefined;

    const position = clamp(((point.x - TRACK.equilibriumX) / TRACK.travel) * DISPLAY_RANGE, -DISPLAY_RANGE, DISPLAY_RANGE);
    commitSimState({
      time: 0,
      position,
      velocity: 0,
      history: [
        {
          time: 0,
          position,
          velocity: 0,
        },
      ],
    });

    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      lastX: point.x,
      lastAt: performance.now(),
    };

    stage.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event) => {
    if (!dragRef.current.active || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    const point = getStagePoint(event);
    if (!point) {
      return;
    }

    event.preventDefault();

    const now = performance.now();
    const dt = Math.max((now - dragRef.current.lastAt) / 1000, 0.001);
    const position = clamp(((point.x - TRACK.equilibriumX) / TRACK.travel) * DISPLAY_RANGE, -DISPLAY_RANGE, DISPLAY_RANGE);
    const rawVelocity = (((point.x - dragRef.current.lastX) / TRACK.travel) * DISPLAY_RANGE) / dt;
    const velocityLimit = getLaunchVelocityLimit({
      position,
      mass,
      springConstant,
    });
    const velocity = clamp(rawVelocity, -velocityLimit, velocityLimit);

    commitSimState({
      time: 0,
      position,
      velocity,
      history: [
        {
          time: 0,
          position,
          velocity,
        },
      ],
    });

    dragRef.current = {
      ...dragRef.current,
      lastX: point.x,
      lastAt: now,
    };
  };

  const finishDrag = (pointerId) => {
    const stage = stageRef.current;
    if (!stage || dragRef.current.pointerId !== pointerId) {
      return;
    }

    const releasedState = simStateRef.current;
    dragRef.current = {
      active: false,
      pointerId: null,
      lastX: 0,
      lastAt: 0,
    };
    lastTimeRef.current = undefined;

    commitSimState({
      time: 0,
      position: releasedState.position,
      velocity: releasedState.velocity,
      history: [
        {
          time: 0,
          position: releasedState.position,
          velocity: releasedState.velocity,
        },
      ],
    });

    setEnergyReference(
      getMechanicalEnergy({
        position: releasedState.position,
        velocity: releasedState.velocity,
        mass,
        springConstant,
      }),
    );

    if (stage.hasPointerCapture(pointerId)) {
      stage.releasePointerCapture(pointerId);
    }

    const isMotionMeaningful = Math.abs(releasedState.position) > 0.0001 || Math.abs(releasedState.velocity) > 0.0001;
    setIsPlaying(isMotionMeaningful);
  };

  const handlePointerUp = (event) => {
    finishDrag(event.pointerId);
  };

  const handlePointerCancel = (event) => {
    finishDrag(event.pointerId);
  };

  const currentTerms = getOscillatorTerms({
    mass,
    springConstant,
    dampingRatio,
  });
  const isCriticallyDamped = currentTerms.isCriticallyDamped;
  const current = {
    position: simState.position,
    velocity: simState.velocity,
    acceleration: getAcceleration({
      position: simState.position,
      velocity: simState.velocity,
      omega0: currentTerms.omega0,
      alpha: currentTerms.alpha,
    }),
  };

  const idealPeriod = (2 * Math.PI) / currentTerms.omega0;
  const dampedPeriod = isCriticallyDamped ? null : (2 * Math.PI) / currentTerms.dampedOmega;
  const frequency = 1 / idealPeriod;
  const potentialEnergy = 0.5 * springConstant * current.position * current.position;
  const kineticEnergy = 0.5 * mass * current.velocity * current.velocity;
  const mechanicalEnergy = potentialEnergy + kineticEnergy;
  const energyScale = Math.max(energyReference, mechanicalEnergy, 0.001);
  const relativeEnergy = energyReference > 0 ? mechanicalEnergy / energyReference : 0;
  const equivalentAmplitude = springConstant > 0 ? Math.sqrt((2 * mechanicalEnergy) / springConstant) : 0;
  const energySummary = getEnergySummary({
    position: current.position,
    velocity: current.velocity,
    equivalentAmplitude,
  });

  const massCenterX = TRACK.equilibriumX + (current.position / DISPLAY_RANGE) * TRACK.travel;
  const massLeftX = massCenterX - TRACK.massWidth / 2;
  const springPoints = createSpringPoints(TRACK.anchorX, massLeftX, TRACK.springY);

  const activeVectorOption = VECTOR_OPTIONS.find((option) => option.key === activeVector) ?? VECTOR_OPTIONS[0];
  const activeVectorValue =
    activeVector === 'position'
      ? current.position
      : activeVector === 'velocity'
      ? current.velocity
      : activeVector === 'force'
        ? -springConstant * current.position
        : activeVector === 'acceleration'
          ? current.acceleration
          : 0;
  const vectorVisible = activeVector !== 'none' && Math.abs(activeVectorValue) > activeVectorOption.threshold;
  const vectorDirection = activeVectorValue >= 0 ? 1 : -1;
  const vectorTotalLength = clamp(
    activeVector === 'position'
      ? Math.abs(massCenterX - TRACK.equilibriumX)
      : activeVector === 'velocity'
        ? Math.abs(current.velocity) * 36
        : activeVector === 'force'
          ? Math.abs(-springConstant * current.position) * 2.8
          : Math.abs(current.acceleration) * 1.9,
    ARROW_MIN_TOTAL_LENGTH,
    ARROW_MAX_TOTAL_LENGTH,
  );
  const vectorStartX = activeVector === 'position' ? TRACK.equilibriumX : massCenterX + (vectorDirection > 0 ? 28 : -28);
  const vectorTipX = activeVector === 'position' ? massCenterX : vectorStartX + vectorDirection * vectorTotalLength;
  const vectorHeadBaseX = vectorTipX - vectorDirection * ARROW_HEAD_LENGTH;
  const vectorShaftEndX =
    Math.abs(vectorTipX - vectorStartX) > ARROW_HEAD_LENGTH ? vectorHeadBaseX : vectorStartX;
  const vectorLabelX = (vectorStartX + vectorTipX) / 2;
  const vectorHeadPoints = `${vectorTipX},${TRACK.springY - 68} ${vectorHeadBaseX},${TRACK.springY - 68 - ARROW_HEAD_HALF_HEIGHT} ${vectorHeadBaseX},${TRACK.springY - 68 + ARROW_HEAD_HALF_HEIGHT}`;

  const cycleVector = () => {
    setActiveVector((currentKey) => {
      const currentIndex = VECTOR_OPTIONS.findIndex((option) => option.key === currentKey);
      const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % VECTOR_OPTIONS.length : 0;
      return VECTOR_OPTIONS[nextIndex].key;
    });
  };

  const statusLabel = dragRef.current.active
    ? 'Setting launch'
    : isPlaying
      ? isCriticallyDamped
        ? 'Critically damped'
        : dampingRatio > 0
        ? `Damped at ${Math.round(dampingRatio * 100)}% of critical`
        : 'Ideal SHM'
      : Math.abs(current.position) > 0.04 || Math.abs(current.velocity) > 0.04
        ? 'Paused'
        : 'Drag to launch';

  return (
    <div className="flex h-full min-h-[44rem] w-full flex-col overflow-hidden bg-[var(--sim-bg)] text-[color:var(--text-primary)]">
      <div className="relative h-[22rem] flex-shrink-0 overflow-hidden border-b border-[var(--grid-line)] bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.12),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(15,118,110,0.14),transparent_34%),var(--bg-primary)] md:h-[24rem]">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'linear-gradient(to right, color-mix(in srgb, var(--grid-line) 75%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--grid-line) 75%, transparent) 1px, transparent 1px)',
            backgroundSize: '10% 100%, 100% 20%',
          }}
        />

        <div className="absolute left-5 top-5 z-20 rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)] shadow-sm">
          {statusLabel}
        </div>



        <div
          ref={stageRef}
          className="relative h-full w-full"
          style={{ touchAction: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        >
          <div className="absolute right-5 top-5 z-20 w-full max-w-xs" data-ui-control="true">
            <div className="overflow-hidden rounded-2xl border border-[var(--grid-line)] bg-[var(--surface-elevated)] shadow-sm backdrop-blur">
              <button
                type="button"
                onClick={() => setIsVectorPanelOpen((open) => !open)}
                aria-expanded={isVectorPanelOpen}
                data-ui-control="true"
                className="flex w-full items-start justify-between gap-4 p-4 text-left"
              >
                <div>
                  <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">Vectors</p>
                  <p className="mt-2 mb-0 text-sm leading-6 text-[color:var(--text-muted)]">
                    {isVectorPanelOpen ? 'Pick one arrow to display inside the animation.' : `Currently showing: ${activeVectorOption.label}`}
                  </p>
                </div>
                <span className="rounded-full border border-[var(--grid-line)] bg-[var(--bg-primary)] p-2 text-[color:var(--text-muted)]">
                  <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${isVectorPanelOpen ? 'rotate-180' : ''}`} />
                </span>
              </button>

              {isVectorPanelOpen ? (
                <div className="border-t border-[var(--grid-line)] px-4 pb-4 pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="m-0 text-sm leading-6 text-[color:var(--text-primary)]">
                      <span className="font-semibold" style={{ color: activeVectorOption.accent }}>
                        {activeVectorOption.label}
                      </span>
                      {activeVector === 'none' ? '' : `: ${formatSigned(activeVectorValue)} ${activeVectorOption.units}`}
                    </p>
                    <button
                      type="button"
                      onClick={cycleVector}
                      data-ui-control="true"
                      className="rounded-full border border-[var(--grid-line)] bg-[var(--bg-primary)] px-4 py-2 text-sm font-medium text-[color:var(--text-muted)] shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
                    >
                      Cycle Arrow
                    </button>
                  </div>
                  <p className="mt-3 mb-0 text-sm leading-7 text-[color:var(--text-muted)]">{activeVectorOption.helper}</p>
                </div>
              ) : null}
            </div>
          </div>
          <svg
            viewBox={`0 0 ${TRACK.width} ${TRACK.height}`}
            className="relative h-full w-full"
            role="img"
            aria-label="Animated spring-mass oscillator; drag the mass to launch the motion"
          >
            <defs>
              <linearGradient id="mass-face" x1="0%" x2="100%" y1="0%" y2="100%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.96)" />
                <stop offset="100%" stopColor="rgba(219,234,254,0.82)" />
              </linearGradient>
            </defs>

            <line
              x1={TRACK.equilibriumX}
              x2={TRACK.equilibriumX}
              y1="54"
              y2="274"
              stroke="rgba(15, 118, 110, 0.5)"
              strokeWidth="2"
              strokeDasharray="8 8"
            />
            <text x={TRACK.equilibriumX} y="44" textAnchor="middle" fill="rgba(15, 118, 110, 0.9)" fontSize="16" fontWeight="700">
              equilibrium
            </text>

            <rect x={TRACK.wallX} y="86" width="16" height="176" rx="4" fill="rgba(15, 23, 42, 0.78)" />
            <rect x={TRACK.wallX + 16} y="96" width="10" height="156" rx="3" fill="rgba(15, 23, 42, 0.22)" />
            <line
              x1={TRACK.wallX + 16}
              x2="912"
              y1={TRACK.springY}
              y2={TRACK.springY}
              stroke="rgba(148, 163, 184, 0.5)"
              strokeWidth="5"
              strokeLinecap="round"
            />

            <polyline
              points={springPoints}
              fill="none"
              stroke="rgba(59, 130, 246, 0.9)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            <rect
              x={massLeftX}
              y={TRACK.springY - TRACK.massHeight / 2}
              width={TRACK.massWidth}
              height={TRACK.massHeight}
              rx="22"
              fill="url(#mass-face)"
              stroke="rgba(30, 64, 175, 0.7)"
              strokeWidth="4"
            />
            <rect
              x={massLeftX + 20}
              y={TRACK.springY - TRACK.massHeight / 2 + 18}
              width={TRACK.massWidth - 40}
              height="12"
              rx="6"
              fill="rgba(59, 130, 246, 0.16)"
            />
            <text
              x={massCenterX}
              y={TRACK.springY + 8}
              textAnchor="middle"
              fill="rgba(15, 23, 42, 0.78)"
              fontSize="20"
              fontWeight="700"
            >
              m
            </text>

            {vectorVisible ? (
              <>
                <text
                  x={vectorLabelX}
                  y={TRACK.springY - 84}
                  textAnchor="middle"
                  fill={activeVectorOption.accent}
                  fontSize="15"
                  fontWeight="700"
                >
                  {activeVectorOption.shortLabel}
                </text>
                <line
                  x1={vectorStartX}
                  x2={vectorShaftEndX}
                  y1={TRACK.springY - 68}
                  y2={TRACK.springY - 68}
                  stroke={activeVectorOption.stroke}
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                <polygon points={vectorHeadPoints} fill={activeVectorOption.stroke} />
              </>
            ) : null}

            <text x="94" y="286" fill="rgba(71, 85, 105, 0.95)" fontSize="16" fontWeight="600">
              wall
            </text>
            <text
              x={TRACK.equilibriumX + 12}
              y="300"
              fill="rgba(15, 118, 110, 0.85)"
              fontSize="16"
              fontWeight="600"
            >
              x = 0
            </text>
          </svg>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-6 p-5 lg:grid-cols-[1.08fr_0.92fr]">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-4 shadow-sm">
            <div>
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">Playback</p>
              <p className="mt-2 mb-0 text-sm leading-7 text-[color:var(--text-muted)]">
                Click-drag the mass to start the oscillation.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsPlaying((playing) => !playing)}
                className="flex items-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                onClick={resetMotion}
                className="rounded-full border border-[var(--grid-line)] bg-[var(--bg-primary)] p-2.5 text-[color:var(--text-muted)] shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
                aria-label="Reset motion"
                title="Reset motion"
              >
                <RotateCcw className="h-5 w-5" />
              </button>
            </div>
          </div>

          <CollapsiblePanel
            title="Parameters"
            accentColor="var(--accent-blue)"
            preview={`m ${formatNumber(mass)} kg, k ${formatNumber(springConstant)} N/m, zeta ${formatNumber(dampingRatio, 2)}`}
            isOpen={openSections.parameters}
            onToggle={() => toggleSection('parameters')}
          >
            <div className="space-y-5">
              <ControlSlider
                label="Mass"
                value={mass}
                valueLabel={`${formatNumber(mass)} kg`}
                min="0.6"
                max="3.2"
                step="0.1"
                onChange={setMass}
              />

              <ControlSlider
                label="Spring constant"
                value={springConstant}
                valueLabel={`${formatNumber(springConstant)} N/m`}
                min="4"
                max="18"
                step="0.5"
                onChange={setSpringConstant}
              />

              <ControlSlider
                label="Damping ratio"
                value={dampingRatio}
                valueLabel={formatNumber(dampingRatio, 2)}
                min="0"
                max="1"
                step="0.01"
                onChange={setDampingRatio}
              />
            </div>


          </CollapsiblePanel>

          <CollapsiblePanel
            title="Energy Exchange"
            accentColor={COLORS.position}
            preview={`E = ${formatNumber(mechanicalEnergy)} J`}
            isOpen={openSections.energy}
            onToggle={() => toggleSection('energy')}
          >
            <div className="space-y-4">
              <div>
                <div className="mb-1 flex items-center justify-between gap-4 text-sm">
                  <span className="text-[color:var(--text-muted)]">Spring potential</span>
                  <span className="font-mono text-[color:var(--text-primary)]">{formatNumber(potentialEnergy)} J</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--grid-line)]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.min(100, (potentialEnergy / energyScale) * 100)}%`, backgroundColor: COLORS.position }}
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-4 text-sm">
                  <span className="text-[color:var(--text-muted)]">Kinetic</span>
                  <span className="font-mono text-[color:var(--text-primary)]">{formatNumber(kineticEnergy)} J</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--grid-line)]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.min(100, (kineticEnergy / energyScale) * 100)}%`, backgroundColor: COLORS.velocity }}
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-4 text-sm">
                  <span className="text-[color:var(--text-muted)]">Mechanical total</span>
                  <span className="font-mono text-[color:var(--text-primary)]">{formatNumber(mechanicalEnergy)} J</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--grid-line)]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.min(100, (mechanicalEnergy / energyScale) * 100)}%`, backgroundColor: COLORS.neutral }}
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-4">
              {energyReference > 0 ? (
                <>
                  <p className="m-0 text-sm leading-7 text-[color:var(--text-primary)]">
                    Relative to the last launch: <span className="font-semibold">{formatNumber(relativeEnergy * 100, 1)}%</span>
                  </p>
                  <p className="mt-2 mb-0 text-sm leading-7 text-[color:var(--text-muted)]">
                    With zero damping, this stays essentially fixed. With damping, mechanical energy steadily leaks away; changing the mass or spring constant can also change the total because the system itself has changed.
                  </p>
                </>
              ) : (
                <p className="m-0 text-sm leading-7 text-[color:var(--text-muted)]">
                  Launch the mass once to set a reference energy for the bar scaling.
                </p>
              )}
            </div>
          </CollapsiblePanel>
        </div>

        <div className="space-y-4">
          <CollapsiblePanel
            title="Kinematics"
            accentColor={COLORS.neutral}
            description="Open to compare the current displacement, velocity, acceleration, and timing of the oscillator."
            isOpen={openSections.kinematics}
            onToggle={() => toggleSection('kinematics')}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: COLORS.position }}>Position</p>
                <p className="mt-3 mb-1 text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">{formatSigned(current.position, 1)} m</p>
                <p className="m-0 text-sm text-[color:var(--text-muted)]">Signed displacement from equilibrium</p>
              </div>

              <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: COLORS.velocity }}>Velocity</p>
                <p className="mt-3 mb-1 text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">{formatSigned(current.velocity, 1)} m/s</p>
                <p className="m-0 text-sm text-[color:var(--text-muted)]">Fastest near the equilibrium crossing</p>
              </div>

              <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: COLORS.acceleration }}>Acceleration</p>
                <p className="mt-3 mb-1 text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">{formatSigned(current.acceleration, 1)} m/s^2</p>
                <p className="m-0 text-sm text-[color:var(--text-muted)]">Net response from the spring pull and damping</p>
              </div>

              <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">Timing</p>
                <p className="mt-3 mb-1 text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">
                  {isCriticallyDamped ? 'critical' : `${formatNumber(dampedPeriod, 1)} s`}
                </p>
                {isCriticallyDamped ? (
                  <p className="m-0 text-sm text-[color:var(--text-muted)]">Returns to equilibrium without oscillating</p>
                ) : (
                  <p className="m-0 text-sm text-[color:var(--text-muted)]">
                    Ideal: {formatNumber(idealPeriod, 1)} s, {formatNumber(frequency, 1)} Hz
                  </p>
                )}
              </div>
            </div>
          </CollapsiblePanel>

          <CollapsiblePanel
            title="Position History"
            accentColor={COLORS.position}
            preview={`Current x(t): ${formatSigned(current.position)} m`}
            description="The displacement trace shows the repeating motion and how damping narrows the oscillation envelope over time."
            badge={`last ${HISTORY_WINDOW}s`}
            isOpen={openSections.positionHistory}
            onToggle={() => toggleSection('positionHistory')}
          >
            <HistoryChart
              history={simState.history}
              accessor={(sample) => sample.position}
              valueRange={DISPLAY_RANGE}
              stroke={COLORS.position}
              markerFill={COLORS.position}
            />
          </CollapsiblePanel>

          <CollapsiblePanel
            title="Velocity History"
            accentColor={COLORS.velocity}
            preview={`Current v(t): ${formatSigned(current.velocity)} m/s`}
            description="Velocity flips sign at each turning point and reaches its largest magnitude near equilibrium."
            badge={`last ${HISTORY_WINDOW}s`}
            isOpen={openSections.velocityHistory}
            onToggle={() => toggleSection('velocityHistory')}
          >
            <HistoryChart
              history={simState.history}
              accessor={(sample) => sample.velocity}
              valueRange={VELOCITY_PLOT_RANGE}
              stroke={COLORS.velocity}
              markerFill={COLORS.velocity}
            />
          </CollapsiblePanel>

        </div>
      </div>
    </div>
  );
}
