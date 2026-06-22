import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';

const TRACK = {
  viewWidth: 920,
  viewHeight: 420,
  centerX: 460,
  centerY: 86,
  radiusPx: 282,
  radiusM: 4.6,
  maxAngle: 1.12,
};

const GRAVITY_PRESETS = [
  { key: 'moon', label: 'Moon', value: 1.62 },
  { key: 'earth', label: 'Earth', value: 9.81 },
  { key: 'jupiter', label: 'Jupiter', value: 24.79 },
];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const formatNumber = (value, digits = 2) => {
  const fixed = value.toFixed(digits);
  return fixed === '-0.00' || fixed === '-0.0' ? fixed.slice(1) : fixed;
};

const formatSigned = (value, digits = 2) => {
  const normalized = Number(formatNumber(value, digits));
  if (Math.abs(normalized) < 1e-9) {
    return formatNumber(0, digits);
  }
  const formatted = formatNumber(normalized, digits);
  return normalized > 0 ? `+${formatted}` : formatted;
};

const angleToHeight = (angleMagnitude) => TRACK.radiusM * (1 - Math.cos(Math.abs(angleMagnitude)));

const heightToAngle = (height) =>
  Math.acos(clamp(1 - clamp(height, 0, TRACK.radiusM) / TRACK.radiusM, -1, 1));

const getPointAtAngle = (angle) => ({
  x: TRACK.centerX + TRACK.radiusPx * Math.sin(angle),
  y: TRACK.centerY + TRACK.radiusPx * Math.cos(angle),
});

