import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, StepForward } from 'lucide-react';
import {
  cloneComplexField,
  createQuantum2DPreset,
  splitStep2D,
  totalProbability2D,
} from '../../lib/quantum/timeEvolution';

const PRESETS = [
  { id: 'double-slit', label: 'Double Slit' },
  { id: 'single-slit', label: 'Single Slit' },
  { id: 'free-packet', label: 'Free Packet' },
  { id: 'finite-barrier', label: 'Finite Barrier' },
];

const VIEW_MODES = [
  { id: 'probability', label: 'Probability' },
  { id: 'phase', label: 'Phase' },
  { id: 'real', label: 'Real Part' },
];

const PRESET_DEFAULTS = {
  'double-slit': {
    wavelength: 1.55,
    packetWidth: 0.72,
    potentialStrength: 90,
    slitSeparation: 2.05,
    slitWidth: 0.82,
  },
  'single-slit': {
    wavelength: 1.45,
    packetWidth: 0.72,
    potentialStrength: 90,
    slitSeparation: 2.05,
    slitWidth: 0.9,
  },
  'free-packet': {
    wavelength: 1.65,
    packetWidth: 0.78,
    potentialStrength: 0,
    slitSeparation: 2.05,
    slitWidth: 0.82,
  },
  'finite-barrier': {
    wavelength: 1.48,
    packetWidth: 0.74,
    potentialStrength: 7.6,
    slitSeparation: 2.05,
    slitWidth: 0.82,
  },
};

