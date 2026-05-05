import React, { useMemo, useState } from 'react';

const BOLTZMANN = 1.380649e-23;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const formatNumber = (value, digits = 2) => {
  const fixed = value.toFixed(digits);
  return fixed === '-0.00' || fixed === '-0.0' ? fixed.slice(1) : fixed;
};

const combination = (n, k) => {
  const r = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= r; index += 1) {
    result = (result * (n - r + index)) / index;
  }
  return Math.round(result);
};

const seededUnit = (seed) => {
  const value = Math.sin(seed * 19.918 + 3.17) * 9876.543;
  return value - Math.floor(value);
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
      <p className="mt-2 mb-1 text-xl font-semibold text-[color:var(--text-primary)]">{value}</p>
      <p className="m-0 text-sm leading-6 text-[color:var(--text-muted)]">{caption}</p>
    </div>
  );
}

export default function TwoChamberMicrostateExplorer() {
  const [particleCount, setParticleCount] = useState(8);
  const [leftCount, setLeftCount] = useState(4);

  const safeLeftCount = clamp(leftCount, 0, particleCount);

  const data = useMemo(() => {
    const macrostates = Array.from({ length: particleCount + 1 }, (_, nLeft) => {
      const multiplicity = combination(particleCount, nLeft);
      return {
        entropyOverKb: Math.log(multiplicity),
        multiplicity,
        nLeft,
        probability: multiplicity / 2 ** particleCount,
      };
    });
    const selected = macrostates[safeLeftCount];
    return {
      entropy: BOLTZMANN * selected.entropyOverKb,
      macrostates,
      maxMultiplicity: Math.max(...macrostates.map((macrostate) => macrostate.multiplicity), 1),
      selected,
      totalMicrostates: 2 ** particleCount,
    };
  }, [particleCount, safeLeftCount]);

  const particles = useMemo(
    () =>
      Array.from({ length: particleCount }, (_, index) => {
        const isLeft = index < safeLeftCount;
        return {
          color: isLeft ? '#2563eb' : '#ea580c',
          cx: (isLeft ? 70 : 302) + seededUnit(index + 5) * 162,
          cy: 60 + seededUnit(index + 47) * 168,
          isLeft,
        };
      }),
    [particleCount, safeLeftCount],
  );

  const status =
    safeLeftCount === 0 || safeLeftCount === particleCount
      ? 'Every particle on one side is possible, but it represents very few microstates.'
      : Math.abs(safeLeftCount - particleCount / 2) <= 1
        ? 'Balanced macrostates dominate because there are many more ways to arrange them.'
        : 'The macrostate is allowed, but it has fewer compatible microstates than the peak.';

  const handleParticleCountChange = (nextCount) => {
    const rounded = Math.round(nextCount);
    setParticleCount(rounded);
    setLeftCount((current) => clamp(current, 0, rounded));
  };

  return (
    <div className="flex h-full min-h-[43rem] w-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,#ea580c_12%,transparent),transparent_34%),radial-gradient(circle_at_bottom_right,color-mix(in_srgb,var(--accent-blue)_10%,transparent),transparent_32%),var(--sim-bg)] text-[color:var(--text-primary)]">
      <div className="grid flex-1 lg:grid-cols-[1.34fr_1fr]">
        <div className="border-b border-[var(--grid-line)] lg:border-r lg:border-b-0">
          <div className="p-5">
            <p className="mb-2 text-xs font-semibold uppercase text-[var(--accent-blue)]">Two-Chamber Gas</p>
            <p className="m-0 max-w-3xl text-sm leading-7 text-[color:var(--text-muted)]">{status}</p>
          </div>

          <div className="px-4 pb-4 sm:px-5">
            <svg viewBox="0 0 560 320" className="h-auto w-full" role="img" aria-label="Two chamber particle macrostate">
              <rect x="28" y="28" width="504" height="252" rx="28" fill="color-mix(in srgb, var(--bg-primary) 86%, white)" stroke="var(--grid-line)" />
              <line x1="280" x2="280" y1="44" y2="264" stroke="color-mix(in srgb, var(--text-primary) 62%, transparent)" strokeWidth="5" strokeLinecap="round" />
              <text x="116" y="64" className="fill-[color:var(--text-muted)] text-[13px] font-semibold">left side</text>
              <text x="346" y="64" className="fill-[color:var(--text-muted)] text-[13px] font-semibold">right side</text>
              {particles.map((particle, index) => (
                <circle
                  key={`micro-particle-${index}`}
                  cx={particle.cx}
                  cy={particle.cy}
                  r="9"
                  fill={particle.color}
                  opacity="0.88"
                  stroke="color-mix(in srgb, white 78%, transparent)"
                  strokeWidth="2"
                />
              ))}
              <g transform="translate(58 224)">
                <rect width="186" height="42" rx="15" fill="color-mix(in srgb, var(--surface-elevated) 96%, white)" stroke="var(--grid-line)" />
                <text x="93" y="27" textAnchor="middle" className="fill-[color:var(--text-primary)] text-[16px] font-semibold">{`nL = ${safeLeftCount}`}</text>
              </g>
              <g transform="translate(316 224)">
                <rect width="186" height="42" rx="15" fill="color-mix(in srgb, var(--surface-elevated) 96%, white)" stroke="var(--grid-line)" />
                <text x="93" y="27" textAnchor="middle" className="fill-[color:var(--text-primary)] text-[16px] font-semibold">{`nR = ${particleCount - safeLeftCount}`}</text>
              </g>
            </svg>
          </div>

          <div className="grid gap-3 border-t border-[var(--grid-line)] px-5 py-4 sm:grid-cols-3">
            <MetricCard
              label="Multiplicity"
              value={data.selected.multiplicity.toLocaleString()}
              caption="Number of microstates matching this macrostate."
            />
            <MetricCard
              label="Probability"
              value={`${formatNumber(data.selected.probability * 100, 2)}%`}
              caption={`Out of ${data.totalMicrostates.toLocaleString()} equally likely assignments.`}
            />
            <MetricCard
              label="S / kB"
              value={formatNumber(data.selected.entropyOverKb, 3)}
              caption="Boltzmann entropy measured in kB units."
            />
          </div>
        </div>

        <div className="flex flex-col">
          <div className="border-b border-[var(--grid-line)] p-5">
            <p className="mb-3 text-xs font-semibold uppercase text-[var(--accent-blue)]">Controls</p>
            <div className="space-y-5">
              <ControlSlider label="Particles N" value={particleCount} valueLabel={`${particleCount}`} min={2} max={16} step={1} onChange={handleParticleCountChange} />
              <ControlSlider label="Particles on Left" value={safeLeftCount} valueLabel={`${safeLeftCount}`} min={0} max={particleCount} step={1} onChange={(value) => setLeftCount(Math.round(value))} />
            </div>
          </div>

          <div className="grid gap-5 p-5">
            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-4">
                <p className="m-0 text-xs font-semibold uppercase text-[var(--accent-blue)]">Multiplicity Histogram</p>
                <p className="m-0 text-xs text-[color:var(--text-muted)]">click a bar</p>
              </div>
              <div className="flex h-56 items-end gap-1.5">
                {data.macrostates.map((macrostate) => {
                  const isSelected = macrostate.nLeft === safeLeftCount;
                  return (
                    <button
                      key={macrostate.nLeft}
                      type="button"
                      onClick={() => setLeftCount(macrostate.nLeft)}
                      className="flex min-w-0 flex-1 flex-col items-center gap-2"
                      aria-label={`Select macrostate with ${macrostate.nLeft} particles on the left`}
                    >
                      <div className="flex h-40 w-full items-end rounded-full bg-slate-200/70">
                        <div
                          className={`w-full rounded-full transition-[height] duration-200 ${isSelected ? 'bg-[#ea580c]' : 'bg-[var(--accent-blue)]'}`}
                          style={{ height: `${Math.max(5, (macrostate.multiplicity / data.maxMultiplicity) * 100)}%` }}
                        />
                      </div>
                      <span className={`text-[10px] ${isSelected ? 'font-semibold text-[#ea580c]' : 'text-[color:var(--text-muted)]'}`}>{macrostate.nLeft}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-5 shadow-sm">
              <p className="mb-3 text-xs font-semibold uppercase text-[color:var(--text-muted)]">Boltzmann Link</p>
              <p className="m-0 text-sm leading-7 text-[color:var(--text-primary)]">
                Entropy grows with multiplicity:
                {' '}
                <span className="font-semibold">S = kB ln Omega</span>
                . The most likely macrostate is not forced by a new mechanical law; it wins because it has overwhelmingly more compatible microstates.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