const buildTrackPath = () =>
  Array.from({ length: 52 }, (_, index) => {
    const angle = -TRACK.maxAngle + (index / 51) * (TRACK.maxAngle * 2);
    const point = getPointAtAngle(angle);
    return `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }).join(' ');

const trackPath = buildTrackPath();

const getConfiguredState = ({ releaseAngleMagnitude, releaseSide, launchSpeed, mass, gravity }) => {
  const angle = releaseSide * releaseAngleMagnitude;
  const directionTowardBottom = angle === 0 ? 0 : -Math.sign(angle);
  const omega = directionTowardBottom * (launchSpeed / TRACK.radiusM);
  const height = angleToHeight(releaseAngleMagnitude);
  const baselineEnergy = 0.5 * mass * launchSpeed * launchSpeed + mass * gravity * height;

  return {
    angle,
    omega,
    thermalEnergy: 0,
    baselineEnergy,
    time: 0,
  };
};

const advanceTrackState = (state, dt, { gravity, friction, mass }) => {
  // A fourth-order Runge-Kutta step keeps the curved-track motion smooth without
  // the visible energy drift that a simple Euler step would introduce.
  const derivatives = (angle, omega) => ({
    dAngle: omega,
    dOmega: -(gravity / TRACK.radiusM) * Math.sin(angle) - friction * omega,
  });

  const k1 = derivatives(state.angle, state.omega);
  const k2 = derivatives(
    state.angle + k1.dAngle * dt * 0.5,
    state.omega + k1.dOmega * dt * 0.5,
  );
  const k3 = derivatives(
    state.angle + k2.dAngle * dt * 0.5,
    state.omega + k2.dOmega * dt * 0.5,
  );
  const k4 = derivatives(
    state.angle + k3.dAngle * dt,
    state.omega + k3.dOmega * dt,
  );

  let nextAngle =
    state.angle +
    (dt / 6) * (k1.dAngle + 2 * k2.dAngle + 2 * k3.dAngle + k4.dAngle);
  let nextOmega =
    state.omega +
    (dt / 6) * (k1.dOmega + 2 * k2.dOmega + 2 * k3.dOmega + k4.dOmega);

  if (nextAngle > TRACK.maxAngle) {
    nextAngle = TRACK.maxAngle;
    nextOmega = Math.min(nextOmega, 0);
  }

  if (nextAngle < -TRACK.maxAngle) {
    nextAngle = -TRACK.maxAngle;
    nextOmega = Math.max(nextOmega, 0);
  }

  if (Math.abs(nextAngle) < 0.0015 && Math.abs(nextOmega) < 0.004 && friction > 0.02) {
    nextAngle = 0;
    nextOmega = 0;
  }

  const speed = Math.abs(nextOmega) * TRACK.radiusM;
  const height = angleToHeight(nextAngle);
  const kineticEnergy = 0.5 * mass * speed * speed;
  const potentialEnergy = mass * gravity * height;

  return {
    angle: nextAngle,
    omega: nextOmega,
    baselineEnergy: state.baselineEnergy,
    thermalEnergy: Math.max(0, state.baselineEnergy - kineticEnergy - potentialEnergy),
    time: state.time + dt,
  };
};

const getStatusSummary = ({
  height,
  speed,
  potentialEnergy,
  kineticEnergy,
  thermalEnergy,
  friction,
}) => {
  if (potentialEnergy + kineticEnergy < 0.08 && thermalEnergy < 0.08) {
    return 'Place the cart on the track and release it to start the energy ledger.';
  }

  if (thermalEnergy > potentialEnergy + kineticEnergy && speed < 0.25) {
    return 'Track friction has converted most of the mechanical energy into thermal energy.';
  }

  if (friction > 0.02 && thermalEnergy > 0.08) {
    return 'Mechanical energy is being transferred into thermal energy as the cart moves.';
  }

  if (height > 1.15 && potentialEnergy >= kineticEnergy) {
    return 'High on the track, gravitational potential energy dominates the bookkeeping.';
  }

  if (height < 0.35 && speed > 1.1) {
    return 'Near the bottom, gravitational potential has mostly become kinetic energy.';
  }

  return 'The cart is continually exchanging gravitational potential and kinetic energy along the track.';
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

function MetricCard({ label, value, caption }) {
  return (
    <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-4 shadow-sm">
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
        {label}
      </p>
      <p className="mt-2 mb-1 text-xl font-semibold text-[color:var(--text-primary)]">{value}</p>
      <p className="m-0 text-sm leading-6 text-[color:var(--text-muted)]">{caption}</p>
    </div>
  );
}

function EnergyBar({ label, value, scale, color, caption }) {
  const width = scale > 0 ? Math.min(100, (value / scale) * 100) : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="font-medium text-[color:var(--text-primary)]">{label}</span>
        <span className="font-mono text-[color:var(--text-muted)]">{formatNumber(value)} J</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-slate-200/70">
        <div
          className="h-full rounded-full transition-[width] duration-200"
          style={{ width: `${width}%`, backgroundColor: color }}
        />
      </div>
      <p className="m-0 text-sm leading-6 text-[color:var(--text-muted)]">{caption}</p>
    </div>
  );
}

export default function EnergyTrackExplorer() {
  const [mass, setMass] = useState(1.6);
  const [releaseSide, setReleaseSide] = useState(1);
  const [releaseAngleMagnitude, setReleaseAngleMagnitude] = useState(() => heightToAngle(2.05));
  const [launchSpeed, setLaunchSpeed] = useState(0);
  const [friction, setFriction] = useState(0.14);
  const [gravityKey, setGravityKey] = useState('earth');
  const [isPlaying, setIsPlaying] = useState(false);
  const [simState, setSimState] = useState(() =>
    getConfiguredState({
      releaseAngleMagnitude: heightToAngle(2.05),
      releaseSide: 1,
      launchSpeed: 0,
      mass: 1.6,
      gravity: 9.81,
    }),
  );

  const stageRef = useRef(null);
  const frameRef = useRef();
  const lastTimeRef = useRef();
  const dragRef = useRef(false);

  const gravityPreset =
    GRAVITY_PRESETS.find((preset) => preset.key === gravityKey) ?? GRAVITY_PRESETS[1];
  const gravity = gravityPreset.value;

  useEffect(() => {
    setIsPlaying(false);
    lastTimeRef.current = undefined;
    setSimState(
      getConfiguredState({
        releaseAngleMagnitude,
        releaseSide,
        launchSpeed,
        mass,
        gravity,
      }),
    );
  }, [releaseAngleMagnitude, releaseSide, launchSpeed, mass, gravity, friction]);

  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(frameRef.current);
      lastTimeRef.current = undefined;
      return undefined;
    }

    const animate = (time) => {
      if (lastTimeRef.current == undefined) {
        lastTimeRef.current = time;
        frameRef.current = requestAnimationFrame(animate);
        return;
      }

      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.02);
      lastTimeRef.current = time;

      setSimState((previous) => advanceTrackState(previous, dt, { gravity, friction, mass }));
      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameRef.current);
      lastTimeRef.current = undefined;
    };
  }, [isPlaying, gravity, friction, mass]);

  const currentPoint = getPointAtAngle(simState.angle);
  const bottomPoint = getPointAtAngle(0);
  const speed = Math.abs(simState.omega) * TRACK.radiusM;
  const height = angleToHeight(simState.angle);
  const trackPosition = TRACK.radiusM * simState.angle;
  const kineticEnergy = 0.5 * mass * speed * speed;
  const potentialEnergy = mass * gravity * height;
  const thermalEnergy = simState.thermalEnergy;
  const totalEnergy = simState.baselineEnergy;
  const mechanicalEnergy = kineticEnergy + potentialEnergy;
  const energyScale = Math.max(totalEnergy, 1);
  const statusSummary = getStatusSummary({
    height,
    speed,
    potentialEnergy,
    kineticEnergy,
    thermalEnergy,
    friction,
  });

  const syncReleaseFromPointer = (event) => {
    const svg = stageRef.current;
    if (!svg) {
      return;
    }

    const rect = svg.getBoundingClientRect();
    const scaleX = TRACK.viewWidth / rect.width;
    const scaleY = TRACK.viewHeight / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    const angle = clamp(
      Math.atan2(x - TRACK.centerX, y - TRACK.centerY),
      -TRACK.maxAngle,
      TRACK.maxAngle,
    );

    if (Math.abs(angle) > 0.025) {
      setReleaseSide(angle >= 0 ? 1 : -1);
    }
    setReleaseAngleMagnitude(Math.max(0, Math.abs(angle)));
  };

  const handlePointerDown = (event) => {
    if (isPlaying) {
      return;
    }

    dragRef.current = true;
    stageRef.current?.setPointerCapture?.(event.pointerId);
    syncReleaseFromPointer(event);
  };

  const handlePointerMove = (event) => {
    if (!dragRef.current || isPlaying) {
      return;
    }

    syncReleaseFromPointer(event);
  };

  const handlePointerUp = (event) => {
    dragRef.current = false;
    if (stageRef.current?.hasPointerCapture?.(event.pointerId)) {
      stageRef.current.releasePointerCapture(event.pointerId);
    }
  };

  const handleReset = () => {
    setIsPlaying(false);
    lastTimeRef.current = undefined;
    setSimState(
      getConfiguredState({
        releaseAngleMagnitude,
        releaseSide,
        launchSpeed,
        mass,
        gravity,
      }),
    );
  };

  return (
    <div className="flex h-full min-h-[44rem] w-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--accent-blue)_14%,transparent),transparent_36%),radial-gradient(circle_at_bottom_right,color-mix(in_srgb,var(--accent-red)_10%,transparent),transparent_34%),var(--sim-bg)] text-[color:var(--text-primary)]">
      <div className="grid flex-1 lg:grid-cols-[1.45fr_0.95fr]">
        <div className="border-b border-[var(--grid-line)] lg:border-r lg:border-b-0">
          <div className="px-5 pt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
              Drag the cart to place the release point
            </p>
            <p className="m-0 max-w-3xl text-sm leading-7 text-[color:var(--text-muted)]">
              The slider sets the release height, and dragging lets you choose the exact spot on either side of the track. The launch speed is applied toward the bottom when the run resets.
            </p>
          </div>

          <div className="px-3 pb-4 pt-2 sm:px-5">
            <svg
              ref={stageRef}
              viewBox={`0 0 ${TRACK.viewWidth} ${TRACK.viewHeight}`}
              className="h-auto w-full touch-none select-none"
              role="img"
              aria-label="Energy track explorer"
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            >
              <defs>
                <linearGradient id="energy-stage-track-fill" x1="0%" x2="0%" y1="0%" y2="100%">
                  <stop offset="0%" stopColor="color-mix(in srgb, var(--accent-blue) 12%, white)" />
                  <stop offset="100%" stopColor="color-mix(in srgb, var(--accent-blue) 2%, var(--bg-primary))" />
                </linearGradient>
                <linearGradient id="energy-height-line" x1="0%" x2="0%" y1="0%" y2="100%">
                  <stop offset="0%" stopColor="color-mix(in srgb, var(--accent-blue) 70%, transparent)" />
                  <stop offset="100%" stopColor="color-mix(in srgb, var(--accent-blue) 25%, transparent)" />
                </linearGradient>
              </defs>

              <rect
                x="16"
                y="24"
                width={TRACK.viewWidth - 32}
                height={TRACK.viewHeight - 48}
                rx="26"
                fill="color-mix(in srgb, var(--bg-primary) 82%, white)"
              />

              {Array.from({ length: 6 }, (_, index) => {
                const x = 110 + index * 140;
                return (
                  <line
                    key={`grid-x-${x}`}
                    x1={x}
                    x2={x}
                    y1="42"
                    y2={TRACK.viewHeight - 52}
                    stroke="color-mix(in srgb, var(--grid-line) 80%, transparent)"
                    strokeWidth="1"
                  />
                );
              })}

              {Array.from({ length: 4 }, (_, index) => {
                const y = 102 + index * 68;
                return (
                  <line
                    key={`grid-y-${y}`}
                    x1="44"
                    x2={TRACK.viewWidth - 44}
                    y1={y}
                    y2={y}
                    stroke="color-mix(in srgb, var(--grid-line) 80%, transparent)"
                    strokeWidth="1"
                  />
                );
              })}

              <path
                d={`${trackPath} L ${getPointAtAngle(TRACK.maxAngle).x.toFixed(2)} ${(TRACK.viewHeight - 44).toFixed(2)} L ${getPointAtAngle(-TRACK.maxAngle).x.toFixed(2)} ${(TRACK.viewHeight - 44).toFixed(2)} Z`}
                fill="url(#energy-stage-track-fill)"
              />
              <path
                d={trackPath}
                fill="none"
                stroke="color-mix(in srgb, var(--text-primary) 78%, transparent)"
                strokeWidth="8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={trackPath}
                fill="none"
                stroke="color-mix(in srgb, white 82%, transparent)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.7"
              />

              <path
                d={trackPath}
                fill="none"
                stroke="transparent"
                strokeWidth="42"
                strokeLinecap="round"
                onPointerDown={handlePointerDown}
              />

              <line
                x1={currentPoint.x}
                x2={currentPoint.x}
                y1={currentPoint.y - 18}
                y2={bottomPoint.y}
                stroke="url(#energy-height-line)"
                strokeWidth="2"
                strokeDasharray="7 7"
              />
              <line
                x1="58"
                x2={TRACK.viewWidth - 58}
                y1={bottomPoint.y}
                y2={bottomPoint.y}
                stroke="color-mix(in srgb, var(--text-muted) 48%, transparent)"
                strokeWidth="2"
              />

              <circle
                cx={currentPoint.x}
                cy={currentPoint.y - 10}
                r="22"
                fill="color-mix(in srgb, var(--bg-primary) 94%, white)"
                stroke={isPlaying ? '#0f766e' : 'var(--accent-blue)'}
                strokeWidth="5"
                onPointerDown={handlePointerDown}
                style={{ cursor: isPlaying ? 'default' : 'grab' }}
              />
              <circle cx={currentPoint.x} cy={currentPoint.y - 10} r="6.5" fill={isPlaying ? '#0f766e' : 'var(--accent-blue)'} />

              <g transform={`translate(${currentPoint.x}, ${currentPoint.y - 62})`}>
                <rect
                  x="-70"
                  y="-20"
                  width="140"
                  height="32"
                  rx="16"
                  fill="color-mix(in srgb, var(--surface-elevated) 96%, white)"
                  stroke="color-mix(in srgb, var(--grid-line) 88%, transparent)"
                />
                <text
                  x="0"
                  y="1"
                  textAnchor="middle"
                  className="fill-[color:var(--text-primary)] text-[13px] font-semibold"
                >
                  {`h = ${formatNumber(height)} m`}
                </text>
              </g>

              <g transform={`translate(${TRACK.viewWidth - 168}, 78)`}>
                <rect
                  x="0"
                  y="0"
                  width="122"
                  height="74"
                  rx="20"
                  fill="color-mix(in srgb, var(--surface-elevated) 94%, white)"
                  stroke="color-mix(in srgb, var(--grid-line) 92%, transparent)"
                />
                <text x="18" y="25" className="fill-[color:var(--text-muted)] text-[11px] font-semibold uppercase tracking-[0.18em]">
                  Tracked Total
                </text>
                <text x="18" y="48" className="fill-[color:var(--text-primary)] text-[22px] font-semibold">
                  {`${formatNumber(totalEnergy, 1)} J`}
                </text>
              </g>
            </svg>
          </div>

          <div className="grid gap-3 border-t border-[var(--grid-line)] px-5 py-4 sm:grid-cols-3">
            <MetricCard
              label="Track Position"
              value={`${formatSigned(trackPosition)} m`}
              caption="Signed distance along the track measured from the bottom."
            />
            <MetricCard
              label="Speed"
              value={`${formatNumber(speed)} m/s`}
              caption="The cart moves fastest near the bottom of the track."
            />
            <MetricCard
              label="Height"
              value={`${formatNumber(height)} m`}
              caption="Gravitational potential energy depends on the cart's height."
            />
          </div>
        </div>

        <div className="flex flex-col">
          <div className="border-b border-[var(--grid-line)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
                  Status
                </p>
                <p className="m-0 max-w-xl text-sm leading-7 text-[color:var(--text-primary)]">
                  {statusSummary}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsPlaying((current) => !current)}
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="inline-flex items-center justify-center rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-2.5 text-[color:var(--text-muted)] shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
                  aria-label="Reset simulation"
                  title="Reset simulation"
                >
                  <RotateCcw className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="mt-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                Gravity Preset
              </p>
              <div className="flex flex-wrap gap-2">
                {GRAVITY_PRESETS.map((preset) => {
                  const isActive = preset.key === gravityKey;
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => setGravityKey(preset.key)}
                      className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all duration-300 ${
                        isActive
                          ? 'border-[var(--accent-blue)] bg-[color-mix(in_srgb,var(--accent-blue)_12%,var(--bg-primary))] text-[var(--accent-blue)]'
                          : 'border-[var(--grid-line)] bg-[var(--surface-elevated)] text-[color:var(--text-primary)] hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]'
                      }`}
                    >
                      {preset.label} ({formatNumber(preset.value, 2)} m/s^2)
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid gap-5 p-5">
            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                Controls
              </p>
              <div className="space-y-5">
                <ControlSlider
                  label="Release Height"
                  value={angleToHeight(releaseAngleMagnitude)}
                  valueLabel={`${formatNumber(angleToHeight(releaseAngleMagnitude))} m`}
                  min={0}
                  max={angleToHeight(TRACK.maxAngle)}
                  step={0.01}
                  onChange={(nextHeight) => setReleaseAngleMagnitude(heightToAngle(nextHeight))}
                />
                <ControlSlider
                  label="Launch Speed"
                  value={launchSpeed}
                  valueLabel={`${formatNumber(launchSpeed)} m/s`}
                  min={0}
                  max={5.6}
                  step={0.05}
                  onChange={setLaunchSpeed}
                />
                <ControlSlider
                  label="Mass"
                  value={mass}
                  valueLabel={`${formatNumber(mass)} kg`}
                  min={0.5}
                  max={4.5}
                  step={0.05}
                  onChange={setMass}
                />
                <ControlSlider
                  label="Track Friction"
                  value={friction}
                  valueLabel={formatNumber(friction)}
                  min={0}
                  max={0.9}
                  step={0.01}
                  onChange={setFriction}
                />
              </div>
            </section>

            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                Energy Bars
              </p>
              <div className="space-y-4">
                <EnergyBar
                  label="Kinetic Energy"
                  value={kineticEnergy}
                  scale={energyScale}
                  color="#0f766e"
                  caption="Motion energy grows as the cart drops toward the bottom."
                />
                <EnergyBar
                  label="Gravitational Potential"
                  value={potentialEnergy}
                  scale={energyScale}
                  color="var(--accent-blue)"
                  caption="Stored height energy depends on how far the cart is above the bottom."
                />
                <EnergyBar
                  label="Thermal Energy"
                  value={thermalEnergy}
                  scale={energyScale}
                  color="#b45309"
                  caption="Track friction converts part of the mechanical energy into thermal energy."
                />
                <EnergyBar
                  label="Total Tracked Energy"
                  value={totalEnergy}
                  scale={energyScale}
                  color="#475569"
                  caption="This stays fixed for a given run; the bars above just redistribute that same total."
                />
              </div>
            </section>

            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-5 shadow-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                Energy Accounting
              </p>
              <p className="m-0 text-sm leading-7 text-[color:var(--text-primary)]">
                Mechanical energy right now:
                {' '}
                <span className="font-semibold">{formatNumber(mechanicalEnergy)} J</span>
              </p>
              <p className="mt-2 mb-0 text-sm leading-7 text-[color:var(--text-muted)]">
                With zero friction, almost all of that stays split between
                {' '}
                <span className="font-semibold">K</span>
                {' '}
                and
                {' '}
                <span className="font-semibold">U_g</span>
                .
                With friction, the missing mechanical energy shows up in the thermal bar instead.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
