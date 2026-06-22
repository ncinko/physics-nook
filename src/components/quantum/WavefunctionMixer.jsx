import React, { useEffect, useMemo, useState } from 'react';

const SAMPLE_COUNT = 160;

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

const sampleIndex = (cdf) => {
  const target = Math.random();

  for (let index = 0; index < cdf.length; index += 1) {
    if (target <= cdf[index]) {
      return index;
    }
  }

  return cdf.length - 1;
};

const buildCdf = (weights) => {
  const total = weights.reduce((sum, value) => sum + value, 0);
  let running = 0;

  return weights.map((value, index) => {
    running += value / total;
    return index === weights.length - 1 ? 1 : running;
  });
};

const regionProbability = (samples, from, to) =>
  samples.reduce((sum, sample, index) => {
    if (index === samples.length - 1) {
      return sum;
    }

    const next = samples[index + 1];
    const midpoint = (sample.x + next.x) * 0.5;
    const dx = next.x - sample.x;

    if (midpoint < from || midpoint > to) {
      return sum;
    }

    return sum + sample.probability * dx;
  }, 0);

const normalizedPhase = (phaseDegrees) => ((phaseDegrees % 360) + 360) % 360;

const getNarrative = ({ excitedShare, phaseDegrees }) => {
  const phase = normalizedPhase(phaseDegrees);

  if (excitedShare < 0.18) {
    return 'The state is mostly the ground-state shape, so the probability density stays concentrated in a single broad hump.';
  }

  if (Math.abs(phase - 90) < 18 || Math.abs(phase - 270) < 18) {
    return 'A near-quarter-turn relative phase gives the superposition a strong imaginary component, which changes the amplitude picture even when the state remains normalized.';
  }

  if (excitedShare > 0.48) {
    return 'The excited contribution is large enough to carve a more complicated interference pattern into the probability density.';
  }

  return 'Superposition combines amplitudes before probabilities are computed, so the resulting density is not a simple average of the two basis shapes.';
};

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

