import React, { useEffect, useMemo, useState } from 'react';

const SAMPLE_COUNT = 240;
const PLOT_X = 62;
const PLOT_Y = 34;
const PLOT_WIDTH = 556;
const PLOT_HEIGHT = 196;
const PLOT_BOTTOM = PLOT_Y + PLOT_HEIGHT;
const ORBITAL_LETTERS = ['s', 'p', 'd', 'f', 'g'];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const formatNumber = (value, digits = 2) => {
  const fixed = value.toFixed(digits);
  return fixed === '-0.00' || fixed === '-0.0' ? fixed.slice(1) : fixed;
};

const factorial = (value) => {
  if (value <= 1) {
    return 1;
  }

  let product = 1;

  for (let index = 2; index <= value; index += 1) {
    product *= index;
  }

  return product;
};

const hermitePolynomial = (order, x) => {
  if (order === 0) {
    return 1;
  }

  if (order === 1) {
    return 2 * x;
  }

  let previousPrevious = 1;
  let previous = 2 * x;

  for (let index = 2; index <= order; index += 1) {
    const current = 2 * x * previous - 2 * (index - 1) * previousPrevious;
    previousPrevious = previous;
    previous = current;
  }

  return previous;
};

const generalizedLaguerre = (order, alpha, x) => {
  if (order === 0) {
    return 1;
  }

  if (order === 1) {
    return 1 + alpha - x;
  }

  let previousPrevious = 1;
  let previous = 1 + alpha - x;

  for (let index = 2; index <= order; index += 1) {
    const current =
      ((2 * index - 1 + alpha - x) * previous - (index - 1 + alpha) * previousPrevious) /
      index;
    previousPrevious = previous;
    previous = current;
  }

  return previous;
};

const integrateSeries = (samples, key) =>
  samples.reduce((sum, sample, index) => {
    if (index === samples.length - 1) {
      return sum;
    }

    const next = samples[index + 1];
    return sum + ((sample[key] + next[key]) * 0.5 * (next.xValue - sample.xValue));
  }, 0);

const peakSampleFor = (samples, key) =>
  samples.reduce((peak, sample) => (sample[key] > peak[key] ? sample : peak), samples[0]);

const orbitalLetter = (angularNumber) => ORBITAL_LETTERS[angularNumber] ?? `l=${angularNumber}`;

