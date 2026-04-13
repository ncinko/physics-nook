import React, { useEffect, useMemo, useState } from 'react';

const MIN_SAMPLE_COUNT = 360;
const SAMPLES_PER_OSCILLATION = 120;

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

const buildCdf = (weights) => {
  const total = weights.reduce((sum, value) => sum + value, 0);
  let running = 0;

  return weights.map((value, index) => {
    running += value / total;
    return index === weights.length - 1 ? 1 : running;
  });
};

const sampleIndex = (cdf) => {
  const target = Math.random();

  for (let index = 0; index < cdf.length; index += 1) {
    if (target <= cdf[index]) {
      return index;
    }
  }

  return cdf.length - 1;
};

const integrateBy = (samples, accessor) =>
  samples.reduce((sum, sample, index) => {
    if (index === samples.length - 1) {
      return sum;
    }

    const next = samples[index + 1];
    return sum + ((accessor(sample) + accessor(next)) * 0.5 * (next.x - sample.x));
  }, 0);

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

const getNarrative = ({ center, spread, cycles }) => {
  if (spread < 0.11) {
    return 'The Gaussian envelope is narrow, so the wave packet is tightly localized. The measurements cluster inside a smaller stretch of space.';
  }

  if (cycles >= 6) {
    return 'The carrier oscillates several times inside the envelope. The wavefunction keeps changing sign, but squaring it turns those sign flips into positive probability peaks.';
  }

  if (center < 0.35 || center > 0.65) {
    return 'Shifting the packet center moves the whole probability pattern left or right, and the measurement hits follow that shift.';
  }

  return 'This is a localized wave packet: the sine factor provides the wiggles, while the Gaussian envelope keeps the state concentrated in one region.';
};

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

