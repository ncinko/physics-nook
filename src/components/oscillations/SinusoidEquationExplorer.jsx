import React, { useState } from 'react';
import katex from 'katex';

const TIME_MAX = 8;
const SAMPLE_COUNT = 180;
const SVG_WIDTH = 620;
const SVG_HEIGHT = 320;
const PADDING = {
  top: 28,
  right: 24,
  bottom: 46,
  left: 58,
};

const EQUATIONS = {
  position: {
    label: 'Position',
    helper: 'Plot the displacement function',
    latex: 'x(t) = A \\cos(\\omega t + \\phi)',
    accent: 'var(--accent-blue)',
    tintClass: 'bg-[color-mix(in_srgb,var(--accent-blue)_8%,var(--bg-primary))]',
    curveColor: 'rgba(59, 130, 246, 0.94)',
    areaColor: 'rgba(59, 130, 246, 0.12)',
    yMax: 2.6,
    axisLabel: 'x(t)',
    summary:
      'For position, the amplitude sets the vertical reach, the angular frequency packs more or fewer cycles into the same time window, and the phase shifts the wave left or right.',
  },
  velocity: {
    label: 'Velocity',
    helper: 'Plot the velocity function',
    latex: 'v(t) = -A\\omega \\sin(\\omega t + \\phi)',
    accent: '#0f766e',
    tintClass: 'bg-[color-mix(in_srgb,#0f766e_8%,var(--bg-primary))]',
    curveColor: 'rgba(15, 118, 110, 0.95)',
    areaColor: 'rgba(15, 118, 110, 0.12)',
    yMax: 10.5,
    axisLabel: 'v(t)',
    summary:
      'For velocity, the curve is still sinusoidal, but its peak scale is A omega, so increasing omega changes both the number of oscillations and the vertical size of the graph.',
  },
};

const renderEquation = (latex) =>
  katex.renderToString(latex, {
    displayMode: true,
    throwOnError: false,
  });

const formatNumber = (value, digits = 2) => {
  const fixed = value.toFixed(digits);
  if (fixed === '-0.00' || fixed === '-0.0') {
    return fixed.slice(1);
  }
  return fixed;
};

const formatSigned = (value, digits = 2) => {
  if (Math.abs(value) < 1e-9) {
    return formatNumber(0, digits);
  }
  return value > 0 ? `+${formatNumber(value, digits)}` : formatNumber(value, digits);
};

const formatPhase = (value) => `${formatSigned(value, 2)} rad`;

const sampleValue = ({ activeEquation, amplitude, omega, phase, time }) => {
  if (activeEquation === 'velocity') {
    return -amplitude * omega * Math.sin(omega * time + phase);
  }

  return amplitude * Math.cos(omega * time + phase);
};

