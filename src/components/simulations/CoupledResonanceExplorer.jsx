import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';

const MODE_OPTIONS = {
  single: {
    key: 'single',
    label: '1 oscillator',
    shortLabel: '1',
    count: 1,
    guide:
      'Start with one driven oscillator so the basic resonance peak is easy to see before neighbors are added.',
  },
  pair: {
    key: 'pair',
    label: '2 oscillators',
    shortLabel: '2',
    count: 2,
    guide:
      'Drive the left mass and compare the lower shared mode with the higher opposite-sign mode.',
  },
  five: {
    key: 'five',
    label: '5 oscillators',
    shortLabel: '5',
    count: 5,
    guide:
      'Add a few neighbors and watch the same coupling idea start to organize a small wave-like pattern.',
  },
  chain: {
    key: 'chain',
    label: 'Chain (40)',
    shortLabel: '40',
    count: 40,
    guide:
      'Stretch the same model across forty masses so the shared motion starts to read like a discrete medium.',
  },
};

const STAGE = {
  width: 960,
  height: 420,
  leftPostX: 108,
  rightPostX: 852,
  baselineY: 214,
  topLimitY: 76,
  bottomLimitY: 352,
};

const HISTORY_WINDOW = 6;
const RESPONSE_WINDOW = 3.2;
const MAX_FRAME_STEP = 0.04;
const MAX_SUBSTEP = 1 / 600;
const MAX_DISPLAY_DISPLACEMENT = 1.75;
const PIXELS_PER_UNIT = 58;

const MIN_FREQUENCY = 0;
const MAX_FREQUENCY = 3;
const MIN_COUPLING = 8;
const MAX_COUPLING = 120;
const MIN_DAMPING = 0.01;
const MAX_DAMPING = 1.3;
const MIN_DRIVE = 0.2;
const MAX_DRIVE = 2.5;

const DEFAULT_MODE = 'pair';
const DEFAULT_COUPLING = 18;
const DEFAULT_DAMPING = 0.24;
const DEFAULT_DRIVE = 0.58;
const DEFAULT_FREQUENCY = getPresetFrequencies(DEFAULT_MODE, DEFAULT_COUPLING).lower;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const formatNumber = (value, digits = 2) => {
  const fixed = value.toFixed(digits);
  return fixed === '-0.00' || fixed === '-0.0' ? fixed.slice(1) : fixed;
};

function getMassCount(mode) {
  return MODE_OPTIONS[mode].count;
}

function getNaturalFrequencies(mode, coupling) {
  const count = getMassCount(mode);
  const base = Math.sqrt(coupling) / Math.PI;

  if (count === 1) {
    const single = base * Math.sin(Math.PI / 4);
    return [single, null];
  }

  return [1, 2].map((modeIndex) => base * Math.sin((modeIndex * Math.PI) / (2 * (count + 1))));
}

function getPresetFrequencies(mode, coupling) {
  const [lower, higher] = getNaturalFrequencies(mode, coupling);

  return {
    off:
      mode === 'pair'
        ? clamp(lower * 0.72, MIN_FREQUENCY, MAX_FREQUENCY)
        : clamp((higher ?? lower) * 1.35, MIN_FREQUENCY, MAX_FREQUENCY),
    lower: clamp(lower, MIN_FREQUENCY, MAX_FREQUENCY),
    higher: higher === null ? null : clamp(higher, MIN_FREQUENCY, MAX_FREQUENCY),
  };
}

function createInitialState(mode) {
  const count = getMassCount(mode);
  const displacements = Array(count).fill(0);

  return {
    time: 0,
    displacements,
    velocities: Array(count).fill(0),
    history: [
      {
        time: 0,
        displacements: displacements.slice(),
      },
    ],
  };
}

