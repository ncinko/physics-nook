import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';

const SAMPLE_COUNT = 360;
const PLOT = {
  x: 48,
  y: 28,
  width: 574,
  height: 156,
};
const PROBABILITY_Y = 206;
const PROBABILITY_HEIGHT = 132;

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

function ModeButton({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 ${
        active
          ? 'bg-[var(--accent-blue)] text-white shadow-sm'
          : 'text-[color:var(--text-primary)] hover:text-[var(--accent-blue)]'
      }`}
    >
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

const boxState = (n, x) => Math.sqrt(2) * Math.sin(n * Math.PI * x);
const energy = (n) => n * n;

const getNarrative = ({ mode, mix }) => {
  if (mode === 'single') {
    return 'An energy eigenstate only picks up an overall rotating phase. The real and imaginary parts trade places, but the probability density stays fixed.';
  }

  if (mix < 0.2 || mix > 0.8) {
    return 'One eigenstate dominates, so the probability pattern only breathes gently. Interference is strongest when the two amplitudes have comparable weight.';
  }

  return 'The two stationary states rotate at different phase rates. Their relative phase changes, so the probability density slides between different shapes.';
};

export default function EnergyPhaseEvolutionInline() {
  const [mode, setMode] = useState('superposition');
  const [time, setTime] = useState(0);
  const [mix, setMix] = useState(0.55);
  const [phaseOffset, setPhaseOffset] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const frameRef = useRef();
  const lastTimeRef = useRef();

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

      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = now;
      setTime((current) => (current + dt * 0.7) % (Math.PI * 4));
      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameRef.current);
      lastTimeRef.current = undefined;
    };
  }, [isPlaying]);

  const analysis = useMemo(() => {
    const samples = Array.from({ length: SAMPLE_COUNT }, (_, index) => {
      const x = index / (SAMPLE_COUNT - 1);
      const first = boxState(1, x);
      const second = boxState(2, x);

      if (mode === 'single') {
        const phase = -energy(2) * time;
        const re = second * Math.cos(phase);
        const im = second * Math.sin(phase);

        return {
          x,
          re,
          im,
          probability: re * re + im * im,
        };
      }

      const c1 = Math.sqrt(mix);
      const c2 = Math.sqrt(1 - mix);
      const phase1 = -energy(1) * time;
      const phase2 = -energy(2) * time + phaseOffset;
      const re = c1 * first * Math.cos(phase1) + c2 * second * Math.cos(phase2);
      const im = c1 * first * Math.sin(phase1) + c2 * second * Math.sin(phase2);

      return {
        x,
        re,
        im,
        probability: re * re + im * im,
      };
    });

    let normalization = 0;
    let meanX = 0;
    let peak = 0;

    for (let index = 0; index < samples.length - 1; index += 1) {
      const sample = samples[index];
      const next = samples[index + 1];
      const dx = next.x - sample.x;
      const probability = (sample.probability + next.probability) * 0.5;
      const midpoint = (sample.x + next.x) * 0.5;
      normalization += probability * dx;
      meanX += probability * midpoint * dx;
      peak = Math.max(peak, sample.probability, next.probability);
    }

    return {
      samples,
      normalization,
      meanX: normalization > 0 ? meanX / normalization : 0.5,
      peak,
    };
  }, [mix, mode, phaseOffset, time]);

  const maxAmplitude = Math.max(
    1,
    ...analysis.samples.map((sample) => Math.max(Math.abs(sample.re), Math.abs(sample.im))),
  );
  const status = getNarrative({ mix, mode });

  return (
    <section className="not-prose my-8 overflow-hidden rounded-[1.8rem] border border-[var(--grid-line)] bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--accent-blue)_10%,transparent),transparent_34%),var(--sim-bg)] text-[color:var(--text-primary)] shadow-sm">
      <div className="grid lg:grid-cols-[1.35fr_0.9fr]">
        <div className="border-b border-[var(--grid-line)] p-4 lg:border-r lg:border-b-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex flex-wrap rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-1">
              <ModeButton active={mode === 'single'} label="Single Energy" onClick={() => setMode('single')} />
              <ModeButton
                active={mode === 'superposition'}
                label="Superposition"
                onClick={() => setMode('superposition')}
              />
            </div>
            <div className="flex items-center gap-2">
              <IconButton
                label={isPlaying ? 'Pause phase evolution' : 'Play phase evolution'}
                onClick={() => setIsPlaying((current) => !current)}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </IconButton>
              <IconButton label="Reset phase evolution" onClick={() => setTime(0)}>
                <RotateCcw className="h-4 w-4" />
              </IconButton>
            </div>
          </div>

          <svg viewBox="0 0 680 370" className="h-auto w-full" role="img" aria-label="Energy phase evolution plots">
            <defs>
              <linearGradient id="energy-phase-prob-fill" x1="0%" x2="0%" y1="0%" y2="100%">
                <stop offset="0%" stopColor="color-mix(in srgb, var(--accent-blue) 30%, white)" />
                <stop offset="100%" stopColor="color-mix(in srgb, var(--accent-blue) 6%, transparent)" />
              </linearGradient>
            </defs>
            <rect x="24" y="16" width="632" height="336" rx="26" fill="color-mix(in srgb, var(--bg-primary) 86%, white)" />
            {Array.from({ length: 5 }, (_, index) => {
              const y = PLOT.y + index * (PLOT.height / 4);
              return (
                <line
                  key={`amp-grid-${y}`}
                  x1={PLOT.x}
                  x2={PLOT.x + PLOT.width}
                  y1={y}
                  y2={y}
                  stroke="color-mix(in srgb, var(--grid-line) 78%, transparent)"
                />
              );
            })}
            <line
              x1={PLOT.x}
              x2={PLOT.x + PLOT.width}
              y1={PLOT.y + PLOT.height / 2}
              y2={PLOT.y + PLOT.height / 2}
              stroke="color-mix(in srgb, var(--text-muted) 60%, transparent)"
              strokeWidth="2"
            />
            <path
              d={pathFromSeries(
                analysis.samples,
                (sample) => PLOT.x + sample.x * PLOT.width,
                (sample) => PLOT.y + PLOT.height / 2 - (sample.re / maxAmplitude) * 56,
              )}
              fill="none"
              stroke="var(--accent-blue)"
              strokeWidth="3"
            />
            <path
              d={pathFromSeries(
                analysis.samples,
                (sample) => PLOT.x + sample.x * PLOT.width,
                (sample) => PLOT.y + PLOT.height / 2 - (sample.im / maxAmplitude) * 56,
              )}
              fill="none"
              stroke="#c2410c"
              strokeDasharray="7 7"
              strokeWidth="3"
            />
            <text x={PLOT.x} y="24" className="fill-[color:var(--text-muted)] text-[12px] font-semibold">
              complex amplitude
            </text>
            <g transform="translate(504 32)">
              <line x1="0" x2="24" y1="0" y2="0" stroke="var(--accent-blue)" strokeWidth="3" />
              <text x="32" y="4" className="fill-[color:var(--text-primary)] text-[12px] font-medium">Re psi</text>
              <line x1="0" x2="24" y1="24" y2="24" stroke="#c2410c" strokeDasharray="7 7" strokeWidth="3" />
              <text x="32" y="28" className="fill-[color:var(--text-primary)] text-[12px] font-medium">Im psi</text>
            </g>

            <line
              x1={PLOT.x}
              x2={PLOT.x + PLOT.width}
              y1={PROBABILITY_Y + PROBABILITY_HEIGHT}
              y2={PROBABILITY_Y + PROBABILITY_HEIGHT}
              stroke="color-mix(in srgb, var(--text-muted) 60%, transparent)"
              strokeWidth="2"
            />
            <path
              d={`${pathFromSeries(
                analysis.samples,
                (sample) => PLOT.x + sample.x * PLOT.width,
                (sample) =>
                  PROBABILITY_Y +
                  PROBABILITY_HEIGHT -
                  (sample.probability / Math.max(analysis.peak, 1e-6)) * 104,
              )} L ${PLOT.x + PLOT.width} ${PROBABILITY_Y + PROBABILITY_HEIGHT} L ${PLOT.x} ${
                PROBABILITY_Y + PROBABILITY_HEIGHT
              } Z`}
              fill="url(#energy-phase-prob-fill)"
            />
            <path
              d={pathFromSeries(
                analysis.samples,
                (sample) => PLOT.x + sample.x * PLOT.width,
                (sample) =>
                  PROBABILITY_Y +
                  PROBABILITY_HEIGHT -
                  (sample.probability / Math.max(analysis.peak, 1e-6)) * 104,
              )}
              fill="none"
              stroke="var(--accent-blue)"
              strokeWidth="3"
            />
            <text x={PLOT.x} y={PROBABILITY_Y - 8} className="fill-[color:var(--text-muted)] text-[12px] font-semibold">
              probability density
            </text>
          </svg>
        </div>

        <div className="flex flex-col">
          <div className="border-b border-[var(--grid-line)] p-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
              Phase Clock
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
                  label="Time"
                  value={time}
                  valueLabel={formatNumber(time, 2)}
                  min={0}
                  max={Math.PI * 4}
                  step={0.01}
                  onChange={(value) => {
                    setIsPlaying(false);
                    setTime(value);
                  }}
                />
                <ControlSlider
                  label="Ground-State Weight"
                  value={mix}
                  valueLabel={formatNumber(mix, 2)}
                  min={0.05}
                  max={0.95}
                  step={0.01}
                  onChange={(value) => setMix(clamp(value, 0.05, 0.95))}
                />
                <ControlSlider
                  label="Relative Phase"
                  value={phaseOffset}
                  valueLabel={`${formatNumber(phaseOffset / Math.PI, 2)} pi`}
                  min={0}
                  max={Math.PI * 2}
                  step={0.01}
                  onChange={setPhaseOffset}
                />
              </div>
            </section>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <MetricCard
                label="Normalization"
                value={formatNumber(analysis.normalization, 3)}
                caption="Total probability stays at one for this closed box."
              />
              <MetricCard
                label="Mean Position"
                value={formatNumber(analysis.meanX, 3)}
                caption="The expectation value changes only when relative phase matters."
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
