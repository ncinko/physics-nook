import React, { useMemo, useState } from 'react';

const BOLTZMANN = 1.380649e-23;
const AMU = 1.6605390666e-27;
const PARTICLE_COUNT = 96;
const HISTOGRAM_BINS = 11;

const GAS_PRESETS = [
  { key: 'helium', label: 'Helium', massAmu: 4.0 },
  { key: 'nitrogen', label: 'Nitrogen', massAmu: 28.0 },
  { key: 'argon', label: 'Argon', massAmu: 39.9 },
];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const seededUnit = (seed) => {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
};

const seededNormal = (seed) => {
  const u1 = Math.max(seededUnit(seed), 1e-5);
  const u2 = seededUnit(seed + 101.7);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

const formatNumber = (value, digits = 2) => {
  const fixed = value.toFixed(digits);
  return fixed === '-0.00' || fixed === '-0.0' ? fixed.slice(1) : fixed;
};

const formatSpeed = (value) => `${Math.round(value).toLocaleString()} m/s`;

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
      <p className="m-0 text-xs font-semibold uppercase text-[color:var(--text-muted)]">{label}</p>
      <p className="mt-2 mb-1 text-xl font-semibold text-[color:var(--text-primary)]">{value}</p>
      <p className="m-0 text-sm leading-6 text-[color:var(--text-muted)]">{caption}</p>
    </div>
  );
}