const buildPath = ({ samples, yMax }) => {
  const plotWidth = SVG_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = SVG_HEIGHT - PADDING.top - PADDING.bottom;

  return samples
    .map((sample, index) => {
      const x = PADDING.left + (sample.time / TIME_MAX) * plotWidth;
      const y = PADDING.top + ((yMax - sample.value) / (2 * yMax)) * plotHeight;
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
};

const buildArea = ({ samples, yMax }) => {
  const plotWidth = SVG_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = SVG_HEIGHT - PADDING.top - PADDING.bottom;
  const zeroY = PADDING.top + (yMax / (2 * yMax)) * plotHeight;
  const firstX = PADDING.left;
  const lastX = PADDING.left + plotWidth;

  const curve = samples
    .map((sample) => {
      const x = PADDING.left + (sample.time / TIME_MAX) * plotWidth;
      const y = PADDING.top + ((yMax - sample.value) / (2 * yMax)) * plotHeight;
      return `L ${x} ${y}`;
    })
    .join(' ');

  return `M ${firstX} ${zeroY} ${curve} L ${lastX} ${zeroY} Z`;
};

export default function SinusoidEquationExplorer() {
  const [activeEquation, setActiveEquation] = useState(null);
  const [amplitude, setAmplitude] = useState(1.2);
  const [omega, setOmega] = useState(1.4);
  const [phase, setPhase] = useState(0);

  const activeConfig = activeEquation ? EQUATIONS[activeEquation] : null;
  const samples = [];

  if (activeEquation) {
    for (let index = 0; index <= SAMPLE_COUNT; index += 1) {
      const time = (index / SAMPLE_COUNT) * TIME_MAX;
      samples.push({
        time,
        value: sampleValue({
          activeEquation,
          amplitude,
          omega,
          phase,
          time,
        }),
      });
    }
  }

  const yMax = activeConfig?.yMax ?? 1;
  const initialValue = activeEquation
    ? sampleValue({
        activeEquation,
        amplitude,
        omega,
        phase,
        time: 0,
      })
    : 0;
  const period = (2 * Math.PI) / omega;
  const plotPath = activeEquation ? buildPath({ samples, yMax }) : '';
  const areaPath = activeEquation ? buildArea({ samples, yMax }) : '';
  const zeroY = PADDING.top + ((yMax - 0) / (2 * yMax)) * (SVG_HEIGHT - PADDING.top - PADDING.bottom);

  return (
    <section className="not-prose my-8">
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        {Object.entries(EQUATIONS).map(([key, config]) => {
          const isActive = activeEquation === key;

          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveEquation((current) => (current === key ? null : key))}
              aria-expanded={isActive}
              className={`rounded-[1.6rem] border px-5 py-5 text-left shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${config.tintClass} ${
                isActive ? 'border-[var(--text-primary)]' : 'border-[var(--grid-line)]'
              }`}
            >
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: config.accent }}>
                {config.label}
              </p>
              <div
                className="mt-3 text-[color:var(--text-primary)] [&_.katex-display]:m-0 [&_.katex]:text-[1.05rem]"
                dangerouslySetInnerHTML={{ __html: renderEquation(config.latex) }}
              />
              <p className="mt-3 mb-0 text-sm leading-7 text-[color:var(--text-muted)]">{config.helper}</p>
            </button>
          );
        })}
      </div>

      {activeConfig && (
        <div className="overflow-hidden rounded-[2rem] border border-[var(--grid-line)] bg-[radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--accent-blue)_12%,transparent),transparent_36%),radial-gradient(circle_at_bottom_left,color-mix(in_srgb,var(--accent-red)_10%,transparent),transparent_40%),var(--sim-bg)] shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--grid-line)] px-6 py-5">
            <div>
              <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: activeConfig.accent }}>
                Interactive Plot
              </p>
              <div
                className="mt-3 text-[color:var(--text-primary)] [&_.katex-display]:m-0"
                dangerouslySetInnerHTML={{ __html: renderEquation(activeConfig.latex) }}
              />
            </div>

            <button
              type="button"
              onClick={() => setActiveEquation(null)}
              className="rounded-full border border-[var(--grid-line)] bg-[var(--bg-primary)] px-4 py-2 text-sm font-medium text-[color:var(--text-muted)] shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
            >
              Hide Plot
            </button>
          </div>

          <div className="space-y-6 px-6 py-6">
            <div className="rounded-[1.6rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: activeConfig.accent }}>
                    Function View
                  </p>
                  <p className="mt-2 mb-0 text-sm leading-7 text-[color:var(--text-muted)]">
                  </p>
                </div>
                <p className="m-0 rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-3 py-1 text-xs font-medium text-[color:var(--text-muted)]">
                  T = {formatNumber(period)} s
                </p>
              </div>

              <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="h-auto w-full">
                <rect x="0" y="0" width={SVG_WIDTH} height={SVG_HEIGHT} rx="24" fill="color-mix(in srgb, var(--sim-bg) 76%, white)" />

                {[0, 2, 4, 6, 8].map((tick) => {
                  const x = PADDING.left + (tick / TIME_MAX) * (SVG_WIDTH - PADDING.left - PADDING.right);
                  return (
                    <g key={tick}>
                      <line
                        x1={x}
                        x2={x}
                        y1={PADDING.top}
                        y2={SVG_HEIGHT - PADDING.bottom}
                        stroke="rgba(148, 163, 184, 0.24)"
                        strokeWidth="1.5"
                      />
                      <text
                        x={x}
                        y={SVG_HEIGHT - 14}
                        textAnchor="middle"
                        fill="rgba(71, 85, 105, 0.9)"
                        fontSize="13"
                        fontWeight="600"
                      >
                        {tick}
                      </text>
                    </g>
                  );
                })}

                {[yMax, 0, -yMax].map((tick) => {
                  const y = PADDING.top + ((yMax - tick) / (2 * yMax)) * (SVG_HEIGHT - PADDING.top - PADDING.bottom);
                  return (
                    <g key={tick}>
                      <line
                        x1={PADDING.left}
                        x2={SVG_WIDTH - PADDING.right}
                        y1={y}
                        y2={y}
                        stroke={tick === 0 ? 'rgba(15, 23, 42, 0.32)' : 'rgba(148, 163, 184, 0.22)'}
                        strokeWidth={tick === 0 ? '1.8' : '1.2'}
                        strokeDasharray={tick === 0 ? '0' : '6 7'}
                      />
                      <text
                        x="18"
                        y={y + 4}
                        fill="rgba(71, 85, 105, 0.9)"
                        fontSize="13"
                        fontWeight="600"
                      >
                        {formatSigned(tick, 1)}
                      </text>
                    </g>
                  );
                })}

                <path d={areaPath} fill={activeConfig.areaColor} />
                <path d={plotPath} fill="none" stroke={activeConfig.curveColor} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                <circle
                  cx={PADDING.left}
                  cy={PADDING.top + ((yMax - initialValue) / (2 * yMax)) * (SVG_HEIGHT - PADDING.top - PADDING.bottom)}
                  r="5"
                  fill={activeConfig.curveColor}
                />
                <text
                  x={7* SVG_WIDTH / 8}
                  y={SVG_HEIGHT - 14}
                  textAnchor="middle"
                  fill="rgba(15, 23, 42, 0.78)"
                  fontSize="14"
                  fontWeight="700"
                >
                  time (s)
                </text>
                <text
                  x="20"
                  y={PADDING.top - 6}
                  fill="rgba(15, 23, 42, 0.78)"
                  fontSize="14"
                  fontWeight="700"
                >
                  {activeConfig.axisLabel}
                </text>
                <line
                  x1={PADDING.left}
                  x2={PADDING.left}
                  y1={PADDING.top}
                  y2={SVG_HEIGHT - PADDING.bottom}
                  stroke="rgba(15, 23, 42, 0.5)"
                  strokeWidth="1.8"
                />
                <line
                  x1={PADDING.left}
                  x2={SVG_WIDTH - PADDING.right}
                  y1={zeroY}
                  y2={zeroY}
                  stroke="rgba(15, 23, 42, 0.18)"
                  strokeWidth="1.2"
                />
              </svg>
            </div>

            <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="rounded-[1.6rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: activeConfig.accent }}>
                  Parameters
                </p>
                <p className="mt-2 mb-4 text-sm leading-7 text-[color:var(--text-muted)]">
             
                </p>

                <div className="space-y-5">
                  <label className="block">
                    <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                      <span className="font-medium text-[color:var(--text-primary)]">Amplitude</span>
                      <span className="font-mono text-[color:var(--text-muted)]">{formatNumber(amplitude)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.4"
                      max="2.4"
                      step="0.05"
                      value={amplitude}
                      onChange={(event) => setAmplitude(parseFloat(event.target.value))}
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-700"
                    />
                  </label>

                  <label className="block">
                    <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                      <span className="font-medium text-[color:var(--text-primary)]">Angular frequency</span>
                      <span className="font-mono text-[color:var(--text-muted)]">{formatNumber(omega)} rad/s</span>
                    </div>
                    <input
                      type="range"
                      min="0.4"
                      max="4.2"
                      step="0.05"
                      value={omega}
                      onChange={(event) => setOmega(parseFloat(event.target.value))}
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-700"
                    />
                  </label>

                  <label className="block">
                    <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                      <span className="font-medium text-[color:var(--text-primary)]">Phase</span>
                      <span className="font-mono text-[color:var(--text-muted)]">{formatPhase(phase)}</span>
                    </div>
                    <input
                      type="range"
                      min={-Math.PI}
                      max={Math.PI}
                      step="0.05"
                      value={phase}
                      onChange={(event) => setPhase(parseFloat(event.target.value))}
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-700"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-[1.6rem] border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-5 shadow-sm">
                <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: activeConfig.accent }}>
                  What Changes
                </p>
                <p className="mt-3 mb-0 text-sm leading-7 text-[color:var(--text-primary)]">{activeConfig.summary}</p>

              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
