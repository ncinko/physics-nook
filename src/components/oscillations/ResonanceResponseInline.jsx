import React, { startTransition, useEffect, useEffectEvent, useRef, useState } from 'react';

const MIN_FREQUENCY = 0.35;
const MAX_FREQUENCY = 1.85;
const NATURAL_FREQUENCY = 1.05;
const MIN_DAMPING = 0.03;
const MAX_DAMPING = 0.42;
const DEFAULT_DAMPING = 0.14;
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
  rodBaseY: 272,
  rodHeight: 196,
};

const BASE_SHAKE_AMPLITUDE = 10;
const MANUAL_MAX_SHIFT = 42;
const BASE_FOLLOW_RATE = 18;
const AUTO_RESUME_DELAY = 2.6;
const AUTO_RESUME_BLEND_DURATION = 0.85;
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

function getResponseFactor(frequency, dampingRatio) {
  const ratio = frequency / NATURAL_FREQUENCY;
  const denominator = Math.sqrt(
    (1 - ratio * ratio) * (1 - ratio * ratio) + (2 * dampingRatio * ratio) * (2 * dampingRatio * ratio),
  );

  return 1 / denominator;
}

function getPhaseLag(frequency, dampingRatio) {
  const ratio = frequency / NATURAL_FREQUENCY;
  return Math.atan2(2 * dampingRatio * ratio, 1 - ratio * ratio);
}

function getAutoTableState(frequency, dampingRatio, timeValue) {
  const responseFactor = getResponseFactor(frequency, dampingRatio);
  const phaseLag = getPhaseLag(frequency, dampingRatio);
  const angularFrequency = 2 * Math.PI * frequency;
  const tipAmplitude = BASE_SHAKE_AMPLITUDE * responseFactor;

  return {
    responseFactor,
    phaseLag,
    angularFrequency,
    baseShift: BASE_SHAKE_AMPLITUDE * Math.sin(angularFrequency * timeValue),
    tipShift: tipAmplitude * Math.sin(angularFrequency * timeValue - phaseLag),
    tipVelocity: angularFrequency * tipAmplitude * Math.cos(angularFrequency * timeValue - phaseLag),
  };
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

function getModeSlopeAt(u) {
  const epsilon = 0.008;
  const before = clamp(u - epsilon, 0, 1);
  const after = clamp(u + epsilon, 0, 1);

  if (after === before) {
    return 0;
  }

  return (getModeShapeAt(after) - getModeShapeAt(before)) / (after - before);
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
  };
});

function getYAxisConfig(maxResponse) {
  const paddedMax = Math.max(1, maxResponse * 1.06);
  const roughStep = paddedMax / 7;
  const exponent = 10 ** Math.floor(Math.log10(roughStep || 1));
  const normalized = roughStep / exponent;
  let niceFactor = 10;

  if (normalized <= 1) {
    niceFactor = 1;
  } else if (normalized <= 2) {
    niceFactor = 2;
  } else if (normalized <= 2.5) {
    niceFactor = 2.5;
  } else if (normalized <= 5) {
    niceFactor = 5;
  }

  const step = niceFactor * exponent;
  const yMax = Math.ceil(paddedMax / step) * step;
  const yTicks = [];

  for (let tick = 0; tick <= yMax + step * 0.1; tick += step) {
    yTicks.push(Number(tick.toFixed(6)));
  }

  return { yMax, yTicks };
}

function responseToPlotY(response, yMax) {
  const usableHeight = PLOT.height - PLOT.padding.top - PLOT.padding.bottom;
  return PLOT.padding.top + ((yMax - response) / yMax) * usableHeight;
}

function buildRodGeometry(baseShift, tipBend) {
  const segmentLength = STAGE.rodHeight / ROD_SEGMENTS;
  const points = [
    {
      x: STAGE.centerX + baseShift,
      y: STAGE.rodBaseY,
    },
  ];

  for (let index = 1; index <= ROD_SEGMENTS; index += 1) {
    const uMid = (index - 0.5) / ROD_SEGMENTS;
    const slope =
      ((tipBend * ROD_VISUAL_SCALE) / STAGE.rodHeight) * getModeSlopeAt(uMid);
    const normalization = Math.sqrt(1 + slope * slope);
    const dx = (segmentLength * slope) / normalization;
    const dy = segmentLength / normalization;
    const previous = points[points.length - 1];

    points.push({
      x: previous.x + dx,
      y: previous.y - dy,
    });
  }

  return {
    path: points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
      .join(' '),
    baseX: points[0].x,
    baseY: points[0].y,
    tipX: points[points.length - 1].x,
    tipY: points[points.length - 1].y,
  };
}

