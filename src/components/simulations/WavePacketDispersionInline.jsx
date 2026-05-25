import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { analyticFreeGaussianSigma } from '../../lib/quantum/timeEvolution';

const SAMPLE_COUNT = 420;
const MAX_TIME = 10;
const X_MIN = -12;
const X_MAX = 30;
const PLOT = {
  x: 52,
  y: 38,
  width: 570,
  height: 226,
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

const gaussianProbability = (x, center, sigma) =>
  Math.exp(-((x - center) * (x - center)) / (2 * sigma * sigma)) /
  (Math.sqrt(2 * Math.PI) * sigma);

const getNarrative = ({ sigma0, sigma, momentum }) => {
  if (sigma0 < 0.55) {
    return 'The packet begins tightly localized, so its momentum spread is large and the envelope spreads quickly.';
  }

  if (momentum > 2.8) {
    return 'The center moves faster because the carrier momentum is larger, while the spreading rate is controlled by the initial width.';
  }

  if (sigma > sigma0 * 2.1) {
    return 'The wave packet is still normalized, but the same probability is now distributed across a wider region.';
  }

  return 'A free packet translates at its group velocity while its width grows because different momentum components carry different phase speeds.';
};

export default function WavePacketDispersionInline() {
  const [time, setTime] = useState(0);
  const [sigma0, setSigma0] = useState(0.78);
  const [momentum, setMomentum] = useState(2.35);
  const [isPlaying, setIsPlaying] = useState(true);
  const [drawParts, setDrawParts] = useState({
    re: true,
    im: false,
    probability: true,
  });
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
      setTime((current) => (current + dt * 0.55) % MAX_TIME);
      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameRef.current);
      lastTimeRef.current = undefined;
    };
  }, [isPlaying]);

  const analysis = useMemo(() => {
    const x0 = -6.4;
    const center = x0 + momentum * time;
    const sigma = analyticFreeGaussianSigma(sigma0, time);
    const currentSamples = [];
    let maxProbability = 0;

    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const x = X_MIN + ((X_MAX - X_MIN) * index) / (SAMPLE_COUNT - 1);
      const initialProbability = gaussianProbability(x, x0, sigma0);
      const currentProbability = gaussianProbability(x, center, sigma);
      const amplitude = Math.sqrt(currentProbability);
      const phase = momentum * x - (momentum * momentum * time) / 2;

      currentSamples.push({
        x,
        im: amplitude * Math.sin(phase),
        probability: currentProbability,
        re: amplitude * Math.cos(phase),
      });
      maxProbability = Math.max(maxProbability, initialProbability, currentProbability);
    }

    return {
      center,
      currentSamples,
      maxProbability,
      momentumSpread: 1 / (2 * sigma0),
      sigma,
    };
  }, [momentum, sigma0, time]);

  const status = getNarrative({
    momentum,
    sigma: analysis.sigma,
    sigma0,
  });
  const xScale = (x) => PLOT.x + ((x - X_MIN) / (X_MAX - X_MIN)) * PLOT.width;
  const yScale = (probability) =>
    PLOT.y + PLOT.height - (probability / Math.max(analysis.maxProbability, 1e-6)) * 174;
  const amplitudeScale = Math.sqrt(Math.max(analysis.maxProbability, 1e-6));
  const amplitudeYScale = (value) => PLOT.y + PLOT.height * 0.5 - (value / amplitudeScale) * 86;
  const centerX = xScale(clamp(analysis.center, X_MIN, X_MAX));
  const togglePart = (part) => {
    setDrawParts((current) => ({
      ...current,
      [part]: !current[part],
    }));
  };

  return (
    <section className="not-prose my-8 overflow-hidden rounded-[1.8rem] border border-[var(--grid-line)] bg-[radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--accent-red)_8%,transparent),transparent_34%),var(--sim-bg)] text-[color:var(--text-primary)] shadow-sm">
      <div className="border-b border-[var(--grid-line)] p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
            Free Gaussian Packet
          </p>
          <div className="flex items-center gap-2">
            <IconButton
              label={isPlaying ? 'Pause packet dispersion' : 'Play packet dispersion'}
              onClick={() => setIsPlaying((current) => !current)}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </IconButton>
            <IconButton label="Reset packet dispersion" onClick={() => setTime(0)}>
              <RotateCcw className="h-4 w-4" />
            </IconButton>
          </div>
        </div>

        <svg viewBox="0 0 680 330" className="h-auto w-full" role="img" aria-label="Free wave packet dispersion">
          <defs>
            <linearGradient id="packet-current-fill" x1="0%" x2="0%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="color-mix(in srgb, var(--accent-blue) 28%, white)" />
              <stop offset="100%" stopColor="color-mix(in srgb, var(--accent-blue) 5%, transparent)" />
            </linearGradient>
          </defs>
          <rect x="24" y="18" width="632" height="286" rx="26" fill="color-mix(in srgb, var(--bg-primary) 86%, white)" />
          {Array.from({ length: 6 }, (_, index) => {
            const y = PLOT.y + index * (PLOT.height / 5);
            return (
              <line
                key={`dispersion-grid-${y}`}
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
              d={`${pathFromSeries(analysis.currentSamples, (sample) => xScale(sample.x), (sample) =>
                yScale(sample.probability),
              )} L ${PLOT.x + PLOT.width} ${PLOT.y + PLOT.height} L ${PLOT.x} ${
                PLOT.y + PLOT.height
              } Z`}
              fill="url(#packet-current-fill)"
            />
          ) : null}
          {drawParts.probability ? (
            <path
              d={pathFromSeries(analysis.currentSamples, (sample) => xScale(sample.x), (sample) =>
                yScale(sample.probability),
              )}
              fill="none"
              stroke="var(--accent-blue)"
              strokeWidth="3"
            />
          ) : null}
          {drawParts.re ? (
            <path
              d={pathFromSeries(analysis.currentSamples, (sample) => xScale(sample.x), (sample) =>
                amplitudeYScale(sample.re),
              )}
              fill="none"
              stroke="#c2410c"
              strokeOpacity="0.78"
              strokeWidth="2"
            />
          ) : null}
          {drawParts.im ? (
            <path
              d={pathFromSeries(analysis.currentSamples, (sample) => xScale(sample.x), (sample) =>
                amplitudeYScale(sample.im),
              )}
              fill="none"
              stroke="#0f766e"
              strokeDasharray="7 7"
              strokeOpacity="0.86"
              strokeWidth="2.25"
            />
          ) : null}
          <line
            x1={centerX}
            x2={centerX}
            y1={PLOT.y + 12}
            y2={PLOT.y + PLOT.height}
            stroke="color-mix(in srgb, var(--text-muted) 70%, transparent)"
            strokeDasharray="5 7"
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
              Dispersion
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
                  max={MAX_TIME}
                  step={0.01}
                  onChange={(value) => {
                    setIsPlaying(false);
                    setTime(value);
                  }}
                />
                <ControlSlider
                  label="Initial Width"
                  value={sigma0}
                  valueLabel={formatNumber(sigma0, 2)}
                  min={0.35}
                  max={1.5}
                  step={0.01}
                  onChange={(value) => setSigma0(clamp(value, 0.35, 1.5))}
                />
                <ControlSlider
                  label="Carrier Momentum"
                  value={momentum}
                  valueLabel={formatNumber(momentum, 2)}
                  min={1.2}
                  max={3.4}
                  step={0.01}
                  onChange={(value) => setMomentum(clamp(value, 1.2, 3.4))}
                />
              </div>
            </section>


        </div>
      </div>
    </section>
  );
}