export default function WavefunctionMixer() {
  const [excitedShare, setExcitedShare] = useState(0.34);
  const [phaseDegrees, setPhaseDegrees] = useState(40);
  const [measurements, setMeasurements] = useState([]);

  const analysis = useMemo(() => {
    const phase = (phaseDegrees * Math.PI) / 180;
    const groundWeight = Math.sqrt(1 - excitedShare);
    const excitedWeight = Math.sqrt(excitedShare);

    const samples = Array.from({ length: SAMPLE_COUNT }, (_, index) => {
      const x = index / (SAMPLE_COUNT - 1);
      const phi1 = Math.sqrt(2) * Math.sin(Math.PI * x);
      const phi2 = Math.sqrt(2) * Math.sin(2 * Math.PI * x);
      const real = groundWeight * phi1 + excitedWeight * Math.cos(phase) * phi2;
      const imag = excitedWeight * Math.sin(phase) * phi2;
      const probability = real * real + imag * imag;

      return {
        imag,
        probability,
        real,
        x,
      };
    });

    const normalization = samples.reduce((sum, sample, index) => {
      if (index === samples.length - 1) {
        return sum;
      }

      const next = samples[index + 1];
      return sum + ((sample.probability + next.probability) * 0.5 * (next.x - sample.x));
    }, 0);

    const probabilities = samples.map((sample) => sample.probability);

    return {
      cdf: buildCdf(probabilities),
      excitedWeight,
      groundWeight,
      normalization,
      probabilities,
      regionLeft: regionProbability(samples, 0, 1 / 3),
      regionMiddle: regionProbability(samples, 1 / 3, 2 / 3),
      regionRight: regionProbability(samples, 2 / 3, 1),
      samples,
    };
  }, [excitedShare, phaseDegrees]);

  useEffect(() => {
    setMeasurements([]);
  }, [excitedShare, phaseDegrees]);

  const maxAmplitude = Math.max(
    ...analysis.samples.map((sample) => Math.max(Math.abs(sample.real), Math.abs(sample.imag))),
    1,
  );
  const maxProbability = Math.max(...analysis.probabilities, 1);
  const statusSummary = getNarrative({ excitedShare, phaseDegrees });

  const handleMeasure = () => {
    const sample = analysis.samples[sampleIndex(analysis.cdf)];

    setMeasurements((previous) =>
      [{ id: `${Date.now()}-${Math.random()}`, x: sample.x }, ...previous].slice(0, 28),
    );
  };

  return (
    <div className="flex h-full min-h-[46rem] w-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--accent-blue)_12%,transparent),transparent_34%),radial-gradient(circle_at_bottom_right,color-mix(in_srgb,var(--accent-red)_8%,transparent),transparent_32%),var(--sim-bg)] text-[color:var(--text-primary)]">
      <div className="grid flex-1 lg:grid-cols-[1.45fr_0.95fr]">
        <div className="border-b border-[var(--grid-line)] lg:border-r lg:border-b-0">
          <div className="px-5 pt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
              Combine amplitudes, then square for probabilities
            </p>
            <p className="m-0 max-w-3xl text-sm leading-7 text-[color:var(--text-muted)]">
              This explorer mixes the first two stationary states of a one-dimensional box. The state stays normalized automatically, so changing the sliders redistributes probability rather than creating or destroying it.
            </p>
          </div>

          <div className="grid gap-4 px-4 pb-4 pt-3 md:px-5">
            <section className="rounded-[1.8rem] border border-[var(--grid-line)] bg-[color:var(--bg-primary)] p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-4">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                  Amplitude View
                </p>
                <p className="m-0 text-xs text-[color:var(--text-muted)]">Real part, imaginary part, and the box walls</p>
              </div>

              <svg viewBox="0 0 680 230" className="h-auto w-full" role="img" aria-label="Wavefunction amplitudes">
                <rect x="24" y="20" width="632" height="180" rx="26" fill="color-mix(in srgb, var(--sim-bg) 84%, white)" />
                {Array.from({ length: 5 }, (_, index) => {
                  const y = 46 + index * 34;
                  return (
                    <line
                      key={`amp-grid-${y}`}
                      x1="44"
                      x2="636"
                      y1={y}
                      y2={y}
                      stroke="color-mix(in srgb, var(--grid-line) 80%, transparent)"
                      strokeWidth="1"
                    />
                  );
                })}
                <line x1="62" x2="62" y1="32" y2="188" stroke="#0f172a" strokeWidth="3" />
                <line x1="618" x2="618" y1="32" y2="188" stroke="#0f172a" strokeWidth="3" />
                <line x1="62" x2="618" y1="110" y2="110" stroke="color-mix(in srgb, var(--text-muted) 50%, transparent)" strokeWidth="2" />

                <path
                  d={pathFromSeries(
                    analysis.samples,
                    (sample) => 62 + sample.x * 556,
                    (sample) => 110 - (sample.real / maxAmplitude) * 64,
                  )}
                  fill="none"
                  stroke="var(--accent-blue)"
                  strokeWidth="3"
                />
                <path
                  d={pathFromSeries(
                    analysis.samples,
                    (sample) => 62 + sample.x * 556,
                    (sample) => 110 - (sample.imag / maxAmplitude) * 64,
                  )}
                  fill="none"
                  stroke="#c2410c"
                  strokeWidth="3"
                  opacity="0.9"
                />

                <g transform="translate(76 182)">
                  <line x1="0" x2="20" y1="0" y2="0" stroke="var(--accent-blue)" strokeWidth="3" />
                  <text x="28" y="4" className="fill-[color:var(--text-primary)] text-[12px] font-medium">
                    Re(psi)
                  </text>
                  <line x1="92" x2="112" y1="0" y2="0" stroke="#c2410c" strokeWidth="3" />
                  <text x="120" y="4" className="fill-[color:var(--text-primary)] text-[12px] font-medium">
                    Im(psi)
                  </text>
                </g>
              </svg>
            </section>

            <section className="rounded-[1.8rem] border border-[var(--grid-line)] bg-[color:var(--bg-primary)] p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-4">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                  Probability Density
                </p>
                <p className="m-0 text-xs text-[color:var(--text-muted)]">
                  Measurements land according to |psi|^2
                </p>
              </div>

              <svg viewBox="0 0 680 240" className="h-auto w-full" role="img" aria-label="Probability density in a one-dimensional box">
                <defs>
                  <linearGradient id="wavefunction-prob-fill" x1="0%" x2="0%" y1="0%" y2="100%">
                    <stop offset="0%" stopColor="color-mix(in srgb, var(--accent-blue) 28%, white)" />
                    <stop offset="100%" stopColor="color-mix(in srgb, var(--accent-blue) 6%, transparent)" />
                  </linearGradient>
                </defs>
                <rect x="24" y="20" width="632" height="188" rx="26" fill="color-mix(in srgb, var(--sim-bg) 84%, white)" />
                {Array.from({ length: 5 }, (_, index) => {
                  const y = 48 + index * 34;
                  return (
                    <line
                      key={`prob-grid-${y}`}
                      x1="44"
                      x2="636"
                      y1={y}
                      y2={y}
                      stroke="color-mix(in srgb, var(--grid-line) 80%, transparent)"
                      strokeWidth="1"
                    />
                  );
                })}
                <line x1="62" x2="618" y1="184" y2="184" stroke="color-mix(in srgb, var(--text-muted) 50%, transparent)" strokeWidth="2" />
                <path
                  d={`${pathFromSeries(
                    analysis.samples,
                    (sample) => 62 + sample.x * 556,
                    (sample) => 184 - (sample.probability / maxProbability) * 116,
                  )} L 618 184 L 62 184 Z`}
                  fill="url(#wavefunction-prob-fill)"
                  stroke="none"
                />
                <path
                  d={pathFromSeries(
                    analysis.samples,
                    (sample) => 62 + sample.x * 556,
                    (sample) => 184 - (sample.probability / maxProbability) * 116,
                  )}
                  fill="none"
                  stroke="var(--accent-blue)"
                  strokeWidth="3"
                />
                {measurements.map((measurement) => (
                  <line
                    key={measurement.id}
                    x1={62 + measurement.x * 556}
                    x2={62 + measurement.x * 556}
                    y1="188"
                    y2="204"
                    stroke="#0f766e"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                ))}
              </svg>
            </section>
          </div>

          <div className="grid gap-3 border-t border-[var(--grid-line)] px-5 py-4 sm:grid-cols-3">
            <MetricCard
              label="Normalization"
              value={formatNumber(analysis.normalization, 3)}
              caption="The total probability stays at 1 after the amplitudes are combined."
            />
            <MetricCard
              label="Ground Share"
              value={`${Math.round((1 - excitedShare) * 100)}%`}
              caption="This coefficient controls how much of the n = 1 shape remains in the mix."
            />
            <MetricCard
              label="Excited Share"
              value={`${Math.round(excitedShare * 100)}%`}
              caption="This coefficient adds the n = 2 structure before probabilities are computed."
            />
          </div>
        </div>

        <div className="flex flex-col">
          <div className="border-b border-[var(--grid-line)] p-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
              Status
            </p>
            <p className="m-0 max-w-xl text-sm leading-7 text-[color:var(--text-primary)]">
              {statusSummary}
            </p>
          </div>

          <div className="grid gap-5 p-5">
            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                Controls
              </p>
              <div className="space-y-5">
                <ControlSlider
                  label="Excited-State Share"
                  value={excitedShare}
                  valueLabel={`${Math.round(excitedShare * 100)}%`}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(value) => setExcitedShare(clamp(value, 0, 1))}
                />
                <ControlSlider
                  label="Relative Phase"
                  value={phaseDegrees}
                  valueLabel={`${Math.round(phaseDegrees)} deg`}
                  min={0}
                  max={360}
                  step={1}
                  onChange={setPhaseDegrees}
                />
              </div>
            </section>

            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                    Position Measurement
                  </p>
                  <p className="m-0 text-sm leading-7 text-[color:var(--text-muted)]">
                    Sample the wavefunction repeatedly and compare the measurement streak to the |psi|^2 curve.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleMeasure}
                    className="rounded-full bg-[var(--accent-blue)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
                  >
                    Measure Position
                  </button>
                  <button
                    type="button"
                    onClick={() => setMeasurements([])}
                    className="rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-4 py-2.5 text-sm font-semibold text-[color:var(--text-primary)] transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                Region Probabilities
              </p>
              <div className="space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                    <span className="font-medium text-[color:var(--text-primary)]">Left third</span>
                    <span className="font-mono text-[color:var(--text-muted)]">{formatNumber(analysis.regionLeft, 3)}</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-200/70">
                    <div className="h-full rounded-full bg-[var(--accent-blue)]" style={{ width: `${analysis.regionLeft * 100}%` }} />
                  </div>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                    <span className="font-medium text-[color:var(--text-primary)]">Middle third</span>
                    <span className="font-mono text-[color:var(--text-muted)]">{formatNumber(analysis.regionMiddle, 3)}</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-200/70">
                    <div className="h-full rounded-full bg-[#0f766e]" style={{ width: `${analysis.regionMiddle * 100}%` }} />
                  </div>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                    <span className="font-medium text-[color:var(--text-primary)]">Right third</span>
                    <span className="font-mono text-[color:var(--text-muted)]">{formatNumber(analysis.regionRight, 3)}</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-200/70">
                    <div className="h-full rounded-full bg-[#c2410c]" style={{ width: `${analysis.regionRight * 100}%` }} />
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-5 shadow-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                Coefficient View
              </p>
              <p className="m-0 text-sm leading-7 text-[color:var(--text-primary)]">
                The stationary-state amplitudes are
                {' '}
                <span className="font-semibold">a = {formatNumber(analysis.groundWeight, 3)}</span>
                {' '}
                and
                {' '}
                <span className="font-semibold">b = {formatNumber(analysis.excitedWeight, 3)} exp(i {Math.round(phaseDegrees)} deg)</span>
                .
                Their squared magnitudes still add to 1.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
