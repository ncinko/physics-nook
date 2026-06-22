import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Pause, Play } from 'lucide-react';

const STAGE = {
  width: 960,
  height: 320,
  padding: {
    left: 56,
    right: 48,
    top: 34,
    bottom: 48,
  },
  domainLength: 10,
};

const SAMPLE_COUNT = 220;
const TRANSVERSE_BASELINE_Y = 164;
const LONGITUDINAL_BASELINE_Y = 166;
const SOURCE_OFFSET = 0.8;
const MAX_WAVE_EVENTS = 120;
const INITIAL_DIRECTION = 1;
const INITIAL_AMPLITUDE = 0.7;
const INITIAL_WAVELENGTH = 2.6;
const INITIAL_FREQUENCY = 1.05;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const formatNumber = (value, digits = 2) => {
  const fixed = value.toFixed(digits);
  return fixed === '-0.00' || fixed === '-0.0' ? fixed.slice(1) : fixed;
};

const sourceXForDirection = (direction) =>
  direction === 1 ? -SOURCE_OFFSET : STAGE.domainLength + SOURCE_OFFSET;

const speedFor = ({ wavelength, frequency }) => Math.max(wavelength * frequency, 0.05);

const fillLeadTimeFor = ({ wavelength, frequency }) =>
  (STAGE.domainLength + SOURCE_OFFSET) / speedFor({ wavelength, frequency });

const buildWaveEvent = ({
  startTime,
  startPhase = 0,
  direction,
  amplitude,
  wavelength,
  frequency,
}) => ({
  startTime,
  startPhase,
  direction,
  amplitude,
  wavelength,
  frequency,
  speed: speedFor({ wavelength, frequency }),
  omega: 2 * Math.PI * frequency,
});

const buildResetWaveEvents = ({
  time,
  direction,
  amplitude,
  wavelength,
  frequency,
}) => [
  buildWaveEvent({
    startTime: time - fillLeadTimeFor({ wavelength, frequency }),
    direction,
    amplitude,
    wavelength,
    frequency,
  }),
];

const sourcePhaseAt = (event, sourceTime) =>
  event.startPhase - event.direction * event.omega * (sourceTime - event.startTime);

const sourceIntervalForEvent = ({ events, index }) => ({
  startTime: events[index].startTime,
  endTime: events[index + 1]?.startTime ?? Infinity,
});

const evaluateEventAtPoint = ({ events, index, xPhysical, time }) => {
  const event = events[index];
  const distance = Math.abs(xPhysical - sourceXForDirection(event.direction));
  const sourceTime = time - distance / event.speed;
  const { startTime, endTime } = sourceIntervalForEvent({ events, index });

  if (sourceTime < startTime || sourceTime >= endTime) {
    return null;
  }

  return {
    event,
    index,
    distance,
    sourceTime,
  };
};

const findActiveWaveEvent = ({ events, xPhysical, time }) => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const evaluation = evaluateEventAtPoint({
      events,
      index,
      xPhysical,
      time,
    });

    if (evaluation) {
      return evaluation;
    }
  }

  return null;
};

const evaluateWaveState = ({ events, xPhysical, time }) => {
  const activeEvent = findActiveWaveEvent({ events, xPhysical, time });

  if (!activeEvent) {
    return {
      event: null,
      phase: 0,
      sin: 0,
      cos: 0,
    };
  }

  const phase = sourcePhaseAt(activeEvent.event, activeEvent.sourceTime);

  return {
    event: activeEvent.event,
    phase,
    sin: Math.sin(phase),
    cos: Math.cos(phase),
  };
};

