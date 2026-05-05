import React, { useMemo, useState } from 'react';

const BOLTZMANN = 1.380649e-23;
const ELECTRON_VOLT = 1.602176634e-19;
const LN2 = Math.log(2);

const TEMPERATURE_PRESETS = [
  { key: 'liquid-nitrogen', label: 'Liquid nitrogen', value: 77 },
  { key: 'room', label: 'Room', value: 300 },
  { key: 'body', label: 'Body', value: 310 },
  { key: 'boiling-water', label: 'Boiling water', value: 373 },
];

const formatScientific = (value, digits = 2) => value.toExponential(digits).replace('e', ' x 10^');

const formatCount = (value) => {
  if (value < 1000) return value.toLocaleString();
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} thousand`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)} million`;
  return `${(value / 1_000_000_000).toFixed(value < 10_000_000_000 ? 1 : 0)} billion`;
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
      <p className="m-0 text-xs font-semibold uppercase text-[color:var(--text-muted)]">{label}</p>
      <p className="mt-2 mb-1 break-words text-xl font-semibold text-[color:var(--text-primary)]">{value}</p>
      <p className="m-0 text-sm leading-6 text-[color:var(--text-muted)]">{caption}</p>
    </div>
  );
}

function PresetButton({ active, label, onClick }) {
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

export default function BitErasureThermalCostCalculator() {
  const [temperature, setTemperature] = useState(300);
  const [bitExponent, setBitExponent] = useState(6);

  const selectedPreset = TEMPERATURE_PRESETS.find((preset) => Math.abs(preset.value - temperature) < 0.5);

  const data = useMemo(() => {
    const bits = Math.max(1, Math.round(10 ** bitExponent));
    const perBitJoules = BOLTZMANN * temperature * LN2;
    const totalJoules = perBitJoules * bits;
    const perBitElectronVolts = perBitJoules / ELECTRON_VOLT;
    const comparisonRows = TEMPERATURE_PRESETS.map((preset) => ({
      cost: BOLTZMANN * preset.value * LN2 * bits,
      label: preset.label,
      temperature: preset.value,
    }));
    const maxComparison = Math.max(...comparisonRows.map((row) => row.cost), totalJoules);

    return {
      bits,
      comparisonRows,
      maxComparison,
      perBitElectronVolts,
      perBitJoules,
      totalJoules,
    };
  }, [bitExponent, temperature]);

  return (
    <div className="flex h-full min-h-[42rem] w-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,#ea580c_12%,transparent),transparent_34%),radial-gradient(circle_at_bottom_right,color-mix(in_srgb,var(--accent-blue)_10%,transparent),transparent_32%),var(--sim-bg)] text-[color:var(--text-primary)]">
      <div className="grid flex-1 lg:grid-cols-[1.35fr_1fr]">
        <div className="border-b border-[var(--grid-line)] lg:border-r lg:border-b-0">
          <div className="p-5">
            <p className="mb-2 text-xs font-semibold uppercase text-[var(--accent-blue)]">Landauer Cost</p>
            <p className="m-0 max-w-3xl text-sm leading-7 text-[color:var(--text-muted)]">
              Erasing a bit maps multiple possible logical states into one final state. Landauer's principle gives the minimum heat cost that must be paid to the surroundings.
            </p>
          </div>

          <div className="px-4 pb-4 sm:px-5">
            <svg viewBox="0 0 600 330" className="h-auto w-full" role="img" aria-label="Bit erasure thermal cost comparison">
              <rect x="30" y="28" width="540" height="268" rx="28" fill="color-mix(in srgb, var(--bg-primary) 86%, white)" stroke="var(--grid-line)" />
              <g transform="translate(68 74)">
                <rect x="0" y="0" width="148" height="86" rx="22" fill="color-mix(in srgb, var(--surface-elevated) 96%, white)" stroke="var(--grid-line)" />
                <text x="74" y="34" textAnchor="middle" className="fill-[color:var(--text-primary)] text-[24px] font-semibold">0 or 1</text>
                <text x="74" y="61" textAnchor="middle" className="fill-[color:var(--text-muted)] text-[12px] font-semibold">unknown bit</text>
                <path d="M176 43 L266 43" stroke="#0f172a" strokeWidth="5" strokeLinecap="round" />
                <path d="M266 43 l-18 -10 v20 z" fill="#0f172a" />
                <rect x="294" y="0" width="148" height="86" rx="22" fill="color-mix(in srgb, #fb923c 20%, var(--surface-elevated))" stroke="var(--grid-line)" />
                <text x="368" y="34" textAnchor="middle" className="fill-[color:var(--text-primary)] text-[24px] font-semibold">0</text>
                <text x="368" y="61" textAnchor="middle" className="fill-[color:var(--text-muted)] text-[12px] font-semibold">reset state</text>
              </g>

              <g transform="translate(68 194)">
                {data.comparisonRows.map((row, index) => {
                  const width = Math.max(8, (row.cost / data.maxComparison) * 376);
                  return (
                    <g key={row.label} transform={`translate(0 ${index * 28})`}>
                      <text x="0" y="12" className="fill-[color:var(--text-muted)] text-[12px] font-semibold">{`${row.temperature} K`}</text>
                      <rect x="86" y="1" width="390" height="14" rx="7" fill="color-mix(in srgb, var(--grid-line) 60%, transparent)" />
                      <rect x="86" y="1" width={width} height="14" rx="7" fill={Math.abs(row.temperature - temperature) < 0.5 ? '#ea580c' : 'var(--accent-blue)'} />
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>

          <div className="grid gap-3 border-t border-[var(--grid-line)] px-5 py-4 sm:grid-cols-3">
            <MetricCard label="Bits Erased" value={formatCount(data.bits)} caption="Logical bits reset to a standard state." />
            <MetricCard label="Cost Per Bit" value={`${formatScientific(data.perBitJoules)} J`} caption={`${data.perBitElectronVolts.toExponential(2)} eV at this temperature.`} />
            <MetricCard label="Total Minimum" value={`${formatScientific(data.totalJoules)} J`} caption="The thermodynamic lower bound, not an engineering guarantee." />
          </div>
        </div>

        <div className="flex flex-col">
          <div className="border-b border-[var(--grid-line)] p-5">
            <p className="mb-3 text-xs font-semibold uppercase text-[var(--accent-blue)]">Controls</p>
            <div className="space-y-5">
              <ControlSlider
                label="Bits Erased"
                value={bitExponent}
                valueLabel={formatCount(data.bits)}
                min={0}
                max={12}
                step={0.25}
                onChange={setBitExponent}
              />
              <ControlSlider
                label="Temperature"
                value={temperature}
                valueLabel={`${Math.round(temperature)} K`}
                min={20}
                max={600}
                step={1}
                onChange={setTemperature}
              />
              <div>
                <p className="mb-3 text-sm font-medium text-[color:var(--text-primary)]">Temperature presets</p>
                <div className="flex flex-wrap gap-2">
                  {TEMPERATURE_PRESETS.map((preset) => (
                    <PresetButton
                      key={preset.key}
                      active={selectedPreset?.key === preset.key}
                      label={`${preset.label} (${preset.value} K)`}
                      onClick={() => setTemperature(preset.value)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-5 p-5">
            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
              <p className="mb-3 text-xs font-semibold uppercase text-[var(--accent-blue)]">Formula</p>
              <p className="m-0 rounded-2xl border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-4 py-3 font-mono text-sm text-[color:var(--text-primary)]">
                Emin = N kB T ln(2)
              </p>
              <p className="mt-4 mb-0 text-sm leading-7 text-[color:var(--text-muted)]">
                The bound scales linearly with bit count and temperature. Colder reservoirs reduce the minimum erasure cost, though real devices usually dissipate far more.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