function GasButton({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all duration-200 ${
        active
          ? 'border-[var(--accent-blue)] bg-[color-mix(in_srgb,var(--accent-blue)_12%,var(--bg-primary))] text-[var(--accent-blue)]'
          : 'border-[var(--grid-line)] bg-[var(--surface-elevated)] text-[color:var(--text-primary)] hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]'
      }`}
    >
      {label}
    </button>
  );
}

export default function ParticleSpeedTemperatureExplorer() {
  const [temperature, setTemperature] = useState(300);
  const [gasKey, setGasKey] = useState('nitrogen');

  const gas = GAS_PRESETS.find((preset) => preset.key === gasKey) ?? GAS_PRESETS[1];
  const particleMass = gas.massAmu * AMU;

  const thermalData = useMemo(() => {
    const sigma = Math.sqrt((BOLTZMANN * temperature) / particleMass);
    const mostProbableSpeed = Math.sqrt((2 * BOLTZMANN * temperature) / particleMass);
    const meanSpeed = Math.sqrt((8 * BOLTZMANN * temperature) / (Math.PI * particleMass));
    const rmsSpeed = Math.sqrt((3 * BOLTZMANN * temperature) / particleMass);
    const averageKineticEnergy = 1.5 * BOLTZMANN * temperature;
    const maxPlotSpeed = Math.max(rmsSpeed * 2.35, mostProbableSpeed * 2.9);

    const particles = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
      const vx = seededNormal(index * 3 + 1) * sigma;
      const vy = seededNormal(index * 3 + 2) * sigma;
      const vz = seededNormal(index * 3 + 3) * sigma;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const hotness = clamp(speed / maxPlotSpeed, 0, 1);
      const x = 50 + seededUnit(index + 13) * 460;
      const y = 48 + seededUnit(index + 53) * 210;
      const angle = seededUnit(index + 91) * Math.PI * 2;
      const arrowLength = 6 + hotness * 22;

      return {
        arrowLength,
        color: `hsl(${210 - hotness * 185} 78% 52%)`,
        speed,
        x,
        y,
        x2: x + Math.cos(angle) * arrowLength,
        y2: y + Math.sin(angle) * arrowLength,
      };
    });

    const histogram = Array.from({ length: HISTOGRAM_BINS }, (_, bin) => {
      const min = (bin / HISTOGRAM_BINS) * maxPlotSpeed;
      const max = ((bin + 1) / HISTOGRAM_BINS) * maxPlotSpeed;
      const count = particles.filter((particle) => particle.speed >= min && particle.speed < max).length;
      return { count, label: `${Math.round(min)}`, max, min };
    });

    return {
      averageKineticEnergy,
      histogram,
      maxHistogramCount: Math.max(...histogram.map((bin) => bin.count), 1),
      maxPlotSpeed,
      meanSpeed,
      mostProbableSpeed,
      particles,
      rmsSpeed,
    };
  }, [particleMass, temperature]);

  const status =
    temperature < 180
      ? 'Lower temperature pulls the whole speed distribution toward slower particles.'
      : temperature > 650
        ? 'Higher temperature broadens the distribution and raises the typical kinetic energy.'
        : 'Temperature describes the distribution as a whole, not a speed owned by every particle.';

  return (
    <div className="flex h-full min-h-[43rem] w-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,#ea580c_12%,transparent),transparent_34%),radial-gradient(circle_at_bottom_right,color-mix(in_srgb,var(--accent-blue)_10%,transparent),transparent_32%),var(--sim-bg)] text-[color:var(--text-primary)]">
      <div className="grid flex-1 lg:grid-cols-[1.4fr_0.95fr]">
        <div className="border-b border-[var(--grid-line)] lg:border-r lg:border-b-0">
          <div className="p-5">
            <p className="mb-2 text-xs font-semibold uppercase text-[var(--accent-blue)]">Particle Speeds</p>
            <p className="m-0 max-w-3xl text-sm leading-7 text-[color:var(--text-muted)]">{status}</p>
          </div>

          <div className="px-4 pb-4 sm:px-5">
            <svg viewBox="0 0 560 320" className="h-auto w-full" role="img" aria-label="Gas particles with velocity arrows">
              <defs>
                <marker id="temperature-arrow" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L6,3 z" fill="currentColor" />
                </marker>
              </defs>
              <rect x="26" y="24" width="508" height="258" rx="26" fill="color-mix(in srgb, var(--bg-primary) 86%, white)" stroke="var(--grid-line)" />
              {Array.from({ length: 7 }, (_, index) => (
                <line
                  key={`speed-grid-x-${index}`}
                  x1={62 + index * 72}
                  x2={62 + index * 72}
                  y1="42"
                  y2="266"
                  stroke="color-mix(in srgb, var(--grid-line) 70%, transparent)"
                />
              ))}
              {Array.from({ length: 4 }, (_, index) => (
                <line
                  key={`speed-grid-y-${index}`}
                  x1="44"
                  x2="516"
                  y1={72 + index * 52}
                  y2={72 + index * 52}
                  stroke="color-mix(in srgb, var(--grid-line) 70%, transparent)"
                />
              ))}
              {thermalData.particles.map((particle, index) => (
                <g key={`particle-${index}`}>
                  <line
                    x1={particle.x}
                    x2={particle.x2}
                    y1={particle.y}
                    y2={particle.y2}
                    stroke={particle.color}
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                  <circle cx={particle.x} cy={particle.y} r="4.4" fill={particle.color} opacity="0.88" />
                </g>
              ))}
              <g transform="translate(48 46)">
                <rect width="196" height="70" rx="18" fill="color-mix(in srgb, var(--surface-elevated) 96%, white)" stroke="var(--grid-line)" />
                <text x="16" y="25" className="fill-[color:var(--text-muted)] text-[11px] font-semibold uppercase">Average kinetic energy</text>
                <text x="16" y="52" className="fill-[color:var(--text-primary)] text-[21px] font-semibold">
                  {`${thermalData.averageKineticEnergy.toExponential(2)} J`}
                </text>
              </g>
            </svg>
          </div>

          <div className="grid gap-3 border-t border-[var(--grid-line)] px-5 py-4 sm:grid-cols-3">
            <MetricCard
              label="Most Probable"
              value={formatSpeed(thermalData.mostProbableSpeed)}
              caption="Peak of the speed distribution."
            />
            <MetricCard
              label="Mean Speed"
              value={formatSpeed(thermalData.meanSpeed)}
              caption="Arithmetic average over many particles."
            />
            <MetricCard
              label="RMS Speed"
              value={formatSpeed(thermalData.rmsSpeed)}
              caption="Root-mean-square speed tied to kinetic energy."
            />
          </div>
        </div>

        <div className="flex flex-col">
          <div className="border-b border-[var(--grid-line)] p-5">
            <p className="mb-3 text-xs font-semibold uppercase text-[var(--accent-blue)]">Controls</p>
            <div className="space-y-5">
              <ControlSlider
                label="Temperature"
                value={temperature}
                valueLabel={`${Math.round(temperature)} K`}
                min={80}
                max={900}
                step={5}
                onChange={setTemperature}
              />
              <div>
                <p className="mb-3 text-sm font-medium text-[color:var(--text-primary)]">Gas particle mass</p>
                <div className="flex flex-wrap gap-2">
                  {GAS_PRESETS.map((preset) => (
                    <GasButton
                      key={preset.key}
                      active={preset.key === gasKey}
                      label={`${preset.label} (${formatNumber(preset.massAmu, 1)} u)`}
                      onClick={() => setGasKey(preset.key)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-5 p-5">
            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-4">
                <p className="m-0 text-xs font-semibold uppercase text-[var(--accent-blue)]">Speed Histogram</p>
                <p className="m-0 text-xs text-[color:var(--text-muted)]">bin start in m/s</p>
              </div>
              <div className="flex h-48 items-end gap-2">
                {thermalData.histogram.map((bin) => (
                  <div key={bin.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                    <div className="flex h-36 w-full items-end rounded-full bg-slate-200/70">
                      <div
                        className="w-full rounded-full bg-[var(--accent-blue)] transition-[height] duration-200"
                        style={{ height: `${Math.max(6, (bin.count / thermalData.maxHistogramCount) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-[color:var(--text-muted)]">{bin.label}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-5 shadow-sm">
              <p className="mb-3 text-xs font-semibold uppercase text-[color:var(--text-muted)]">Temperature Link</p>
              <p className="m-0 text-sm leading-7 text-[color:var(--text-primary)]">
                For an ideal gas, the average translational kinetic energy per particle is
                {' '}
                <span className="font-semibold">3 kT / 2</span>
                . Raising temperature scales the whole speed distribution upward, while heavier particles move more slowly at the same temperature.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
