import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';

const STAGE = {
  width: 920,
  height: 560,
  sourceX: 128,
  sourceY: 234,
  barrierX: 364,
  barrierTop: 124,
  barrierBottom: 352,
  slitUpperY: 174,
  slitLowerY: 266,
  slitHeight: 38,
  detectorX: 398,
  detectorY: 106,
  screenAreaX: 522,
  screenAreaY: 92,
  screenAreaWidth: 250,
  screenAreaHeight: 332,
  screenStripX: 548,
  screenStripY: 118,
  screenStripWidth: 32,
  screenStripHeight: 286,
};

const SCREEN_TOP = STAGE.screenStripY;
const SCREEN_BOTTOM = STAGE.screenStripY + STAGE.screenStripHeight;
const SCREEN_HEIGHT = SCREEN_BOTTOM - SCREEN_TOP;
const BIN_COUNT = 72;
const PREDICTION_SAMPLE_COUNT = 720;
const MAX_HITS = 1800;
const MIN_WAVELENGTH_NM = 380;
const MAX_WAVELENGTH_NM = 780;
const DEFAULT_WAVELENGTH_NM = 620;
const MIN_DE_BROGLIE_WAVELENGTH_PM = 20;
const MAX_DE_BROGLIE_WAVELENGTH_PM = 160;
const DEFAULT_DE_BROGLIE_WAVELENGTH_PM = 70;
const LIGHT_TWO_SLIT_WIDTH_UM = 12;
const LIGHT_WIDTH_SCALE_UM = 10;
const LIGHT_SEPARATION_SCALE_UM = 24;
const ELECTRON_TWO_SLIT_WIDTH_NM = 1.3;
const ELECTRON_WIDTH_SCALE_NM = 1.0;
const ELECTRON_SEPARATION_SCALE_NM = 3.0;
const ELECTRON_MARKER_TRAVEL_TIME_S = 1;
const SCREEN_ANGLE_SCALE = 0.04;

const MODES = {
  one_slit: {
    chip: '1 slit',
    title: 'One slit open',
  },
  two_slits: {
    chip: '2 slits',
    title: 'Coherent two slits',
  },
};