function computeAccelerations(displacements, velocities, time, params) {
  const drive = params.driveAmplitude * Math.sin(2 * Math.PI * params.driveFrequency * time);
  const count = displacements.length;
  const accelerations = Array(count).fill(0);

  for (let index = 0; index < count; index += 1) {
    const left = index === 0 ? 0 : displacements[index - 1];
    const right = index === count - 1 ? 0 : displacements[index + 1];

    accelerations[index] =
      params.coupling * (left - 2 * displacements[index] + right) -
      params.damping * velocities[index] +
      (index === 0 ? drive : 0);
  }

  return accelerations;
}

function advanceState(state, dt, params) {
  if (dt <= 0) {
    return;
  }

  const substeps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
  const step = dt / substeps;

  // Use small fixed substeps so the driven chain stays stable as the sliders move.
  for (let substep = 0; substep < substeps; substep += 1) {
    const accelerations = computeAccelerations(
      state.displacements,
      state.velocities,
      state.time,
      params,
    );

    for (let index = 0; index < state.velocities.length; index += 1) {
      state.velocities[index] = clamp(
        state.velocities[index] + accelerations[index] * step,
        -10,
        10,
      );
    }

    for (let index = 0; index < state.displacements.length; index += 1) {
      state.displacements[index] = clamp(
        state.displacements[index] + state.velocities[index] * step,
        -2.3,
        2.3,
      );
    }

    state.time += step;
  }
}

function appendSnapshot(state) {
  state.history.push({
    time: state.time,
    displacements: state.displacements.slice(),
  });

  while (state.history.length > 1 && state.time - state.history[0].time > HISTORY_WINDOW) {
    state.history.shift();
  }
}

function getResponsePeaks(history, count, lastTime) {
  const cutoff = Math.max(0, lastTime - RESPONSE_WINDOW);
  const peaks = Array(count).fill(0);

  history.forEach((snapshot) => {
    if (snapshot.time < cutoff) {
      return;
    }

    for (let index = 0; index < count; index += 1) {
      peaks[index] = Math.max(peaks[index], Math.abs(snapshot.displacements[index] ?? 0));
    }
  });

  return peaks;
}

function getPairCorrelation(history, lastTime) {
  const cutoff = Math.max(0, lastTime - RESPONSE_WINDOW);
  let sum12 = 0;
  let sum11 = 0;
  let sum22 = 0;

  history.forEach((snapshot) => {
    if (snapshot.time < cutoff || snapshot.displacements.length < 2) {
      return;
    }

    const [a, b] = snapshot.displacements;
    sum12 += a * b;
    sum11 += a * a;
    sum22 += b * b;
  });

  const denominator = Math.sqrt(sum11 * sum22);
  return denominator > 1e-8 ? sum12 / denominator : 0;
}

function countSignChanges(values) {
  let lastSign = 0;
  let changes = 0;

  values.forEach((value) => {
    if (Math.abs(value) < 0.06) {
      return;
    }

    const sign = value >= 0 ? 1 : -1;

    if (lastSign !== 0 && sign !== lastSign) {
      changes += 1;
    }

    lastSign = sign;
  });

  return changes;
}

function getModeStory({ mode, peaks, displacements, correlation, driveFrequency, frequencies }) {
  const strongestPeak = Math.max(...peaks, 0);

  if (strongestPeak < 0.06) {
    return 'The drive is still far from a strong shared response, so the motion remains modest.';
  }

  if (mode === 'single') {
    const difference = Math.abs(driveFrequency - frequencies[0]);

    if (difference < 0.05) {
      return 'Single-oscillator resonance: the drive is landing close to the natural frequency, so the motion builds efficiently.';
    }

    return 'Single-oscillator response: the motion is being driven, but the frequency mismatch keeps it away from the strongest resonance.';
  }

  if (mode === 'pair') {
    if (correlation > 0.45) {
      return 'Lower shared mode: the two masses are responding mostly together.';
    }

    if (correlation < -0.45) {
      return 'Higher shared mode: neighboring masses are favoring opposite-direction motion.';
    }

    return 'Mixed response: the drive is between the main pair resonances, so neither shared pattern fully dominates.';
  }

  const signChanges = countSignChanges(displacements);
  const midpoint = (frequencies[0] + frequencies[1]) * 0.5;

  if (driveFrequency < midpoint && signChanges <= 1) {
    return 'Lower chain mode: the whole chain bends in one broad, wave-like arch.';
  }

  if (driveFrequency >= midpoint || signChanges >= 2) {
    return 'Higher chain mode: an internal turning point is appearing as the chain organizes into a tighter pattern.';
  }

  return 'The chain is sharing the drive across neighbors, but the pattern is still mixed rather than mode-clean.';
}

