import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, StepForward } from 'lucide-react';
import {
  buildAbsorbingMask1D,
  buildSquareBarrier1D,
  cloneComplexField,
  createGaussianPacket1D,
  probabilityInRegion1D,
  splitStep1D,
  totalProbability1D,
} from '../../lib/quantum/timeEvolution';

const COUNT = 1024;
const X_MIN = -12;
const X_MAX = 12;
const BARRIER_FROM = 0;
const BARRIER_TO = 0.75;
const DT = 0.004;
const ENERGY_AXIS_MAX = 10;
const PLOT = {
  x: 48,
  y: 34,
  width: 574,
  height: 230,
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const formatNumber = (value, digits = 2) => {
  const fixed = value.toFixed(digits);
  return fixed === '-0.00' || fixed === '-0.0' ? fixed.slice(1) : fixed;
};

const pathFromSeries = (points, xProject, yProject) =>
  points
    .map((point, index) => {
      const x = xProject(point, index);
      const y = yProject(point, index);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

function ControlSlider({ label, value, valueLabel, min, max, step, onChange }) {
  return (
    <label className="block">
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
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

function IconButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] text-[color:var(--text-primary)] shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
    >
      {children}
    </button>
  );
}

function LegendToggle({ active, color, dashed = false, label, onClick }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? 'border-[var(--accent-blue)] bg-[color:color-mix(in_srgb,var(--accent-blue)_10%,white)] text-[color:var(--text-primary)]'
          : 'border-[var(--grid-line)] bg-[var(--surface-elevated)] text-[color:var(--text-muted)] hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]'
      }`}
    >
      <span
        className={`h-0.5 w-6 ${dashed ? 'border-t-2 border-dashed bg-transparent' : ''}`}
        style={dashed ? { borderColor: color } : { backgroundColor: color }}
      />
      {label}
    </button>
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

const getFieldScale = (field) => {
  let maxAmplitude = 0;
  let maxProbability = 0;

  for (let index = 0; index < field.count; index += 1) {
    const probability = field.re[index] * field.re[index] + field.im[index] * field.im[index];
    maxAmplitude = Math.max(maxAmplitude, Math.abs(field.re[index]), Math.abs(field.im[index]));
    maxProbability = Math.max(maxProbability, probability);
  }

  return {
    maxAmplitude: Math.max(maxAmplitude, 1e-6),
    maxProbability: Math.max(maxProbability, 1e-6),
  };
};

const smoothSamples = (samples, passes = 2) => {
  let smoothed = samples;

  for (let pass = 0; pass < passes; pass += 1) {
    smoothed = smoothed.map((sample, index) => {
      if (index === 0 || index === smoothed.length - 1) {
        return sample;
      }

      const previous = smoothed[index - 1];
      const next = smoothed[index + 1];

      return {
        ...sample,
        im: previous.im * 0.25 + sample.im * 0.5 + next.im * 0.25,
        probability:
          previous.probability * 0.25 + sample.probability * 0.5 + next.probability * 0.25,
        re: previous.re * 0.25 + sample.re * 0.5 + next.re * 0.25,
      };
    });
  }

  return smoothed;
};

const buildScenario = ({ barrierHeight, momentum, packetWidth }) => {
  const field = createGaussianPacket1D({
    count: COUNT,
    xMin: X_MIN,
    xMax: X_MAX,
    x0: -6.4,
    sigma: packetWidth,
    k0: momentum,
  });
  const potential = buildSquareBarrier1D(
    COUNT,
    field.xMin,
    field.dx,
    BARRIER_FROM,
    BARRIER_TO,
    barrierHeight,
  );
  const absorber = buildAbsorbingMask1D(COUNT, 72, 0.08);
  const scale = getFieldScale(field);

  return {
    absorber,
    field,
    potential,
    scale,
  };
};

const makeSnapshot = (field, potential, time, scale) => {
  const samples = [];

  for (let index = 0; index < field.count; index += 2) {
    const x = field.xMin + index * field.dx;
    const probability = field.re[index] * field.re[index] + field.im[index] * field.im[index];
    samples.push({
      im: field.im[index],
      x,
      probability,
      potential: potential[index],
      re: field.re[index],
    });
  }

  const total = totalProbability1D(field);
  const reflected = probabilityInRegion1D(field, X_MIN + 1.4, BARRIER_FROM - 0.45);
  const insideBarrier = probabilityInRegion1D(field, BARRIER_FROM, BARRIER_TO);
  const transmitted = probabilityInRegion1D(field, BARRIER_TO + 0.45, X_MAX - 1.4);
  const scatteringTotal = reflected + transmitted;

  return {
    absorbed: clamp(1 - total, 0, 1),
    insideBarrier,
    maxAmplitude: scale.maxAmplitude,
    maxProbability: scale.maxProbability,
    reflected,
    reflectedShare: scatteringTotal > 1e-8 ? reflected / scatteringTotal : 1,
    samples: smoothSamples(samples),
    time,
    total,
    transmitted,
    transmittedShare: scatteringTotal > 1e-8 ? transmitted / scatteringTotal : 0,
  };
};

const getNarrative = ({ barrierHeight, kineticEnergy, transmittedShare }) => {
  if (barrierHeight < kineticEnergy) {
    return 'The barrier height is lower than the packet energy scale, so classical transmission is allowed; the wavefunction can still leave a reflected pulse behind.';
  }

  if (barrierHeight > kineticEnergy) {
    return 'The barrier is higher than the packet energy scale, but the tail can still leak through because the wavefunction penetrates the forbidden region.';
  }

  if (transmittedShare > 0.35) {
    return 'Near the classical threshold, transmission dominates while a reflected pulse still travels back to the left.';
  }

  return 'The split-step solver advances the packet with the finite barrier included in the phase update, so reflection and transmission emerge from the same wavefunction.';
};

export default function FiniteBarrierScatteringInline() {
  const [barrierHeight, setBarrierHeight] = useState(6.8);
  const [momentum, setMomentum] = useState(3.25);
  const [packetWidth, setPacketWidth] = useState(0.62);
  const [speed, setSpeed] = useState(4);
  const [isPlaying, setIsPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [showPacketEnergy, setShowPacketEnergy] = useState(false);
  const [drawParts, setDrawParts] = useState({
    re: true,
    im: false,
    probability: true,
  });
  const fieldRef = useRef();
  const frameRef = useRef();
  const lastTimeRef = useRef();

  const scenario = useMemo(
    () => buildScenario({ barrierHeight, momentum, packetWidth }),
    [barrierHeight, momentum, packetWidth],
  );
  const [snapshot, setSnapshot] = useState(() =>
    makeSnapshot(scenario.field, scenario.potential, 0, scenario.scale),
  );

  const reset = useCallback(() => {
    fieldRef.current = cloneComplexField(scenario.field);
    setTime(0);
    setSnapshot(makeSnapshot(fieldRef.current, scenario.potential, 0, scenario.scale));
  }, [scenario]);

  useEffect(() => {
    reset();
  }, [reset]);

  const stepSimulation = useCallback(
    (steps = 8) => {
      if (!fieldRef.current) {
        return;
      }

      for (let index = 0; index < steps; index += 1) {
        splitStep1D(fieldRef.current, scenario.potential, {
          absorber: scenario.absorber,
          dt: DT,
        });
      }

      setTime((current) => {
        const next = current + DT * steps;
        setSnapshot(makeSnapshot(fieldRef.current, scenario.potential, next, scenario.scale));
        return next;
      });
    },
    [scenario],
  );

  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(frameRef.current);
      lastTimeRef.current = undefined;
      return undefined;
    }

    const animate = (now) => {
      if (lastTimeRef.current == null) {
        lastTimeRef.current = now;
      }

      const elapsed = Math.min((now - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = now;
      const steps = Math.max(1, Math.round(speed + elapsed * 40));
      stepSimulation(steps);
      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameRef.current);
      lastTimeRef.current = undefined;
    };
  }, [isPlaying, speed, stepSimulation]);

  const kineticEnergy = (momentum * momentum) / 2;
  const xScale = (x) => PLOT.x + ((x - X_MIN) / (X_MAX - X_MIN)) * PLOT.width;
  const energyYScale = (energy) =>
    PLOT.y +
    PLOT.height -
    (clamp(energy, 0, ENERGY_AXIS_MAX) / ENERGY_AXIS_MAX) * (PLOT.height - 16);
  const yScale = (probability) =>
    PLOT.y + PLOT.height - (probability / Math.max(snapshot.maxProbability, 1e-6)) * 176;
  const amplitudeYScale = (value) =>
    PLOT.y + PLOT.height * 0.5 - (value / Math.max(snapshot.maxAmplitude, 1e-6)) * 88;
  const barrierTopY = energyYScale(barrierHeight);
  const packetEnergyY = energyYScale(kineticEnergy);
  const barrierEnergyRelation = barrierHeight < kineticEnergy ? 'V0 < E' : 'V0 > E';
  const status = getNarrative({
    barrierHeight,
    kineticEnergy,
    transmittedShare: snapshot.transmittedShare,
  });
  const togglePart = (part) => {
    setDrawParts((current) => ({
      ...current,
      [part]: !current[part],
    }));
  };

  return (
    <section className="not-prose my-8 overflow-hidden rounded-[1.8rem] border border-[var(--grid-line)] bg-[radial-gradient(circle_at_bottom_left,color-mix(in_srgb,var(--accent-blue)_10%,transparent),transparent_34%),var(--sim-bg)] text-[color:var(--text-primary)] shadow-sm">
      <div className="border-b border-[var(--grid-line)] p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
            Finite Barrier Scattering
          </p>
          <div className="flex items-center gap-2">
            <IconButton
              label={isPlaying ? 'Pause barrier scattering' : 'Play barrier scattering'}
              onClick={() => setIsPlaying((current) => !current)}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </IconButton>
            <IconButton
              label="Step barrier scattering"
              onClick={() => {
                setIsPlaying(false);
                stepSimulation(24);
              }}
            >
              <StepForward className="h-4 w-4" />
            </IconButton>
            <IconButton label="Reset barrier scattering" onClick={reset}>
              <RotateCcw className="h-4 w-4" />
            </IconButton>
          </div>
        </div>

        <svg viewBox="0 0 680 332" className="h-auto w-full" role="img" aria-label="Finite barrier scattering plot">
          <defs>
            <linearGradient id="barrier-prob-fill" x1="0%" x2="0%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="color-mix(in srgb, var(--accent-blue) 30%, white)" />
              <stop offset="100%" stopColor="color-mix(in srgb, var(--accent-blue) 6%, transparent)" />
            </linearGradient>
          </defs>
          <rect x="24" y="18" width="632" height="288" rx="26" fill="color-mix(in srgb, var(--bg-primary) 86%, white)" />
          {Array.from({ length: 6 }, (_, index) => {
            const y = PLOT.y + index * (PLOT.height / 5);
            return (
              <line
                key={`barrier-grid-${y}`}
                x1={PLOT.x}
                x2={PLOT.x + PLOT.width}
                y1={y}
                y2={y}
                stroke="color-mix(in srgb, var(--grid-line) 78%, transparent)"
              />
            );
          })}
          <path
            d={`${pathFromSeries(
              snapshot.samples,
              (sample) => xScale(sample.x),
              (sample) => energyYScale(sample.potential),
            )} L ${PLOT.x + PLOT.width} ${PLOT.y + PLOT.height} L ${PLOT.x} ${
              PLOT.y + PLOT.height
            } Z`}
            fill="rgba(15,23,42,0.16)"
          />
          {showPacketEnergy ? (
            <>
              <line
                x1={PLOT.x}
                x2={PLOT.x + PLOT.width}
                y1={packetEnergyY}
                y2={packetEnergyY}
                stroke="#0f766e"
                strokeDasharray="8 7"
                strokeOpacity="0.9"
                strokeWidth="2.5"
              />
              <text
                x={PLOT.x + PLOT.width - 8}
                y={Math.max(PLOT.y + 18, packetEnergyY - 8)}
                fill="#0f766e"
                fontSize="15"
                fontWeight="700"
                textAnchor="end"
              >
                packet E
              </text>
            </>
          ) : null}
          <text
            x={xScale(BARRIER_TO) + 12}
            y={Math.max(PLOT.y + 20, barrierTopY - 8)}
            fill="#0f172a"
            fillOpacity="0.74"
            fontSize="14"
            fontWeight="700"
          >
            V0
          </text>
          <line
            x1={PLOT.x}
            x2={PLOT.x + PLOT.width}
            y1={PLOT.y + PLOT.height * 0.5}
            y2={PLOT.y + PLOT.height * 0.5}
            stroke="color-mix(in srgb, var(--text-muted) 45%, transparent)"
            strokeWidth="2"
          />
          <line
            x1={PLOT.x}
            x2={PLOT.x + PLOT.width}
            y1={PLOT.y + PLOT.height}
            y2={PLOT.y + PLOT.height}
            stroke="color-mix(in srgb, var(--text-muted) 55%, transparent)"
            strokeWidth="2"
          />
          {drawParts.probability ? (
            <path
              d={`${pathFromSeries(snapshot.samples, (sample) => xScale(sample.x), (sample) =>
                yScale(sample.probability),
              )} L ${PLOT.x + PLOT.width} ${PLOT.y + PLOT.height} L ${PLOT.x} ${
                PLOT.y + PLOT.height
              } Z`}
              fill="url(#barrier-prob-fill)"
            />
          ) : null}
          {drawParts.probability ? (
            <path
              d={pathFromSeries(snapshot.samples, (sample) => xScale(sample.x), (sample) =>
                yScale(sample.probability),
              )}
              fill="none"
              stroke="var(--accent-blue)"
              strokeWidth="3"
            />
          ) : null}
          {drawParts.re ? (
            <path
              d={pathFromSeries(snapshot.samples, (sample) => xScale(sample.x), (sample) =>
                amplitudeYScale(sample.re),
              )}
              fill="none"
              stroke="#c2410c"
              strokeOpacity="0.8"
              strokeWidth="2"
            />
          ) : null}
          {drawParts.im ? (
            <path
              d={pathFromSeries(snapshot.samples, (sample) => xScale(sample.x), (sample) =>
                amplitudeYScale(sample.im),
              )}
              fill="none"
              stroke="#0f766e"
              strokeDasharray="7 7"
              strokeOpacity="0.9"
              strokeWidth="2.25"
            />
          ) : null}
          <line
            x1={xScale(BARRIER_FROM)}
            x2={xScale(BARRIER_FROM)}
            y1={barrierTopY}
            y2={PLOT.y + PLOT.height}
            stroke="#0f172a"
            strokeOpacity="0.54"
            strokeWidth="2"
          />
          <line
            x1={xScale(BARRIER_TO)}
            x2={xScale(BARRIER_TO)}
            y1={barrierTopY}
            y2={PLOT.y + PLOT.height}
            stroke="#0f172a"
            strokeOpacity="0.54"
            strokeWidth="2"
          />
        </svg>

        <div className="mt-3 flex flex-wrap gap-2">
          <LegendToggle
            active={drawParts.re}
            color="#c2410c"
            label="Re(psi)"
            onClick={() => togglePart('re')}
          />
          <LegendToggle
            active={drawParts.im}
            color="#0f766e"
            dashed
            label="Im(psi)"
            onClick={() => togglePart('im')}
          />
          <LegendToggle
            active={drawParts.probability}
            color="var(--accent-blue)"
            label="|psi|^2"
            onClick={() => togglePart('probability')}
          />
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[0.95fr_1.35fr]">
        <div className="border-b border-[var(--grid-line)] p-5 lg:border-r lg:border-b-0">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
              Scattering
            </p>
            <p className="m-0 text-sm leading-7 text-[color:var(--text-primary)]">{status}</p>
        </div>

        <div className="grid gap-5 p-5">
            <section className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                Controls
              </p>
              <div className="space-y-5">
                <ControlSlider
                  label="Barrier Height"
                  value={barrierHeight}
                  valueLabel={formatNumber(barrierHeight, 2)}
                  min={1}
                  max={10}
                  step={0.05}
                  onChange={(value) => {
                    setShowPacketEnergy(true);
                    setBarrierHeight(clamp(value, 1, 10));
                  }}
                />
                <ControlSlider
                  label="Packet Momentum"
                  value={momentum}
                  valueLabel={formatNumber(momentum, 2)}
                  min={2.2}
                  max={4.3}
                  step={0.01}
                  onChange={(value) => {
                    setShowPacketEnergy(true);
                    setMomentum(clamp(value, 2.2, 4.3));
                  }}
                />
                <ControlSlider
                  label="Packet Width"
                  value={packetWidth}
                  valueLabel={formatNumber(packetWidth, 2)}
                  min={0.45}
                  max={1.05}
                  step={0.01}
                  onChange={(value) => setPacketWidth(clamp(value, 0.45, 1.05))}
                />
                <ControlSlider
                  label="Speed"
                  value={speed}
                  valueLabel={`${Math.round(speed)}x`}
                  min={1}
                  max={8}
                  step={1}
                  onChange={(value) => setSpeed(Math.round(value))}
                />
              </div>
            </section>

            
          
        </div>
      </div>
    </section>
  );
}
