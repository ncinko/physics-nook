import React, { useState } from 'react';

const BETA_LIMIT = 0.95;
const PRESETS = [-0.8, -0.5, 0, 0.5, 0.8, 0.95];
const MAX_GAMMA = 1 / Math.sqrt(1 - BETA_LIMIT * BETA_LIMIT);
const MOMENTUM_SCALE = MAX_GAMMA * BETA_LIMIT;
const TOTAL_ENERGY_SCALE = MAX_GAMMA;
const KINETIC_SCALE = MAX_GAMMA - 1;

const formatNumber = (value, digits = 3, signed = false) => {
  if (Math.abs(value) < 0.0005) {
    return signed ? '0.000' : '0.000';
  }

  const fixed = value.toFixed(digits);

  if (fixed === '-0.000') {
    return '0.000';
  }

  if (signed && value > 0) {
    return `+${fixed}`;
  }

  return fixed;
};

const getSummary = ({ beta }) => {
  const absBeta = Math.abs(beta);

  if (absBeta < 0.001) {
    return 'At beta = 0, both momentum and kinetic energy are zero, but the total energy still includes the rest-energy baseline.';
  }

  if (absBeta < 0.25) {
    return 'At low speed, gamma stays close to 1, so the relativistic and classical predictions nearly overlap.';
  }

  if (absBeta < 0.75) {
    return beta > 0
      ? 'Positive beta gives positive momentum. The energy stays positive because it depends on gamma, which only cares about speed.'
      : 'Negative beta gives negative momentum. The energy stays positive because gamma depends on beta squared, not on direction.';
  }

  return 'Near c, gamma rises quickly, so both momentum and kinetic energy grow much faster than the classical estimates.';
};

function CenteredBar({ label, value, scale, color, formula, note }) {
  const extent = Math.min(46, (Math.abs(value) / scale) * 46);
  const markerPosition = value >= 0 ? 50 + extent : 50 - extent;
  const barLeft = value >= 0 ? 50 : 50 - extent;

  return (
    <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {label}
          </p>
          <p className="mt-1 mb-0 font-mono text-sm text-[var(--text-primary)]">{formula}</p>
        </div>
        <p className="m-0 text-lg font-semibold text-[var(--text-primary)]">{formatNumber(value, 3, true)}</p>
      </div>

      <div className="relative mt-4 h-14 overflow-hidden rounded-full border border-[var(--grid-line)] bg-[var(--sim-bg)]">
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--grid-line)]" />
        <div
          className="absolute top-1/2 h-5 -translate-y-1/2 rounded-full shadow-sm"
          style={{
            left: `${barLeft}%`,
            width: `${extent}%`,
            backgroundColor: color,
          }}
        />
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
          style={{
            left: `${markerPosition}%`,
            backgroundColor: color,
          }}
        />
        <div className="absolute inset-x-0 bottom-1 flex justify-between px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          <span>negative</span>
          <span>0</span>
          <span>positive</span>
        </div>
      </div>

      <p className="mt-3 mb-0 text-sm leading-7 text-[var(--text-muted)]">{note}</p>
    </div>
  );
}

function PositiveBar({ label, value, scale, color, formula, note }) {
  const width = Math.min(100, (value / scale) * 100);

  return (
    <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {label}
          </p>
          <p className="mt-1 mb-0 font-mono text-sm text-[var(--text-primary)]">{formula}</p>
        </div>
        <p className="m-0 text-lg font-semibold text-[var(--text-primary)]">{formatNumber(value)}</p>
      </div>

      <div className="mt-4 h-5 overflow-hidden rounded-full border border-[var(--grid-line)] bg-[var(--sim-bg)]">
        <div className="h-full rounded-full shadow-sm" style={{ width: `${width}%`, backgroundColor: color }} />
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        <span>0</span>
        <span>larger</span>
      </div>

      <p className="mt-3 mb-0 text-sm leading-7 text-[var(--text-muted)]">{note}</p>
    </div>
  );
}

