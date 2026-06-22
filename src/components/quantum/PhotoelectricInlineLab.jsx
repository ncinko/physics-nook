import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';

const H_EV_PHZ = 4.135667696;
const MIN_FREQUENCY = 0.35;
const MAX_FREQUENCY = 1.85;
const MAX_VISIBLE_PHOTONS = 28;
const MAX_VISIBLE_ELECTRONS = 40;

const STAGE = {
  width: 920,
  height: 560,
  sourceX: 118,
  beamY: 228,
  cathodeX: 340,
  collectorX: 626,
  plateTop: 132,
  plateBottom: 346,
  chamberX: 246,
  chamberY: 86,
  chamberWidth: 484,
  chamberHeight: 306,
  wireY: 430,
  batteryX: 382,
  batteryY: 406,
  batteryWidth: 202,
  batteryHeight: 84,
  meterX: 798,
  meterY: 236,
};

const MATERIALS = [
  {
    id: 'sodium',
    label: 'Sodium',
    symbol: 'Na',
    workFunction: 2.28,
    plateFill: 'rgba(251,191,36,0.68)',
    plateStroke: 'rgba(217,119,6,0.76)',
  },
  {
    id: 'calcium',
    label: 'Calcium',
    symbol: 'Ca',
    workFunction: 2.9,
    plateFill: 'rgba(134,239,172,0.68)',
    plateStroke: 'rgba(22,163,74,0.74)',
  },
  {
    id: 'zinc',
    label: 'Zinc',
    symbol: 'Zn',
    workFunction: 4.3,
    plateFill: 'rgba(148,163,184,0.76)',
    plateStroke: 'rgba(71,85,105,0.78)',
  },
];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const formatNumber = (value, digits = 2) => {
  const fixed = value.toFixed(digits);
  return fixed === '-0.00' || fixed === '-0.0' ? fixed.slice(1) : fixed;
};

const frequencyToColor = (frequency) => {
  const normalized = clamp((frequency - MIN_FREQUENCY) / (MAX_FREQUENCY - MIN_FREQUENCY), 0, 1);
  const hue = 18 + normalized * 250;
  return `hsl(${hue.toFixed(1)} 88% 58%)`;
};

const buildSnapshot = (photons, electrons, totals) => ({
  photons: photons.map((photon) => ({ ...photon })),
  electrons: electrons.map((electron) => ({ ...electron })),
  cathodeFlash: totals.cathodeFlash,
  collectedTotal: totals.collectedTotal,
  emittedTotal: totals.emittedTotal,
  meterLevel: totals.meterLevel,
});

const getStatusSummary = ({
  aboveThreshold,
  collectorFraction,
  collectorVoltage,
  maxKineticEnergy,
  materialLabel,
  photonEnergy,
  workFunction,
}) => {
  if (!aboveThreshold) {
    return `${materialLabel} needs ${formatNumber(workFunction)} eV per electron, but each photon carries only ${formatNumber(photonEnergy)} eV. More brightness only sends in more underpowered photons, so emission still fails.`;
  }

  if (collectorVoltage < 0 && collectorFraction <= 0.02) {
    return 'Electrons are being emitted at the cathode, but the retarding voltage has reached the stopping potential. The collector current falls to zero even while the beam is still on.';
  }

  if (collectorVoltage < 0) {
    return 'The light is above threshold, so electrons leave the surface immediately. A negative collector voltage now turns the battery into a filter that blocks the slowest electrons first.';
  }

  if (maxKineticEnergy > 1.6) {
    return 'The photons are comfortably above threshold now. Raising intensity increases the current, but the battery test still shows that the electron energy is set by frequency rather than brightness.';
  }

  return 'You are just above threshold. Electrons appear right away because a single photon can already free one electron, but their maximum kinetic energy is still modest.';
};

const scenePosition = (x, y, transform = 'translate(-50%, -50%)') => ({
  left: `${(x / STAGE.width) * 100}%`,
  top: `${(y / STAGE.height) * 100}%`,
  transform,
});

function SceneSlider({ label, value, valueLabel, min, max, step, onChange }) {
  return (
    <label className="block">
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
        onChange={(event) => onChange(parseFloat(event.target.value))}
        style={{ accentColor: 'var(--accent-blue)' }}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[color:color-mix(in_srgb,var(--grid-line)_70%,white)]"
      />
    </label>
  );
}