function buildFrame(state, params) {
  const count = state.displacements.length;
  const frequencies = getNaturalFrequencies(params.mode, params.coupling);
  const peaks = getResponsePeaks(state.history, count, state.time);
  const correlation = params.mode === 'pair' ? getPairCorrelation(state.history, state.time) : 0;

  return {
    time: state.time,
    displacements: state.displacements.slice(),
    peaks,
    driveSignal: Math.sin(2 * Math.PI * params.driveFrequency * state.time),
    story: getModeStory({
      mode: params.mode,
      peaks,
      displacements: state.displacements,
      correlation,
      driveFrequency: params.driveFrequency,
      frequencies,
    }),
  };
}

function buildSpringPath(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy) || 1;

  if (distance < 26) {
    return `${start.x},${start.y} ${end.x},${end.y}`;
  }

  const ux = dx / distance;
  const uy = dy / distance;
  const px = -uy;
  const py = ux;
  const lead = Math.min(24, distance * 0.14);
  const tail = lead;
  const usable = Math.max(distance - lead - tail, 1);
  const coilCount = Math.max(5, Math.round(distance / 36));
  const amplitude = Math.min(10, distance * 0.12);
  const points = [];

  points.push(`${start.x},${start.y}`);
  points.push(`${start.x + ux * lead},${start.y + uy * lead}`);

  for (let coilIndex = 0; coilIndex < coilCount; coilIndex += 1) {
    const t = (coilIndex + 0.5) / coilCount;
    const baseX = start.x + ux * (lead + usable * t);
    const baseY = start.y + uy * (lead + usable * t);
    const direction = coilIndex % 2 === 0 ? 1 : -1;

    points.push(`${baseX + px * amplitude * direction},${baseY + py * amplitude * direction}`);
  }

  points.push(`${end.x - ux * tail},${end.y - uy * tail}`);
  points.push(`${end.x},${end.y}`);

  return points.join(' ');
}

function getPointerInStage(element, event) {
  const rect = element.getBoundingClientRect();
  const scaleX = STAGE.width / rect.width;
  const scaleY = STAGE.height / rect.height;

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function getDisplacementFromStageY(y) {
  return clamp((STAGE.baselineY - y) / PIXELS_PER_UNIT, -MAX_DISPLAY_DISPLACEMENT, MAX_DISPLAY_DISPLACEMENT);
}

function getMassVisual() {
  return {
    fill: 'rgba(226, 232, 240, 0.98)',
    stroke: 'rgba(71, 85, 105, 0.96)',
  };
}

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

function ModeButton({ isActive, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all duration-300 ${
        isActive
          ? 'border-transparent bg-[var(--accent-blue)] text-white shadow-sm'
          : 'border-[var(--grid-line)] bg-[var(--bg-primary)] text-[color:var(--text-muted)] hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]'
      }`}
    >
      {label}
    </button>
  );
}

function PresetButton({ isActive, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-all duration-300 ${
        isActive
          ? 'border-transparent bg-[var(--accent-blue)] text-white shadow-sm'
          : 'border-[var(--grid-line)] bg-[var(--bg-primary)] text-[color:var(--text-muted)] hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]'
      }`}
    >
      {label}
    </button>
  );
}

