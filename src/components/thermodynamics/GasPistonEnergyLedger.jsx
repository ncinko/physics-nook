import React, { useMemo, useState } from 'react';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const formatNumber = (value, digits = 1) => {
  const fixed = value.toFixed(digits);
  return fixed === '-0.0' || fixed === '-0.00' ? fixed.slice(1) : fixed;
};

const formatSigned = (value, unit = 'J', digits = 1) => {
  const normalized = Math.abs(value) < 1e-9 ? 0 : value;
  const sign = normalized > 0 ? '+' : '';
  return `${sign}${formatNumber(normalized, digits)} ${unit}`;
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

function SignedEnergyBar({ label, value, scale, color, caption }) {
  const magnitude = Math.min(100, (Math.abs(value) / scale) * 100);
  const isPositive = value >= 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="font-medium text-[color:var(--text-primary)]">{label}</span>
        <span className="font-mono text-[color:var(--text-muted)]">{formatSigned(value)}</span>
      </div>
      <div className="grid h-4 grid-cols-2 overflow-hidden rounded-full bg-slate-200/70">
        <div className="flex justify-end border-r border-white/80">
          {!isPositive && (
            <div className="h-full rounded-l-full transition-[width] duration-200" style={{ width: `${magnitude}%`, backgroundColor: color }} />
          )}
        </div>
        <div>
          {isPositive && (
            <div className="h-full rounded-r-full transition-[width] duration-200" style={{ width: `${magnitude}%`, backgroundColor: color }} />
          )}
        </div>
      </div>
      <p className="m-0 text-sm leading-6 text-[color:var(--text-muted)]">{caption}</p>
    </div>
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

export default function GasPistonEnergyLedger() {
  const [heat, setHeat] = useState(360);
  const [pressure, setPressure] = useState(120);
  const [volumeChange, setVolumeChange] = useState(2);

  const ledger = useMemo(() => {
    const work = pressure * volumeChange;
    const deltaU = heat - work;
    const initialVolume = 4.0;
    const finalVolume = clamp(initialVolume + volumeChange, 1.2, 8.8);
    const pistonX = 156 + ((finalVolume - 1.2) / (8.8 - 1.2)) * 278;
    const temperatureIndex = clamp(0.55 + deltaU / 1000, 0.12, 1.0);

    return {
      deltaU,
      finalVolume,
      initialVolume,
      pistonX,
      scale: Math.max(600, Math.abs(heat), Math.abs(work), Math.abs(deltaU)),
      temperatureIndex,
      work,
    };
  }, [heat, pressure, volumeChange]);

  const processLabel =
    volumeChange > 0.05
      ? 'Expansion: W is positive because the gas pushes the piston outward.'
      : volumeChange < -0.05
        ? 'Compression: W is negative because work is done on the gas.'
        : 'Constant volume: the piston barely moves, so W is near zero.';

  return (
    <div className="flex h-full min-h-[43rem] w-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,#ea580c_12%,transparent),transparent_34%),radial-gradient(circle_at_bottom_right,color-mix(in_srgb,var(--accent-blue)_10%,transparent),transparent_32%),var(--sim-bg)] text-[color:var(--text-primary)]">
      <div className="grid flex-1 lg:grid-cols-[1.35fr_1fr]">
        <div className="border-b border-[var(--grid-line)] lg:border-r lg:border-b-0">
          <div className="p-5">
            <p className="mb-2 text-xs font-semibold uppercase text-[var(--accent-blue)]">Piston Process</p>
            <p className="m-0 max-w-3xl text-sm leading-7 text-[color:var(--text-muted)]">{processLabel}</p>
          </div>

          <div className="px-4 pb-4 sm:px-5">
            <svg viewBox="0 0 600 360" className="h-auto w-full" role="img" aria-label="Gas piston energy ledger">
              <rect x="30" y="30" width="540" height="296" rx="28" fill="color-mix(in srgb, var(--bg-primary) 86%, white)" stroke="var(--grid-line)" />
              <g transform="translate(64 88)">
                <rect x="0" y="38" width="418" height="146" rx="24" fill="color-mix(in srgb, #93c5fd 10%, var(--surface-elevated))" stroke="color-mix(in srgb, var(--text-primary) 62%, transparent)" strokeWidth="4" />
                <rect
                  x="8"
                  y="46"
                  width={Math.max(46, ledger.pistonX - 72)}
                  height="130"
                  rx="18"
                  fill={`color-mix(in srgb, #fb923c ${Math.round(16 + ledger.temperatureIndex * 40)}%, #bfdbfe)`}
                />
                <line x1={ledger.pistonX} x2={ledger.pistonX} y1="25" y2="198" stroke="#0f172a" strokeWidth="13" strokeLinecap="round" />
                <rect x={ledger.pistonX} y="85" width="72" height="52" rx="14" fill="color-mix(in srgb, var(--surface-elevated) 94%, white)" stroke="var(--grid-line)" />
                <line x1={ledger.pistonX + 72} x2="472" y1="111" y2="111" stroke="#0f172a" strokeWidth="8" strokeLinecap="round" />
                <text x="26" y="76" className="fill-[color:var(--text-primary)] text-[15px] font-semibold">gas system</text>
                <text x={ledger.pistonX + 92} y="102" className="fill-[color:var(--text-muted)] text-[12px] font-semibold">piston</text>
                {heat >= 0 ? (
                  <g>
                    <path d="M78 230 C98 204, 120 204, 142 178" fill="none" stroke="#ea580c" strokeWidth="5" strokeLinecap="round" />
                    <path d="M142 178 l-18 5 l9 15 z" fill="#ea580c" />
                    <text x="36" y="258" className="fill-[color:var(--text-primary)] text-[14px] font-semibold">heat in</text>
                  </g>
                ) : (
                  <g>
                    <path d="M152 178 C130 204, 108 204, 86 230" fill="none" stroke="#2563eb" strokeWidth="5" strokeLinecap="round" />
                    <path d="M86 230 l18 -5 l-9 -15 z" fill="#2563eb" />
                    <text x="32" y="258" className="fill-[color:var(--text-primary)] text-[14px] font-semibold">heat out</text>
                  </g>
                )}
                <g transform="translate(240 230)">
                  <rect x="-118" y="0" width="236" height="58" rx="18" fill="color-mix(in srgb, var(--surface-elevated) 96%, white)" stroke="var(--grid-line)" />
                  <text x="0" y="24" textAnchor="middle" className="fill-[color:var(--text-muted)] text-[12px] font-semibold uppercase">First law ledger</text>
                  <text x="0" y="47" textAnchor="middle" className="fill-[color:var(--text-primary)] text-[18px] font-semibold">Delta U = Q - W</text>
                </g>
              </g>
            </svg>
          </div>

          <div className="grid gap-3 border-t border-[var(--grid-line)] px-5 py-4 sm:grid-cols-3">
            <MetricCard label="Heat Q" value={formatSigned(heat)} caption="Positive when energy enters the gas thermally." />
            <MetricCard label="Work W" value={formatSigned(ledger.work)} caption="Positive when the gas does work on surroundings." />
            <MetricCard label="Delta U" value={formatSigned(ledger.deltaU)} caption="Change in the gas internal energy." />
          </div>
        </div>

        <div className="flex flex-col">
          <div className="border-b border-[var(--grid-line)] p-5">
            <p className="mb-3 text-xs font-semibold uppercase text-[var(--accent-blue)]">Controls</p>
            <div className="space-y-5">
              <ControlSlider label="Heat Transfer Q" value={heat} valueLabel={formatSigned(heat)} min={-400} max={800} step={10} onChange={setHeat} />
              <ControlSlider label="Pressure" value={pressure} valueLabel={`${formatNumber(pressure, 0)} kPa`} min={50} max={250} step={5} onChange={setPressure} />
              <ControlSlider label="Volume Change" value={volumeChange} valueLabel={`${formatSigned(volumeChange, 'L', 1)}`} min={-3} max={4} step={0.1} onChange={setVolumeChange} />
            </div>
          </div>

          <div className="grid gap-5 p-5">
            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
              <p className="mb-4 text-xs font-semibold uppercase text-[var(--accent-blue)]">Signed Energy Bars</p>
              <div className="space-y-5">
                <SignedEnergyBar label="Heat Q" value={heat} scale={ledger.scale} color="#ea580c" caption="Right means heat added; left means heat removed." />
                <SignedEnergyBar label="Work W" value={ledger.work} scale={ledger.scale} color="#2563eb" caption="Right means expansion work done by the gas." />
                <SignedEnergyBar label="Internal Energy Delta U" value={ledger.deltaU} scale={ledger.scale} color="#0f766e" caption="This is the resulting change after Q - W." />
              </div>
            </section>

            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-5 shadow-sm">
              <p className="mb-3 text-xs font-semibold uppercase text-[color:var(--text-muted)]">Convention</p>
              <p className="m-0 text-sm leading-7 text-[color:var(--text-primary)]">
                This page uses <span className="font-semibold">W as work done by the system</span>. Expansion gives positive W and subtracts from the system's internal energy. Compression gives negative W, so subtracting W adds energy to the system.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