const buildLongitudinalBands = ({
  events,
  time,
  phaseOffset,
  plotWidth,
  widthFactor,
}) => {
  const minPhysical = -SOURCE_OFFSET;
  const maxPhysical = STAGE.domainLength + SOURCE_OFFSET;
  const bands = [];

  events.forEach((event, eventIndex) => {
    const waveNumber = (2 * Math.PI) / event.wavelength;
    const basePhysical =
      sourceXForDirection(event.direction) +
      event.direction * event.speed * (time - event.startTime) +
      (phaseOffset - event.startPhase) / waveNumber;
    const startIndex = Math.ceil((minPhysical - basePhysical) / event.wavelength);
    const endIndex = Math.floor((maxPhysical - basePhysical) / event.wavelength);

    for (let repeatIndex = startIndex; repeatIndex <= endIndex; repeatIndex += 1) {
      const xPhysical = basePhysical + repeatIndex * event.wavelength;

      if (findActiveWaveEvent({ events, xPhysical, time })?.event !== event) {
        continue;
      }

      bands.push({
        key: `${eventIndex}-${phaseOffset}-${repeatIndex}`,
        x: stageXFromPhysical(xPhysical),
        width: (event.wavelength / STAGE.domainLength) * plotWidth * widthFactor,
      });
    }
  });

  return bands;
};

const stageXFromPhysical = (x) =>
  STAGE.padding.left +
  (x / STAGE.domainLength) * (STAGE.width - STAGE.padding.left - STAGE.padding.right);

function ControlSlider({ label, value, valueLabel, min, max, step, onChange, onCommit }) {
  const commitValue = (event) => onCommit(parseFloat(event.currentTarget.value));

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
        onPointerUp={commitValue}
        onKeyUp={commitValue}
        onBlur={commitValue}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-700"
      />
    </label>
  );
}