export default function CoupledResonanceExplorer() {
  const [mode, setMode] = useState(DEFAULT_MODE);
  const [coupling, setCoupling] = useState(DEFAULT_COUPLING);
  const [damping, setDamping] = useState(DEFAULT_DAMPING);
  const [driveAmplitude, setDriveAmplitude] = useState(DEFAULT_DRIVE);
  const [driveFrequency, setDriveFrequency] = useState(DEFAULT_FREQUENCY);
  const [isRunning, setIsRunning] = useState(true);
  const [frame, setFrame] = useState(() =>
    buildFrame(createInitialState(DEFAULT_MODE), {
      mode: DEFAULT_MODE,
      coupling: DEFAULT_COUPLING,
      damping: DEFAULT_DAMPING,
      driveAmplitude: DEFAULT_DRIVE,
      driveFrequency: DEFAULT_FREQUENCY,
    }),
  );

  const controlsRef = useRef({
    mode,
    coupling,
    damping,
    driveAmplitude,
    driveFrequency,
  });
  const runningRef = useRef(isRunning);
  const simRef = useRef(createInitialState(DEFAULT_MODE));
  const lastTimestampRef = useRef(0);
  const svgRef = useRef(null);
  const dragRef = useRef({
    active: false,
    pointerId: null,
    massIndex: -1,
    pointerOffsetY: 0,
    targetDisplacement: 0,
  });

  useEffect(() => {
    controlsRef.current = {
      mode,
      coupling,
      damping,
      driveAmplitude,
      driveFrequency,
    };
  }, [mode, coupling, damping, driveAmplitude, driveFrequency]);

  useEffect(() => {
    runningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    const nextState = createInitialState(mode);
    simRef.current = nextState;
    lastTimestampRef.current = 0;
    setFrame(
      buildFrame(nextState, {
        mode,
        coupling,
        damping,
        driveAmplitude,
        driveFrequency,
      }),
    );
  }, [mode]);

  const handleModeChange = (nextMode) => {
    setMode(nextMode);

    if (nextMode === 'chain') {
      const chainPresets = getPresetFrequencies('chain', MAX_COUPLING);

      setCoupling(MAX_COUPLING);
      setDamping(MIN_DAMPING);
      setDriveAmplitude(MAX_DRIVE);
      setDriveFrequency(chainPresets.higher ?? chainPresets.lower);
    }
  };

  useEffect(() => {
    let frameId = 0;

    const animate = (timestamp) => {
      if (!lastTimestampRef.current) {
        lastTimestampRef.current = timestamp;
      }

      const dt = Math.min((timestamp - lastTimestampRef.current) / 1000, MAX_FRAME_STEP);
      lastTimestampRef.current = timestamp;

      if (runningRef.current) {
        advanceState(simRef.current, dt, controlsRef.current);
        appendSnapshot(simRef.current);
      }

      if (dragRef.current.active && dragRef.current.massIndex >= 0) {
        const { massIndex, targetDisplacement } = dragRef.current;

        if (simRef.current.displacements[massIndex] !== undefined) {
          simRef.current.displacements[massIndex] = targetDisplacement;
          simRef.current.velocities[massIndex] = 0;
        }
      }

      setFrame(buildFrame(simRef.current, controlsRef.current));
      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  const resetSimulation = () => {
    const nextState = createInitialState(mode);
    simRef.current = nextState;
    lastTimestampRef.current = 0;
    runningRef.current = true;
    setIsRunning(true);
    setFrame(
      buildFrame(nextState, {
        mode,
        coupling,
        damping,
        driveAmplitude,
        driveFrequency,
      }),
    );
  };

  const frequencies = getNaturalFrequencies(mode, coupling);
  const presets = getPresetFrequencies(mode, coupling);
  const count = getMassCount(mode);
  const spacing = (STAGE.rightPostX - STAGE.leftPostX) / (count + 1);
  const radius =
    count === 1 ? 34 : count === 2 ? 30 : count <= 5 ? 22 : count <= 12 ? 14 : 4.6;
  const springStrokeWidth = count <= 5 ? 4 : count <= 12 ? 2.2 : 1.2;
  const masses = frame.displacements.map((value, index) => {
    const x = STAGE.leftPostX + spacing * (index + 1);
    const y =
      STAGE.baselineY -
      clamp(value, -MAX_DISPLAY_DISPLACEMENT, MAX_DISPLAY_DISPLACEMENT) * PIXELS_PER_UNIT;

    return {
      index,
      value,
      x,
      y,
      radius,
      visual: getMassVisual(),
    };
  });

  const anchors = [
    { x: STAGE.leftPostX, y: STAGE.baselineY },
    ...masses.map((mass) => ({ x: mass.x, y: mass.y })),
    { x: STAGE.rightPostX, y: STAGE.baselineY },
  ];
  const activePreset = Object.entries(presets).find(([, value]) => value !== null && Math.abs(value - driveFrequency) < 0.02)?.[0];
  const modeCopy = MODE_OPTIONS[mode];
  const driveArrowHeight = frame.driveSignal * 34;

  const updateDraggedMass = (event) => {
    if (!dragRef.current.active || dragRef.current.pointerId !== event.pointerId || !svgRef.current) {
      return;
    }

    const point = getPointerInStage(svgRef.current, event);
    const y = point.y - dragRef.current.pointerOffsetY;
    const targetDisplacement = getDisplacementFromStageY(y);

    dragRef.current.targetDisplacement = targetDisplacement;

    const { massIndex } = dragRef.current;
    if (simRef.current.displacements[massIndex] !== undefined) {
      simRef.current.displacements[massIndex] = targetDisplacement;
      simRef.current.velocities[massIndex] = 0;
      setFrame(buildFrame(simRef.current, controlsRef.current));
    }
  };

  const finishDrag = (event) => {
    if (!dragRef.current.active || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = {
      active: false,
      pointerId: null,
      massIndex: -1,
      pointerOffsetY: 0,
      targetDisplacement: 0,
    };

    svgRef.current?.releasePointerCapture?.(event.pointerId);
  };

  const handleStagePointerDown = (event) => {
    if (event.button !== 0 || !svgRef.current) {
      return;
    }

    const point = getPointerInStage(svgRef.current, event);
    const grabRadius = Math.max(radius * 2.4, Math.min(spacing * 0.8, 18));
    let closestMass = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    masses.forEach((mass) => {
      const distance = Math.hypot(point.x - mass.x, point.y - mass.y);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestMass = mass;
      }
    });

    if (!closestMass || closestDistance > grabRadius) {
      return;
    }

    event.preventDefault();
    svgRef.current.setPointerCapture?.(event.pointerId);

    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      massIndex: closestMass.index,
      pointerOffsetY: point.y - closestMass.y,
      targetDisplacement: closestMass.value,
    };
  };

  return (
    <section className="not-prose h-full bg-[radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--accent-blue)_14%,transparent),transparent_38%),radial-gradient(circle_at_bottom_left,color-mix(in_srgb,var(--accent-red)_10%,transparent),transparent_42%),var(--sim-bg)] p-4 md:p-5">
      <div className="space-y-4">
        <div className="overflow-hidden rounded-[1.8rem] border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--bg-primary)_88%,transparent)] shadow-sm">
          <div className="border-b border-[var(--grid-line)] px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                  Motion Stage
                </p>
                <p className="mt-2 mb-0 max-w-3xl text-sm leading-7 text-[color:var(--text-muted)]">
                  {modeCopy.guide}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {Object.values(MODE_OPTIONS).map((option) => (
                  <ModeButton
                    key={option.key}
                    isActive={mode === option.key}
                    label={option.label}
                    onClick={() => handleModeChange(option.key)}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setIsRunning((current) => !current)}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--grid-line)] bg-[var(--bg-primary)] px-4 py-2 text-sm font-semibold text-[color:var(--text-primary)] shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
                >
                  {isRunning ? <Pause size={16} /> : <Play size={16} />}
                  <span>{isRunning ? 'Pause' : 'Play'}</span>
                </button>

                <button
                  type="button"
                  onClick={resetSimulation}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--grid-line)] bg-[var(--bg-primary)] px-4 py-2 text-sm font-semibold text-[color:var(--text-primary)] shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
                >
                  <RotateCcw size={16} />
                  <span>Reset</span>
                </button>
              </div>
            </div>
          </div>

          <div className="px-4 py-4 md:px-5 md:py-5">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${STAGE.width} ${STAGE.height}`}
              className="h-auto w-full"
              role="img"
              aria-label={
                mode === 'single'
                  ? 'Driven single oscillator'
                  : mode === 'pair'
                    ? 'Driven pair of coupled oscillators'
                    : mode === 'five'
                    ? 'Driven five-oscillator chain'
                      : 'Driven dense chain of coupled oscillators'
              }
              style={{ touchAction: 'none', cursor: dragRef.current.active ? 'grabbing' : 'grab' }}
              onPointerDown={handleStagePointerDown}
              onPointerMove={updateDraggedMass}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
            >
              <defs>
                <linearGradient id="drive-arrow" x1="0%" x2="0%" y1="0%" y2="100%">
                  <stop offset="0%" stopColor="rgba(59, 130, 246, 0.95)" />
                  <stop offset="100%" stopColor="rgba(239, 68, 68, 0.95)" />
                </linearGradient>
                <linearGradient id="stage-backdrop" x1="0%" x2="100%" y1="0%" y2="100%">
                  <stop offset="0%" stopColor="rgba(248, 250, 252, 0.96)" />
                  <stop offset="100%" stopColor="rgba(241, 245, 249, 0.86)" />
                </linearGradient>
              </defs>

              <rect x="0" y="0" width={STAGE.width} height={STAGE.height} rx="30" fill="url(#stage-backdrop)" />
              <rect
                x="46"
                y={STAGE.topLimitY}
                width={STAGE.width - 92}
                height={STAGE.bottomLimitY - STAGE.topLimitY}
                rx="28"
                fill="rgba(255, 255, 255, 0.5)"
                stroke="rgba(148, 163, 184, 0.28)"
                strokeWidth="1.5"
              />

              <line
                x1="46"
                x2={STAGE.width - 46}
                y1={STAGE.baselineY}
                y2={STAGE.baselineY}
                stroke="rgba(148, 163, 184, 0.5)"
                strokeWidth="2"
                strokeDasharray="8 8"
              />

              <line
                x1={STAGE.leftPostX}
                x2={STAGE.leftPostX}
                y1={STAGE.baselineY - 76}
                y2={STAGE.baselineY + 76}
                stroke="rgba(71, 85, 105, 0.94)"
                strokeWidth="6"
                strokeLinecap="round"
              />
              <line
                x1={STAGE.rightPostX}
                x2={STAGE.rightPostX}
                y1={STAGE.baselineY - 76}
                y2={STAGE.baselineY + 76}
                stroke="rgba(71, 85, 105, 0.94)"
                strokeWidth="6"
                strokeLinecap="round"
              />

              {anchors.slice(0, -1).map((point, index) => {
                const nextPoint = anchors[index + 1];

                return (
                  <polyline
                    key={`spring-${index}`}
                    points={buildSpringPath(point, nextPoint)}
                    fill="none"
                    stroke="rgba(37, 99, 235, 0.86)"
                    strokeWidth={springStrokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                );
              })}

              {masses.map((mass) => (
                <g key={`mass-${mass.index}`}>
                  <circle
                    cx={mass.x}
                    cy={STAGE.baselineY}
                    r={mass.radius * 0.34}
                    fill="rgba(148, 163, 184, 0.22)"
                  />
                  <circle
                    cx={mass.x}
                    cy={mass.y}
                    r={mass.radius}
                    fill={mass.visual.fill}
                    stroke={mass.visual.stroke}
                    strokeWidth="3"
                  />
                </g>
              ))}

              <line
                x1={STAGE.leftPostX - 46}
                x2={STAGE.leftPostX - 46}
                y1={STAGE.baselineY}
                y2={STAGE.baselineY - driveArrowHeight}
                stroke="url(#drive-arrow)"
                strokeWidth="5"
                strokeLinecap="round"
              />
              <path
                d={`M ${STAGE.leftPostX - 46} ${STAGE.baselineY - driveArrowHeight} L ${STAGE.leftPostX - 54} ${STAGE.baselineY - driveArrowHeight + (driveArrowHeight >= 0 ? 10 : -10)} L ${STAGE.leftPostX - 38} ${STAGE.baselineY - driveArrowHeight + (driveArrowHeight >= 0 ? 10 : -10)} Z`}
                fill="rgba(59, 130, 246, 0.96)"
              />
              <text
                x="56"
                y="48"
                fill="rgba(37, 99, 235, 0.96)"
                fontSize="15"
                fontWeight="700"
              >
                {mode === 'single'
                  ? 'One driven oscillator'
                  : mode === 'pair'
                    ? 'Two coupled oscillators'
                    : mode === 'five'
                      ? 'Five coupled oscillators'
                      : 'Dense fixed-end chain'}
              </text>
              <text
                x="56"
                y="68"
                fill="rgba(71, 85, 105, 0.96)"
                fontSize="13"
              >
                Drive frequency: {formatNumber(driveFrequency)} Hz
              </text>
            </svg>
          </div>
        </div>

        <div className="rounded-[1.7rem] border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--surface-elevated)_92%,transparent)] p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                Controls
              </p>

            </div>
            <p className="m-0 rounded-full border border-[var(--grid-line)] bg-[var(--bg-primary)] px-3 py-1 text-xs font-medium text-[color:var(--text-muted)]">
              {modeCopy.shortLabel}
            </p>
          </div>

          <div className={`grid gap-3 ${mode === 'single' ? '' : 'sm:grid-cols-2'}`}>
            <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4">
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent-blue)]">
                {mode === 'single' ? 'Natural Frequency' : 'Lower Mode'}
              </p>
              <p className="mt-2 mb-0 text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">
                {formatNumber(frequencies[0])} Hz
              </p>

            </div>

            {frequencies[1] !== null ? (
              <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent-red)]">
                  Higher Mode
                </p>
                <p className="mt-2 mb-0 text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">
                  {formatNumber(frequencies[1])} Hz
                </p>
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <PresetButton
              isActive={activePreset === 'off'}
              label="off resonance"
              onClick={() => setDriveFrequency(presets.off)}
            />
            <PresetButton
              isActive={activePreset === 'lower'}
              label={mode === 'single' ? 'resonance' : 'lower mode'}
              onClick={() => setDriveFrequency(presets.lower)}
            />
            {presets.higher !== null ? (
              <PresetButton
                isActive={activePreset === 'higher'}
                label="higher mode"
                onClick={() => setDriveFrequency(presets.higher)}
              />
            ) : null}
          </div>

          {mode !== 'single' ? (
            <div className="mt-4 rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4">
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                Pattern Readout
              </p>
              <p className="mt-3 mb-0 text-sm leading-7 text-[color:var(--text-primary)]">
                {frame.story}
              </p>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <ControlSlider
                label="Drive Frequency"
                value={driveFrequency}
                valueLabel={`${formatNumber(driveFrequency)} Hz`}
                min={MIN_FREQUENCY}
                max={MAX_FREQUENCY}
                step={0.01}
                onChange={setDriveFrequency}
              />

              <ControlSlider
                label="Coupling Strength"
                value={coupling}
                valueLabel={formatNumber(coupling, 1)}
                min={MIN_COUPLING}
                max={MAX_COUPLING}
                step={0.5}
                onChange={setCoupling}
              />
            </div>

            <div className="space-y-4">
              <ControlSlider
                label="Damping"
                value={damping}
                valueLabel={formatNumber(damping, 2)}
                min={MIN_DAMPING}
                max={MAX_DAMPING}
                step={0.01}
                onChange={setDamping}
              />

              <ControlSlider
                label="Drive Amplitude"
                value={driveAmplitude}
                valueLabel={formatNumber(driveAmplitude, 2)}
                min={MIN_DRIVE}
                max={MAX_DRIVE}
                step={0.01}
                onChange={setDriveAmplitude}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