function getPointInStage(element, event) {
  const rect = element.getBoundingClientRect();
  const scaleX = STAGE.width / rect.width;
  const scaleY = STAGE.height / rect.height;

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
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
  const [dampingRatio, setDampingRatio] = useState(DEFAULT_DAMPING);
  const [time, setTime] = useState(0);
  const [isManualTableControl, setIsManualTableControl] = useState(false);
  const [manualFrame, setManualFrame] = useState({
    baseShift: 0,
    tipShift: 0,
  });
  const plotRef = useRef(null);
  const stageRef = useRef(null);
  const lastTimestampRef = useRef(0);
  const timeRef = useRef(0);
  const driveFrequencyRef = useRef(DEFAULT_FREQUENCY);
  const dampingRatioRef = useRef(DEFAULT_DAMPING);
  const dragRef = useRef({
    active: false,
    pointerId: null,
  });
  const tableDragRef = useRef({
    active: false,
    pointerId: null,
    pointerOffsetX: 0,
  });
  const manualModeRef = useRef(false);
  const manualIdleElapsedRef = useRef(0);
  const handoffRef = useRef({
    active: false,
    elapsed: 0,
    fromBase: 0,
    fromTip: 0,
  });
  const manualMotionRef = useRef({
    baseShift: 0,
    targetShift: 0,
    tipShift: 0,
    tipVelocity: 0,
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
    manualModeRef.current = isManualTableControl;
  }, [isManualTableControl]);

  useEffect(() => {
    driveFrequencyRef.current = driveFrequency;
  }, [driveFrequency]);

  useEffect(() => {
    dampingRatioRef.current = dampingRatio;
  }, [dampingRatio]);

  useEffect(() => {
    let frameId = 0;

    const animate = (timestamp) => {
      if (!lastTimestampRef.current) {
        lastTimestampRef.current = timestamp;
      }

      const dt = Math.min((timestamp - lastTimestampRef.current) / 1000, 1 / 24);
      lastTimestampRef.current = timestamp;
      timeRef.current += dt;
      setTime(timeRef.current);

      if (manualModeRef.current) {
        const manual = manualMotionRef.current;
        const naturalAngularFrequency = 2 * Math.PI * NATURAL_FREQUENCY;
        const dampingCoefficient = 2 * dampingRatioRef.current * naturalAngularFrequency;
        const springCoefficient = naturalAngularFrequency * naturalAngularFrequency;
        const followAmount = clamp(dt * BASE_FOLLOW_RATE, 0, 1);
        manual.baseShift += (manual.targetShift - manual.baseShift) * followAmount;

        const tipAcceleration =
          springCoefficient * (manual.baseShift - manual.tipShift) -
          dampingCoefficient * manual.tipVelocity;
        manual.tipVelocity += tipAcceleration * dt;
        manual.tipShift += manual.tipVelocity * dt;

        setManualFrame({
          baseShift: manual.baseShift,
          tipShift: manual.tipShift,
        });

        if (tableDragRef.current.active) {
          manualIdleElapsedRef.current = 0;
        } else {
          manualIdleElapsedRef.current += dt;

          if (manualIdleElapsedRef.current >= AUTO_RESUME_DELAY) {
            handoffRef.current = {
              active: true,
              elapsed: 0,
              fromBase: manual.baseShift,
              fromTip: manual.tipShift,
            };
            manualIdleElapsedRef.current = 0;
            manualModeRef.current = false;
            setIsManualTableControl(false);
          }
        }
      } else if (handoffRef.current.active) {
        const autoState = getAutoTableState(
          driveFrequencyRef.current,
          dampingRatioRef.current,
          timeRef.current,
        );
        handoffRef.current.elapsed += dt;
        const progress = clamp(
          handoffRef.current.elapsed / AUTO_RESUME_BLEND_DURATION,
          0,
          1,
        );
        const eased = progress * progress * (3 - 2 * progress);

        setManualFrame({
          baseShift:
            handoffRef.current.fromBase +
            (autoState.baseShift - handoffRef.current.fromBase) * eased,
          tipShift:
            handoffRef.current.fromTip +
            (autoState.tipShift - handoffRef.current.fromTip) * eased,
        });

        if (progress >= 1) {
          handoffRef.current.active = false;
        }
      }

      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  const updateTableTargetFromPointer = useEffectEvent((event) => {
    if (!stageRef.current) {
      return;
    }

    const point = getPointInStage(stageRef.current, event);
    const restPlatformX = STAGE.centerX - STAGE.platformWidth / 2;
    const nextPlatformX = clamp(
      point.x - tableDragRef.current.pointerOffsetX,
      restPlatformX - MANUAL_MAX_SHIFT,
      restPlatformX + MANUAL_MAX_SHIFT,
    );

    manualMotionRef.current.targetShift = nextPlatformX - restPlatformX;
  });

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

  const responseFactor = getResponseFactor(driveFrequency, dampingRatio);
  const phaseLag = getPhaseLag(driveFrequency, dampingRatio);
  const phaseLagDegrees = (phaseLag * 180) / Math.PI;
  const autoState = getAutoTableState(driveFrequency, dampingRatio, time);
  const autoBaseShift = autoState.baseShift;
  const tipAmplitude = BASE_SHAKE_AMPLITUDE * responseFactor;
  const autoTipAbsoluteShift = autoState.tipShift;
  const autoTipVelocity = autoState.tipVelocity;
  const baseShift =
    isManualTableControl || handoffRef.current.active ? manualFrame.baseShift : autoBaseShift;
  const tipAbsoluteShift =
    isManualTableControl || handoffRef.current.active ? manualFrame.tipShift : autoTipAbsoluteShift;
  const tipBend = tipAbsoluteShift - baseShift;
  const relativeBendAmplitude =
    BASE_SHAKE_AMPLITUDE *
    Math.sqrt(
      responseFactor * responseFactor +
        1 -
        2 * responseFactor * Math.cos(phaseLag),
    );
  const maxCurveResponse = Math.max(
    responseFactor,
    ...CURVE_SAMPLES.map((sample) => getResponseFactor(sample.frequency, dampingRatio)),
  );
  const { yMax, yTicks } = getYAxisConfig(maxCurveResponse);
  const curvePath = CURVE_SAMPLES.map((sample, index) => {
    const x = frequencyToPlotX(sample.frequency);
    const y = responseToPlotY(getResponseFactor(sample.frequency, dampingRatio), yMax);
    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');
  const curveAreaPath = [
    `M ${frequencyToPlotX(MIN_FREQUENCY)} ${responseToPlotY(0, yMax)}`,
    ...CURVE_SAMPLES.map((sample) => {
      const x = frequencyToPlotX(sample.frequency);
      const y = responseToPlotY(getResponseFactor(sample.frequency, dampingRatio), yMax);
      return `L ${x} ${y}`;
    }),
    `L ${frequencyToPlotX(MAX_FREQUENCY)} ${responseToPlotY(0, yMax)}`,
    'Z',
  ].join(' ');
  const pointX = frequencyToPlotX(driveFrequency);
  const pointY = responseToPlotY(responseFactor, yMax);
  const naturalFrequencyX = frequencyToPlotX(NATURAL_FREQUENCY);
  const liveRod = buildRodGeometry(baseShift, tipBend);
  const positiveEnvelope = buildRodGeometry(0, relativeBendAmplitude);
  const negativeEnvelope = buildRodGeometry(0, -relativeBendAmplitude);
  const platformX = STAGE.centerX - STAGE.platformWidth / 2 + baseShift;
  const tipX = liveRod.tipX;
  const tipY = liveRod.tipY;
  const mountX = liveRod.baseX - 11;

  const handleTablePointerDown = (event) => {
    if (event.button !== 0 || !stageRef.current) {
      return;
    }

    event.preventDefault();
    handoffRef.current.active = false;
    manualIdleElapsedRef.current = 0;

    const currentBaseShift = manualModeRef.current ? manualMotionRef.current.baseShift : autoBaseShift;
    const currentTipShift = manualModeRef.current ? manualMotionRef.current.tipShift : autoTipAbsoluteShift;
    const currentTipVelocity = manualModeRef.current ? manualMotionRef.current.tipVelocity : autoTipVelocity;
    const point = getPointInStage(stageRef.current, event);
    const currentPlatformX = STAGE.centerX - STAGE.platformWidth / 2 + currentBaseShift;

    manualMotionRef.current = {
      baseShift: currentBaseShift,
      targetShift: currentBaseShift,
      tipShift: currentTipShift,
      tipVelocity: currentTipVelocity,
    };

    setManualFrame({
      baseShift: currentBaseShift,
      tipShift: currentTipShift,
    });
    setIsManualTableControl(true);
    manualModeRef.current = true;

    tableDragRef.current = {
      active: true,
      pointerId: event.pointerId,
      pointerOffsetX: point.x - currentPlatformX,
    };

    stageRef.current.setPointerCapture?.(event.pointerId);
    updateTableTargetFromPointer(event);
  };

  const handleTablePointerMove = (event) => {
    if (!tableDragRef.current.active || tableDragRef.current.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    updateTableTargetFromPointer(event);
  };

  const finishTablePointerDrag = (event) => {
    if (!tableDragRef.current.active || tableDragRef.current.pointerId !== event.pointerId) {
      return;
    }

    tableDragRef.current = {
      active: false,
      pointerId: null,
      pointerOffsetX: 0,
    };

    manualMotionRef.current.targetShift = 0;
    manualIdleElapsedRef.current = 0;
    stageRef.current?.releasePointerCapture?.(event.pointerId);
  };

  return (
    <section className="not-prose my-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>

          <h3 className="mt-2 mb-0 text-[1.35rem] font-semibold tracking-tight text-[color:var(--text-primary)]">
            Sweep along the resonance curve
          </h3>
        </div>
        <p className="m-0 inline-flex items-center rounded-full border border-[var(--grid-line)] px-3 py-1 text-xs font-medium text-[color:var(--text-muted)]">
          Flexible rod on a shake table, first bending mode
        </p>
      </div>



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

              {yTicks.map((tick) => {
                const y = responseToPlotY(tick, yMax);
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
                      {`${Number.isInteger(tick) ? formatNumber(tick, 0) : formatNumber(tick, 1)}x`}
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

              <path d={curveAreaPath} fill="url(#response-curve-fill)" />
              <path
                d={curvePath}
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
                y2={responseToPlotY(0, yMax)}
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

          <div className="mt-4 max-w-sm">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[color:var(--text-primary)]">
                damping
              </span>
              <input
                type="range"
                min={MIN_DAMPING}
                max={MAX_DAMPING}
                step="0.01"
                value={dampingRatio}
                onChange={(event) => setDampingRatio(parseFloat(event.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-700"
              />
            </label>
          </div>

          <p className="mt-3 mb-0 text-sm leading-7 text-[color:var(--text-muted)]">
            {getRegimeCopy(driveFrequency)}
          </p>
        </div>

        <div>
          <svg
            ref={stageRef}
            viewBox={`0 0 ${STAGE.width} ${STAGE.height}`}
            className="h-auto w-full select-none"
            role="img"
            aria-label="Flexible rod on a shake table"
            style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
            onPointerMove={handleTablePointerMove}
            onPointerUp={finishTablePointerDrag}
            onPointerCancel={finishTablePointerDrag}
            onDragStart={(event) => event.preventDefault()}
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
              d={negativeEnvelope.path}
              fill="none"
              stroke="rgba(239, 68, 68, 0.18)"
              strokeWidth="7"
              strokeLinecap="round"
            />
            <path
              d={positiveEnvelope.path}
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
              className="cursor-grab active:cursor-grabbing"
              onPointerDown={handleTablePointerDown}
            />

            <rect
              x={mountX}
              y={STAGE.platformY - 10}
              width="22"
              height="12"
              rx="4"
              fill="rgba(226, 232, 240, 0.98)"
              stroke="rgba(71, 85, 105, 0.92)"
              strokeWidth="2.2"
            />

            <path
              d={liveRod.path}
              fill="none"
              stroke="url(#rod-gradient)"
              strokeWidth="10"
              strokeLinecap="round"
            />
            <path
              d={liveRod.path}
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
  




            <text
              x="44"
              y="34"
              fill="rgba(37, 99, 235, 0.96)"
              fontSize="15"
              fontWeight="700"
            >
              {isManualTableControl ? 'Manual shake' : 'Shake table'}
            </text>


          </svg>

          <div className="mt-4">
            <div className="rounded-2xl border border-[var(--grid-line)] p-4">
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-red)]">
                System Response
              </p>
              <p className="mt-2 mb-0 text-sm leading-7 text-[color:var(--text-muted)]">
                The rod tip moves about {formatNumber(responseFactor)} times the base amplitude.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
