import React, { startTransition, useEffect, useEffectEvent, useRef, useState } from 'react';

const MIN_FREQUENCY = 0.35;
const MAX_FREQUENCY = 1.85;
const NATURAL_FREQUENCY = 1.05;
const DAMPING_RATIO = 0.14;
const DEFAULT_FREQUENCY = 0.92;
const CURVE_SAMPLE_COUNT = 180;

const PLOT = {
  width: 640,
  height: 320,
  padding: {
    top: 20,
    right: 20,
    bottom: 46,
    left: 56,
  },
};

const STAGE = {
  width: 430,
  height: 360,
  centerX: 220,
  platformY: 272,
  platformWidth: 118,
  platformHeight: 22,
  rodBaseY: 254,
  rodHeight: 196,
};

const BASE_SHAKE_AMPLITUDE = 10;
const ROD_VISUAL_SCALE = 1;
const ROD_SEGMENTS = 28;
const X_TICKS = [0.4, 0.8, 1.2, 1.6];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatNumber(value, digits = 2) {
  const fixed = value.toFixed(digits);
  return fixed === '-0.00' || fixed === '-0.0' ? fixed.slice(1) : fixed;
}

function getResponseFactor(frequency) {
  const ratio = frequency / NATURAL_FREQUENCY;
  const denominator = Math.sqrt(
    (1 - ratio * ratio) * (1 - ratio * ratio) + (2 * DAMPING_RATIO * ratio) * (2 * DAMPING_RATIO * ratio),
  );

  return 1 / denominator;
}

function getPhaseLag(frequency) {
  const ratio = frequency / NATURAL_FREQUENCY;
  return Math.atan2(2 * DAMPING_RATIO * ratio, 1 - ratio * ratio);
}

function getModeShapeAt(u) {
  const beta = 1.875104068711961;
  const sigma =
    (Math.cosh(beta) + Math.cos(beta)) /
    (Math.sinh(beta) + Math.sin(beta));
  const x = beta * u;
  const raw =
    Math.cosh(x) -
    Math.cos(x) -
    sigma * (Math.sinh(x) - Math.sin(x));
  const normalization =
    Math.cosh(beta) -
    Math.cos(beta) -
    sigma * (Math.sinh(beta) - Math.sin(beta));

  return raw / normalization;
}

function frequencyToPlotX(frequency) {
  const usableWidth = PLOT.width - PLOT.padding.left - PLOT.padding.right;
  return (
    PLOT.padding.left +
    ((frequency - MIN_FREQUENCY) / (MAX_FREQUENCY - MIN_FREQUENCY)) * usableWidth
  );
}

const CURVE_SAMPLES = Array.from({ length: CURVE_SAMPLE_COUNT + 1 }, (_, index) => {
  const frequency =
    MIN_FREQUENCY + (index / CURVE_SAMPLE_COUNT) * (MAX_FREQUENCY - MIN_FREQUENCY);

  return {
    frequency,
    response: getResponseFactor(frequency),
  };
});

const Y_MAX =
  Math.ceil(Math.max(...CURVE_SAMPLES.map((sample) => sample.response)) * 10) / 10 + 0.4;
const Y_TICKS = Array.from({ length: Math.ceil(Y_MAX) + 1 }, (_, index) => index).filter(
  (tick) => tick <= Y_MAX,
);

function responseToPlotY(response) {
  const usableHeight = PLOT.height - PLOT.padding.top - PLOT.padding.bottom;
  return PLOT.padding.top + ((Y_MAX - response) / Y_MAX) * usableHeight;
}

const CURVE_PATH = CURVE_SAMPLES.map((sample, index) => {
  const x = frequencyToPlotX(sample.frequency);
  const y = responseToPlotY(sample.response);
  return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
}).join(' ');

const CURVE_AREA_PATH = [
  `M ${frequencyToPlotX(MIN_FREQUENCY)} ${responseToPlotY(0)}`,
  ...CURVE_SAMPLES.map((sample) => {
    const x = frequencyToPlotX(sample.frequency);
    const y = responseToPlotY(sample.response);
    return `L ${x} ${y}`;
  }),
  `L ${frequencyToPlotX(MAX_FREQUENCY)} ${responseToPlotY(0)}`,
  'Z',
].join(' ');