function ModeButton({ isActive, accent, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all duration-300 ${
        isActive
          ? 'border-transparent text-white shadow-sm'
          : 'border-[var(--grid-line)] bg-[var(--bg-primary)] text-[color:var(--text-muted)] hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]'
      }`}
      style={isActive ? { backgroundColor: accent } : undefined}
    >
      {label}
    </button>
  );
}

export default function WaveSimulator() {
  const [mode, setMode] = useState('transverse');
  const [direction, setDirection] = useState(INITIAL_DIRECTION);
  const [amplitude, setAmplitude] = useState(INITIAL_AMPLITUDE);
  const [draftAmplitude, setDraftAmplitude] = useState(INITIAL_AMPLITUDE);
  const [wavelength, setWavelength] = useState(INITIAL_WAVELENGTH);
  const [draftWavelength, setDraftWavelength] = useState(INITIAL_WAVELENGTH);
  const [frequency, setFrequency] = useState(INITIAL_FREQUENCY);
  const [draftFrequency, setDraftFrequency] = useState(INITIAL_FREQUENCY);
  const [isPlaying, setIsPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [waveEvents, setWaveEvents] = useState(() =>
    buildResetWaveEvents({
      time: 0,
      direction: INITIAL_DIRECTION,
      amplitude: INITIAL_AMPLITUDE,
      wavelength: INITIAL_WAVELENGTH,
      frequency: INITIAL_FREQUENCY,
    }),
  );

  const frameRef = useRef(null);
  const lastTimeRef = useRef(null);
  const committedParamsRef = useRef({
    amplitude: INITIAL_AMPLITUDE,
    wavelength: INITIAL_WAVELENGTH,
    frequency: INITIAL_FREQUENCY,
  });

  useEffect(() => {
    if (!isPlaying) {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      lastTimeRef.current = null;
      return undefined;
    }

    const tick = (timestamp) => {
      const previous = lastTimeRef.current ?? timestamp;
      lastTimeRef.current = timestamp;
      const dt = clamp((timestamp - previous) / 1000, 0.001, 0.04);
      setTime((current) => current + dt);
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
      lastTimeRef.current = null;
    };
  }, [isPlaying]);

  const appendWaveEvent = ({ nextAmplitude, nextWavelength, nextFrequency }) => {
    const eventTime = time;

    setWaveEvents((currentEvents) => {
      const activeEvents = currentEvents.filter((event) => event.startTime <= eventTime + 1e-6);
      const currentEvent = activeEvents[activeEvents.length - 1];
      const nextEvent = buildWaveEvent({
        startTime: eventTime,
        startPhase: currentEvent ? sourcePhaseAt(currentEvent, eventTime) : 0,
        direction,
        amplitude: nextAmplitude,
        wavelength: nextWavelength,
        frequency: nextFrequency,
      });

      return [...activeEvents, nextEvent].slice(-MAX_WAVE_EVENTS);
    });
  };

  const handleAmplitudePreview = (nextAmplitude) => {
    setDraftAmplitude(nextAmplitude);
  };

  const handleAmplitudeCommit = (nextAmplitude) => {
    if (nextAmplitude === committedParamsRef.current.amplitude) {
      return;
    }

    const nextParams = {
      ...committedParamsRef.current,
      amplitude: nextAmplitude,
    };

    committedParamsRef.current = nextParams;
    appendWaveEvent({
      nextAmplitude: nextParams.amplitude,
      nextWavelength: nextParams.wavelength,
      nextFrequency: nextParams.frequency,
    });
    setAmplitude(nextAmplitude);
    setDraftAmplitude(nextAmplitude);
  };

  const handleWavelengthPreview = (nextWavelength) => {
    setDraftWavelength(nextWavelength);
  };

  const handleWavelengthCommit = (nextWavelength) => {
    if (nextWavelength === committedParamsRef.current.wavelength) {
      return;
    }

    const nextParams = {
      ...committedParamsRef.current,
      wavelength: nextWavelength,
    };

    committedParamsRef.current = nextParams;
    appendWaveEvent({
      nextAmplitude: nextParams.amplitude,
      nextWavelength: nextParams.wavelength,
      nextFrequency: nextParams.frequency,
    });
    setWavelength(nextWavelength);
    setDraftWavelength(nextWavelength);
  };

  const handleFrequencyPreview = (nextFrequency) => {
    setDraftFrequency(nextFrequency);
  };

  const handleFrequencyCommit = (nextFrequency) => {
    if (nextFrequency === committedParamsRef.current.frequency) {
      return;
    }

    const nextParams = {
      ...committedParamsRef.current,
      frequency: nextFrequency,
    };

    committedParamsRef.current = nextParams;
    appendWaveEvent({
      nextAmplitude: nextParams.amplitude,
      nextWavelength: nextParams.wavelength,
      nextFrequency: nextParams.frequency,
    });
    setFrequency(nextFrequency);
    setDraftFrequency(nextFrequency);
  };

  const handleDirectionChange = (nextDirection) => {
    if (nextDirection === direction) {
      return;
    }

    lastTimeRef.current = null;
    setDirection(nextDirection);
    setTime(0);
    setWaveEvents(
      buildResetWaveEvents({
        time: 0,
        direction: nextDirection,
        amplitude: committedParamsRef.current.amplitude,
        wavelength: committedParamsRef.current.wavelength,
        frequency: committedParamsRef.current.frequency,
      }),
    );
  };

  const plotWidth = STAGE.width - STAGE.padding.left - STAGE.padding.right;
  const amplitudePx = amplitude * 52;
  const period = 1 / draftFrequency;
  const speed = draftWavelength * draftFrequency;
  const k = (2 * Math.PI) / draftWavelength;
  const omega = 2 * Math.PI * frequency;
  const wavelengthPx = (wavelength / STAGE.domainLength) * plotWidth;
  const highlightStageX = stageXFromPhysical(4.8);

  const transversePath = Array.from({ length: SAMPLE_COUNT + 1 }, (_, index) => {
    const xPhysical = (index / SAMPLE_COUNT) * STAGE.domainLength;
    const x = stageXFromPhysical(xPhysical);
    const waveState = evaluateWaveState({
      events: waveEvents,
      xPhysical,
      time,
    });
    const localAmplitude = waveState.event?.amplitude ?? 0;
    const y = TRANSVERSE_BASELINE_Y - localAmplitude * 52 * waveState.sin;

    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');

  const mediumPoints = Array.from({ length: 22 }, (_, index) => {
    const xPhysical = (index / 21) * STAGE.domainLength;
    const waveState = evaluateWaveState({
      events: waveEvents,
      xPhysical,
      time,
    });
    const localAmplitude = waveState.event?.amplitude ?? 0;

    return {
      x: stageXFromPhysical(xPhysical),
      y: TRANSVERSE_BASELINE_Y - localAmplitude * 52 * waveState.sin,
      shift: localAmplitude * 18 * waveState.cos,
      density: 0.5 + 0.5 * waveState.cos,
    };
  });
  const compressionBands = buildLongitudinalBands({
    events: waveEvents,
    time,
    phaseOffset: 0,
    plotWidth,
    widthFactor: 0.24,
  });
  const rarefactionBands = buildLongitudinalBands({
    events: waveEvents,
    time,
    phaseOffset: Math.PI,
    plotWidth,
    widthFactor: 0.28,
  });

  const waveEquation =
    mode === 'transverse'
      ? direction === 1
        ? 'y(x,t) = A sin(kx - wt)'
        : 'y(x,t) = A sin(kx + wt)'
      : direction === 1
        ? 'Dx(x,t) = A cos(kx - wt)'
        : 'Dx(x,t) = A cos(kx + wt)';

  const modeSummary =
    mode === 'transverse'
      ? 'Each particle moves perpendicular to the direction of travel, so the crests and troughs pass by while the medium mostly bobs in place.'
      : 'Each particle moves parallel to the direction of travel, so crowded and spread-out regions move through the medium even though the particles only shuffle back and forth.';

  const relationSummary =
    direction === 1
      ? 'A right-moving wave keeps the same shape while its phase shifts toward larger x.'
      : 'A left-moving wave keeps the same shape while its phase shifts toward smaller x.';

  return (
    <div
      className="grid h-full min-h-[42rem] grid-cols-1 gap-6 bg-[var(--sim-bg)] p-5 text-[color:var(--text-primary)] lg:grid-cols-[1.18fr_0.82fr]"
      style={{ overflowAnchor: 'none' }}
    >
      <div className="space-y-5">
        <div className="overflow-hidden rounded-[1.9rem] border border-[var(--grid-line)] bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.16),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(15,118,110,0.12),transparent_36%),var(--bg-primary)] shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--grid-line)] px-5 py-5">
            <div>
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                Traveling Wave
              </p>

            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-1 shadow-sm">
                <ModeButton isActive={mode === 'transverse'} accent="var(--accent-blue)" label="Transverse" onClick={() => setMode('transverse')} />
                <ModeButton isActive={mode === 'longitudinal'} accent="#0f766e" label="Longitudinal" onClick={() => setMode('longitudinal')} />
              </div>

              <div className="flex items-center gap-2 rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => handleDirectionChange(-1)}
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 ${
                    direction === -1
                      ? 'bg-[var(--accent-red)] text-white shadow-sm'
                      : 'text-[color:var(--text-muted)] hover:text-[var(--accent-blue)]'
                  }`}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Left
                </button>
                <button
                  type="button"
                  onClick={() => handleDirectionChange(1)}
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 ${
                    direction === 1
                      ? 'bg-[var(--accent-blue)] text-white shadow-sm'
                      : 'text-[color:var(--text-muted)] hover:text-[var(--accent-blue)]'
                  }`}
                >
                  Right
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsPlaying((playing) => !playing)}
                className="flex items-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {isPlaying ? 'Pause' : 'Play'}
              </button>
            </div>
          </div>

          <div className="px-5 py-5">
            <svg viewBox={`0 0 ${STAGE.width} ${STAGE.height}`} className="h-auto w-full" role="img" aria-label="Interactive wave simulator">
              <defs>
                <linearGradient id="wave-line" x1="0%" x2="100%" y1="0%" y2="0%">
                  <stop offset="0%" stopColor="rgba(15,118,110,0.86)" />
                  <stop offset="100%" stopColor="rgba(59,130,246,0.96)" />
                </linearGradient>
                <linearGradient id="wave-fill" x1="0%" x2="0%" y1="0%" y2="100%">
                  <stop offset="0%" stopColor="rgba(59,130,246,0.22)" />
                  <stop offset="100%" stopColor="rgba(59,130,246,0.02)" />
                </linearGradient>
              </defs>

              <rect x="0" y="0" width={STAGE.width} height={STAGE.height} rx="26" fill="color-mix(in srgb, var(--sim-bg) 82%, white)" />

              {[0, 2, 4, 6, 8, 10].map((tick) => {
                const x = stageXFromPhysical(tick);
                return (
                  <g key={tick}>
                    <line
                      x1={x}
                      x2={x}
                      y1={STAGE.padding.top}
                      y2={STAGE.height - STAGE.padding.bottom}
                      stroke="rgba(148, 163, 184, 0.18)"
                      strokeWidth="1.4"
                    />
                    <text x={x} y={STAGE.height - 14} textAnchor="middle" fill="rgba(71, 85, 105, 0.9)" fontSize="13" fontWeight="600">
                      {tick}
                    </text>
                  </g>
                );
              })}

              {mode === 'transverse' ? (
                <>
                  <line
                    x1={STAGE.padding.left}
                    x2={STAGE.width - STAGE.padding.right}
                    y1={TRANSVERSE_BASELINE_Y}
                    y2={TRANSVERSE_BASELINE_Y}
                    stroke="rgba(71, 85, 105, 0.36)"
                    strokeWidth="1.8"
                    strokeDasharray="8 8"
                  />
                  <path
                    d={`${transversePath} L ${stageXFromPhysical(STAGE.domainLength)} ${TRANSVERSE_BASELINE_Y} L ${STAGE.padding.left} ${TRANSVERSE_BASELINE_Y} Z`}
                    fill="url(#wave-fill)"
                  />
                  <path d={transversePath} fill="none" stroke="url(#wave-line)" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />

                  {mediumPoints.map((point, index) => (
                    <circle
                      key={index}
                      cx={point.x}
                      cy={point.y}
                      r={index === 10 ? 7.5 : 5.5}
                      fill={index === 10 ? 'rgba(239, 68, 68, 0.95)' : 'rgba(15, 23, 42, 0.78)'}
                    />
                  ))}

                  <line
                    x1={highlightStageX}
                    x2={highlightStageX}
                    y1={TRANSVERSE_BASELINE_Y - amplitudePx}
                    y2={TRANSVERSE_BASELINE_Y + amplitudePx}
                    stroke="rgba(239, 68, 68, 0.24)"
                    strokeWidth="2"
                    strokeDasharray="6 6"
                  />
                  <line
                    x1="118"
                    x2="118"
                    y1={TRANSVERSE_BASELINE_Y}
                    y2={TRANSVERSE_BASELINE_Y - amplitudePx}
                    stroke="rgba(239, 68, 68, 0.9)"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                  <path d={`M 110 ${TRANSVERSE_BASELINE_Y - amplitudePx + 8} L 118 ${TRANSVERSE_BASELINE_Y - amplitudePx} L 126 ${TRANSVERSE_BASELINE_Y - amplitudePx + 8}`} fill="none" stroke="rgba(239, 68, 68, 0.9)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  <path d={`M 110 ${TRANSVERSE_BASELINE_Y - 8} L 118 ${TRANSVERSE_BASELINE_Y} L 126 ${TRANSVERSE_BASELINE_Y - 8}`} fill="none" stroke="rgba(239, 68, 68, 0.9)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  <text x="138" y={TRANSVERSE_BASELINE_Y - amplitudePx / 2 + 4} fill="rgba(239, 68, 68, 0.92)" fontSize="14" fontWeight="700">
                    amplitude
                  </text>
                </>
              ) : (
                <>
                  <line
                    x1={STAGE.padding.left}
                    x2={STAGE.width - STAGE.padding.right}
                    y1={LONGITUDINAL_BASELINE_Y}
                    y2={LONGITUDINAL_BASELINE_Y}
                    stroke="rgba(71, 85, 105, 0.32)"
                    strokeWidth="2"
                  />

                  {compressionBands.map((band) => (
                    <rect
                      key={`compression-${band.key}`}
                      x={band.x - band.width / 2}
                      y={LONGITUDINAL_BASELINE_Y - 48}
                      width={band.width}
                      height="96"
                      rx="22"
                      fill="rgba(59, 130, 246, 0.12)"
                    />
                  ))}

                  {rarefactionBands.map((band) => (
                    <rect
                      key={`rarefaction-${band.key}`}
                      x={band.x - band.width / 2}
                      y={LONGITUDINAL_BASELINE_Y - 42}
                      width={band.width}
                      height="84"
                      rx="22"
                      fill="rgba(15, 118, 110, 0.08)"
                    />
                  ))}

                  {mediumPoints.map((point, index) => (
                    <circle
                      key={index}
                      cx={point.x + point.shift}
                      cy={LONGITUDINAL_BASELINE_Y}
                      r={index === 10 ? 7.5 : 6}
                      fill={`rgba(15, 23, 42, ${0.38 + point.density * 0.48})`}
                    />
                  ))}
                </>
              )}

              <line
                x1={stageXFromPhysical(1.4)}
                x2={stageXFromPhysical(1.4) + wavelengthPx}
                y1={STAGE.height - 40}
                y2={STAGE.height - 40}
                stroke="rgba(59, 130, 246, 0.92)"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <path d={`M ${stageXFromPhysical(1.4)} ${STAGE.height - 48} L ${stageXFromPhysical(1.4) - 8} ${STAGE.height - 40} L ${stageXFromPhysical(1.4)} ${STAGE.height - 32}`} fill="none" stroke="rgba(59, 130, 246, 0.92)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <path d={`M ${stageXFromPhysical(1.4) + wavelengthPx} ${STAGE.height - 48} L ${stageXFromPhysical(1.4) + wavelengthPx + 8} ${STAGE.height - 40} L ${stageXFromPhysical(1.4) + wavelengthPx} ${STAGE.height - 32}`} fill="none" stroke="rgba(59, 130, 246, 0.92)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <text x={stageXFromPhysical(1.4) + wavelengthPx / 2} y={STAGE.height - 52} textAnchor="middle" fill="rgba(59, 130, 246, 0.95)" fontSize="14" fontWeight="700">
                wavelength
              </text>

              <text x={STAGE.padding.left} y="22" fill="rgba(71, 85, 105, 0.85)" fontSize="14" fontWeight="700">
                position x (m)
              </text>
              <text x={STAGE.width - STAGE.padding.right} y="22" textAnchor="end" fill="rgba(71, 85, 105, 0.85)" fontSize="14" fontWeight="700">
                {mode === 'transverse' ? 'medium motion is vertical' : 'medium motion is horizontal'}
              </text>
            </svg>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">Wave Speed</p>
            <p className="mt-3 mb-1 text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">
              {formatNumber(speed)} m/s
            </p>
          </div>

          <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[#0f766e]">Period</p>
            <p className="mt-3 mb-1 text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">
              {formatNumber(period)} s
            </p>
          </div>

          <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">Wave Number</p>
            <p className="mt-3 mb-1 text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">
              {formatNumber(k)} rad/m
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        <div className="rounded-[1.8rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">Parameters</p>
          <p className="mt-2 mb-4 text-sm leading-7 text-[color:var(--text-muted)]">
          </p>

          <div className="space-y-5">
            <ControlSlider
              label="Amplitude"
              value={draftAmplitude}
              valueLabel={`${formatNumber(draftAmplitude)} m`}
              min="0.2"
              max="1.2"
              step="0.05"
              onChange={handleAmplitudePreview}
              onCommit={handleAmplitudeCommit}
            />

            <ControlSlider
              label="Wavelength"
              value={draftWavelength}
              valueLabel={`${formatNumber(draftWavelength)} m`}
              min="1.2"
              max="4.6"
              step="0.05"
              onChange={handleWavelengthPreview}
              onCommit={handleWavelengthCommit}
            />

            <ControlSlider
              label="Frequency"
              value={draftFrequency}
              valueLabel={`${formatNumber(draftFrequency)} Hz`}
              min="0.4"
              max="2.2"
              step="0.05"
              onChange={handleFrequencyPreview}
              onCommit={handleFrequencyCommit}
            />
          </div>
        </div>



        <div className="rounded-[1.8rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: mode === 'transverse' ? 'var(--accent-blue)' : '#0f766e' }}>
            What Changes
          </p>
          <p className="mt-3 mb-0 text-sm leading-7 text-[color:var(--text-primary)]">{modeSummary}</p>

        </div>
      </div>
    </div>
  );
}