function ComparisonRow({ label, relativisticValue, classicalValue, unit, color }) {
  const relativeScale = label === 'Momentum' ? MOMENTUM_SCALE : KINETIC_SCALE;
  const relativisticWidth = Math.min(100, (Math.abs(relativisticValue) / relativeScale) * 100);
  const classicalWidth = Math.min(100, (Math.abs(classicalValue) / relativeScale) * 100);

  return (
    <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm font-semibold text-[var(--text-primary)]">{label}</p>
        <p className="m-0 text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">{unit}</p>
      </div>

      <div className="space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-[var(--text-primary)]">Relativistic</span>
            <span className="font-mono text-[var(--text-primary)]">{formatNumber(relativisticValue, 3, label === 'Momentum')}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full border border-[var(--grid-line)] bg-[var(--sim-bg)]">
            <div className="h-full rounded-full" style={{ width: `${relativisticWidth}%`, backgroundColor: color }} />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-[var(--text-primary)]">Classical</span>
            <span className="font-mono text-[var(--text-primary)]">{formatNumber(classicalValue, 3, label === 'Momentum')}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full border border-[var(--grid-line)] bg-[var(--sim-bg)]">
            <div className="h-full rounded-full bg-slate-400" style={{ width: `${classicalWidth}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RelativisticMomentumEnergyExplorer() {
  const [beta, setBeta] = useState(0.8);

  const gamma = 1 / Math.sqrt(1 - beta * beta);
  const relativisticMomentum = gamma * beta;
  const totalEnergy = gamma;
  const kineticEnergy = gamma - 1;
  const classicalMomentum = beta;
  const classicalKinetic = (beta * beta) / 2;
  const momentumDifference = relativisticMomentum - classicalMomentum;
  const kineticDifference = kineticEnergy - classicalKinetic;
  const direction = beta > 0 ? 'to the right' : beta < 0 ? 'to the left' : 'at rest';
  const speedTrackPosition = ((beta + 1) / 2) * 100;
  const restEnergyWidth = (1 / TOTAL_ENERGY_SCALE) * 100;
  const kineticWidth = (kineticEnergy / TOTAL_ENERGY_SCALE) * 100;

  return (
    <div className="flex h-full min-h-[42rem] w-full flex-col overflow-hidden bg-[var(--sim-bg)] text-[var(--text-primary)]">
      <div className="border-b border-[var(--grid-line)] bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.18),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.14),transparent_35%),var(--bg-primary)] p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
              1D Relativity Explorer
            </p>
            <h3 className="mt-2 mb-0 text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
              Compare normalized momentum and energy as beta approaches the speed of light.
            </h3>
            <p className="mt-3 mb-0 max-w-2xl text-sm leading-7 text-[var(--text-muted)]">
              This view keeps the algebra readable by tracking p/(mc), E/(mc^2), and K/(mc^2) instead of raw SI values.
            </p>
          </div>

          <div className="max-w-lg rounded-2xl border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--surface-elevated)_92%,transparent)] p-4 shadow-sm">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
              Current Regime
            </p>
            <p className="mt-2 mb-0 text-sm leading-7 text-[var(--text-primary)]">{getSummary({ beta })}</p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--surface-elevated)_94%,transparent)] p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                Speed Control
              </p>
              <p className="mt-1 mb-0 text-sm leading-7 text-[var(--text-primary)]">
                beta = <span className="font-mono">{formatNumber(beta, 2, true)}</span>
              </p>
            </div>
            <p className="m-0 rounded-full border border-[var(--grid-line)] bg-[var(--bg-primary)] px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
              Direction: {direction}
            </p>
          </div>

          <input
            type="range"
            min={-BETA_LIMIT}
            max={BETA_LIMIT}
            step="0.01"
            value={beta}
            onChange={(event) => setBeta(parseFloat(event.target.value))}
            className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-700"
            aria-label="Set beta"
          />

          <div className="mt-2 flex justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            <span>-0.95</span>
            <span>0</span>
            <span>+0.95</span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setBeta(preset)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] transition-all ${
                  Math.abs(beta - preset) < 0.001
                    ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white'
                    : 'border-[var(--grid-line)] bg-[var(--bg-primary)] text-[var(--text-primary)] hover:-translate-y-0.5 hover:border-[var(--accent-blue)]'
                }`}
              >
                {preset > 0 ? `+${preset.toFixed(2)}` : preset.toFixed(2)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-5 p-5 lg:grid-cols-[1.25fr_0.95fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Signed Speed In One Dimension
                </p>
                <p className="mt-1 mb-0 text-sm leading-7 text-[var(--text-primary)]">
                  The sign of beta tells you which way the particle moves along the x-axis.
                </p>
              </div>
              <p className="m-0 text-lg font-semibold text-[var(--text-primary)]">
                gamma = {formatNumber(gamma)}
              </p>
            </div>

            <div className="relative mt-5 h-24 overflow-hidden rounded-[1.5rem] border border-[var(--grid-line)] bg-[linear-gradient(90deg,color-mix(in_srgb,var(--accent-red)_10%,transparent),transparent_22%,transparent_78%,color-mix(in_srgb,var(--accent-blue)_12%,transparent))]">
              <div className="absolute inset-y-6 left-6 right-6 rounded-full border border-[var(--grid-line)] bg-[var(--sim-bg)]" />
              <div className="absolute inset-y-6 left-1/2 w-px -translate-x-1/2 bg-[var(--grid-line)]" />
              <div
                className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full"
                style={{
                  left: beta >= 0 ? '50%' : `${speedTrackPosition}%`,
                  width: `${Math.abs(speedTrackPosition - 50)}%`,
                  backgroundColor: beta >= 0 ? 'var(--accent-blue)' : 'var(--accent-red)',
                }}
              />
              <div
                className="absolute top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-lg"
                style={{
                  left: `${speedTrackPosition}%`,
                  backgroundColor: beta >= 0 ? 'var(--accent-blue)' : beta < 0 ? 'var(--accent-red)' : '#64748b',
                }}
              />
              <div className="absolute inset-x-6 bottom-2 flex justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                <span>-c</span>
                <span>0</span>
                <span>+c</span>
              </div>
            </div>

            <p className="mt-3 mb-0 text-sm leading-7 text-[var(--text-muted)]">
              Flipping beta from positive to negative reverses the momentum, but gamma stays the same because it depends on beta squared.
            </p>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <CenteredBar
              label="Relativistic Momentum"
              value={relativisticMomentum}
              scale={MOMENTUM_SCALE}
              color="var(--accent-blue)"
              formula="p/(mc) = gamma beta"
              note="Momentum is signed in 1D. The magnitude grows faster than the classical beta estimate as |beta| approaches 1."
            />

            <PositiveBar
              label="Total Energy"
              value={totalEnergy}
              scale={TOTAL_ENERGY_SCALE}
              color="var(--accent-blue)"
              formula="E/(mc^2) = gamma"
              note="Total energy never becomes negative here. Even at beta = 0, the rest-energy baseline remains."
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <ComparisonRow
              label="Momentum"
              relativisticValue={relativisticMomentum}
              classicalValue={classicalMomentum}
              unit="p/(mc)"
              color="var(--accent-blue)"
            />

            <ComparisonRow
              label="Kinetic Energy"
              relativisticValue={kineticEnergy}
              classicalValue={classicalKinetic}
              unit="K/(mc^2)"
              color="#0f766e"
            />
          </div>

          <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Rest Energy Plus Kinetic Energy
                </p>
                <p className="mt-1 mb-0 font-mono text-sm text-[var(--text-primary)]">E/(mc^2) = 1 + K/(mc^2)</p>
              </div>
              <p className="m-0 text-lg font-semibold text-[var(--text-primary)]">{formatNumber(totalEnergy)}</p>
            </div>

            <div className="overflow-hidden rounded-full border border-[var(--grid-line)] bg-[var(--sim-bg)]">
              <div className="flex h-5 w-full">
                <div
                  className="h-full border-r border-white/60 bg-slate-400"
                  style={{ width: `${restEnergyWidth}%` }}
                  title="Rest energy"
                />
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${kineticWidth}%` }}
                  title="Kinetic energy"
                />
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--sim-bg)] p-3">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Rest Baseline
                </p>
                <p className="mt-2 mb-0 text-lg font-semibold text-[var(--text-primary)]">1.000</p>
              </div>
              <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--sim-bg)] p-3">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Kinetic Addition
                </p>
                <p className="mt-2 mb-0 text-lg font-semibold text-[var(--text-primary)]">{formatNumber(kineticEnergy)}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-5">
          <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
              Normalized Readouts
            </p>

            <div className="mt-4 space-y-4">
              <div className="flex items-center justify-between gap-4 border-b border-[var(--grid-line)] pb-4">
                <div>
                  <p className="m-0 text-sm font-semibold text-[var(--text-primary)]">Lorentz factor</p>
                  <p className="mt-1 mb-0 font-mono text-xs text-[var(--text-muted)]">gamma = 1 / sqrt(1 - beta^2)</p>
                </div>
                <span className="font-mono text-lg font-semibold text-[var(--text-primary)]">{formatNumber(gamma)}</span>
              </div>

              <div className="flex items-center justify-between gap-4 border-b border-[var(--grid-line)] pb-4">
                <div>
                  <p className="m-0 text-sm font-semibold text-[var(--text-primary)]">Momentum</p>
                  <p className="mt-1 mb-0 font-mono text-xs text-[var(--text-muted)]">p/(mc) = gamma beta</p>
                </div>
                <span className="font-mono text-lg font-semibold text-[var(--text-primary)]">
                  {formatNumber(relativisticMomentum, 3, true)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-4 border-b border-[var(--grid-line)] pb-4">
                <div>
                  <p className="m-0 text-sm font-semibold text-[var(--text-primary)]">Total energy</p>
                  <p className="mt-1 mb-0 font-mono text-xs text-[var(--text-muted)]">E/(mc^2) = gamma</p>
                </div>
                <span className="font-mono text-lg font-semibold text-[var(--text-primary)]">{formatNumber(totalEnergy)}</span>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="m-0 text-sm font-semibold text-[var(--text-primary)]">Kinetic energy</p>
                  <p className="mt-1 mb-0 font-mono text-xs text-[var(--text-muted)]">K/(mc^2) = gamma - 1</p>
                </div>
                <span className="font-mono text-lg font-semibold text-[var(--text-primary)]">{formatNumber(kineticEnergy)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[#0f766e]">
              Classical Comparison
            </p>

            <div className="mt-4 space-y-4">
              <div className="flex items-center justify-between gap-4 border-b border-[var(--grid-line)] pb-4">
                <div>
                  <p className="m-0 text-sm font-semibold text-[var(--text-primary)]">Classical momentum</p>
                  <p className="mt-1 mb-0 font-mono text-xs text-[var(--text-muted)]">p_class/(mc) = beta</p>
                </div>
                <span className="font-mono text-lg font-semibold text-[var(--text-primary)]">
                  {formatNumber(classicalMomentum, 3, true)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-4 border-b border-[var(--grid-line)] pb-4">
                <div>
                  <p className="m-0 text-sm font-semibold text-[var(--text-primary)]">Classical kinetic energy</p>
                  <p className="mt-1 mb-0 font-mono text-xs text-[var(--text-muted)]">K_class/(mc^2) = beta^2 / 2</p>
                </div>
                <span className="font-mono text-lg font-semibold text-[var(--text-primary)]">{formatNumber(classicalKinetic)}</span>
              </div>

              <div className="flex items-center justify-between gap-4 border-b border-[var(--grid-line)] pb-4">
                <div>
                  <p className="m-0 text-sm font-semibold text-[var(--text-primary)]">Momentum gap</p>
                  <p className="mt-1 mb-0 text-xs text-[var(--text-muted)]">Relativistic minus classical</p>
                </div>
                <span className="font-mono text-lg font-semibold text-[var(--text-primary)]">
                  {formatNumber(momentumDifference, 3, true)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="m-0 text-sm font-semibold text-[var(--text-primary)]">Kinetic-energy gap</p>
                  <p className="mt-1 mb-0 text-xs text-[var(--text-muted)]">Relativistic minus classical</p>
                </div>
                <span className="font-mono text-lg font-semibold text-[var(--text-primary)]">{formatNumber(kineticDifference)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--accent-blue)_10%,var(--bg-primary))] p-5 shadow-sm">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
              Key Idea
            </p>
            <p className="mt-3 mb-0 text-sm leading-7 text-[var(--text-primary)]">
              In one dimension, momentum keeps track of direction, so it changes sign with beta. Energy does not track direction in the same way, so both total energy and kinetic energy stay nonnegative.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
