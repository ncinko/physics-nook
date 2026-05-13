import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleGauge,
  Guitar,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Ruler,
  Waves,
  Wind,
} from 'lucide-react';

const STAGE = {
  width: 960,
  height: 360,
  left: 88,
  right: 872,
  baselineY: 176,
  amplitude: 72,
};

const SAMPLE_COUNT = 260;
const MIN_LENGTH = 0.25;
const MAX_LENGTH = 1.2;
const MIN_SPEED = 120;
const MAX_SPEED = 600;
const MAX_MODE = 6;

const BOUNDARY_MODES = {
  fixed: {
    key: 'fixed',
    label: 'Fixed-fixed string',
    shortLabel: 'String',
    color: 'var(--accent-blue)',
    formulaLabel: 'lambda_n = 2L / n',
    frequencyLabel: 'f_n = n v / 2L',
    startCondition: 'node',
    endCondition: 'node',
    modeWord: 'harmonic',
    icon: Waves,
  },
  openOpen: {
    key: 'openOpen',
    label: 'Open-open air column',
    shortLabel: 'Open pipe',
    color: '#0f766e',
    formulaLabel: 'lambda_n = 2L / n',
    frequencyLabel: 'f_n = n v / 2L',
    startCondition: 'antinode',
    endCondition: 'antinode',
    modeWord: 'harmonic',
    icon: Wind,
  },
  openClosed: {
    key: 'openClosed',
    label: 'Open-closed air column',
    shortLabel: 'Closed pipe',
    color: 'var(--accent-red)',
    formulaLabel: 'lambda_m = 4L / (2m - 1)',
    frequencyLabel: 'f_m = (2m - 1)v / 4L',
    startCondition: 'node',
    endCondition: 'antinode',
    modeWord: 'mode',
    icon: Wind,
  },
};

const INSTRUMENTS = [
  {
    key: 'guitar',
    label: 'Guitar string',
    boundary: 'fixed',
    length: 0.65,
    speed: 326,
    icon: Guitar,
    color: 'var(--accent-blue)',
    mix: [1, 0.46, 0.31, 0.2, 0.14, 0.1],
  },
  {
    key: 'violin',
    label: 'Violin string',
    boundary: 'fixed',
    length: 0.33,
    speed: 290,
    icon: Music2,
    color: '#7c3aed',
    mix: [1, 0.58, 0.37, 0.29, 0.2, 0.16],
  },
  {
    key: 'flute',
    label: 'Flute pipe',
    boundary: 'openOpen',
    length: 0.66,
    speed: 343,
    icon: Wind,
    color: '#0f766e',
    mix: [1, 0.22, 0.11, 0.07, 0.04, 0.03],
  },
  {
    key: 'clarinet',
    label: 'Clarinet pipe',
    boundary: 'openClosed',
    length: 0.66,
    speed: 343,
    icon: Music2,
    color: 'var(--accent-red)',
    mix: [1, 0.42, 0.24, 0.14, 0.09, 0.06],
  },
];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatNumber(value, digits = 2) {
  const fixed = value.toFixed(digits);
  return fixed === '-0.00' || fixed === '-0.0' ? fixed.slice(1) : fixed;
}

function stageXFromU(u) {
  return STAGE.left + u * (STAGE.right - STAGE.left);
}

function getModeInfo(boundaryKey, modeIndex, length, speed) {
  if (boundaryKey === 'openClosed') {
    const harmonicNumber = 2 * modeIndex - 1;
    const wavelength = (4 * length) / harmonicNumber;

    return {
      modeIndex,
      harmonicNumber,
      wavelength,
      frequency: speed / wavelength,
      displayName: `Mode ${modeIndex}`,
      detailName: `odd harmonic ${harmonicNumber}`,
    };
  }

  const wavelength = (2 * length) / modeIndex;

  return {
    modeIndex,
    harmonicNumber: modeIndex,
    wavelength,
    frequency: speed / wavelength,
    displayName: `Harmonic ${modeIndex}`,
    detailName: `harmonic ${modeIndex}`,
  };
}

function getShapeValue(boundaryKey, modeIndex, u) {
  if (boundaryKey === 'fixed') {
    return Math.sin(modeIndex * Math.PI * u);
  }

  if (boundaryKey === 'openOpen') {
    return Math.cos(modeIndex * Math.PI * u);
  }

  return Math.sin(((2 * modeIndex - 1) * Math.PI * u) / 2);
}