const getNextMaterialId = (currentId) => {
  const currentIndex = MATERIALS.findIndex((entry) => entry.id === currentId);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % MATERIALS.length : 0;
  return MATERIALS[nextIndex].id;
};

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

export default function PhotoelectricInlineLab() {
  const [materialId, setMaterialId] = useState('sodium');
  const [frequency, setFrequency] = useState(0.72);
  const [intensity, setIntensity] = useState(0.95);
  const [collectorVoltage, setCollectorVoltage] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [snapshot, setSnapshot] = useState({
    photons: [],
    electrons: [],
    cathodeFlash: 0,
    collectedTotal: 0,
    emittedTotal: 0,
    meterLevel: 0,
  });

  const frameRef = useRef();
  const lastTimeRef = useRef();
  const photonCarryRef = useRef(0);
  const particleIdRef = useRef(0);
  const photonsRef = useRef([]);
  const electronsRef = useRef([]);
  const totalsRef = useRef({
    cathodeFlash: 0,
    collectedTotal: 0,
    emittedTotal: 0,
    meterLevel: 0,
  });

  const material = useMemo(
    () => MATERIALS.find((entry) => entry.id === materialId) ?? MATERIALS[0],
    [materialId],
  );

  const metrics = useMemo(() => {
    const photonEnergy = frequency * H_EV_PHZ;
    const thresholdFrequency = material.workFunction / H_EV_PHZ;
    const maxKineticEnergy = Math.max(0, photonEnergy - material.workFunction);
    const stoppingPotential = maxKineticEnergy;
    const retardingVoltage = Math.max(0, -collectorVoltage);
    const collectorFraction =
      maxKineticEnergy <= 0
        ? 0
        : collectorVoltage >= 0
          ? 1
          : clamp(1 - retardingVoltage / Math.max(maxKineticEnergy, 1e-6), 0, 1);
    const relativeCurrent = maxKineticEnergy > 0 ? intensity * collectorFraction : 0;

    return {
      photonEnergy,
      thresholdFrequency,
      maxKineticEnergy,
      stoppingPotential,
      collectorFraction,
      relativeCurrent,
      aboveThreshold: maxKineticEnergy > 0,
    };
  }, [collectorVoltage, frequency, intensity, material.workFunction]);

  const beamColor = frequencyToColor(frequency);
  const cycleMaterial = () => setMaterialId((current) => getNextMaterialId(current));
  const statusSummary = getStatusSummary({
    aboveThreshold: metrics.aboveThreshold,
    collectorFraction: metrics.collectorFraction,
    collectorVoltage,
    maxKineticEnergy: metrics.maxKineticEnergy,
    materialLabel: material.label,
    photonEnergy: metrics.photonEnergy,
    workFunction: material.workFunction,
  });
  const currentFill = snapshot.meterLevel;
  const currentAngle = (-128 + currentFill * 256) * (Math.PI / 180);
  const meterNeedleX = STAGE.meterX + Math.cos(currentAngle) * 42;
  const meterNeedleY = STAGE.meterY + Math.sin(currentAngle) * 42;

  const resetLab = () => {
    photonsRef.current = [];
    electronsRef.current = [];
    totalsRef.current = {
      cathodeFlash: 0,
      collectedTotal: 0,
      emittedTotal: 0,
      meterLevel: 0,
    };
    photonCarryRef.current = 0;
    particleIdRef.current = 0;
    lastTimeRef.current = undefined;
    setSnapshot(buildSnapshot(photonsRef.current, electronsRef.current, totalsRef.current));
  };

  useEffect(() => {
    resetLab();
  }, [materialId]);

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
      const spawnRate = 3 + intensity * 12;
      const rawBatch = photonCarryRef.current + spawnRate * dt;
      const batchSize = Math.floor(rawBatch);
      photonCarryRef.current = rawBatch - batchSize;

      if (batchSize > 0) {
        const newPhotons = Array.from({ length: batchSize }, () => ({
          id: particleIdRef.current++,
          x: STAGE.sourceX + 22 + Math.random() * 14,
          y: STAGE.beamY + (Math.random() - 0.5) * (48 + intensity * 28),
          speed: 180 + frequency * 34,
          radius: 4 + Math.random() * 1.6,
          opacity: 0.45 + Math.random() * 0.35,
        }));
        photonsRef.current = [...photonsRef.current, ...newPhotons].slice(-MAX_VISIBLE_PHOTONS);
      }

      const nextPhotons = [];
      const nextElectrons = [];

      photonsRef.current.forEach((photon) => {
        const nextX = photon.x + photon.speed * dt;

        if (nextX < STAGE.cathodeX - 12) {
          nextPhotons.push({ ...photon, x: nextX });
          return;
        }

        totalsRef.current.cathodeFlash = 1;

        if (!metrics.aboveThreshold) {
          return;
        }

        totalsRef.current.emittedTotal += 1;
        const retardingVoltage = Math.max(0, -collectorVoltage);
        const sampledEnergy = metrics.maxKineticEnergy * (0.18 + 0.82 * Math.random());
        const reachesCollector = collectorVoltage >= 0 || sampledEnergy > retardingVoltage;

        nextElectrons.push({
          id: particleIdRef.current++,
          x: STAGE.cathodeX + 18,
          y: STAGE.beamY + (Math.random() - 0.5) * 52,
          vx: 82 + metrics.maxKineticEnergy * 42 + Math.max(collectorVoltage, 0) * 18,
          vy: (Math.random() - 0.5) * 18,
          ax: reachesCollector
            ? Math.max(collectorVoltage, 0) * 28
            : -(125 + retardingVoltage * 56),
          drift: (Math.random() - 0.5) * 0.8,
          radius: 3.4 + Math.min(metrics.maxKineticEnergy * 0.22, 2),
          fate: reachesCollector ? 'collect' : 'return',
        });
      });

      let collectedThisFrame = 0;

      electronsRef.current = [...electronsRef.current, ...nextElectrons]
        .map((electron) => {
          const vx = electron.vx + electron.ax * dt;
          const x = electron.x + vx * dt;
          const vy = electron.vy * 0.98 + (STAGE.beamY - electron.y) * 0.03 * dt;
          const y = electron.y + vy * dt * 10 + electron.drift;

          return {
            ...electron,
            x,
            y,
            vx,
            vy,
          };
        })
        .filter((electron) => {
          if (electron.fate === 'collect' && electron.x >= STAGE.collectorX - 14) {
            totalsRef.current.collectedTotal += 1;
            collectedThisFrame += 1;
            return false;
          }

          if (electron.fate === 'return' && electron.x <= STAGE.cathodeX + 10 && electron.vx < 0) {
            return false;
          }

          return (
            electron.x > STAGE.cathodeX - 8 &&
            electron.x < STAGE.collectorX + 24 &&
            electron.y > STAGE.plateTop + 10 &&
            electron.y < STAGE.plateBottom - 10
          );
        })
        .slice(-MAX_VISIBLE_ELECTRONS);

      photonsRef.current = nextPhotons.slice(-MAX_VISIBLE_PHOTONS);
      totalsRef.current.cathodeFlash = Math.max(0, totalsRef.current.cathodeFlash - dt * 3.6);
      totalsRef.current.meterLevel = clamp(
        totalsRef.current.meterLevel * Math.exp(-dt * 2) + collectedThisFrame * 0.08,
        0,
        1,
      );
      setSnapshot(buildSnapshot(photonsRef.current, electronsRef.current, totalsRef.current));
      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameRef.current);
      lastTimeRef.current = undefined;
    };
  }, [collectorVoltage, frequency, intensity, isPlaying, metrics.aboveThreshold, metrics.maxKineticEnergy]);

  return (
    <section className="not-prose my-10">
      <div className="relative overflow-hidden">
        <svg
          viewBox={`0 0 ${STAGE.width} ${STAGE.height}`}
          className="block h-auto w-full"
          role="img"
          aria-label="Photoelectric effect interactive with the controls embedded in the apparatus"
        >
          <defs>
            <linearGradient id="photoelectric-glass" x1="0%" x2="0%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.78)" />
              <stop offset="100%" stopColor="rgba(226,232,240,0.48)" />
            </linearGradient>
            <linearGradient id="photoelectric-plate" x1="0%" x2="0%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.36)" />
              <stop offset="100%" stopColor="rgba(15,23,42,0.18)" />
            </linearGradient>
            <linearGradient id="photoelectric-beam-fill" x1="0%" x2="100%" y1="0%" y2="0%">
              <stop offset="0%" stopColor={beamColor} stopOpacity="0.02" />
              <stop offset="40%" stopColor={beamColor} stopOpacity={0.14 + intensity * 0.08} />
              <stop offset="100%" stopColor={beamColor} stopOpacity="0.01" />
            </linearGradient>
            <linearGradient id="photoelectric-battery" x1="0%" x2="0%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(255,248,220,0.94)" />
              <stop offset="100%" stopColor="rgba(234,179,8,0.28)" />
            </linearGradient>
            <radialGradient id="photoelectric-lamp-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={beamColor} stopOpacity="0.5" />
              <stop offset="100%" stopColor={beamColor} stopOpacity="0" />
            </radialGradient>
          </defs>

          <circle cx="152" cy="116" r="92" fill={beamColor} opacity="0.06" />
          <circle cx="772" cy="110" r="82" fill="rgba(59,130,246,0.08)" />
          <ellipse cx="488" cy="500" rx="292" ry="26" fill="rgba(148,163,184,0.16)" />

          <path
            d={`M ${STAGE.cathodeX + 10} ${STAGE.plateBottom} V ${STAGE.wireY} H ${STAGE.batteryX + 22}`}
            fill="none"
            stroke="rgba(71,85,105,0.72)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={`M ${STAGE.collectorX + 10} ${STAGE.plateBottom} V ${STAGE.wireY} H ${STAGE.meterX + 58}`}
            fill="none"
            stroke="rgba(71,85,105,0.72)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={`M ${STAGE.meterX - 58} ${STAGE.wireY} H ${STAGE.batteryX + STAGE.batteryWidth}`}
            fill="none"
            stroke="rgba(71,85,105,0.72)"
            strokeWidth="4"
            strokeLinecap="round"
          />

          <rect
            x={STAGE.batteryX}
            y={STAGE.batteryY}
            width={STAGE.batteryWidth}
            height={STAGE.batteryHeight}
            rx="28"
            fill="url(#photoelectric-battery)"
            stroke="rgba(217,119,6,0.36)"
            strokeWidth="2"
          />
          <rect
            x={STAGE.batteryX + 26}
            y={STAGE.batteryY + 18}
            width={STAGE.batteryWidth - 52}
            height={STAGE.batteryHeight - 36}
            rx="17"
            fill="rgba(255,255,255,0.4)"
          />
          <line
            x1={STAGE.batteryX - 12}
            x2={STAGE.batteryX}
            y1={STAGE.wireY}
            y2={STAGE.wireY}
            stroke="rgba(71,85,105,0.72)"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <text
            x={STAGE.batteryX + 30}
            y={STAGE.batteryY + 31}
            fill="rgba(146,64,14,0.84)"
            fontSize="18"
            fontWeight="700"
          >
            +
          </text>
          <text
            x={STAGE.batteryX + STAGE.batteryWidth - 40}
            y={STAGE.batteryY + 31}
            fill="rgba(146,64,14,0.84)"
            fontSize="18"
            fontWeight="700"
          >
            -
          </text>

          <g transform={`translate(${STAGE.meterX} ${STAGE.meterY})`}>
            <circle r="72" fill="rgba(255,255,255,0.74)" stroke="rgba(148,163,184,0.34)" strokeWidth="2" />
            <circle r="54" fill="rgba(248,250,252,0.9)" stroke="rgba(148,163,184,0.22)" />
            {Array.from({ length: 7 }, (_, index) => {
              const angle = (-128 + index * (256 / 6)) * (Math.PI / 180);
              const innerX = Math.cos(angle) * 38;
              const innerY = Math.sin(angle) * 38;
              const outerX = Math.cos(angle) * 50;
              const outerY = Math.sin(angle) * 50;

              return (
                <line
                  key={`meter-tick-${index}`}
                  x1={innerX}
                  x2={outerX}
                  y1={innerY}
                  y2={outerY}
                  stroke="rgba(71,85,105,0.55)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              );
            })}
            <line
              x1="0"
              x2={meterNeedleX - STAGE.meterX}
              y1="0"
              y2={meterNeedleY - STAGE.meterY}
              stroke="rgba(16,185,129,0.92)"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <circle r="7" fill="rgba(16,185,129,0.92)" />
            <text
              x="0"
              y="-18"
              textAnchor="middle"
              fill="rgba(71,85,105,0.84)"
              fontSize="11"
              fontWeight="700"
              letterSpacing="0.16em"
            >
              CURRENT
            </text>
          </g>

          <rect
            x={STAGE.chamberX}
            y={STAGE.chamberY}
            width={STAGE.chamberWidth}
            height={STAGE.chamberHeight}
            rx="54"
            fill="url(#photoelectric-glass)"
            stroke="rgba(148,163,184,0.35)"
            strokeWidth="2"
          />
          <path
            d={`M ${STAGE.chamberX + 34} ${STAGE.chamberY + 42} H ${STAGE.chamberX + STAGE.chamberWidth - 34}`}
            fill="none"
            stroke="rgba(255,255,255,0.55)"
            strokeWidth="4"
            strokeLinecap="round"
          />

          <rect
            x={STAGE.sourceX + 20}
            y={STAGE.beamY - (30 + intensity * 18)}
            width={STAGE.cathodeX - STAGE.sourceX - 38}
            height={60 + intensity * 36}
            rx="30"
            fill="url(#photoelectric-beam-fill)"
          />

          <g transform={`translate(${STAGE.sourceX} ${STAGE.beamY})`}>
            <circle r="52" fill="url(#photoelectric-lamp-glow)" />
            <circle r="34" fill="rgba(59,130,246,0.08)" stroke="rgba(59,130,246,0.7)" strokeWidth="3" />
            <circle r="14" fill={beamColor} opacity="0.96" />
            <circle r="22" fill={beamColor} opacity="0.18" />
            <rect x="-8" y="34" width="16" height="58" rx="8" fill="rgba(71,85,105,0.72)" />
            <rect x="-30" y="88" width="60" height="14" rx="7" fill="rgba(100,116,139,0.5)" />
          </g>

          {Array.from({ length: 5 }, (_, index) => (
            <path
              key={`waveguide-${index}`}
              d={`M ${STAGE.sourceX + 30 + index * 18} ${STAGE.beamY - 50} C ${STAGE.sourceX + 58 + index * 18} ${STAGE.beamY - 28}, ${STAGE.sourceX + 58 + index * 18} ${STAGE.beamY + 28}, ${STAGE.sourceX + 30 + index * 18} ${STAGE.beamY + 50}`}
              fill="none"
              stroke={beamColor}
              strokeOpacity={0.18 + intensity * 0.08}
              strokeWidth="2"
            />
          ))}

          <g
            onClick={cycleMaterial}
            role="button"
            tabIndex={0}
            aria-label={`Cycle cathode material. Current material ${material.label}.`}
            style={{ outline: 'none' }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                cycleMaterial();
              }
            }}
            className="cursor-pointer"
          >
            <title>{`Cycle cathode material. Current material ${material.label}.`}</title>
            <rect
              x={STAGE.cathodeX - 8}
              y={STAGE.plateTop - 10}
              width="36"
              height={STAGE.plateBottom - STAGE.plateTop + 20}
              rx="16"
              fill="rgba(0,0,0,0)"
            />
            <rect
              x={STAGE.cathodeX}
              y={STAGE.plateTop}
              width="20"
              height={STAGE.plateBottom - STAGE.plateTop}
              rx="10"
              fill={material.plateFill}
              stroke={material.plateStroke}
              strokeWidth="2.2"
            />
            <rect
              x={STAGE.cathodeX + 3}
              y={STAGE.plateTop + 8}
              width="6"
              height={STAGE.plateBottom - STAGE.plateTop - 16}
              rx="3"
              fill="rgba(255,255,255,0.34)"
            />
          </g>
          <rect
            x={STAGE.collectorX}
            y={STAGE.plateTop}
            width="20"
            height={STAGE.plateBottom - STAGE.plateTop}
            rx="10"
            fill="url(#photoelectric-plate)"
            stroke="rgba(15,23,42,0.24)"
            strokeWidth="2"
          />

          <circle
            cx={STAGE.cathodeX + 10}
            cy={STAGE.beamY}
            r={18 + snapshot.cathodeFlash * 26}
            fill="rgba(251,191,36,0.16)"
            opacity={snapshot.cathodeFlash}
          />

          {snapshot.photons.map((photon) => (
            <g key={photon.id}>
              <circle cx={photon.x} cy={photon.y} r={photon.radius + 4} fill={beamColor} opacity="0.12" />
              <circle cx={photon.x} cy={photon.y} r={photon.radius} fill={beamColor} opacity={photon.opacity} />
            </g>
          ))}

          {snapshot.electrons.map((electron) => (
            <g key={electron.id}>
              <circle cx={electron.x} cy={electron.y} r={electron.radius + 4} fill="rgba(16,185,129,0.14)" />
              <circle cx={electron.x} cy={electron.y} r={electron.radius} fill="rgba(16,185,129,0.92)" />
            </g>
          ))}

          <text
            x={STAGE.sourceX}
            y="108"
            textAnchor="middle"
            fill="rgba(71,85,105,0.84)"
            fontSize="12"
            fontWeight="700"
            letterSpacing="0.16em"
          >
            LIGHT SOURCE
          </text>
          <text
            x={STAGE.cathodeX + 10}
            y="114"
            textAnchor="middle"
            fill="rgba(71,85,105,0.84)"
            fontSize="12"
            fontWeight="700"
            letterSpacing="0.16em"
          >
            CATHODE [
            <tspan letterSpacing="0.02em">{material.symbol}</tspan>
            <tspan letterSpacing="0.16em">]</tspan>
          </text>
          <text
            x={STAGE.collectorX + 10}
            y="114"
            textAnchor="middle"
            fill="rgba(71,85,105,0.84)"
            fontSize="12"
            fontWeight="700"
            letterSpacing="0.16em"
          >
            COLLECTOR
          </text>
        </svg>

        <div className="pointer-events-none absolute inset-0">
          <div
            className="pointer-events-auto absolute w-[30%] min-w-[8.5rem] max-w-[12rem] rounded-[1.4rem] border border-[color:color-mix(in_srgb,var(--grid-line)_58%,white)] bg-[color:color-mix(in_srgb,var(--bg-primary)_82%,transparent)] p-3 shadow-[0_14px_34px_rgba(15,23,42,0.1)] backdrop-blur-sm"
            style={scenePosition(118, 396)}
          >
            <p className="m-0 text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
              Light
            </p>
            <div className="mt-2.5 space-y-3">
              <SceneSlider
                label="Frequency"
                value={frequency}
                valueLabel={`${formatNumber(frequency)} PHz`}
                min={MIN_FREQUENCY}
                max={MAX_FREQUENCY}
                step={0.01}
                onChange={setFrequency}
              />
              <SceneSlider
                label="Intensity"
                value={intensity}
                valueLabel={`${formatNumber(intensity)}x`}
                min={0}
                max={1}
                step={0.01}
                onChange={setIntensity}
              />
            </div>
          </div>

          <div
            className="pointer-events-auto absolute flex items-center gap-2"
            style={scenePosition(878, 64, 'translate(-100%, -50%)')}
          >
            <SceneButton label={isPlaying ? 'Pause photoelectric lab' : 'Play photoelectric lab'} onClick={() => setIsPlaying((current) => !current)}>
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </SceneButton>
            <SceneButton label="Reset photoelectric lab" onClick={resetLab}>
              <RotateCcw className="h-4 w-4" />
            </SceneButton>
          </div>

          <div
            className="pointer-events-auto absolute w-[42%] min-w-[12rem] max-w-[18rem]"
            style={scenePosition(STAGE.batteryX + STAGE.batteryWidth / 2, STAGE.batteryY + STAGE.batteryHeight / 2 + 2)}
          >
            <div className="text-center">
              <span className="block text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-[color:rgba(146,64,14,0.84)]">
                Collector Voltage
              </span>
              <span className="mt-1 block font-mono text-[0.95rem] text-[color:var(--text-primary)]">
                {formatNumber(collectorVoltage, 1)} V
              </span>
            </div>
            <input
              type="range"
              min={-6}
              max={0}
              step={0.1}
              dir="rtl"
              value={collectorVoltage}
              onChange={(event) => setCollectorVoltage(parseFloat(event.target.value))}
              style={{ accentColor: 'rgb(180 83 9)' }}
              className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[rgba(146,64,14,0.18)]"
            />
            <div className="mt-1 flex items-center justify-between text-[0.64rem] text-[color:rgba(120,53,15,0.84)]">
              <span>0.0 V</span>
              <span>-6.0 V</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <p className="m-0 text-sm leading-7 text-[color:var(--text-primary)]">{statusSummary}</p>
        <p className="m-0 flex flex-wrap gap-x-5 gap-y-1 text-sm leading-7 text-[color:var(--text-muted)]">
          <span>Photon energy: {formatNumber(metrics.photonEnergy)} eV</span>
          <span>Work function: {formatNumber(material.workFunction)} eV</span>
          <span>Max kinetic energy: {formatNumber(metrics.maxKineticEnergy)} eV</span>
          <span>Stopping potential: {formatNumber(metrics.stoppingPotential)} V</span>
        </p>
      </div>
    </section>
  );
}