function buildRodPath(baseShift, tipBend) {
  const points = [];

  for (let index = 0; index <= ROD_SEGMENTS; index += 1) {
    const u = index / ROD_SEGMENTS;
    const x =
      STAGE.centerX +
      baseShift +
      tipBend * getModeShapeAt(u) * ROD_VISUAL_SCALE;
    const y = STAGE.rodBaseY - STAGE.rodHeight * u;
    points.push(`${index === 0 ? 'M' : 'L'} ${x} ${y}`);
  }

  return points.join(' ');
}

function getRegimeCopy(frequency) {
  if (Math.abs(frequency - NATURAL_FREQUENCY) < 0.12) {
    return "Near resonance, the table timing keeps feeding the rod's first bending mode, so the tip sweep grows quickly.";
  }

  if (frequency < NATURAL_FREQUENCY) {
    return 'Below resonance, the rod mostly follows the table and only bends modestly before the next shove arrives.';
  }

  return 'Above resonance, the table is shaking too quickly for the rod to keep pace, so the lag grows while the response falls back down.';
}

export default function ResonanceResponseInline() {
  const [driveFrequency, setDriveFrequency] = useState(DEFAULT_FREQUENCY);
  const [time, setTime] = useState(0);
  const plotRef = useRef(null);
  const lastTimestampRef = useRef(0);
  const dragRef = useRef({
    active: false,
    pointerId: null,
  });

  const updateFrequencyFromClientX = useEffectEvent((clientX) => {
    if (!plotRef.current) {
      return;
    }

    const rect = plotRef.current.getBoundingClientRect();
    const scaleX = PLOT.width / rect.width;
    const localX = (clientX - rect.left) * scaleX;
    const clampedX = clamp(localX, PLOT.padding.left, PLOT.width - PLOT.padding.right);
    const nextFrequency =
      MIN_FREQUENCY +
      ((clampedX - PLOT.padding.left) / (PLOT.width - PLOT.padding.left - PLOT.padding.right)) *
        (MAX_FREQUENCY - MIN_FREQUENCY);

    startTransition(() => {
      setDriveFrequency(clamp(nextFrequency, MIN_FREQUENCY, MAX_FREQUENCY));
    });
  });

  useEffect(() => {
    let frameId = 0;

    const animate = (timestamp) => {
      if (!lastTimestampRef.current) {
        lastTimestampRef.current = timestamp;
      }

      const dt = Math.min((timestamp - lastTimestampRef.current) / 1000, 1 / 24);
      lastTimestampRef.current = timestamp;
      setTime((current) => current + dt);
      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  const handlePointerDown = (event) => {
    event.preventDefault();

    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
    };

    plotRef.current?.setPointerCapture?.(event.pointerId);
    updateFrequencyFromClientX(event.clientX);
  };

  const handlePointerMove = (event) => {
    if (!dragRef.current.active || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    updateFrequencyFromClientX(event.clientX);
  };

  const finishPointerDrag = (event) => {
    if (!dragRef.current.active || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = {
      active: false,
      pointerId: null,
    };

    plotRef.current?.releasePointerCapture?.(event.pointerId);
  };

  const handleKeyDown = (event) => {
    const keySteps = {
      ArrowLeft: -0.02,
      ArrowDown: -0.02,
      ArrowRight: 0.02,
      ArrowUp: 0.02,
      PageDown: -0.08,
      PageUp: 0.08,
    };

    if (event.key === 'Home') {
      event.preventDefault();
      setDriveFrequency(MIN_FREQUENCY);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setDriveFrequency(MAX_FREQUENCY);
      return;
    }

    const delta = keySteps[event.key];

    if (delta === undefined) {
      return;
    }

    event.preventDefault();
    setDriveFrequency((current) => clamp(current + delta, MIN_FREQUENCY, MAX_FREQUENCY));
  };

  const responseFactor = getResponseFactor(driveFrequency);
  const phaseLag = getPhaseLag(driveFrequency);
  const phaseLagDegrees = (phaseLag * 180) / Math.PI;
  const angularFrequency = 2 * Math.PI * driveFrequency;
  const baseShift = BASE_SHAKE_AMPLITUDE * Math.sin(angularFrequency * time);
  const tipAmplitude = BASE_SHAKE_AMPLITUDE * responseFactor;
  const tipAbsoluteShift = tipAmplitude * Math.sin(angularFrequency * time - phaseLag);
  const tipBend = tipAbsoluteShift - baseShift;
  const relativeBendAmplitude =
    BASE_SHAKE_AMPLITUDE *
    Math.sqrt(
      responseFactor * responseFactor +
        1 -
        2 * responseFactor * Math.cos(phaseLag),
    );
  const pointX = frequencyToPlotX(driveFrequency);
  const pointY = responseToPlotY(responseFactor);
  const naturalFrequencyX = frequencyToPlotX(NATURAL_FREQUENCY);
  const liveRodPath = buildRodPath(baseShift, tipBend);
  const positiveEnvelopePath = buildRodPath(0, relativeBendAmplitude);
  const negativeEnvelopePath = buildRodPath(0, -relativeBendAmplitude);
  const platformX = STAGE.centerX - STAGE.platformWidth / 2 + baseShift;
  const tipX = STAGE.centerX + tipAbsoluteShift;
  const tipY = STAGE.rodBaseY - STAGE.rodHeight;

  return (
    <section className="not-prose my-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
            Inline Interactive
          </p>
          <h3 className="mt-2 mb-0 text-[1.35rem] font-semibold tracking-tight text-[color:var(--text-primary)]">
            Sweep the drive along the resonance curve
          </h3>
        </div>
        <p className="m-0 inline-flex items-center rounded-full border border-[var(--grid-line)] px-3 py-1 text-xs font-medium text-[color:var(--text-muted)]">
          Flexible rod on a shake table, first bending mode
        </p>
      </div>

      <p className="mt-0 mb-5 max-w-3xl text-sm leading-7 text-[color:var(--text-muted)]">
        Drag the marker directly on the response curve. Its horizontal position sets the table frequency,
        and the rod animation updates to the matching steady-state response and phase lag.
      </p>

      <div className="grid items-start gap-7 xl:grid-cols-[1.14fr_0.86fr]">
        <div>
          <div
            ref={plotRef}
            role="slider"
            tabIndex={0}
            aria-label="Drive frequency along the resonance response curve"
            aria-valuemin={MIN_FREQUENCY}
            aria-valuemax={MAX_FREQUENCY}
            aria-valuenow={Number(formatNumber(driveFrequency))}
            aria-valuetext={`${formatNumber(driveFrequency)} hertz`}
            className="cursor-ew-resize select-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--bg-primary)]"
            style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishPointerDrag}
            onPointerCancel={finishPointerDrag}
            onKeyDown={handleKeyDown}
            onDragStart={(event) => event.preventDefault()}
          >
            <svg
              viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
              className="h-auto w-full"
              role="img"
              aria-label="Resonance response curve"
              style={{ pointerEvents: 'none' }}
            >
              <defs>
                <linearGradient id="response-curve-line" x1="0%" x2="100%" y1="0%" y2="0%">
                  <stop offset="0%" stopColor="rgba(59, 130, 246, 0.78)" />
                  <stop offset="55%" stopColor="rgba(59, 130, 246, 0.98)" />
                  <stop offset="100%" stopColor="rgba(37, 99, 235, 0.76)" />
                </linearGradient>
                <linearGradient id="response-curve-fill" x1="0%" x2="0%" y1="0%" y2="100%">
                  <stop offset="0%" stopColor="rgba(59, 130, 246, 0.18)" />
                  <stop offset="100%" stopColor="rgba(59, 130, 246, 0.02)" />
                </linearGradient>
              </defs>

              {Y_TICKS.map((tick) => {
                const y = responseToPlotY(tick);
                return (
                  <g key={`y-${tick}`}>
                    <line
                      x1={PLOT.padding.left}
                      x2={PLOT.width - PLOT.padding.right}
                      y1={y}
                      y2={y}
                      stroke={tick === 0 ? 'rgba(15, 23, 42, 0.36)' : 'rgba(148, 163, 184, 0.24)'}
                      strokeDasharray={tick === 0 ? '0' : '7 8'}
                      strokeWidth={tick === 0 ? '1.8' : '1.3'}
                    />
                    <text
                      x="18"
                      y={y + 4}
                      fill="rgba(71, 85, 105, 0.92)"
                      fontSize="13"
                      fontWeight="600"
                    >
                      {tick.toFixed(0)}x
                    </text>
                  </g>
                );
              })}

              {X_TICKS.map((tick) => {
                const x = frequencyToPlotX(tick);
                return (
                  <g key={`x-${tick}`}>
                    <line
                      x1={x}
                      x2={x}
                      y1={PLOT.padding.top}
                      y2={PLOT.height - PLOT.padding.bottom}
                      stroke="rgba(148, 163, 184, 0.24)"
                      strokeWidth="1.2"
                    />
                    <text
                      x={x}
                      y={PLOT.height - 14}
                      textAnchor="middle"
                      fill="rgba(71, 85, 105, 0.92)"
                      fontSize="13"
                      fontWeight="600"
                    >
                      {formatNumber(tick, 1)}
                    </text>
                  </g>
                );
              })}

              <line
                x1={naturalFrequencyX}
                x2={naturalFrequencyX}
                y1={PLOT.padding.top}
                y2={PLOT.height - PLOT.padding.bottom}
                stroke="rgba(239, 68, 68, 0.78)"
                strokeDasharray="5 6"
                strokeWidth="2.2"
              />
              <text
                x={naturalFrequencyX + 8}
                y={PLOT.padding.top + 18}
                fill="rgba(239, 68, 68, 0.92)"
                fontSize="13"
                fontWeight="700"
              >
                natural mode
              </text>

              <path d={CURVE_AREA_PATH} fill="url(#response-curve-fill)" />
              <path
                d={CURVE_PATH}
                fill="none"
                stroke="url(#response-curve-line)"
                strokeWidth="4.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              <line
                x1={pointX}
                x2={pointX}
                y1={pointY}
                y2={responseToPlotY(0)}
                stroke="rgba(239, 68, 68, 0.58)"
                strokeDasharray="4 6"
                strokeWidth="2"
              />
              <circle
                cx={pointX}
                cy={pointY}
                r="8.5"
                fill="rgba(239, 68, 68, 0.96)"
                stroke="rgba(255, 255, 255, 0.96)"
                strokeWidth="3"
              />

              <text
                x={PLOT.width / 2}
                y={PLOT.height - 10}
                textAnchor="middle"
                fill="rgba(15, 23, 42, 0.82)"
                fontSize="14"
                fontWeight="700"
              >
                drive frequency (Hz)
              </text>
              <text
                x="20"
                y={PLOT.padding.top - 2}
                fill="rgba(15, 23, 42, 0.82)"
                fontSize="14"
                fontWeight="700"
              >
                tip response
              </text>
            </svg>
          </div>

          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <div className="rounded-full border border-[var(--grid-line)] px-3 py-1.5 text-[color:var(--text-primary)]">
              Drive: <span className="font-semibold">{formatNumber(driveFrequency)} Hz</span>
            </div>
            <div className="rounded-full border border-[var(--grid-line)] px-3 py-1.5 text-[color:var(--text-primary)]">
              Response: <span className="font-semibold">{formatNumber(responseFactor)}x</span>
            </div>
            <div className="rounded-full border border-[var(--grid-line)] px-3 py-1.5 text-[color:var(--text-primary)]">
              Phase lag: <span className="font-semibold">{formatNumber(phaseLagDegrees, 0)}&deg;</span>
            </div>
          </div>

          <p className="mt-3 mb-0 text-sm leading-7 text-[color:var(--text-muted)]">
            {getRegimeCopy(driveFrequency)}
          </p>
        </div>

        <div>
          <svg
            viewBox={`0 0 ${STAGE.width} ${STAGE.height}`}
            className="h-auto w-full"
            role="img"
            aria-label="Flexible rod on a shake table"
          >
            <defs>
              <linearGradient id="rod-gradient" x1="0%" x2="0%" y1="0%" y2="100%">
                <stop offset="0%" stopColor="rgba(59, 130, 246, 0.92)" />
                <stop offset="100%" stopColor="rgba(15, 23, 42, 0.92)" />
              </linearGradient>
              <linearGradient id="platform-gradient" x1="0%" x2="100%" y1="0%" y2="0%">
                <stop offset="0%" stopColor="rgba(241, 245, 249, 0.98)" />
                <stop offset="100%" stopColor="rgba(203, 213, 225, 0.92)" />
              </linearGradient>
            </defs>

            <line
              x1="40"
              x2={STAGE.width - 40}
              y1={STAGE.platformY + STAGE.platformHeight + 42}
              y2={STAGE.platformY + STAGE.platformHeight + 42}
              stroke="rgba(148, 163, 184, 0.52)"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <line
              x1="62"
              x2={STAGE.width - 62}
              y1={STAGE.platformY + STAGE.platformHeight + 18}
              y2={STAGE.platformY + STAGE.platformHeight + 18}
              stroke="rgba(148, 163, 184, 0.4)"
              strokeWidth="2.5"
              strokeDasharray="10 8"
              strokeLinecap="round"
            />

            <path
              d={negativeEnvelopePath}
              fill="none"
              stroke="rgba(239, 68, 68, 0.18)"
              strokeWidth="7"
              strokeLinecap="round"
            />
            <path
              d={positiveEnvelopePath}
              fill="none"
              stroke="rgba(239, 68, 68, 0.18)"
              strokeWidth="7"
              strokeLinecap="round"
            />

            <rect
              x={platformX}
              y={STAGE.platformY}
              width={STAGE.platformWidth}
              height={STAGE.platformHeight}
              rx="9"
              fill="url(#platform-gradient)"
              stroke="rgba(71, 85, 105, 0.92)"
              strokeWidth="2.6"
            />

            {[0.2, 0.5, 0.8].map((fraction) => {
              const wheelX = platformX + STAGE.platformWidth * fraction;
              return (
                <circle
                  key={fraction}
                  cx={wheelX}
                  cy={STAGE.platformY + STAGE.platformHeight + 11}
                  r="6.5"
                  fill="rgba(226, 232, 240, 0.98)"
                  stroke="rgba(71, 85, 105, 0.88)"
                  strokeWidth="2"
                />
              );
            })}

            <path
              d={liveRodPath}
              fill="none"
              stroke="url(#rod-gradient)"
              strokeWidth="10"
              strokeLinecap="round"
            />
            <path
              d={liveRodPath}
              fill="none"
              stroke="rgba(255, 255, 255, 0.22)"
              strokeWidth="3.4"
              strokeLinecap="round"
            />

            <circle
              cx={tipX}
              cy={tipY}
              r="7"
              fill="rgba(239, 68, 68, 0.94)"
              stroke="rgba(255, 255, 255, 0.95)"
              strokeWidth="2.5"
            />
            <line
              x1={tipX}
              x2={tipX}
              y1={tipY + 18}
              y2={STAGE.platformY - 10}
              stroke="rgba(239, 68, 68, 0.34)"
              strokeDasharray="4 6"
              strokeWidth="1.8"
            />

            <line
              x1={STAGE.centerX - 34}
              x2={STAGE.centerX + 34}
              y1={STAGE.platformY + STAGE.platformHeight + 58}
              y2={STAGE.platformY + STAGE.platformHeight + 58}
              stroke="rgba(59, 130, 246, 0.92)"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            <path
              d={`M ${STAGE.centerX - 34} ${STAGE.platformY + STAGE.platformHeight + 58} l 10 -6 v 12 z`}
              fill="rgba(59, 130, 246, 0.92)"
            />
            <path
              d={`M ${STAGE.centerX + 34} ${STAGE.platformY + STAGE.platformHeight + 58} l -10 -6 v 12 z`}
              fill="rgba(59, 130, 246, 0.92)"
            />

            <text
              x="44"
              y="34"
              fill="rgba(37, 99, 235, 0.96)"
              fontSize="15"
              fontWeight="700"
            >
              Shake table
            </text>
            <text
              x="44"
              y="56"
              fill="rgba(71, 85, 105, 0.92)"
              fontSize="13"
            >
              base motion = 1.00x
            </text>
            <text
              x={tipX + 12}
              y={tipY - 10}
              fill="rgba(239, 68, 68, 0.96)"
              fontSize="13"
              fontWeight="700"
            >
              rod tip
            </text>
          </svg>

          <div className="mt-4">
            <div className="rounded-2xl border border-[var(--grid-line)] p-4">
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-red)]">
                Reading the Peak
              </p>
              <p className="mt-2 mb-0 text-sm leading-7 text-[color:var(--text-muted)]">
                Near the crest of the curve, the base motion is unchanged, but the rod tip moves about {formatNumber(responseFactor)} times the base motion.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