const getInitialGridSize = () => {
  if (typeof window !== 'undefined' && window.innerWidth < 720) {
    return 64;
  }

  return 128;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const formatNumber = (value, digits = 2) => {
  const fixed = value.toFixed(digits);
  return fixed === '-0.00' || fixed === '-0.0' ? fixed.slice(1) : fixed;
};

const hslToRgb = (h, s, l) => {
  const hue = h / 360;
  const saturation = s / 100;
  const lightness = l / 100;

  if (saturation === 0) {
    const gray = Math.round(lightness * 255);
    return [gray, gray, gray];
  }

  const hueToRgb = (p, q, tValue) => {
    let t = tValue;

    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;

    return p;
  };

  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;

  return [
    Math.round(hueToRgb(p, q, hue + 1 / 3) * 255),
    Math.round(hueToRgb(p, q, hue) * 255),
    Math.round(hueToRgb(p, q, hue - 1 / 3) * 255),
  ];
};

function ControlSlider({ label, value, valueLabel, min, max, step, onChange, disabled = false }) {
  return (
    <label className={`block ${disabled ? 'opacity-45' : ''}`}>
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
        disabled={disabled}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-700 disabled:cursor-not-allowed"
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

function SegmentButton({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-2 text-sm font-semibold transition-all duration-300 ${
        active
          ? 'bg-[var(--accent-blue)] text-white shadow-sm'
          : 'text-[color:var(--text-primary)] hover:text-[var(--accent-blue)]'
      }`}
    >
      {label}
    </button>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-4 py-3 shadow-sm">
      <p className="m-0 text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
        {label}
      </p>
      <p className="mt-1 mb-0 font-mono text-sm font-semibold text-[color:var(--text-primary)]">
        {value}
      </p>
    </div>
  );
}

const drawField = (canvas, field, potential, viewMode) => {
  if (!canvas || !field) {
    return;
  }

  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return;
  }

  if (canvas.width !== field.width || canvas.height !== field.height) {
    canvas.width = field.width;
    canvas.height = field.height;
  }

  const image = ctx.createImageData(field.width, field.height);
  let maxProbability = 0;
  let maxAbsReal = 0;
  let maxPotential = 0;

  for (let index = 0; index < field.re.length; index += 1) {
    const probability = field.re[index] * field.re[index] + field.im[index] * field.im[index];
    maxProbability = Math.max(maxProbability, probability);
    maxAbsReal = Math.max(maxAbsReal, Math.abs(field.re[index]));
    maxPotential = Math.max(maxPotential, potential[index]);
  }

  const probabilityScale = Math.max(maxProbability * 0.82, 1e-8);
  const realScale = Math.max(maxAbsReal, 1e-8);
  const potentialScale = Math.max(maxPotential, 1e-8);
  let paintedCells = 0;

  for (let index = 0; index < field.re.length; index += 1) {
    const probability = field.re[index] * field.re[index] + field.im[index] * field.im[index];
    const intensity = clamp(Math.sqrt(probability / probabilityScale), 0, 1);
    const potentialIntensity = clamp(potential[index] / potentialScale, 0, 1);
    const pixel = index * 4;
    let r = 248;
    let g = 250;
    let b = 252;

    if (viewMode === 'phase') {
      const phase = Math.atan2(field.im[index], field.re[index]);
      const hue = ((phase + Math.PI) / (Math.PI * 2)) * 360;
      const rgb = hslToRgb(hue, 78, 40 + intensity * 35);
      r = 245 * (1 - intensity) + rgb[0] * intensity;
      g = 248 * (1 - intensity) + rgb[1] * intensity;
      b = 250 * (1 - intensity) + rgb[2] * intensity;
    } else if (viewMode === 'real') {
      const signed = clamp(field.re[index] / realScale, -1, 1);

      if (signed >= 0) {
        r = 248 - signed * 30;
        g = 250 - signed * 80;
        b = 252 - signed * 160;
      } else {
        const magnitude = -signed;
        r = 248 - magnitude * 165;
        g = 250 - magnitude * 70;
        b = 252 - magnitude * 20;
      }
    } else {
      const hot = intensity * intensity;
      r = 248 * (1 - intensity) + (22 + hot * 226) * intensity;
      g = 250 * (1 - intensity) + (120 + intensity * 118) * intensity;
      b = 252 * (1 - intensity) + (118 - hot * 74) * intensity;
    }

    if (potentialIntensity > 0) {
      const opacity = 0.78 * potentialIntensity;
      r = r * (1 - opacity) + 15 * opacity;
      g = g * (1 - opacity) + 23 * opacity;
      b = b * (1 - opacity) + 42 * opacity;
    }

    if (intensity > 0.035 || potentialIntensity > 0.05) {
      paintedCells += 1;
    }

    image.data[pixel] = clamp(Math.round(r), 0, 255);
    image.data[pixel + 1] = clamp(Math.round(g), 0, 255);
    image.data[pixel + 2] = clamp(Math.round(b), 0, 255);
    image.data[pixel + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);
  canvas.dataset.quantumRendered = 'true';
  canvas.dataset.quantumPaintedCells = String(paintedCells);
  canvas.dataset.quantumMaxProbability = maxProbability.toPrecision(5);
  canvas.dataset.quantumViewMode = viewMode;
};

const makeMetrics = (field, preset) => {
  if (!field || !preset) {
    return {
      absorbed: 0,
      norm: 1,
      transmitted: 0,
    };
  }

  const norm = totalProbability2D(field);
  let transmitted = 0;

  if (preset.barrierX != null) {
    for (let yIndex = 0; yIndex < field.height; yIndex += 1) {
      for (let xIndex = 0; xIndex < field.width; xIndex += 1) {
        const x = field.xMin + xIndex * field.dx;

        if (x > preset.barrierX + 0.45) {
          const index = yIndex * field.width + xIndex;
          transmitted += field.re[index] * field.re[index] + field.im[index] * field.im[index];
        }
      }
    }

    transmitted *= field.dx * field.dy;
  }

  return {
    absorbed: clamp(1 - norm, 0, 1),
    norm,
    transmitted,
  };
};

export default function QuantumTimeEvolution2DSimulator() {
  const [presetId, setPresetId] = useState('double-slit');
  const [viewMode, setViewMode] = useState('probability');
  const [gridSize, setGridSize] = useState(getInitialGridSize);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [time, setTime] = useState(0);
  const defaults = PRESET_DEFAULTS[presetId];
  const [wavelength, setWavelength] = useState(defaults.wavelength);
  const [packetWidth, setPacketWidth] = useState(defaults.packetWidth);
  const [potentialStrength, setPotentialStrength] = useState(defaults.potentialStrength);
  const [slitSeparation, setSlitSeparation] = useState(defaults.slitSeparation);
  const [slitWidth, setSlitWidth] = useState(defaults.slitWidth);
  const [metrics, setMetrics] = useState({ absorbed: 0, norm: 1, transmitted: 0 });
  const canvasRef = useRef();
  const frameRef = useRef();
  const lastTimeRef = useRef();
  const metricFrameRef = useRef(0);
  const slowFrameCountRef = useRef(0);
  const presetRef = useRef();
  const fieldRef = useRef();
  const viewModeRef = useRef(viewMode);
  const timeRef = useRef(0);

  const initialize = useCallback(() => {
    const preset = createQuantum2DPreset(presetId, {
      size: gridSize,
      wavelength,
      packetWidth,
      potentialStrength,
      slitSeparation,
      slitWidth,
    });

    presetRef.current = preset;
    fieldRef.current = cloneComplexField(preset.field);
    timeRef.current = 0;
    metricFrameRef.current = 0;
    setTime(0);
    setMetrics(makeMetrics(fieldRef.current, preset));
    requestAnimationFrame(() => {
      drawField(canvasRef.current, fieldRef.current, preset.potential, viewModeRef.current);
    });
  }, [gridSize, packetWidth, potentialStrength, presetId, slitSeparation, slitWidth, wavelength]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    viewModeRef.current = viewMode;

    if (fieldRef.current && presetRef.current) {
      drawField(canvasRef.current, fieldRef.current, presetRef.current.potential, viewMode);
    }
  }, [viewMode]);

  const stepSimulation = useCallback(
    (steps = 1) => {
      const preset = presetRef.current;
      const field = fieldRef.current;

      if (!preset || !field) {
        return;
      }

      for (let index = 0; index < steps; index += 1) {
        splitStep2D(field, preset.potential, {
          absorber: preset.absorber,
          dt: preset.dt,
        });
      }

      timeRef.current += preset.dt * steps;
      drawField(canvasRef.current, field, preset.potential, viewModeRef.current);
      setTime(timeRef.current);

      metricFrameRef.current += 1;

      if (metricFrameRef.current % 3 === 0) {
        setMetrics(makeMetrics(field, preset));
      }
    },
    [],
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
        frameRef.current = requestAnimationFrame(animate);
        return;
      }

      if (now - lastTimeRef.current < 56) {
        frameRef.current = requestAnimationFrame(animate);
        return;
      }

      const start = performance.now();
      lastTimeRef.current = now;
      stepSimulation(speed);
      const cost = performance.now() - start;

      if (cost > 80 && gridSize > 64) {
        slowFrameCountRef.current += 1;
      } else {
        slowFrameCountRef.current = Math.max(0, slowFrameCountRef.current - 1);
      }

      if (slowFrameCountRef.current > 5) {
        slowFrameCountRef.current = 0;
        setGridSize(64);
      }

      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameRef.current);
      lastTimeRef.current = undefined;
    };
  }, [gridSize, isPlaying, speed, stepSimulation]);

  const setPreset = (nextPresetId) => {
    const nextDefaults = PRESET_DEFAULTS[nextPresetId];
    setPresetId(nextPresetId);
    setWavelength(nextDefaults.wavelength);
    setPacketWidth(nextDefaults.packetWidth);
    setPotentialStrength(nextDefaults.potentialStrength);
    setSlitSeparation(nextDefaults.slitSeparation);
    setSlitWidth(nextDefaults.slitWidth);
    setIsPlaying(false);
  };

  const hasSlits = presetId === 'double-slit' || presetId === 'single-slit';
  const hasPacketWidth = presetId === 'free-packet' || presetId === 'finite-barrier';
  const hasFiniteBarrier = presetId === 'finite-barrier';
  const hasSlitSeparation = presetId === 'double-slit';
  const activePreset = PRESETS.find((preset) => preset.id === presetId) ?? PRESETS[0];
  const presetDescription = presetRef.current?.description ?? '';
  const gridLabel = fieldRef.current
    ? `${fieldRef.current.width} x ${fieldRef.current.height}`
    : `${gridSize * 2} x ${gridSize}`;

  return (
    <div className="flex min-h-[46rem] w-full flex-col bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--accent-blue)_10%,transparent),transparent_34%),radial-gradient(circle_at_bottom_right,color-mix(in_srgb,var(--accent-red)_8%,transparent),transparent_30%),var(--sim-bg)] text-[color:var(--text-primary)] lg:min-h-[50rem]">
      <div className="grid flex-1 lg:grid-cols-[minmax(0,1.65fr)_22rem]">
        <div className="flex min-w-0 flex-col border-b border-[var(--grid-line)] p-4 lg:border-r lg:border-b-0 lg:p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
                {activePreset.label}
              </p>
              <p className="mt-2 mb-0 max-w-2xl text-sm leading-6 text-[color:var(--text-muted)]">
                {presetDescription}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <IconButton
                label={isPlaying ? 'Pause 2D simulator' : 'Play 2D simulator'}
                onClick={() => setIsPlaying((current) => !current)}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </IconButton>
              <IconButton
                label="Step 2D simulator"
                onClick={() => {
                  setIsPlaying(false);
                  stepSimulation(4);
                }}
              >
                <StepForward className="h-4 w-4" />
              </IconButton>
              <IconButton label="Reset 2D simulator" onClick={initialize}>
                <RotateCcw className="h-4 w-4" />
              </IconButton>
            </div>
          </div>

          <div className="min-h-0 flex-1 rounded-[1.5rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-3 shadow-sm">
            <canvas
              ref={canvasRef}
              className="block h-auto max-h-[74vh] w-full rounded-[1.15rem] bg-white [image-rendering:auto]"
              aria-label="Two-dimensional time-dependent Schrodinger equation simulation"
              role="img"
            />
          </div>


        </div>

        <aside className="grid content-start gap-5 p-5">
          <section className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
              Scenario
            </p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <SegmentButton
                  key={preset.id}
                  active={preset.id === presetId}
                  label={preset.label}
                  onClick={() => setPreset(preset.id)}
                />
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
              View
            </p>
            <div className="flex flex-wrap gap-2">
              {VIEW_MODES.map((mode) => (
                <SegmentButton
                  key={mode.id}
                  active={mode.id === viewMode}
                  label={mode.label}
                  onClick={() => setViewMode(mode.id)}
                />
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
              Controls
            </p>
            <div className="space-y-5">
              <ControlSlider
                label="Speed"
                value={speed}
                valueLabel={`${speed}x`}
                min={1}
                max={5}
                step={1}
                onChange={(value) => setSpeed(Math.round(value))}
              />
              <ControlSlider
                label="Wavelength"
                value={wavelength}
                valueLabel={formatNumber(wavelength, 2)}
                min={1.05}
                max={2.4}
                step={0.01}
                onChange={(value) => setWavelength(clamp(value, 1.05, 2.4))}
              />
              {hasPacketWidth ? (
                <ControlSlider
                  label="Packet Width"
                  value={packetWidth}
                  valueLabel={formatNumber(packetWidth, 2)}
                  min={0.42}
                  max={1.25}
                  step={0.01}
                  onChange={(value) => setPacketWidth(clamp(value, 0.42, 1.25))}
                />
              ) : null}
              {hasFiniteBarrier ? (
                <ControlSlider
                  label="Barrier Height"
                  value={potentialStrength}
                  valueLabel={formatNumber(potentialStrength, 1)}
                  min={1}
                  max={10}
                  step={0.1}
                  onChange={(value) => setPotentialStrength(clamp(value, 1, 10))}
                />
              ) : null}
              {hasSlits ? (
                <>
                  <ControlSlider
                    label="Slit Width"
                    value={slitWidth}
                    valueLabel={formatNumber(slitWidth, 2)}
                    min={0.4}
                    max={1.45}
                    step={0.01}
                    onChange={(value) => setSlitWidth(clamp(value, 0.4, 1.45))}
                  />
                  {hasSlitSeparation ? (
                    <ControlSlider
                      label="Slit Separation"
                      value={slitSeparation}
                      valueLabel={formatNumber(slitSeparation, 2)}
                      min={1.2}
                      max={3.2}
                      step={0.01}
                      onChange={(value) => setSlitSeparation(clamp(value, 1.2, 3.2))}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
          </section>


        </aside>
      </div>
    </div>
  );
}