const pathFromSeries = (points, xProject, yProject) =>
  points
    .map((point, index) => {
      const x = xProject(point, index);
      const y = yProject(point, index);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

const areaPathFromSeries = (points, xProject, yProject, baselineY) => {
  if (points.length === 0) {
    return '';
  }

  const startX = xProject(points[0], 0);
  const endX = xProject(points[points.length - 1], points.length - 1);

  return `${pathFromSeries(points, xProject, yProject)} L ${endX.toFixed(2)} ${baselineY.toFixed(
    2,
  )} L ${startX.toFixed(2)} ${baselineY.toFixed(2)} Z`;
};

const scaledX = (value, min, max) => PLOT_X + ((value - min) / (max - min)) * PLOT_WIDTH;

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

const getWellStatus = ({ boxWidth, quantumNumber }) => {
  if (quantumNumber === 1) {
    return 'The rigid-box ground state already carries nonzero energy because the walls do not allow a flat n = 0 solution.';
  }

  if (boxWidth > 1.45) {
    return 'Widening the box spreads the standing wave out, so the curvature softens and the allowed energy drops like 1 over L squared.';
  }

  if (quantumNumber >= 5) {
    return 'Higher box states pack many half-wavelengths between the walls, which is why the node count rises and the energy grows quickly like n squared.';
  }

  return 'The box makes the quantization rule visible: only standing waves that land on zero at both walls survive.';
};

const getOscillatorStatus = ({ omega, quantumNumber }) => {
  if (quantumNumber === 0) {
    return 'The harmonic-oscillator ground state is a smooth Gaussian-like hump with zero-point energy, so the motion never settles to exactly zero energy.';
  }

  if (omega > 1.35) {
    return 'A stiffer oscillator squeezes the state inward and increases the fixed spacing between neighboring levels.';
  }

  if (quantumNumber >= 4) {
    return 'Higher oscillator states add nodes one by one, but unlike the box their energies still climb in equal steps of hbar omega.';
  }

  return 'The oscillator is quantized by normalizability rather than hard walls: only a discrete Hermite-Gaussian ladder stays finite at large distance.';
};

const getHydrogenStatus = ({ angularNumber, orbitalLabel, principalNumber, radialNodes }) => {
  if (principalNumber === 1 && angularNumber === 0) {
    return 'The 1s state is the simplest hydrogen radial state: no radial nodes, the most tightly bound energy, and a probability peak near one Bohr radius.';
  }

  if (radialNodes === 0 && angularNumber > 0) {
    return `${orbitalLabel} has no radial nodes, but the nonzero angular momentum pushes the radial profile away from the origin.`;
  }

  if (radialNodes > 0) {
    return `For ${orbitalLabel}, the radial component changes sign ${radialNodes} time${radialNodes === 1 ? '' : 's'} before it decays away, so the radial probability develops multiple shells.`;
  }

  return 'Hydrogen quantization comes from a Coulomb potential plus spherical boundary conditions. The energy depends on n in this simple model, while l reshapes the radial part.';
};

export default function QuantizationExplorer() {
  const [system, setSystem] = useState('well');
  const [wellQuantumNumber, setWellQuantumNumber] = useState(2);
  const [boxWidth, setBoxWidth] = useState(1.15);
  const [oscillatorQuantumNumber, setOscillatorQuantumNumber] = useState(1);
  const [oscillatorOmega, setOscillatorOmega] = useState(1.0);
  const [hydrogenPrincipalNumber, setHydrogenPrincipalNumber] = useState(2);
  const [hydrogenAngularNumber, setHydrogenAngularNumber] = useState(0);

  useEffect(() => {
    setHydrogenAngularNumber((current) => Math.min(current, hydrogenPrincipalNumber - 1));
  }, [hydrogenPrincipalNumber]);

  const effectiveHydrogenAngularNumber = Math.min(
    hydrogenAngularNumber,
    hydrogenPrincipalNumber - 1,
  );

  const wellData = useMemo(() => {
    const domainMin = 0;
    const domainMax = 2.3;
    const boxStart = (domainMax - boxWidth) * 0.5;
    const boxEnd = boxStart + boxWidth;

    const samples = Array.from({ length: SAMPLE_COUNT }, (_, index) => {
      const x = domainMin + ((domainMax - domainMin) * index) / (SAMPLE_COUNT - 1);
      const inside = x >= boxStart && x <= boxEnd;
      const localX = inside ? (x - boxStart) / boxWidth : 0;
      const psi = inside
        ? Math.sqrt(2 / boxWidth) * Math.sin(wellQuantumNumber * Math.PI * localX)
        : 0;

      return { inside, probability: psi * psi, psi, x, xValue: x };
    });

    return {
      boxEnd,
      boxStart,
      domainMax,
      domainMin,
      energyRatioToGround: wellQuantumNumber * wellQuantumNumber,
      interiorSamples: samples.filter((sample) => sample.inside),
      nodeCount: Math.max(0, wellQuantumNumber - 1),
      normalization: integrateSeries(samples, 'probability'),
      relativeEnergy: (wellQuantumNumber * wellQuantumNumber) / (boxWidth * boxWidth),
      samples,
      wavelength: (2 * boxWidth) / wellQuantumNumber,
    };
  }, [boxWidth, wellQuantumNumber]);

  const oscillatorData = useMemo(() => {
    const domainMin = -5.25;
    const domainMax = 5.25;
    const prefactor =
      Math.pow(oscillatorOmega / Math.PI, 0.25) /
      Math.sqrt(Math.pow(2, oscillatorQuantumNumber) * factorial(oscillatorQuantumNumber));

    const samples = Array.from({ length: SAMPLE_COUNT }, (_, index) => {
      const x = domainMin + ((domainMax - domainMin) * index) / (SAMPLE_COUNT - 1);
      const scaledPosition = Math.sqrt(oscillatorOmega) * x;
      const psi =
        prefactor *
        hermitePolynomial(oscillatorQuantumNumber, scaledPosition) *
        Math.exp(-0.5 * oscillatorOmega * x * x);
      const potential = 0.5 * oscillatorOmega * oscillatorOmega * x * x;

      return { potential, probability: psi * psi, psi, x, xValue: x };
    });

    const energy = oscillatorOmega * (oscillatorQuantumNumber + 0.5);

    return {
      displayMax: Math.max(
        0.5 * oscillatorOmega * oscillatorOmega * domainMax * domainMax * 1.04,
        energy * 1.35,
      ),
      domainMax,
      domainMin,
      energy,
      nodeCount: oscillatorQuantumNumber,
      normalization: integrateSeries(samples, 'probability'),
      samples,
      turningPoint: Math.sqrt((2 * energy) / (oscillatorOmega * oscillatorOmega)),
    };
  }, [oscillatorOmega, oscillatorQuantumNumber]);

  const hydrogenData = useMemo(() => {
    const domainMin = 0;
    const domainMax = 36;
    const radialOrder = hydrogenPrincipalNumber - effectiveHydrogenAngularNumber - 1;
    const prefactor =
      Math.pow(2 / hydrogenPrincipalNumber, 1.5) *
      Math.sqrt(
        factorial(radialOrder) /
          (2 * hydrogenPrincipalNumber *
            factorial(hydrogenPrincipalNumber + effectiveHydrogenAngularNumber)),
      );

    const samples = Array.from({ length: SAMPLE_COUNT }, (_, index) => {
      const radius = domainMin + ((domainMax - domainMin) * index) / (SAMPLE_COUNT - 1);
      const safeRadius = Math.max(radius, 1e-6);
      const rho = (2 * safeRadius) / hydrogenPrincipalNumber;
      const laguerre = generalizedLaguerre(
        radialOrder,
        2 * effectiveHydrogenAngularNumber + 1,
        rho,
      );
      const radialPower =
        effectiveHydrogenAngularNumber === 0 ? 1 : Math.pow(rho, effectiveHydrogenAngularNumber);
      const radial = prefactor * radialPower * Math.exp(-rho * 0.5) * laguerre;

      return {
        potential:
          (effectiveHydrogenAngularNumber * (effectiveHydrogenAngularNumber + 1)) /
            (2 * safeRadius * safeRadius) -
          1 / safeRadius,
        radial,
        radialProbability: radius * radius * radial * radial,
        x: radius,
        xValue: radius,
      };
    });

    const peakSample = peakSampleFor(samples, 'radialProbability');

    return {
      displayMax: 0.55,
      displayMin: -1.05,
      domainMax,
      domainMin,
      energyAtomicUnits: -0.5 / (hydrogenPrincipalNumber * hydrogenPrincipalNumber),
      energyElectronVolts: -13.6 / (hydrogenPrincipalNumber * hydrogenPrincipalNumber),
      normalization: integrateSeries(samples, 'radialProbability'),
      orbitalLabel: `${hydrogenPrincipalNumber}${orbitalLetter(effectiveHydrogenAngularNumber)}`,
      peakRadius: peakSample.x,
      radialNodes: radialOrder,
      samples,
    };
  }, [effectiveHydrogenAngularNumber, hydrogenPrincipalNumber]);

  const activeContent = useMemo(() => {
    if (system === 'well') {
      return {
        formulaLines: [
          'psi_n(x) ~ sin(n pi x / L)',
          'E_n ~ n^2 / L^2',
        ],
        intro:
          'The infinite well makes the rule visible: the state must vanish at rigid walls, so only standing-wave patterns fit.',
        metrics: [
          {
            caption: 'For this box width, the allowed energy scales like n squared divided by L squared.',
            label: 'Relative Energy',
            value: formatNumber(wellData.relativeEnergy, 2),
          },
          {
            caption: 'The standing wavelength inside the box is 2L divided by n.',
            label: 'Wavelength',
            value: `${formatNumber(wellData.wavelength, 2)} units`,
          },
          {
            caption: 'Each higher box state adds one interior zero crossing.',
            label: 'Interior Nodes',
            value: `${wellData.nodeCount}`,
          },
        ],
        note:
          'Hard-wall boundary conditions reject every wavelength that fails to land on zero at both ends of the box.',
        noteTitle: 'Why These States Are Discrete',
        probabilityCaption: 'The probability density stays entirely inside the rigid walls.',
        probabilityTitle: 'Probability Density |psi_n|^2',
        stateCaption: 'Rigid walls, a single allowed energy line, and the stationary wave for that state.',
        stateTitle: 'Infinite-Well State',
        status: getWellStatus({ boxWidth, quantumNumber: wellQuantumNumber }),
      };
    }

    if (system === 'oscillator') {
      return {
        formulaLines: [
          'E_n = (n + 1/2) hbar omega',
          `Nodes = ${oscillatorData.nodeCount}`,
        ],
        intro:
          'The harmonic oscillator has no hard edges. Quantization appears because only special Hermite-Gaussian solutions remain normalizable at large distance.',
        metrics: [
          {
            caption: 'This is the plotted level in the scaled oscillator units used by the sim.',
            label: 'Scaled Energy',
            value: formatNumber(oscillatorData.energy, 2),
          },
          {
            caption: 'Neighboring oscillator levels remain separated by the same amount.',
            label: 'Level Spacing',
            value: `${formatNumber(oscillatorOmega, 2)} units`,
          },
          {
            caption: 'These are the classical turning points for the selected energy.',
            label: 'Turning Point',
            value: `+/- ${formatNumber(oscillatorData.turningPoint, 2)}`,
          },
        ],
        note:
          'Unlike the box, the oscillator does not spread out its level spacing. Every step up the ladder adds one node and exactly one more quantum of energy.',
        noteTitle: 'What Changes Here',
        probabilityCaption:
          'The dashed lines mark the classical turning points for the selected level.',
        probabilityTitle: 'Probability Density |psi_n|^2',
        stateCaption: 'Parabolic potential, equally spaced energy ladder, and the selected stationary state.',
        stateTitle: 'Oscillator State',
        status: getOscillatorStatus({
          omega: oscillatorOmega,
          quantumNumber: oscillatorQuantumNumber,
        }),
      };
    }

    return {
      formulaLines: [
        'E_n = -13.6 eV / n^2',
        `Radial nodes = ${hydrogenData.radialNodes}`,
      ],
      intro:
        'This panel focuses on the hydrogen radial component. The angular structure is omitted so the radial nodes and shell-like probability pattern are easier to compare with one-dimensional examples.',
      metrics: [
        {
          caption: 'This label combines the principal quantum number n and angular number l.',
          label: 'Orbital Label',
          value: hydrogenData.orbitalLabel,
        },
        {
          caption: 'In the simple hydrogen model, the binding energy depends only on n.',
          label: 'Energy',
          value: `${formatNumber(hydrogenData.energyElectronVolts, 2)} eV`,
        },
        {
          caption: 'The radial probability peaks near this radius in Bohr-radius units.',
          label: 'Peak Radius',
          value: `${formatNumber(hydrogenData.peakRadius, 2)} a0`,
        },
      ],
      note:
        'Changing l at fixed n reshapes the radial state and changes the node count, even though the simple energy formula shown here still depends only on n.',
      noteTitle: 'Hydrogen Reference',
      probabilityCaption:
        'The lower plot shows the radial probability r^2 |R_nl(r)|^2, which highlights shell structure.',
      probabilityTitle: 'Radial Probability',
      stateCaption:
        'Effective radial potential, bound-state energy, and the radial component for the chosen hydrogen state.',
      stateTitle: 'Hydrogen Radial State',
      status: getHydrogenStatus({
        angularNumber: effectiveHydrogenAngularNumber,
        orbitalLabel: hydrogenData.orbitalLabel,
        principalNumber: hydrogenPrincipalNumber,
        radialNodes: hydrogenData.radialNodes,
      }),
    };
  }, [
    boxWidth,
    effectiveHydrogenAngularNumber,
    hydrogenData.energyElectronVolts,
    hydrogenData.normalization,
    hydrogenData.orbitalLabel,
    hydrogenData.peakRadius,
    hydrogenData.radialNodes,
    hydrogenPrincipalNumber,
    oscillatorData.energy,
    oscillatorData.nodeCount,
    oscillatorData.normalization,
    oscillatorData.turningPoint,
    oscillatorOmega,
    oscillatorQuantumNumber,
    system,
    wellData.nodeCount,
    wellData.normalization,
    wellData.relativeEnergy,
    wellData.wavelength,
    wellQuantumNumber,
  ]);

  const wellAmplitude = Math.max(
    ...wellData.interiorSamples.map((sample) => Math.abs(sample.psi)),
    1,
  );
  const wellProbabilityPeak = Math.max(...wellData.samples.map((sample) => sample.probability), 1);
  const oscillatorAmplitude = Math.max(
    ...oscillatorData.samples.map((sample) => Math.abs(sample.psi)),
    1,
  );
  const oscillatorProbabilityPeak = Math.max(
    ...oscillatorData.samples.map((sample) => sample.probability),
    1,
  );
  const hydrogenAmplitude = Math.max(
    ...hydrogenData.samples.map((sample) => Math.abs(sample.radial)),
    1,
  );
  const hydrogenProbabilityPeak = Math.max(
    ...hydrogenData.samples.map((sample) => sample.radialProbability),
    1,
  );

  const renderStatePlot = () => {
    if (system === 'well') {
      const leftWallX = scaledX(wellData.boxStart, wellData.domainMin, wellData.domainMax);
      const rightWallX = scaledX(wellData.boxEnd, wellData.domainMin, wellData.domainMax);
      const energyY = PLOT_BOTTOM - 30 - Math.min(136, Math.sqrt(wellData.relativeEnergy) * 23);

      return (
        <svg viewBox="0 0 680 280" className="h-auto w-full" role="img" aria-label="Infinite well state">
          <rect x="24" y="20" width="632" height="232" rx="26" fill="color-mix(in srgb, var(--sim-bg) 84%, white)" />
          {Array.from({ length: 6 }, (_, index) => {
            const y = 46 + index * 30;
            return (
              <line
                key={`well-grid-${y}`}
                x1="44"
                x2="636"
                y1={y}
                y2={y}
                stroke="color-mix(in srgb, var(--grid-line) 80%, transparent)"
                strokeWidth="1"
              />
            );
          })}
          <rect x={PLOT_X} y={PLOT_Y} width={leftWallX - PLOT_X} height={PLOT_HEIGHT} fill="color-mix(in srgb, var(--accent-red) 6%, transparent)" />
          <rect x={rightWallX} y={PLOT_Y} width={PLOT_X + PLOT_WIDTH - rightWallX} height={PLOT_HEIGHT} fill="color-mix(in srgb, var(--accent-red) 6%, transparent)" />
          <line x1={leftWallX} x2={leftWallX} y1={PLOT_Y + 6} y2={PLOT_BOTTOM} stroke="#0f172a" strokeWidth="4" />
          <line x1={rightWallX} x2={rightWallX} y1={PLOT_Y + 6} y2={PLOT_BOTTOM} stroke="#0f172a" strokeWidth="4" />
          <line x1={leftWallX} x2={rightWallX} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} stroke="#0f172a" strokeWidth="3" />
          <line x1={leftWallX} x2={rightWallX} y1={energyY} y2={energyY} stroke="var(--accent-blue)" strokeWidth="3" />
          <path
            d={pathFromSeries(
              wellData.interiorSamples,
              (sample) => scaledX(sample.x, wellData.domainMin, wellData.domainMax),
              (sample) => energyY - (sample.psi / wellAmplitude) * 40,
            )}
            fill="none"
            stroke="#0f766e"
            strokeWidth="3"
          />
          <g transform="translate(50 50)">
            <rect x="0" y="0" width="140" height="78" rx="18" fill="color-mix(in srgb, var(--surface-elevated) 95%, white)" stroke="color-mix(in srgb, var(--grid-line) 92%, transparent)" />
            <text x="18" y="24" className="fill-[color:var(--text-muted)] text-[11px] font-semibold uppercase tracking-[0.16em]">Current State</text>
            <text x="18" y="52" className="fill-[color:var(--text-primary)] text-[22px] font-semibold">n = {wellQuantumNumber}</text>
          </g>
          <g transform="translate(82 246)">
            <line x1="0" x2="22" y1="0" y2="0" stroke="#0f172a" strokeWidth="3" />
            <text x="30" y="4" className="fill-[color:var(--text-primary)] text-[11px] font-medium">walls</text>
            <line x1="96" x2="118" y1="0" y2="0" stroke="var(--accent-blue)" strokeWidth="3" />
            <text x="126" y="4" className="fill-[color:var(--text-primary)] text-[11px] font-medium">energy</text>
            <line x1="190" x2="212" y1="0" y2="0" stroke="#0f766e" strokeWidth="3" />
            <text x="220" y="4" className="fill-[color:var(--text-primary)] text-[11px] font-medium">psi_n</text>
          </g>
        </svg>
      );
    }

    if (system === 'oscillator') {
      const yProject = (value) => PLOT_BOTTOM - (value / oscillatorData.displayMax) * PLOT_HEIGHT;
      const energyY = yProject(oscillatorData.energy);
      const leftTurningPointX = scaledX(-oscillatorData.turningPoint, oscillatorData.domainMin, oscillatorData.domainMax);
      const rightTurningPointX = scaledX(oscillatorData.turningPoint, oscillatorData.domainMin, oscillatorData.domainMax);

      return (
        <svg viewBox="0 0 680 280" className="h-auto w-full" role="img" aria-label="Harmonic oscillator state">
          <rect x="24" y="20" width="632" height="232" rx="26" fill="color-mix(in srgb, var(--sim-bg) 84%, white)" />
          {Array.from({ length: 6 }, (_, index) => {
            const y = 46 + index * 30;
            return (
              <line
                key={`osc-grid-${y}`}
                x1="44"
                x2="636"
                y1={y}
                y2={y}
                stroke="color-mix(in srgb, var(--grid-line) 80%, transparent)"
                strokeWidth="1"
              />
            );
          })}
          <path
            d={pathFromSeries(
              oscillatorData.samples,
              (sample) => scaledX(sample.x, oscillatorData.domainMin, oscillatorData.domainMax),
              (sample) => yProject(sample.potential),
            )}
            fill="none"
            stroke="#0f172a"
            strokeWidth="3"
          />
          <line x1={leftTurningPointX} x2={leftTurningPointX} y1={PLOT_Y} y2={PLOT_BOTTOM} stroke="color-mix(in srgb, var(--text-muted) 68%, transparent)" strokeDasharray="5 6" strokeWidth="2" />
          <line x1={rightTurningPointX} x2={rightTurningPointX} y1={PLOT_Y} y2={PLOT_BOTTOM} stroke="color-mix(in srgb, var(--text-muted) 68%, transparent)" strokeDasharray="5 6" strokeWidth="2" />
          <line x1={PLOT_X} x2={PLOT_X + PLOT_WIDTH} y1={energyY} y2={energyY} stroke="var(--accent-blue)" strokeWidth="3" />
          <path
            d={pathFromSeries(
              oscillatorData.samples,
              (sample) => scaledX(sample.x, oscillatorData.domainMin, oscillatorData.domainMax),
              (sample) => energyY - (sample.psi / oscillatorAmplitude) * 38,
            )}
            fill="none"
            stroke="#0f766e"
            strokeWidth="3"
          />
          <g transform="translate(50 50)">
            <rect x="0" y="0" width="140" height="78" rx="18" fill="color-mix(in srgb, var(--surface-elevated) 95%, white)" stroke="color-mix(in srgb, var(--grid-line) 92%, transparent)" />
            <text x="18" y="24" className="fill-[color:var(--text-muted)] text-[11px] font-semibold uppercase tracking-[0.16em]">Current State</text>
            <text x="18" y="52" className="fill-[color:var(--text-primary)] text-[22px] font-semibold">n = {oscillatorQuantumNumber}</text>
          </g>
          <g transform="translate(82 246)">
            <line x1="0" x2="22" y1="0" y2="0" stroke="#0f172a" strokeWidth="3" />
            <text x="30" y="4" className="fill-[color:var(--text-primary)] text-[11px] font-medium">V(x)</text>
            <line x1="84" x2="106" y1="0" y2="0" stroke="var(--accent-blue)" strokeWidth="3" />
            <text x="114" y="4" className="fill-[color:var(--text-primary)] text-[11px] font-medium">energy</text>
            <line x1="178" x2="200" y1="0" y2="0" stroke="#0f766e" strokeWidth="3" />
            <text x="208" y="4" className="fill-[color:var(--text-primary)] text-[11px] font-medium">psi_n</text>
          </g>
        </svg>
      );
    }

    const yProject = (value) =>
      PLOT_Y +
      ((hydrogenData.displayMax - clamp(value, hydrogenData.displayMin, hydrogenData.displayMax)) /
        (hydrogenData.displayMax - hydrogenData.displayMin)) *
        PLOT_HEIGHT;
    const energyY = yProject(hydrogenData.energyAtomicUnits);

    return (
      <svg viewBox="0 0 680 280" className="h-auto w-full" role="img" aria-label="Hydrogen radial state">
        <rect x="24" y="20" width="632" height="232" rx="26" fill="color-mix(in srgb, var(--sim-bg) 84%, white)" />
        {Array.from({ length: 6 }, (_, index) => {
          const y = 46 + index * 30;
          return (
            <line
              key={`hydrogen-grid-${y}`}
              x1="44"
              x2="636"
              y1={y}
              y2={y}
              stroke="color-mix(in srgb, var(--grid-line) 80%, transparent)"
              strokeWidth="1"
            />
          );
        })}
        <line x1={PLOT_X} x2={PLOT_X + PLOT_WIDTH} y1={yProject(0)} y2={yProject(0)} stroke="color-mix(in srgb, var(--text-muted) 68%, transparent)" strokeDasharray="6 6" strokeWidth="2" />
        <path
          d={pathFromSeries(
            hydrogenData.samples,
            (sample) => scaledX(sample.x, hydrogenData.domainMin, hydrogenData.domainMax),
            (sample) => yProject(sample.potential),
          )}
          fill="none"
          stroke="#0f172a"
          strokeWidth="3"
        />
        <line x1={PLOT_X} x2={PLOT_X + PLOT_WIDTH} y1={energyY} y2={energyY} stroke="var(--accent-blue)" strokeWidth="3" />
        <path
          d={pathFromSeries(
            hydrogenData.samples,
            (sample) => scaledX(sample.x, hydrogenData.domainMin, hydrogenData.domainMax),
            (sample) => energyY - (sample.radial / hydrogenAmplitude) * 34,
          )}
          fill="none"
          stroke="#0f766e"
          strokeWidth="3"
        />
        <g transform="translate(50 50)">
          <rect x="0" y="0" width="140" height="78" rx="18" fill="color-mix(in srgb, var(--surface-elevated) 95%, white)" stroke="color-mix(in srgb, var(--grid-line) 92%, transparent)" />
          <text x="18" y="24" className="fill-[color:var(--text-muted)] text-[11px] font-semibold uppercase tracking-[0.16em]">Current State</text>
          <text x="18" y="52" className="fill-[color:var(--text-primary)] text-[22px] font-semibold">{hydrogenData.orbitalLabel}</text>
        </g>
        <g transform="translate(82 246)">
          <line x1="0" x2="22" y1="0" y2="0" stroke="#0f172a" strokeWidth="3" />
          <text x="30" y="4" className="fill-[color:var(--text-primary)] text-[11px] font-medium">Veff(r)</text>
          <line x1="96" x2="118" y1="0" y2="0" stroke="var(--accent-blue)" strokeWidth="3" />
          <text x="126" y="4" className="fill-[color:var(--text-primary)] text-[11px] font-medium">energy</text>
          <line x1="190" x2="212" y1="0" y2="0" stroke="#0f766e" strokeWidth="3" />
          <text x="220" y="4" className="fill-[color:var(--text-primary)] text-[11px] font-medium">R_nl</text>
        </g>
      </svg>
    );
  };

  const renderProbabilityPlot = () => {
    if (system === 'well') {
      const leftWallX = scaledX(wellData.boxStart, wellData.domainMin, wellData.domainMax);
      const rightWallX = scaledX(wellData.boxEnd, wellData.domainMin, wellData.domainMax);

      return (
        <svg viewBox="0 0 680 250" className="h-auto w-full" role="img" aria-label="Infinite well probability density">
          <defs>
            <linearGradient id="quantization-well-fill" x1="0%" x2="0%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="color-mix(in srgb, var(--accent-blue) 30%, white)" />
              <stop offset="100%" stopColor="color-mix(in srgb, var(--accent-blue) 6%, transparent)" />
            </linearGradient>
          </defs>
          <rect x="24" y="20" width="632" height="200" rx="26" fill="color-mix(in srgb, var(--sim-bg) 84%, white)" />
          {Array.from({ length: 5 }, (_, index) => {
            const y = 48 + index * 34;
            return (
              <line
                key={`well-prob-grid-${y}`}
                x1="44"
                x2="636"
                y1={y}
                y2={y}
                stroke="color-mix(in srgb, var(--grid-line) 80%, transparent)"
                strokeWidth="1"
              />
            );
          })}
          <line x1={leftWallX} x2={leftWallX} y1={PLOT_Y + 2} y2={PLOT_BOTTOM} stroke="#0f172a" strokeWidth="4" />
          <line x1={rightWallX} x2={rightWallX} y1={PLOT_Y + 2} y2={PLOT_BOTTOM} stroke="#0f172a" strokeWidth="4" />
          <line x1={leftWallX} x2={rightWallX} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} stroke="#0f172a" strokeWidth="3" />
          <path
            d={areaPathFromSeries(
              wellData.samples,
              (sample) => scaledX(sample.x, wellData.domainMin, wellData.domainMax),
              (sample) => PLOT_BOTTOM - (sample.probability / wellProbabilityPeak) * 110,
              PLOT_BOTTOM,
            )}
            fill="url(#quantization-well-fill)"
            stroke="none"
          />
          <path
            d={pathFromSeries(
              wellData.samples,
              (sample) => scaledX(sample.x, wellData.domainMin, wellData.domainMax),
              (sample) => PLOT_BOTTOM - (sample.probability / wellProbabilityPeak) * 110,
            )}
            fill="none"
            stroke="var(--accent-blue)"
            strokeWidth="3"
          />
        </svg>
      );
    }

    if (system === 'oscillator') {
      const leftTurningPointX = scaledX(-oscillatorData.turningPoint, oscillatorData.domainMin, oscillatorData.domainMax);
      const rightTurningPointX = scaledX(oscillatorData.turningPoint, oscillatorData.domainMin, oscillatorData.domainMax);

      return (
        <svg viewBox="0 0 680 250" className="h-auto w-full" role="img" aria-label="Harmonic oscillator probability density">
          <defs>
            <linearGradient id="quantization-osc-fill" x1="0%" x2="0%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="color-mix(in srgb, var(--accent-blue) 30%, white)" />
              <stop offset="100%" stopColor="color-mix(in srgb, var(--accent-blue) 6%, transparent)" />
            </linearGradient>
          </defs>
          <rect x="24" y="20" width="632" height="200" rx="26" fill="color-mix(in srgb, var(--sim-bg) 84%, white)" />
          {Array.from({ length: 5 }, (_, index) => {
            const y = 48 + index * 34;
            return (
              <line
                key={`osc-prob-grid-${y}`}
                x1="44"
                x2="636"
                y1={y}
                y2={y}
                stroke="color-mix(in srgb, var(--grid-line) 80%, transparent)"
                strokeWidth="1"
              />
            );
          })}
          <line x1={leftTurningPointX} x2={leftTurningPointX} y1={PLOT_Y} y2={PLOT_BOTTOM} stroke="color-mix(in srgb, var(--text-muted) 68%, transparent)" strokeDasharray="5 6" strokeWidth="2" />
          <line x1={rightTurningPointX} x2={rightTurningPointX} y1={PLOT_Y} y2={PLOT_BOTTOM} stroke="color-mix(in srgb, var(--text-muted) 68%, transparent)" strokeDasharray="5 6" strokeWidth="2" />
          <line x1={PLOT_X} x2={PLOT_X + PLOT_WIDTH} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} stroke="color-mix(in srgb, var(--text-muted) 68%, transparent)" strokeWidth="2" />
          <path
            d={areaPathFromSeries(
              oscillatorData.samples,
              (sample) => scaledX(sample.x, oscillatorData.domainMin, oscillatorData.domainMax),
              (sample) => PLOT_BOTTOM - (sample.probability / oscillatorProbabilityPeak) * 110,
              PLOT_BOTTOM,
            )}
            fill="url(#quantization-osc-fill)"
            stroke="none"
          />
          <path
            d={pathFromSeries(
              oscillatorData.samples,
              (sample) => scaledX(sample.x, oscillatorData.domainMin, oscillatorData.domainMax),
              (sample) => PLOT_BOTTOM - (sample.probability / oscillatorProbabilityPeak) * 110,
            )}
            fill="none"
            stroke="var(--accent-blue)"
            strokeWidth="3"
          />
        </svg>
      );
    }

    const peakRadiusX = scaledX(hydrogenData.peakRadius, hydrogenData.domainMin, hydrogenData.domainMax);

    return (
      <svg viewBox="0 0 680 250" className="h-auto w-full" role="img" aria-label="Hydrogen radial probability density">
        <defs>
          <linearGradient id="quantization-hydrogen-fill" x1="0%" x2="0%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="color-mix(in srgb, var(--accent-blue) 30%, white)" />
            <stop offset="100%" stopColor="color-mix(in srgb, var(--accent-blue) 6%, transparent)" />
          </linearGradient>
        </defs>
        <rect x="24" y="20" width="632" height="200" rx="26" fill="color-mix(in srgb, var(--sim-bg) 84%, white)" />
        {Array.from({ length: 5 }, (_, index) => {
          const y = 48 + index * 34;
          return (
            <line
              key={`hydrogen-prob-grid-${y}`}
              x1="44"
              x2="636"
              y1={y}
              y2={y}
              stroke="color-mix(in srgb, var(--grid-line) 80%, transparent)"
              strokeWidth="1"
            />
          );
        })}
        <line x1={PLOT_X} x2={PLOT_X + PLOT_WIDTH} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} stroke="color-mix(in srgb, var(--text-muted) 68%, transparent)" strokeWidth="2" />
        <line x1={peakRadiusX} x2={peakRadiusX} y1={PLOT_Y} y2={PLOT_BOTTOM} stroke="#c2410c" strokeDasharray="5 6" strokeWidth="2" />
        <path
          d={areaPathFromSeries(
            hydrogenData.samples,
            (sample) => scaledX(sample.x, hydrogenData.domainMin, hydrogenData.domainMax),
            (sample) => PLOT_BOTTOM - (sample.radialProbability / hydrogenProbabilityPeak) * 112,
            PLOT_BOTTOM,
          )}
          fill="url(#quantization-hydrogen-fill)"
          stroke="none"
        />
        <path
          d={pathFromSeries(
            hydrogenData.samples,
            (sample) => scaledX(sample.x, hydrogenData.domainMin, hydrogenData.domainMax),
            (sample) => PLOT_BOTTOM - (sample.radialProbability / hydrogenProbabilityPeak) * 112,
          )}
          fill="none"
          stroke="var(--accent-blue)"
          strokeWidth="3"
        />
      </svg>
    );
  };

  return (
    <div className="flex h-full min-h-[54rem] w-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--accent-blue)_12%,transparent),transparent_34%),radial-gradient(circle_at_bottom_right,color-mix(in_srgb,var(--accent-red)_8%,transparent),transparent_30%),var(--sim-bg)] text-[color:var(--text-primary)]">
      <div className="grid flex-1 lg:grid-cols-[1.45fr_0.95fr]">
        <div className="border-b border-[var(--grid-line)] lg:border-r lg:border-b-0">
          <div className="px-5 pt-5">


          </div>

          <div className="px-4 pb-4 pt-3 md:px-5">
            <div className="mb-4 inline-flex flex-wrap rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-1">
              <ModeButton active={system === 'well'} label="Infinite Well" onClick={() => setSystem('well')} />
              <ModeButton active={system === 'oscillator'} label="Harmonic Oscillator" onClick={() => setSystem('oscillator')} />
              <ModeButton active={system === 'hydrogen'} label="Hydrogen Radial" onClick={() => setSystem('hydrogen')} />
            </div>

            <div className="grid gap-4">
              <section className="rounded-[1.8rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">{activeContent.stateTitle}</p>
                  <p className="m-0 max-w-sm text-right text-xs text-[color:var(--text-muted)]">{activeContent.stateCaption}</p>
                </div>
                {renderStatePlot()}
              </section>

              <section className="rounded-[1.8rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">{activeContent.probabilityTitle}</p>
                  <p className="m-0 max-w-sm text-right text-xs text-[color:var(--text-muted)]">{activeContent.probabilityCaption}</p>
                </div>
                {renderProbabilityPlot()}
              </section>
            </div>
          </div>

          <div className="grid gap-3 border-t border-[var(--grid-line)] px-5 py-4 sm:grid-cols-3">
            {activeContent.metrics.map((metric) => (
              <MetricCard key={metric.label} label={metric.label} value={metric.value} caption={metric.caption} />
            ))}
          </div>
        </div>

        <div className="flex flex-col">
          <div className="border-b border-[var(--grid-line)] p-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
              Status
            </p>
            <p className="m-0 max-w-xl text-sm leading-7 text-[color:var(--text-primary)]">
              {activeContent.status}
            </p>
          </div>

          <div className="grid gap-5 p-5">
            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                Controls
              </p>

              {system === 'well' ? (
                <div className="space-y-5">
                  <ControlSlider label="Quantum Number n" value={wellQuantumNumber} valueLabel={`${wellQuantumNumber}`} min={1} max={6} step={1} onChange={(value) => setWellQuantumNumber(Math.round(value))} />
                  <ControlSlider label="Box Width L" value={boxWidth} valueLabel={`${formatNumber(boxWidth, 2)} units`} min={0.8} max={1.8} step={0.01} onChange={setBoxWidth} />
                </div>
              ) : null}

              {system === 'oscillator' ? (
                <div className="space-y-5">
                  <ControlSlider label="Quantum Number n" value={oscillatorQuantumNumber} valueLabel={`${oscillatorQuantumNumber}`} min={0} max={5} step={1} onChange={(value) => setOscillatorQuantumNumber(Math.round(value))} />
                  <ControlSlider label="Frequency omega" value={oscillatorOmega} valueLabel={`${formatNumber(oscillatorOmega, 2)} units`} min={0.6} max={1.8} step={0.01} onChange={setOscillatorOmega} />
                </div>
              ) : null}

              {system === 'hydrogen' ? (
                <div className="space-y-5">
                  <ControlSlider label="Principal Number n" value={hydrogenPrincipalNumber} valueLabel={`${hydrogenPrincipalNumber}`} min={1} max={5} step={1} onChange={(value) => setHydrogenPrincipalNumber(Math.round(value))} />
                  <ControlSlider
                    label="Angular Number l"
                    value={effectiveHydrogenAngularNumber}
                    valueLabel={`${effectiveHydrogenAngularNumber} (${orbitalLetter(effectiveHydrogenAngularNumber)})`}
                    min={0}
                    max={Math.max(hydrogenPrincipalNumber - 1, 0)}
                    step={1}
                    onChange={(value) => setHydrogenAngularNumber(Math.min(Math.round(value), hydrogenPrincipalNumber - 1))}
                  />
                </div>
              ) : null}
            </section>

            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                {activeContent.noteTitle}
              </p>
              <p className="m-0 text-sm leading-7 text-[color:var(--text-primary)]">
                {activeContent.note}
              </p>
            </section>

            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-5 shadow-sm">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                Key Relations
              </p>
              <div className="space-y-3">
                {activeContent.formulaLines.map((line) => (
                  <p key={line} className="m-0 rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] px-4 py-3 font-mono text-sm text-[color:var(--text-primary)]">
                    {line}
                  </p>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