const SOURCES = {
  light: {
    title: 'Light',
    sceneLabel: 'LIGHT',
    panelLabel: 'Photons / s',
    wavelengthLabel: 'Wavelength',
  },
  electron: {
    title: 'Electrons',
    sceneLabel: 'ELECTRONS',
    panelLabel: 'Electrons / s',
    wavelengthLabel: 'Wavelength',
  },
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const formatNumber = (value, digits = 2) => {
  const fixed = value.toFixed(digits);
  return fixed === '-0.00' || fixed === '-0.0' ? fixed.slice(1) : fixed;
};

const sincSquared = (value) => {
  if (Math.abs(value) < 1e-6) {
    return 1;
  }

  const sinc = Math.sin(value) / value;
  return sinc * sinc;
};

const getSourceAppearance = (sourceType, wavelengthNm, rateLevel) => {
  if (sourceType === 'electron') {
    return {
      ambientColor: 'rgba(34,211,238,0.72)',
      beamColor: 'rgba(34,211,238,0.9)',
      coreColor: 'rgba(226,232,240,0.96)',
      glowOpacity: 0.42,
      ambientOpacity: 0.08,
      coreHaloOpacity: 0.2,
      beamAreaOpacity: 0.03,
      waveStrokeOpacity: 0.8,
      shellFill: 'rgba(15,23,42,0.24)',
      shellStroke: 'rgba(34,211,238,0.74)',
    };
  }

  const normalized = (wavelengthNm - MIN_WAVELENGTH_NM) / (MAX_WAVELENGTH_NM - MIN_WAVELENGTH_NM);
  const hue = 265 - normalized * 265;
  const visibleColor = `hsl(${hue.toFixed(1)} 90% 60%)`;
  const shellFillOpacity = 0.05 + rateLevel * 0.09;

  return {
    ambientColor: visibleColor,
    beamColor: visibleColor,
    coreColor: visibleColor,
    glowOpacity: 0.22 + rateLevel * 0.62,
    ambientOpacity: 0.02 + rateLevel * 0.12,
    coreHaloOpacity: 0.14 + rateLevel * 0.24,
    beamAreaOpacity: 0.025 + rateLevel * 0.06,
    waveStrokeOpacity: 0.15 + rateLevel * 0.22,
    shellFill: `rgba(59,130,246,${shellFillOpacity.toFixed(3)})`,
    shellStroke: 'rgba(59,130,246,0.68)',
  };
};

const scenePosition = (x, y, transform = 'translate(-50%, -50%)') => ({
  left: `${(x / STAGE.width) * 100}%`,
  top: `${(y / STAGE.height) * 100}%`,
  transform,
});

const buildCdf = (weights) => {
  const total = weights.reduce((sum, value) => sum + value, 0);
  let running = 0;

  return weights.map((value, index) => {
    running += value / total;
    return index === weights.length - 1 ? 1 : running;
  });
};

const sampleIndexFromCdf = (cdf) => {
  const target = Math.random();

  for (let index = 0; index < cdf.length; index += 1) {
    if (target <= cdf[index]) {
      return index;
    }
  }

  return cdf.length - 1;
};

const sampleCurveY = (sampleIndex, sampleCount) => {
  const step = SCREEN_HEIGHT / sampleCount;
  return SCREEN_TOP + sampleIndex * step + Math.random() * step;
};

const getNarrative = ({ mode, sourceType }) => {
  if (mode === 'one_slit') {
    if (sourceType === 'electron') {
      return 'With only one opening available, single electrons still build up a broad diffraction envelope on the screen. Each hit is localized, but the long-run pattern still reflects wave spreading through the slit.';
    }

    return 'For light, classical wave theory already predicts this single-slit diffraction envelope. The quantum wrinkle is that the screen still fills in through individual photon detections.';
  }

  if (sourceType === 'electron') {
    return 'This is the striking quantum case: individual electrons land at definite points, but over time they build an interference pattern set by their de Broglie wavelength rather than by two independent particle streams.';
  }

  return 'For light, classical wave theory and quantum theory agree on the interference pattern. What this display adds is the one-by-one build-up from individual photon detections.';
};

function SceneSlider({
  label,
  value,
  valueLabel,
  min,
  max,
  step,
  onChange,
  disabled = false,
}) {
  return (
    <label className={`block ${disabled ? 'opacity-45' : ''}`}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
          {label}
        </span>
        <span className="font-mono text-[0.72rem] text-[color:var(--text-primary)]">
          {valueLabel}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        style={{ accentColor: 'var(--accent-blue)' }}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[color:color-mix(in_srgb,var(--grid-line)_70%,white)] disabled:cursor-not-allowed"
      />
    </label>
  );
}

function ModeChip({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[0.72rem] font-semibold transition-colors ${
        active
          ? 'border-[var(--accent-blue)] bg-[color:color-mix(in_srgb,var(--accent-blue)_12%,white)] text-[color:var(--text-primary)]'
          : 'border-[var(--grid-line)] bg-[color:color-mix(in_srgb,var(--bg-primary)_78%,transparent)] text-[color:var(--text-muted)] hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]'
      }`}
    >
      {label}
    </button>
  );
}

function SceneButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--grid-line)] bg-[color:color-mix(in_srgb,var(--bg-primary)_82%,transparent)] text-[color:var(--text-primary)] shadow-[0_10px_24px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
    >
      {children}
    </button>
  );
}

function ActionPill({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-[var(--grid-line)] bg-[color:color-mix(in_srgb,var(--bg-primary)_84%,transparent)] px-3 py-1.5 text-[0.72rem] font-semibold text-[color:var(--text-primary)] transition-colors hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
    >
      {label}
    </button>
  );
}

export default function DoubleSlitInlineLab() {
  const [mode, setMode] = useState('two_slits');
  const [sourceType, setSourceType] = useState('light');
  const [lightWavelengthNm, setLightWavelengthNm] = useState(DEFAULT_WAVELENGTH_NM);
  const [electronWavelengthPm, setElectronWavelengthPm] = useState(
    DEFAULT_DE_BROGLIE_WAVELENGTH_PM,
  );
  const [slitSeparation, setSlitSeparation] = useState(1.35);
  const [slitWidth, setSlitWidth] = useState(1.0);
  const [detectionRate, setDetectionRate] = useState(5);
  const [isPlaying, setIsPlaying] = useState(true);
  const [detectorState, setDetectorState] = useState(() => ({
    hits: [],
    counts: Array(BIN_COUNT).fill(0),
    total: 0,
  }));
  const [wavePhase, setWavePhase] = useState(0);

  const frameRef = useRef();
  const lastTimeRef = useRef();
  const carryRef = useRef(0);
  const nextIdRef = useRef(0);
  const sourceConfig = SOURCES[sourceType];
  const displayedWavelength =
    sourceType === 'light' ? lightWavelengthNm : electronWavelengthPm;
  const rateLevel = detectionRate / 30;
  const wavelengthUm =
    sourceType === 'light' ? lightWavelengthNm / 1000 : electronWavelengthPm / 1_000_000;
  const slitWidthMetric =
    sourceType === 'light'
      ? mode === 'one_slit'
        ? slitWidth * LIGHT_WIDTH_SCALE_UM
        : LIGHT_TWO_SLIT_WIDTH_UM
      : mode === 'one_slit'
        ? slitWidth * ELECTRON_WIDTH_SCALE_NM
        : ELECTRON_TWO_SLIT_WIDTH_NM;
  const slitSeparationMetric =
    sourceType === 'light'
      ? slitSeparation * LIGHT_SEPARATION_SCALE_UM
      : slitSeparation * ELECTRON_SEPARATION_SCALE_NM;
  const slitMetricUnit = sourceType === 'light' ? 'um' : 'nm';
  const slitWidthUm =
    sourceType === 'light' ? slitWidthMetric : slitWidthMetric / 1000;
  const slitSeparationUm =
    sourceType === 'light' ? slitSeparationMetric : slitSeparationMetric / 1000;
  const barrierMidY = (STAGE.barrierTop + STAGE.barrierBottom) / 2;
  const visualSlitWidthControl = mode === 'one_slit' ? slitWidth : 1;
  const slitPixelHeight = clamp(18 + visualSlitWidthControl * 12, 18, 42);
  const slitCenterGapPx = clamp(38 + slitSeparation * 24, 54, 112);
  const upperSlitY = Math.round(barrierMidY - slitCenterGapPx / 2 - slitPixelHeight / 2);
  const lowerSlitY = Math.round(barrierMidY + slitCenterGapPx / 2 - slitPixelHeight / 2);
  const upperSlitCenter = upperSlitY + slitPixelHeight / 2;
  const lowerSlitCenter = lowerSlitY + slitPixelHeight / 2;
  const centerSlitY = Math.round(barrierMidY - slitPixelHeight / 2);
  const centerSlitCenter = centerSlitY + slitPixelHeight / 2;
  const openingHalfHeight = slitPixelHeight / SCREEN_HEIGHT;
  const openingCenters = useMemo(
    () =>
      mode === 'one_slit'
        ? [((centerSlitCenter - SCREEN_TOP) / SCREEN_HEIGHT) * 2 - 1]
        : [
            ((upperSlitCenter - SCREEN_TOP) / SCREEN_HEIGHT) * 2 - 1,
            ((lowerSlitCenter - SCREEN_TOP) / SCREEN_HEIGHT) * 2 - 1,
          ],
    [centerSlitCenter, lowerSlitCenter, mode, upperSlitCenter],
  );

  const distribution = useMemo(() => {
    const activeVisibility = mode === 'two_slits' ? 1 : 0;

    const evaluateAtPosition = (position) => {
      const sinTheta = position * SCREEN_ANGLE_SCALE;
      const diffractionPhase = Math.PI * slitWidthUm * sinTheta / wavelengthUm;
      const envelope = sincSquared(diffractionPhase);
      const interferencePhase = Math.PI * slitSeparationUm * sinTheta / wavelengthUm;
      const twoSlit = envelope * (1 + activeVisibility * Math.cos(2 * interferencePhase)) * 0.5;
      const active = mode === 'one_slit' ? envelope : twoSlit;
      const classicalParticle =
        sourceType === 'electron' &&
        openingCenters.some((center) => Math.abs(position - center) <= openingHalfHeight)
          ? 1
          : 0;

      return {
        active,
        classicalParticle,
      };
    };

    const bins = Array.from({ length: BIN_COUNT }, (_, index) =>
      evaluateAtPosition(-1 + (index / (BIN_COUNT - 1)) * 2),
    );
    const curveSamples = Array.from({ length: PREDICTION_SAMPLE_COUNT }, (_, index) =>
      evaluateAtPosition(-1 + (index / (PREDICTION_SAMPLE_COUNT - 1)) * 2),
    );

    const activeWeights = bins.map((bin) => bin.active);
    const activeCurveWeights = curveSamples.map((sample) => sample.active);
    const referenceCurveWeights =
      sourceType === 'electron'
        ? curveSamples.map((sample) => sample.classicalParticle)
        : null;
    const maxActive = Math.max(...activeWeights, 1);
    const maxCurveActive = Math.max(...activeCurveWeights, 1);
    const maxReference = referenceCurveWeights ? Math.max(...referenceCurveWeights, 1) : 1;

    return {
      cdf: buildCdf(activeCurveWeights),
      normalizedActive: activeWeights.map((value) => value / maxActive),
      predictionCurve: activeCurveWeights.map((value) => value / maxCurveActive),
      referenceCurve: referenceCurveWeights
        ? referenceCurveWeights.map((value) => value / maxReference)
        : null,
      fringeSpacing:
        mode === 'two_slits'
          ? wavelengthUm / (Math.max(slitSeparationUm, 1e-6) * SCREEN_ANGLE_SCALE)
          : null,
    };
  }, [
    mode,
    openingCenters,
    openingHalfHeight,
    slitSeparationUm,
    slitWidthUm,
    sourceType,
    wavelengthUm,
  ]);

  const resetDetections = () => {
    setDetectorState({
      hits: [],
      counts: Array(BIN_COUNT).fill(0),
      total: 0,
    });
    carryRef.current = 0;
    nextIdRef.current = 0;
  };

  const toggleSourceType = () => {
    setSourceType((current) => (current === 'light' ? 'electron' : 'light'));
    resetDetections();
  };

  const handleSourceKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleSourceType();
    }
  };

  const handleWavelengthChange = (value) => {
    if (sourceType === 'light') {
      setLightWavelengthNm(value);
      return;
    }

    setElectronWavelengthPm(value);
  };

  const appendHits = (sampleCount) => {
    if (sampleCount <= 0) {
      return;
    }

    const sampledIndices = Array.from({ length: sampleCount }, () =>
      sampleIndexFromCdf(distribution.cdf),
    );

    setDetectorState((previous) => {
      const nextCounts = [...previous.counts];
      const newHits = sampledIndices.map((sampleIndex) => {
        const y = sampleCurveY(sampleIndex, PREDICTION_SAMPLE_COUNT);
        const binIndex = clamp(
          Math.floor(((y - SCREEN_TOP) / SCREEN_HEIGHT) * BIN_COUNT),
          0,
          BIN_COUNT - 1,
        );
        nextCounts[binIndex] += 1;

        return {
          id: nextIdRef.current++,
          x: STAGE.screenStripX + 7 + Math.random() * (STAGE.screenStripWidth - 14),
          y,
        };
      });

      return {
        counts: nextCounts,
        hits: [...previous.hits, ...newHits].slice(-MAX_HITS),
        total: previous.total + sampleCount,
      };
    });
  };

  useEffect(() => {
    resetDetections();
  }, [distribution]);

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

      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = time;
      const rawBatch = carryRef.current + detectionRate * dt;
      const batchSize = Math.floor(rawBatch);
      carryRef.current = rawBatch - batchSize;

      const phaseStep =
        sourceType === 'light'
          ? (dt * 92) / (14 + wavelengthUm * 44)
          : dt / ELECTRON_MARKER_TRAVEL_TIME_S;
      setWavePhase((current) => (current + phaseStep) % 1);
      appendHits(batchSize);
      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameRef.current);
      lastTimeRef.current = undefined;
    };
  }, [detectionRate, distribution.cdf, isPlaying, sourceType, wavelengthUm]);

  const measuredPeak = Math.max(...detectorState.counts, 0);
  const centerIndex = Math.floor(BIN_COUNT / 2);
  const centerContrast =
    measuredPeak > 0
      ? detectorState.counts[centerIndex] / measuredPeak
      : distribution.normalizedActive[centerIndex];
  const statusSummary = getNarrative({
    mode,
    sourceType,
  });
  const sourceAppearance = getSourceAppearance(sourceType, lightWavelengthNm, rateLevel);
  const waveColor = sourceAppearance.beamColor;
  const waveSpacing = 14 + wavelengthUm * 44;
  const incomingWaveOffset = wavePhase * waveSpacing;
  const incomingWaveCount =
    Math.ceil((STAGE.barrierX - STAGE.sourceX + 70) / waveSpacing) + 4;
  const electronQuestionCount = Math.max(1, Math.round(detectionRate));
  const electronLaneCount =
    electronQuestionCount <= 8 ? 2 : electronQuestionCount <= 18 ? 3 : 4;
  const electronMarkersPerLane = Math.ceil(electronQuestionCount / electronLaneCount);
  const electronPathStart = STAGE.sourceX + 58;
  const electronPathSpan = STAGE.barrierX - electronPathStart - 28;
  const electronLaneSpacing = 20;
  const histogramX = STAGE.screenStripX + STAGE.screenStripWidth + 22;
  const histogramWidth = 124;
  const apertureTop = mode === 'one_slit' ? centerSlitY + 4 : upperSlitCenter - 12;
  const apertureBottom = mode === 'one_slit' ? centerSlitY + slitPixelHeight - 4 : lowerSlitCenter + 12;

  const renderProfilePath = (values, xStart, xScale) =>
    values
      .map((value, index) => {
        const x = xStart + value * xScale;
        const y = SCREEN_TOP + (index / (values.length - 1)) * SCREEN_HEIGHT;
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');

  return (
    <section className="not-prose my-10">
      <div className="relative overflow-hidden">
        <svg
          viewBox={`0 0 ${STAGE.width} ${STAGE.height}`}
          className="block h-auto w-full"
          role="img"
          aria-label="Double-slit interference interactive with controls embedded in the apparatus"
        >
          <defs>
            <radialGradient id="double-slit-source-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={sourceAppearance.ambientColor} stopOpacity={sourceAppearance.glowOpacity} />
              <stop offset="100%" stopColor={sourceAppearance.ambientColor} stopOpacity="0" />
            </radialGradient>
            <linearGradient id="double-slit-screen-fill" x1="0%" x2="100%" y1="0%" y2="0%">
              <stop offset="0%" stopColor={waveColor} stopOpacity="0.08" />
              <stop offset="100%" stopColor={waveColor} stopOpacity="0.32" />
            </linearGradient>
            <linearGradient id="double-slit-screen-shell" x1="0%" x2="0%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.8)" />
              <stop offset="100%" stopColor="rgba(226,232,240,0.54)" />
            </linearGradient>
            <linearGradient id="double-slit-barrier" x1="0%" x2="0%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(30,41,59,0.92)" />
              <stop offset="100%" stopColor="rgba(15,23,42,0.78)" />
            </linearGradient>
          </defs>

          <circle cx="168" cy="108" r="94" fill={sourceAppearance.ambientColor} opacity={sourceAppearance.ambientOpacity} />
          <circle cx="742" cy="108" r="84" fill="rgba(59,130,246,0.08)" />
          <ellipse cx="486" cy="506" rx="310" ry="24" fill="rgba(148,163,184,0.16)" />

          <path
            d={`M ${STAGE.sourceX + 32} ${STAGE.sourceY - 58} C ${STAGE.sourceX + 128} ${STAGE.sourceY - 74}, ${STAGE.barrierX - 70} ${STAGE.sourceY - 92}, ${STAGE.barrierX - 12} ${apertureTop} L ${STAGE.barrierX - 12} ${apertureBottom} C ${STAGE.barrierX - 70} ${STAGE.sourceY + 92}, ${STAGE.sourceX + 128} ${STAGE.sourceY + 74}, ${STAGE.sourceX + 32} ${STAGE.sourceY + 58} Z`}
            fill={waveColor}
            opacity={sourceAppearance.beamAreaOpacity}
          />

          <rect
            x={STAGE.screenAreaX}
            y={STAGE.screenAreaY}
            width={STAGE.screenAreaWidth}
            height={STAGE.screenAreaHeight}
            rx="42"
            fill="url(#double-slit-screen-shell)"
            stroke="rgba(148,163,184,0.34)"
            strokeWidth="2"
          />
          <path
            d={`M ${STAGE.screenAreaX + 28} ${STAGE.screenAreaY + 40} H ${STAGE.screenAreaX + STAGE.screenAreaWidth - 28}`}
            fill="none"
            stroke="rgba(255,255,255,0.58)"
            strokeWidth="4"
            strokeLinecap="round"
          />

          <g
            transform={`translate(${STAGE.sourceX} ${STAGE.sourceY})`}
            role="button"
            tabIndex="0"
            aria-label={`Switch source. Current source: ${sourceConfig.title}`}
            onClick={toggleSourceType}
            onKeyDown={handleSourceKeyDown}
            style={{ cursor: 'pointer' }}
          >
            <circle r="54" fill="url(#double-slit-source-glow)" />
            <circle r="34" fill={sourceAppearance.shellFill} stroke={sourceAppearance.shellStroke} strokeWidth="3" />
            {sourceType === 'light' ? (
              <>
                <circle r="8" fill={sourceAppearance.coreColor} />
                <circle
                  r="17"
                  fill={sourceAppearance.ambientColor}
                  opacity={sourceAppearance.coreHaloOpacity}
                />
                <rect x="-7" y="34" width="14" height="60" rx="7" fill="rgba(71,85,105,0.76)" />
                <rect x="-28" y="88" width="56" height="13" rx="6.5" fill="rgba(100,116,139,0.48)" />
              </>
            ) : (
              <>
                <rect
                  x="-24"
                  y="-18"
                  width="48"
                  height="36"
                  rx="12"
                  fill="rgba(15,23,42,0.72)"
                  stroke={sourceAppearance.shellStroke}
                  strokeWidth="2.5"
                />
                <rect
                  x="20"
                  y="-8"
                  width="18"
                  height="16"
                  rx="6"
                  fill="rgba(15,23,42,0.72)"
                  stroke={sourceAppearance.shellStroke}
                  strokeWidth="2.5"
                />
                <circle cx="-7" cy="0" r="5" fill={sourceAppearance.coreColor} />
                <circle cx="7" cy="0" r="5" fill={sourceAppearance.coreColor} opacity="0.88" />
                <circle cx="24" cy="0" r="4" fill={sourceAppearance.beamColor} opacity="0.94" />
                <rect x="-7" y="24" width="14" height="70" rx="7" fill="rgba(71,85,105,0.76)" />
                <rect x="-30" y="88" width="60" height="13" rx="6.5" fill="rgba(100,116,139,0.48)" />
              </>
            )}
          </g>

          {sourceType === 'light'
            ? Array.from({ length: incomingWaveCount }, (_, index) => {
                const x =
                  STAGE.sourceX - waveSpacing * 2 + incomingWaveOffset + index * waveSpacing;
                const controlX = x + 40;

                if (x < STAGE.sourceX - 24 || x > STAGE.barrierX - 12) {
                  return null;
                }

                return (
                  <path
                    key={`incoming-wave-${index}`}
                    d={`M ${x} ${STAGE.sourceY - 56} C ${controlX} ${STAGE.sourceY - 30}, ${controlX} ${STAGE.sourceY + 30}, ${x} ${STAGE.sourceY + 56}`}
                    fill="none"
                    stroke={waveColor}
                    strokeOpacity={sourceAppearance.waveStrokeOpacity}
                    strokeWidth="2"
                  />
                );
              })
            : Array.from({ length: electronQuestionCount }, (_, index) => {
                const lane = index % electronLaneCount;
                const slot = Math.floor(index / electronLaneCount);
                const laneStride = electronPathSpan / Math.max(electronMarkersPerLane, 1);
                const travelOffset =
                  (wavePhase * electronPathSpan + slot * laneStride + lane * 8) %
                  electronPathSpan;
                const x = electronPathStart + travelOffset;
                const y =
                  STAGE.sourceY -
                  ((electronLaneCount - 1) * electronLaneSpacing) / 2 +
                  lane * electronLaneSpacing +
                  Math.sin(wavePhase * 3.2 + index * 0.45) * 2.5;

                return (
                  <text
                    key={`electron-question-${index}`}
                    x={x}
                    y={y}
                    fill={waveColor}
                    fillOpacity={sourceAppearance.waveStrokeOpacity}
                    fontSize="26"
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    ?
                  </text>
                );
              })}

          <g>
            <rect
              x={STAGE.barrierX}
              y={STAGE.barrierTop}
              width="18"
              height={STAGE.barrierBottom - STAGE.barrierTop}
              rx="9"
              fill="url(#double-slit-barrier)"
            />
            {mode === 'two_slits' ? (
              <>
                <rect
                  x={STAGE.barrierX}
                  y={upperSlitY}
                  width="18"
                  height={slitPixelHeight}
                  rx="7"
                  fill="white"
                />
                <rect
                  x={STAGE.barrierX}
                  y={lowerSlitY}
                  width="18"
                  height={slitPixelHeight}
                  rx="7"
                  fill="white"
                />
              </>
            ) : (
              <rect
                x={STAGE.barrierX}
                y={centerSlitY}
                width="18"
                height={slitPixelHeight}
                rx="7"
                fill="white"
              />
            )}
          </g>

          
        

          {Array.from({ length: 6 }, (_, index) => {
            const y = SCREEN_TOP + index * 48;
            return (
              <line
                key={`screen-grid-${y}`}
                x1={STAGE.screenStripX - 8}
                x2={histogramX + histogramWidth + 10}
                y1={y}
                y2={y}
                stroke="rgba(148,163,184,0.16)"
                strokeWidth="1"
              />
            );
          })}

          <path
            d={renderProfilePath(distribution.predictionCurve, histogramX, histogramWidth)}
            fill="none"
            stroke={waveColor}
            strokeWidth="3"
            opacity="0.88"
          />
          {distribution.referenceCurve ? (
            <path
              d={renderProfilePath(distribution.referenceCurve, histogramX, histogramWidth)}
              fill="none"
              stroke="rgba(100,116,139,0.9)"
              strokeWidth="2.5"
              strokeDasharray="8 8"
            />
          ) : null}

          {detectorState.counts.map((count, index) => {
            const y = SCREEN_TOP + index * (SCREEN_HEIGHT / BIN_COUNT);
            const width = measuredPeak > 0 ? (count / measuredPeak) * histogramWidth : 0;

            return (
              <rect
                key={`hist-${index}`}
                x={histogramX}
                y={y + 1}
                width={width}
                height={Math.max(1, SCREEN_HEIGHT / BIN_COUNT - 2)}
                rx="3"
                fill="url(#double-slit-screen-fill)"
              />
            );
          })}

          <rect
            x={STAGE.screenStripX}
            y={SCREEN_TOP}
            width={STAGE.screenStripWidth}
            height={SCREEN_HEIGHT}
            rx="12"
            fill="rgba(255,255,255,0.88)"
            stroke="rgba(148,163,184,0.34)"
            strokeWidth="3"
          />

          {detectorState.hits.map((hit) => (
            <circle key={hit.id} cx={hit.x} cy={hit.y} r="2.4" fill={waveColor} opacity="0.9" />
          ))}

          <g transform={`translate(${histogramX} ${STAGE.screenAreaY + STAGE.screenAreaHeight - 26})`}>
            <line x1="0" x2="18" y1="0" y2="0" stroke={waveColor} strokeWidth="3" />
            <text x="26" y="4" fill="rgba(71,85,105,0.9)" fontSize="11" fontWeight="600">
              prediction
            </text>
            {distribution.referenceCurve ? (
              <>
                <line
                  x1="98"
                  x2="116"
                  y1="0"
                  y2="0"
                  stroke="rgba(100,116,139,0.9)"
                  strokeWidth="2.5"
                  strokeDasharray="6 6"
                />
                <text x="124" y="4" fill="rgba(71,85,105,0.9)" fontSize="11" fontWeight="600">
                  classical particles
                </text>
              </>
            ) : null}
          </g>

          <text
            x={STAGE.sourceX}
            y="108"
            textAnchor="middle"
            fill="rgba(71,85,105,0.84)"
            fontSize="12"
            fontWeight="700"
            letterSpacing="0.16em"
          >
            SOURCE
          </text>
          <text
            x={STAGE.sourceX}
            y="125"
            textAnchor="middle"
            fill="rgba(71,85,105,0.72)"
            fontSize="11"
            fontWeight="600"
            letterSpacing="0.16em"
          >
            {sourceConfig.sceneLabel}
          </text>
          <text
            x={STAGE.barrierX + 9}
            y="108"
            textAnchor="middle"
            fill="rgba(71,85,105,0.84)"
            fontSize="12"
            fontWeight="700"
            letterSpacing="0.16em"
          >
            BARRIER
          </text>
          <text
            x={STAGE.screenAreaX + STAGE.screenAreaWidth / 2}
            y="74"
            textAnchor="middle"
            fill="rgba(71,85,105,0.84)"
            fontSize="12"
            fontWeight="700"
            letterSpacing="0.16em"
          >
            SCREEN
          </text>
        </svg>

        <div className="pointer-events-none absolute inset-0">
          <div
            className="pointer-events-auto absolute flex flex-wrap items-center justify-center gap-2"
            style={scenePosition(STAGE.detectorX, 58)}
          >
            {Object.entries(MODES).map(([key, config]) => (
              <ModeChip
                key={key}
                active={key === mode}
                label={config.chip}
                onClick={() => setMode(key)}
              />
            ))}
          </div>

          <div
            className="pointer-events-auto absolute w-[31%] min-w-[8.75rem] max-w-[13rem] rounded-[1.4rem] border border-[color:color-mix(in_srgb,var(--grid-line)_58%,white)] bg-[color:color-mix(in_srgb,var(--bg-primary)_82%,transparent)] p-3 shadow-[0_14px_34px_rgba(15,23,42,0.1)] backdrop-blur-sm"
            style={scenePosition(STAGE.sourceX, 432)}
          >
            <p className="m-0 text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
              {sourceConfig.title} Source
            </p>
            <div className="mt-2.5 space-y-3">
              <SceneSlider
                label={sourceConfig.wavelengthLabel}
                value={displayedWavelength}
                valueLabel={`${Math.round(displayedWavelength)} ${sourceType === 'light' ? 'nm' : 'pm'}`}
                min={sourceType === 'light' ? MIN_WAVELENGTH_NM : MIN_DE_BROGLIE_WAVELENGTH_PM}
                max={sourceType === 'light' ? MAX_WAVELENGTH_NM : MAX_DE_BROGLIE_WAVELENGTH_PM}
                step={sourceType === 'light' ? 5 : 1}
                onChange={handleWavelengthChange}
              />
              <SceneSlider
                label={sourceConfig.panelLabel}
                value={detectionRate}
                valueLabel={`${Math.round(detectionRate)}`}
                min={1}
                max={30}
                step={1}
                onChange={setDetectionRate}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionPill label="Burst 100" onClick={() => appendHits(100)} />
            </div>
          </div>

          <div
            className="pointer-events-auto absolute w-[32%] min-w-[9rem] max-w-[13rem] rounded-[1.4rem] border border-[color:color-mix(in_srgb,var(--grid-line)_58%,white)] bg-[color:color-mix(in_srgb,var(--bg-primary)_82%,transparent)] p-3 shadow-[0_14px_34px_rgba(15,23,42,0.1)] backdrop-blur-sm"
            style={scenePosition(STAGE.barrierX + 12, 434)}
          >
            <p className="m-0 text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
              Barrier
            </p>
            <div className="mt-2.5 space-y-3">
              {mode === 'one_slit' ? (
                <SceneSlider
                  label="Slit Width"
                  value={slitWidth}
                  valueLabel={`${formatNumber(slitWidthMetric, sourceType === 'light' ? 0 : 1)} ${slitMetricUnit}`}
                  min={0.5}
                  max={1.8}
                  step={0.01}
                  onChange={setSlitWidth}
                />
              ) : (
                <SceneSlider
                  label="Slit Separation"
                  value={slitSeparation}
                  valueLabel={`${formatNumber(slitSeparationMetric, sourceType === 'light' ? 0 : 1)} ${slitMetricUnit}`}
                  min={0.7}
                  max={2.2}
                  step={0.01}
                  onChange={setSlitSeparation}
                />
              )}
            </div>
          </div>

          <div
            className="pointer-events-auto absolute flex items-center gap-2"
            style={scenePosition(884, 64, 'translate(-100%, -50%)')}
          >
            <SceneButton
              label={isPlaying ? 'Pause double-slit lab' : 'Play double-slit lab'}
              onClick={() => setIsPlaying((current) => !current)}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </SceneButton>
            <SceneButton label="Reset double-slit detections" onClick={resetDetections}>
              <RotateCcw className="h-4 w-4" />
            </SceneButton>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <p className="m-0 text-sm leading-7 text-[color:var(--text-primary)]">{statusSummary}</p>
        <p className="m-0 flex flex-wrap gap-x-5 gap-y-1 text-sm leading-7 text-[color:var(--text-muted)]">
          <span>Source: {sourceConfig.title}</span>
          <span>Mode: {MODES[mode].title}</span>
          <span>Detections: {detectorState.total.toLocaleString()}</span>
          <span>
            Fringe spacing:{' '}
            {distribution.fringeSpacing == null
              ? 'No fringes'
              : `${formatNumber(distribution.fringeSpacing, 2)} units`}
          </span>
        </p>
      </div>
    </section>
  );
}