function getMarkers(boundaryKey, modeIndex) {
  if (boundaryKey === 'fixed') {
    return {
      nodes: Array.from({ length: modeIndex + 1 }, (_, index) => index / modeIndex),
      antinodes: Array.from({ length: modeIndex }, (_, index) => (index + 0.5) / modeIndex),
    };
  }

  if (boundaryKey === 'openOpen') {
    return {
      nodes: Array.from({ length: modeIndex }, (_, index) => (2 * index + 1) / (2 * modeIndex)),
      antinodes: Array.from({ length: modeIndex + 1 }, (_, index) => index / modeIndex),
    };
  }

  const harmonicNumber = 2 * modeIndex - 1;

  return {
    nodes: Array.from({ length: modeIndex }, (_, index) => (2 * index) / harmonicNumber),
    antinodes: Array.from({ length: modeIndex }, (_, index) => (2 * index + 1) / harmonicNumber),
  };
}

function buildWavePath(boundaryKey, modeIndex, time, length, speed, scale = 1) {
  const modeInfo = getModeInfo(boundaryKey, modeIndex, length, speed);
  const visualFrequency = clamp(modeInfo.frequency * 0.0016, 0.25, 2.4);
  const motion = Math.cos(2 * Math.PI * visualFrequency * time);

  return Array.from({ length: SAMPLE_COUNT + 1 }, (_, index) => {
    const u = index / SAMPLE_COUNT;
    const x = stageXFromU(u);
    const shape = getShapeValue(boundaryKey, modeIndex, u);
    const y = STAGE.baselineY - STAGE.amplitude * scale * shape * motion;

    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

function buildEnvelopePath(boundaryKey, modeIndex, sign = 1) {
  return Array.from({ length: SAMPLE_COUNT + 1 }, (_, index) => {
    const u = index / SAMPLE_COUNT;
    const x = stageXFromU(u);
    const shape = getShapeValue(boundaryKey, modeIndex, u);
    const y = STAGE.baselineY - STAGE.amplitude * shape * sign;

    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

function ControlSlider({ icon: Icon, label, value, valueLabel, min, max, step, onChange }) {
  return (
    <label className="block rounded-[1.3rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
      <span className="mb-3 flex items-center justify-between gap-4 text-sm">
        <span className="flex items-center gap-2 font-semibold text-[color:var(--text-primary)]">
          <Icon className="h-4 w-4 text-[var(--accent-blue)]" aria-hidden="true" />
          {label}
        </span>
        <span className="font-mono text-[color:var(--text-muted)]">{valueLabel}</span>
      </span>
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

function MetricCard({ eyebrow, value, detail, color }) {
  return (
    <div className="rounded-[1.3rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color }}>
        {eyebrow}
      </p>
      <p className="mt-3 mb-1 text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">
        {value}
      </p>
      <p className="m-0 text-sm leading-6 text-[color:var(--text-muted)]">{detail}</p>
    </div>
  );
}

export default function StandingWaveHarmonicsExplorer() {
  const [instrumentKey, setInstrumentKey] = useState('guitar');
  const initialInstrument = INSTRUMENTS[0];
  const [boundaryKey, setBoundaryKey] = useState(initialInstrument.boundary);
  const [length, setLength] = useState(initialInstrument.length);
  const [speed, setSpeed] = useState(initialInstrument.speed);
  const [modeIndex, setModeIndex] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const frameRef = useRef(null);
  const lastTimestampRef = useRef(null);

  useEffect(() => {
    if (!isPlaying) {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
      lastTimestampRef.current = null;
      return undefined;
    }

    const tick = (timestamp) => {
      const previous = lastTimestampRef.current ?? timestamp;
      const dt = clamp((timestamp - previous) / 1000, 0.001, 0.04);
      lastTimestampRef.current = timestamp;
      setTime((current) => current + dt);
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
      lastTimestampRef.current = null;
    };
  }, [isPlaying]);

  const instrument = INSTRUMENTS.find((entry) => entry.key === instrumentKey) ?? initialInstrument;
  const boundary = BOUNDARY_MODES[boundaryKey];
  const modeInfo = getModeInfo(boundaryKey, modeIndex, length, speed);
  const markers = useMemo(() => getMarkers(boundaryKey, modeIndex), [boundaryKey, modeIndex]);
  const livePath = buildWavePath(boundaryKey, modeIndex, time, length, speed);
  const upperEnvelopePath = buildEnvelopePath(boundaryKey, modeIndex, 1);
  const lowerEnvelopePath = buildEnvelopePath(boundaryKey, modeIndex, -1);
  const harmonicRows = Array.from({ length: MAX_MODE }, (_, index) => {
    const rowMode = index + 1;
    const rowInfo = getModeInfo(boundaryKey, rowMode, length, speed);
    const rawStrength = instrument.mix[index] ?? 0;

    return {
      ...rowInfo,
      strength: rawStrength,
      isSelected: rowMode === modeIndex,
    };
  });
  const lengthLabel = `${formatNumber(length, 2)} m`;
  const speedLabel = `${formatNumber(speed, 0)} m/s`;

  const applyInstrument = (nextInstrument) => {
    setInstrumentKey(nextInstrument.key);
    setBoundaryKey(nextInstrument.boundary);
    setLength(nextInstrument.length);
    setSpeed(nextInstrument.speed);
    setModeIndex(1);
    setTime(0);
  };

  const reset = () => {
    applyInstrument(instrument);
  };

  const changeBoundary = (nextBoundaryKey) => {
    const matchingInstrument =
      INSTRUMENTS.find((entry) => entry.boundary === nextBoundaryKey) ?? instrument;

    applyInstrument(matchingInstrument);
  };

  return (
    <div
      className="grid h-full min-h-[44rem] grid-cols-1 gap-6 bg-[var(--sim-bg)] p-5 text-[color:var(--text-primary)] xl:grid-cols-[1.16fr_0.84fr]"
      style={{ overflowAnchor: 'none' }}
    >
      <div className="space-y-5">
        <div className="overflow-hidden rounded-[1.8rem] border border-[var(--grid-line)] bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.16),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(15,118,110,0.12),transparent_36%),var(--bg-primary)] shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--grid-line)] px-5 py-5">
            <div>
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: boundary.color }}>
                {boundary.label}
              </p>
              <p className="mt-2 mb-0 max-w-xl text-sm leading-7 text-[color:var(--text-muted)]">
                {boundary.formulaLabel}; {boundary.frequencyLabel}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsPlaying((playing) => !playing)}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-blue)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-300 hover:-translate-y-0.5"
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-semibold text-[color:var(--text-muted)] shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
            </div>
          </div>

          <div className="px-4 py-5 sm:px-5">
            <svg
              viewBox={`0 0 ${STAGE.width} ${STAGE.height}`}
              className="h-auto w-full"
              role="img"
              aria-label="Standing wave pattern with nodes and antinodes"
            >
              <defs>
                <linearGradient id="standing-wave-line" x1="0%" x2="100%" y1="0%" y2="0%">
                  <stop offset="0%" stopColor="rgba(15,118,110,0.92)" />
                  <stop offset="48%" stopColor="rgba(59,130,246,0.96)" />
                  <stop offset="100%" stopColor="rgba(239,68,68,0.86)" />
                </linearGradient>
              </defs>

              <rect x="0" y="0" width={STAGE.width} height={STAGE.height} rx="28" fill="color-mix(in srgb, var(--sim-bg) 78%, white)" />

              <line
                x1={STAGE.left}
                x2={STAGE.right}
                y1={STAGE.baselineY}
                y2={STAGE.baselineY}
                stroke="rgba(71,85,105,0.32)"
                strokeWidth="2"
                strokeDasharray="8 8"
              />

              <rect
                x={STAGE.left - 18}
                y={STAGE.baselineY - 92}
                width={STAGE.right - STAGE.left + 36}
                height="184"
                rx="30"
                fill={boundaryKey === 'fixed' ? 'rgba(59,130,246,0.06)' : 'rgba(15,118,110,0.07)'}
                stroke="rgba(148,163,184,0.32)"
                strokeWidth="2"
              />

              {boundaryKey === 'fixed' ? (
                <>
                  <rect x={STAGE.left - 28} y={STAGE.baselineY - 70} width="14" height="140" rx="4" fill="rgba(71,85,105,0.78)" />
                  <rect x={STAGE.right + 14} y={STAGE.baselineY - 70} width="14" height="140" rx="4" fill="rgba(71,85,105,0.78)" />
                </>
              ) : (
                <>
                  {boundaryKey === 'openClosed' && (
                    <rect x={STAGE.left - 26} y={STAGE.baselineY - 72} width="18" height="144" rx="5" fill="rgba(71,85,105,0.78)" />
                  )}
                  <line
                    x1={STAGE.left}
                    x2={STAGE.right}
                    y1={STAGE.baselineY - 70}
                    y2={STAGE.baselineY - 70}
                    stroke="rgba(71,85,105,0.5)"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                  <line
                    x1={STAGE.left}
                    x2={STAGE.right}
                    y1={STAGE.baselineY + 70}
                    y2={STAGE.baselineY + 70}
                    stroke="rgba(71,85,105,0.5)"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                </>
              )}

              <path d={upperEnvelopePath} fill="none" stroke="rgba(37,99,235,0.18)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
              <path d={lowerEnvelopePath} fill="none" stroke="rgba(239,68,68,0.14)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
              <path d={livePath} fill="none" stroke="url(#standing-wave-line)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />

              {markers.nodes.map((u, index) => {
                const x = stageXFromU(u);
                return (
                  <g key={`node-${index}`}>
                    <line
                      x1={x}
                      x2={x}
                      y1={STAGE.baselineY - 88}
                      y2={STAGE.baselineY + 88}
                      stroke="rgba(15,23,42,0.26)"
                      strokeWidth="1.8"
                      strokeDasharray="6 7"
                    />
                    <circle cx={x} cy={STAGE.baselineY} r="7" fill="rgba(15,23,42,0.92)" stroke="rgba(255,255,255,0.95)" strokeWidth="2.4" />
                  </g>
                );
              })}

              {markers.antinodes.map((u, index) => {
                const x = stageXFromU(u);
                const sign = getShapeValue(boundaryKey, modeIndex, u) >= 0 ? -1 : 1;
                return (
                  <g key={`antinode-${index}`}>
                    <circle cx={x} cy={STAGE.baselineY + sign * STAGE.amplitude} r="8" fill="rgba(239,68,68,0.9)" stroke="rgba(255,255,255,0.95)" strokeWidth="2.4" />
                    <line
                      x1={x}
                      x2={x}
                      y1={STAGE.baselineY}
                      y2={STAGE.baselineY + sign * STAGE.amplitude}
                      stroke="rgba(239,68,68,0.24)"
                      strokeWidth="2"
                    />
                  </g>
                );
              })}

              <text x={STAGE.left} y="34" fill="rgba(15,23,42,0.78)" fontSize="14" fontWeight="700">
                {boundary.startCondition} at x = 0
              </text>
              <text x={STAGE.right} y="34" textAnchor="end" fill="rgba(15,23,42,0.78)" fontSize="14" fontWeight="700">
                {boundary.endCondition} at x = L
              </text>

              <g>
                <line x1={STAGE.left} x2={STAGE.right} y1="320" y2="320" stroke="rgba(59,130,246,0.86)" strokeWidth="3" strokeLinecap="round" />
                <path d={`M ${STAGE.left + 8} 312 L ${STAGE.left} 320 L ${STAGE.left + 8} 328`} fill="none" stroke="rgba(59,130,246,0.86)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                <path d={`M ${STAGE.right - 8} 312 L ${STAGE.right} 320 L ${STAGE.right - 8} 328`} fill="none" stroke="rgba(59,130,246,0.86)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                <text x={(STAGE.left + STAGE.right) / 2} y="310" textAnchor="middle" fill="rgba(59,130,246,0.94)" fontSize="15" fontWeight="700">
                  L = {lengthLabel}
                </text>
              </g>
            </svg>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard
            eyebrow="Frequency"
            value={`${formatNumber(modeInfo.frequency, modeInfo.frequency >= 100 ? 0 : 1)} Hz`}
            detail={modeInfo.displayName}
            color={boundary.color}
          />
          <MetricCard
            eyebrow="Wavelength"
            value={`${formatNumber(modeInfo.wavelength, 2)} m`}
            detail={modeInfo.detailName}
            color="var(--accent-blue)"
          />
          <MetricCard
            eyebrow="Ends"
            value={`${markers.nodes.length} N / ${markers.antinodes.length} A`}
            detail="nodes and antinodes"
            color="#0f766e"
          />
        </div>

        <div className="rounded-[1.8rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
              Harmonic ladder
            </p>
            <p className="m-0 text-sm text-[color:var(--text-muted)]">
              {boundaryKey === 'openClosed' ? 'odd harmonics only' : 'all integer harmonics'}
            </p>
          </div>

          <div className="space-y-3">
            {harmonicRows.map((row) => {
              const strengthPercent = clamp(row.strength * 100, 0, 100);

              return (
                <button
                  type="button"
                  key={row.modeIndex}
                  onClick={() => setModeIndex(row.modeIndex)}
                  className={`grid w-full grid-cols-[5.5rem_minmax(0,1fr)_4.8rem] items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all duration-200 ${
                    row.isSelected
                      ? 'border-[var(--accent-blue)] bg-[color-mix(in_srgb,var(--accent-blue)_10%,var(--bg-primary))]'
                      : 'border-[var(--grid-line)] bg-[var(--surface-elevated)] hover:border-[var(--accent-blue)]'
                  }`}
                >
                  <span className="text-sm font-semibold text-[color:var(--text-primary)]">
                    {boundaryKey === 'openClosed' ? `m ${row.modeIndex}` : `n ${row.modeIndex}`}
                  </span>
                  <span className="block h-2.5 overflow-hidden rounded-full bg-slate-200/80">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${strengthPercent}%`, backgroundColor: instrument.color }}
                    />
                  </span>
                  <span className="text-right font-mono text-sm text-[color:var(--text-muted)]">
                    {formatNumber(row.frequency, row.frequency >= 100 ? 0 : 1)} Hz
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="space-y-5">
        <div className="rounded-[1.8rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
            Instrument type
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {INSTRUMENTS.map((entry) => {
              const Icon = entry.icon;
              const active = entry.key === instrumentKey;

              return (
                <button
                  type="button"
                  key={entry.key}
                  onClick={() => applyInstrument(entry)}
                  className={`flex min-h-16 items-center gap-3 rounded-[1.1rem] border px-4 py-3 text-left transition-all duration-200 ${
                    active
                      ? 'border-[var(--accent-blue)] bg-[color-mix(in_srgb,var(--accent-blue)_10%,var(--bg-primary))] shadow-sm'
                      : 'border-[var(--grid-line)] bg-[var(--surface-elevated)] hover:border-[var(--accent-blue)]'
                  }`}
                >
                  <span
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white"
                    style={{ backgroundColor: entry.color }}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[color:var(--text-primary)]">{entry.label}</span>
                    <span className="block truncate text-xs text-[color:var(--text-muted)]">
                      {BOUNDARY_MODES[entry.boundary].shortLabel}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-[1.8rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
            Boundary model
          </p>
          <div className="mt-4 grid gap-2">
            {Object.values(BOUNDARY_MODES).map((entry) => {
              const Icon = entry.icon;
              const active = entry.key === boundaryKey;

              return (
                <button
                  type="button"
                  key={entry.key}
                  onClick={() => changeBoundary(entry.key)}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-200 ${
                    active
                      ? 'border-[var(--accent-blue)] bg-[color-mix(in_srgb,var(--accent-blue)_10%,var(--bg-primary))]'
                      : 'border-[var(--grid-line)] bg-[var(--surface-elevated)] hover:border-[var(--accent-blue)]'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Icon className="h-5 w-5 shrink-0" style={{ color: entry.color }} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[color:var(--text-primary)]">{entry.label}</span>
                      <span className="block text-xs text-[color:var(--text-muted)]">
                        {entry.startCondition} to {entry.endCondition}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <ControlSlider
            icon={Ruler}
            label="Length"
            value={length}
            valueLabel={lengthLabel}
            min={MIN_LENGTH}
            max={MAX_LENGTH}
            step={0.01}
            onChange={setLength}
          />
          <ControlSlider
            icon={CircleGauge}
            label="Wave speed"
            value={speed}
            valueLabel={speedLabel}
            min={MIN_SPEED}
            max={MAX_SPEED}
            step={1}
            onChange={setSpeed}
          />
        </div>

        <div className="rounded-[1.8rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: instrument.color }}>
            Timbre hint
          </p>
          <p className="mt-3 mb-0 text-sm leading-7 text-[color:var(--text-muted)]">
            The colored bars sketch one possible harmonic mixture for the selected instrument. Longer bars mean that harmonic contributes more strongly to the instrument's tone color.
          </p>
        </div>
      </div>
    </div>
  );
}
