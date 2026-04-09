import React, { useMemo, useState } from 'react';

const SAMPLE_COUNT = 220;

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

const getBoxStatus = ({ quantumNumber, boxWidth }) => {
  if (quantumNumber === 1) {
    return 'The ground state has no interior nodes and the longest allowed standing wavelength inside the box.';
  }

  if (quantumNumber >= 4) {
    return 'Higher quantum numbers pack more half-wavelengths into the same box, so the energy climbs rapidly as n squared.';
  }

  if (boxWidth > 1.5) {
    return 'A wider box admits longer wavelengths, so every allowed energy level drops compared with a tighter box.';
  }

  return 'Boundary conditions force only certain standing waves to fit, which is why the allowed energies come in a discrete ladder.';
};

const getBarrierStatus = ({ energyRatio, barrierWidth }) => {
  if (energyRatio > 0.78) {
    return 'When the particle energy sits closer to the barrier height, the decay region is thinner and transmission becomes much more likely.';
  }

  if (barrierWidth > 0.34) {
    return 'A wider barrier compounds the exponential decay, so the transmitted wave on the far side shrinks quickly.';
  }

  return 'Inside the classically forbidden region the wavefunction does not vanish immediately; it decays, which leaves a small transmitted wave beyond the barrier.';
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

export default function ParticleInBoxExplorer() {
  const [mode, setMode] = useState('box');
  const [quantumNumber, setQuantumNumber] = useState(2);
  const [boxWidth, setBoxWidth] = useState(1.1);
  const [energyRatio, setEnergyRatio] = useState(0.46);
  const [barrierWidth, setBarrierWidth] = useState(0.24);

  const boxData = useMemo(() => {
    const relativeEnergy = (quantumNumber * quantumNumber) / (boxWidth * boxWidth);
    const samples = Array.from({ length: SAMPLE_COUNT }, (_, index) => {
      const x = index / (SAMPLE_COUNT - 1);
      const psi = Math.sin(quantumNumber * Math.PI * x);
      return { psi, x };
    });

    return {
      nodeCount: Math.max(0, quantumNumber - 1),
      relativeEnergy,
      samples,
      wavelength: (2 * boxWidth) / quantumNumber,
    };
  }, [boxWidth, quantumNumber]);

  const barrierData = useMemo(() => {
    const barrierStart = 0.42;
    const barrierEnd = 0.42 + barrierWidth;
    const attenuation = Math.exp(-6.4 * barrierWidth * (1 - energyRatio));
    const kLeft = 18 + energyRatio * 8;
    const kRight = kLeft * 0.98;
    const kappa = 10.5 * (1 - energyRatio);

    const samples = Array.from({ length: SAMPLE_COUNT }, (_, index) => {
      const x = index / (SAMPLE_COUNT - 1);

      if (x < barrierStart) {
        return {
          psi: Math.sin(kLeft * (x - barrierStart)) + 0.22 * Math.sin(kLeft * 0.55),
          x,
        };
      }

      if (x <= barrierEnd) {
        const localX = x - barrierStart;
        return {
          psi: Math.exp(-kappa * localX),
          x,
        };
      }

      return {
        psi: attenuation * Math.sin(kRight * (x - barrierEnd) + 0.35),
        x,
      };
    });

    return {
      attenuation,
      barrierEnd,
      barrierStart,
      decayLength: kappa > 0 ? 1 / kappa : 0,
      samples,
    };
  }, [barrierWidth, energyRatio]);

  const activeStatus =
    mode === 'box'
      ? getBoxStatus({ quantumNumber, boxWidth })
      : getBarrierStatus({ barrierWidth, energyRatio });

  const boxAmplitude = Math.max(...boxData.samples.map((sample) => Math.abs(sample.psi)), 1);
  const barrierAmplitude = Math.max(...barrierData.samples.map((sample) => Math.abs(sample.psi)), 1);

  return (
    <div className="flex h-full min-h-[46rem] w-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--accent-blue)_12%,transparent),transparent_34%),radial-gradient(circle_at_bottom_right,color-mix(in_srgb,var(--accent-red)_8%,transparent),transparent_30%),var(--sim-bg)] text-[color:var(--text-primary)]">
      <div className="grid flex-1 lg:grid-cols-[1.45fr_0.95fr]">
        <div className="border-b border-[var(--grid-line)] lg:border-r lg:border-b-0">
          <div className="px-5 pt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
              Quantized standing states and tunneling share the same wave equation
            </p>
            <p className="m-0 max-w-3xl text-sm leading-7 text-[color:var(--text-muted)]">
              Switch between a bound-state box and a finite barrier. The plots keep the potential, the energy level, and the wavefunction on the same diagram so the boundary conditions stay visible.
            </p>
          </div>

          <div className="px-4 pb-4 pt-3 md:px-5">
            <div className="mb-4 inline-flex rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-1">
              {[
                { id: 'box', label: 'Particle In A Box' },
                { id: 'barrier', label: 'Tunneling Barrier' },
              ].map((option) => {
                const isActive = option.id === mode;

                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setMode(option.id)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 ${
                      isActive
                        ? 'bg-[var(--accent-blue)] text-white shadow-sm'
                        : 'text-[color:var(--text-primary)] hover:text-[var(--accent-blue)]'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            <section className="rounded-[1.8rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-4">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                  {mode === 'box' ? 'Bound States' : 'Finite Barrier'}
                </p>
                <p className="m-0 text-xs text-[color:var(--text-muted)]">
                  {mode === 'box' ? 'Potential walls, energy line, and standing wave' : 'Potential barrier, energy line, and decaying amplitude'}
                </p>
              </div>

              {mode === 'box' ? (
                <svg viewBox="0 0 680 360" className="h-auto w-full" role="img" aria-label="Particle in a one-dimensional box">
                  <rect x="24" y="20" width="632" height="300" rx="26" fill="color-mix(in srgb, var(--sim-bg) 84%, white)" />
                  {Array.from({ length: 6 }, (_, index) => {
                    const y = 56 + index * 40;
                    return (
                      <line
                        key={`box-grid-${y}`}
                        x1="44"
                        x2="636"
                        y1={y}
                        y2={y}
                        stroke="color-mix(in srgb, var(--grid-line) 80%, transparent)"
                        strokeWidth="1"
                      />
                    );
                  })}
                  <line x1="92" x2="92" y1="52" y2="286" stroke="#0f172a" strokeWidth="4" />
                  <line x1="588" x2="588" y1="52" y2="286" stroke="#0f172a" strokeWidth="4" />
                  <line x1="92" x2="588" y1="286" y2="286" stroke="#0f172a" strokeWidth="3" />

                  <line
                    x1="92"
                    x2="588"
                    y1={252 - boxData.relativeEnergy * 18}
                    y2={252 - boxData.relativeEnergy * 18}
                    stroke="var(--accent-blue)"
                    strokeWidth="3"
                  />
                  <path
                    d={pathFromSeries(
                      boxData.samples,
                      (sample) => 92 + sample.x * 496,
                      (sample) => 252 - boxData.relativeEnergy * 18 - (sample.psi / boxAmplitude) * 44,
                    )}
                    fill="none"
                    stroke="#0f766e"
                    strokeWidth="3"
                  />

                  <g transform="translate(108 70)">
                    <rect
                      x="0"
                      y="0"
                      width="166"
                      height="74"
                      rx="18"
                      fill="color-mix(in srgb, var(--surface-elevated) 95%, white)"
                      stroke="color-mix(in srgb, var(--grid-line) 92%, transparent)"
                    />
                    <text x="18" y="24" className="fill-[color:var(--text-muted)] text-[11px] font-semibold uppercase tracking-[0.16em]">
                      Current State
                    </text>
                    <text x="18" y="50" className="fill-[color:var(--text-primary)] text-[22px] font-semibold">
                      n = {quantumNumber}
                    </text>
                  </g>
                </svg>
              ) : (
                <svg viewBox="0 0 680 360" className="h-auto w-full" role="img" aria-label="Quantum tunneling through a barrier">
                  <rect x="24" y="20" width="632" height="300" rx="26" fill="color-mix(in srgb, var(--sim-bg) 84%, white)" />
                  {Array.from({ length: 6 }, (_, index) => {
                    const y = 56 + index * 40;
                    return (
                      <line
                        key={`barrier-grid-${y}`}
                        x1="44"
                        x2="636"
                        y1={y}
                        y2={y}
                        stroke="color-mix(in srgb, var(--grid-line) 80%, transparent)"
                        strokeWidth="1"
                      />
                    );
                  })}

                  <line x1="62" x2="618" y1="280" y2="280" stroke="#0f172a" strokeWidth="3" />
                  <path
                    d={`M 62 280 L ${62 + barrierData.barrierStart * 556} 280 L ${62 + barrierData.barrierStart * 556} 118 L ${62 + barrierData.barrierEnd * 556} 118 L ${62 + barrierData.barrierEnd * 556} 280 L 618 280`}
                    fill="none"
                    stroke="#0f172a"
                    strokeWidth="4"
                  />
                  <line
                    x1="62"
                    x2="618"
                    y1={280 - energyRatio * 122}
                    y2={280 - energyRatio * 122}
                    stroke="var(--accent-blue)"
                    strokeWidth="3"
                  />
                  <path
                    d={pathFromSeries(
                      barrierData.samples,
                      (sample) => 62 + sample.x * 556,
                      (sample) => 280 - energyRatio * 122 - (sample.psi / barrierAmplitude) * 54,
                    )}
                    fill="none"
                    stroke="#0f766e"
                    strokeWidth="3"
                  />

                  <g transform="translate(96 58)">
                    <rect
                      x="0"
                      y="0"
                      width="184"
                      height="82"
                      rx="18"
                      fill="color-mix(in srgb, var(--surface-elevated) 95%, white)"
                      stroke="color-mix(in srgb, var(--grid-line) 92%, transparent)"
                    />
                    <text x="18" y="24" className="fill-[color:var(--text-muted)] text-[11px] font-semibold uppercase tracking-[0.16em]">
                      Transmission
                    </text>
                    <text x="18" y="51" className="fill-[color:var(--text-primary)] text-[22px] font-semibold">
                      {`${Math.round(barrierData.attenuation * barrierData.attenuation * 100)}%`}
                    </text>
                  </g>
                </svg>
              )}
            </section>
          </div>

          {mode === 'box' ? (
            <div className="grid gap-3 border-t border-[var(--grid-line)] px-5 py-4 sm:grid-cols-3">
              <MetricCard
                label="Quantum Number"
                value={`${quantumNumber}`}
                caption="Each higher n adds another half-wavelength inside the box."
              />
              <MetricCard
                label="Relative Energy"
                value={formatNumber(boxData.relativeEnergy, 2)}
                caption="The energy scales like n squared divided by the box width squared."
              />
              <MetricCard
                label="Nodes"
                value={`${boxData.nodeCount}`}
                caption="The wavefunction crosses zero this many times between the walls."
              />
            </div>
          ) : (
            <div className="grid gap-3 border-t border-[var(--grid-line)] px-5 py-4 sm:grid-cols-3">
              <MetricCard
                label="Energy / Barrier"
                value={formatNumber(energyRatio, 2)}
                caption="Larger ratios reduce the effective decay under the barrier."
              />
              <MetricCard
                label="Barrier Width"
                value={`${formatNumber(barrierWidth, 2)} box units`}
                caption="Wider barriers suppress the transmitted wave more strongly."
              />
              <MetricCard
                label="Decay Length"
                value={`${formatNumber(barrierData.decayLength, 3)} units`}
                caption="This gives the characteristic distance over which the under-barrier wave fades."
              />
            </div>
          )}
        </div>

        <div className="flex flex-col">
          <div className="border-b border-[var(--grid-line)] p-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
              Status
            </p>
            <p className="m-0 max-w-xl text-sm leading-7 text-[color:var(--text-primary)]">
              {activeStatus}
            </p>
          </div>

          <div className="grid gap-5 p-5">
            {mode === 'box' ? (
              <>
                <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
                  <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                    Controls
                  </p>
                  <div className="space-y-5">
                    <ControlSlider
                      label="Quantum Number"
                      value={quantumNumber}
                      valueLabel={`${quantumNumber}`}
                      min={1}
                      max={5}
                      step={1}
                      onChange={(value) => setQuantumNumber(Math.round(value))}
                    />
                    <ControlSlider
                      label="Box Width"
                      value={boxWidth}
                      valueLabel={`${formatNumber(boxWidth, 2)} nm`}
                      min={0.7}
                      max={1.9}
                      step={0.01}
                      onChange={setBoxWidth}
                    />
                  </div>
                </section>

                <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-5 shadow-sm">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                    Box Facts
                  </p>
                  <p className="m-0 text-sm leading-7 text-[color:var(--text-primary)]">
                    The allowed standing wavelength for this state is
                    {' '}
                    <span className="font-semibold">{formatNumber(boxData.wavelength, 2)} nm</span>
                    .
                    Because the walls force
                    {' '}
                    <span className="font-semibold">psi = 0</span>
                    {' '}
                    at both ends, only an integer number of half-wavelengths can fit.
                  </p>
                </section>
              </>
            ) : (
              <>
                <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
                  <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                    Controls
                  </p>
                  <div className="space-y-5">
                    <ControlSlider
                      label="Energy Ratio E / V0"
                      value={energyRatio}
                      valueLabel={formatNumber(energyRatio, 2)}
                      min={0.12}
                      max={0.92}
                      step={0.01}
                      onChange={setEnergyRatio}
                    />
                    <ControlSlider
                      label="Barrier Width"
                      value={barrierWidth}
                      valueLabel={`${formatNumber(barrierWidth, 2)} units`}
                      min={0.12}
                      max={0.4}
                      step={0.01}
                      onChange={setBarrierWidth}
                    />
                  </div>
                </section>

                <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-5 shadow-sm">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                    Barrier Facts
                  </p>
                  <p className="m-0 text-sm leading-7 text-[color:var(--text-primary)]">
                    A classical particle with
                    {' '}
                    <span className="font-semibold">E &lt; V0</span>
                    {' '}
                    would bounce back completely. The wavefunction instead leaks under the barrier and leaves a transmitted amplitude whose intensity is roughly the square of that surviving amplitude.
                  </p>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