export default function WavePacketMeasurementInline() {
  const [center, setCenter] = useState(0.5);
  const [spread, setSpread] = useState(0.16);
  const [cycles, setCycles] = useState(5);
  const [measurements, setMeasurements] = useState([]);

  const analysis = useMemo(() => {
    const sampleCount = Math.max(MIN_SAMPLE_COUNT, Math.round(cycles * SAMPLES_PER_OSCILLATION));

    const rawSamples = Array.from({ length: sampleCount }, (_, index) => {
      const x = index / (sampleCount - 1);
      const offset = x - center;
      const envelope = Math.exp(-0.5 * (offset / spread) ** 2);
      const carrier = Math.sin(2 * Math.PI * cycles * x);
      const raw = envelope * carrier;

      return {
        envelope,
        raw,
        x,
      };
    });

    const rawSquaredSamples = rawSamples.map((sample) => ({
      ...sample,
      rawSquared: sample.raw * sample.raw,
    }));

    const normalizationIntegral = integrateBy(rawSquaredSamples, (sample) => sample.rawSquared);
    const normalizationFactor = normalizationIntegral > 0 ? 1 / Math.sqrt(normalizationIntegral) : 1;

    const samples = rawSquaredSamples.map((sample) => {
      const amplitude = normalizationFactor * sample.raw;
      const envelopeAmplitude = normalizationFactor * sample.envelope;
      const probability = amplitude * amplitude;

      return {
        amplitude,
        envelopeAmplitude,
        probability,
        x: sample.x,
      };
    });

    const normalization = integrateBy(samples, (sample) => sample.probability);
    const expectedPosition =
      normalization > 0
        ? integrateBy(samples, (sample) => sample.x * sample.probability) / normalization
        : center;

    return {
      cdf: buildCdf(samples.map((sample) => sample.probability)),
      expectedPosition,
      middleProbability: regionProbability(samples, 1 / 3, 2 / 3),
      normalization,
      samples,
    };
  }, [center, cycles, spread]);

  useEffect(() => {
    setMeasurements([]);
  }, [analysis.cdf]);

  const maxAmplitude = Math.max(
    ...analysis.samples.map((sample) =>
      Math.max(Math.abs(sample.amplitude), Math.abs(sample.envelopeAmplitude)),
    ),
    1,
  );
  const maxProbability = Math.max(...analysis.samples.map((sample) => sample.probability), 1);
  const statusSummary = getNarrative({ center, spread, cycles });

  const addMeasurements = (count) => {
    setMeasurements((previous) => {
      const next = Array.from({ length: count }, () => {
        const sample = analysis.samples[sampleIndex(analysis.cdf)];
        return {
          id: `${Date.now()}-${Math.random()}`,
          x: sample.x,
        };
      });

      return [...next, ...previous].slice(0, 64);
    });
  };

  return (
    <div className="my-8 overflow-hidden rounded-[2rem] border border-[var(--grid-line)] bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--accent-blue)_12%,transparent),transparent_32%),radial-gradient(circle_at_bottom_right,color-mix(in_srgb,var(--accent-red)_8%,transparent),transparent_34%),var(--sim-bg)] text-[color:var(--text-primary)] shadow-[0_22px_60px_rgba(15,23,42,0.12)]">
      <div className="grid gap-0 lg:grid-cols-[1.3fr_0.9fr]">
        <div className="border-b border-[var(--grid-line)] lg:border-r lg:border-b-0">
          <div className="px-5 pt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
              Example wave packet
            </p>

          </div>

          <div className="grid gap-4 px-4 pb-4 pt-3 md:px-5">
            <section className="rounded-[1.8rem] border border-[var(--grid-line)] bg-[color:var(--bg-primary)] p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-4">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                  Amplitude View
                </p>

              </div>

              <svg viewBox="0 0 680 230" className="h-auto w-full" role="img" aria-label="Wave packet amplitude">
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
                <line x1="62" x2="618" y1="110" y2="110" stroke="color-mix(in srgb, var(--text-muted) 50%, transparent)" strokeWidth="2" />

                <path
                  d={pathFromSeries(
                    analysis.samples,
                    (sample) => 62 + sample.x * 556,
                    (sample) => 110 - (sample.envelopeAmplitude / maxAmplitude) * 68,
                  )}
                  fill="none"
                  stroke="color-mix(in srgb, var(--text-muted) 70%, white)"
                  strokeDasharray="7 7"
                  strokeWidth="2"
                />
                <path
                  d={pathFromSeries(
                    analysis.samples,
                    (sample) => 62 + sample.x * 556,
                    (sample) => 110 + (sample.envelopeAmplitude / maxAmplitude) * 68,
                  )}
                  fill="none"
                  stroke="color-mix(in srgb, var(--text-muted) 70%, white)"
                  strokeDasharray="7 7"
                  strokeWidth="2"
                />
                <path
                  d={pathFromSeries(
                    analysis.samples,
                    (sample) => 62 + sample.x * 556,
                    (sample) => 110 - (sample.amplitude / maxAmplitude) * 68,
                  )}
                  fill="none"
                  stroke="var(--accent-blue)"
                  strokeWidth="3"
                />
              </svg>
            </section>

            <section className="rounded-[1.8rem] border border-[var(--grid-line)] bg-[color:var(--bg-primary)] p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-4">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                  Probability Density
                </p>
                <p className="m-0 text-xs text-[color:var(--text-muted)]">
                  Measurement hits land according to |psi|^2
                </p>
              </div>

              <svg viewBox="0 0 680 240" className="h-auto w-full" role="img" aria-label="Probability density and measurement hits">
                <defs>
                  <linearGradient id="wave-packet-prob-fill" x1="0%" x2="0%" y1="0%" y2="100%">
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
                  fill="url(#wave-packet-prob-fill)"
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

          <div className="grid gap-3 border-t border-[var(--grid-line)] px-5 py-4 sm:grid-cols-2">

            <MetricCard
              label="Expected Position"
              value={formatNumber(analysis.expectedPosition, 3)}
              caption="This probability-weighted average gives a sense of where position measurements cluster."
            />
            <MetricCard
              label="Middle Third"
              value={formatNumber(analysis.middleProbability, 3)}
              caption="Probability of landing in the central third of the plot."
            />
          </div>
        </div>

        <div className="flex flex-col">
          <div className="border-b border-[var(--grid-line)] p-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
              Read the plots
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
                  label="Packet Center"
                  value={center}
                  valueLabel={formatNumber(center, 2)}
                  min={0.2}
                  max={0.8}
                  step={0.01}
                  onChange={(value) => setCenter(clamp(value, 0.2, 0.8))}
                />
                <ControlSlider
                  label="Envelope Width"
                  value={spread}
                  valueLabel={formatNumber(spread, 2)}
                  min={0.08}
                  max={0.28}
                  step={0.01}
                  onChange={(value) => setSpread(clamp(value, 0.08, 0.28))}
                />
                <ControlSlider
                  label="Oscillations"
                  value={cycles}
                  valueLabel={`${Math.round(cycles)}`}
                  min={2}
                  max={8}
                  step={1}
                  onChange={(value) => setCycles(clamp(value, 2, 8))}
                />
              </div>
            </section>

            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                    Position Measurements
                  </p>
                  <p className="m-0 text-sm leading-7 text-[color:var(--text-muted)]">
                    Repeated measurements build up a set of hits that follows the probability plot.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => addMeasurements(1)}
                    className="rounded-full bg-[var(--accent-blue)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
                  >
                    Measure Once
                  </button>
                  <button
                    type="button"
                    onClick={() => addMeasurements(12)}
                    className="rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-4 py-2.5 text-sm font-semibold text-[color:var(--text-primary)] transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
                  >
                    Measure 12x
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


          </div>
        </div>
      </div>
    </div>
  );
}
