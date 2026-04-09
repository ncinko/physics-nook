import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';

const BIN_COUNT = 72;
const MAX_HITS = 1800;
const SCREEN_TOP = 46;
const SCREEN_BOTTOM = 354;
const SCREEN_HEIGHT = SCREEN_BOTTOM - SCREEN_TOP;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const formatNumber = (value, digits = 2) => {
  const fixed = value.toFixed(digits);
  return fixed === '-0.00' || fixed === '-0.0' ? fixed.slice(1) : fixed;
};

const buildCdf = (weights) => {
  const total = weights.reduce((sum, value) => sum + value, 0);
  let running = 0;

  return weights.map((value, index) => {
    running += value / total;
    return index === weights.length - 1 ? 1 : running;
  });
};

const sampleIndexFromCdf = (cdf) => {
  const target = Math.random();

  for (let index = 0; index < cdf.length; index += 1) {
    if (target <= cdf[index]) {
      return index;
    }
  }

  return cdf.length - 1;
};

const sampleHitY = (binIndex) => {
  const binHeight = SCREEN_HEIGHT / BIN_COUNT;
  return SCREEN_TOP + binIndex * binHeight + Math.random() * binHeight;
};

const getNarrative = ({ coherence, slitSeparation, wavelength }) => {
  if (coherence < 0.35) {
    return 'Low coherence washes out the dark fringes, so the screen starts to look more like a smooth classical envelope.';
  }

  if (slitSeparation / wavelength > 2.7) {
    return 'Larger slit spacing relative to wavelength squeezes more fringes onto the screen, so neighboring bright bands move closer together.';
  }

  if (wavelength > 0.85) {
    return 'A longer wavelength spreads the pattern and pushes the bright fringes farther apart on the screen.';
  }

  return 'Even though detections arrive one by one, the accumulated screen pattern follows a wave-like probability rule rather than a pair of classical particle piles.';
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

export default function DoubleSlitBuildUpExplorer() {
  const [wavelength, setWavelength] = useState(0.62);
  const [slitSeparation, setSlitSeparation] = useState(1.35);
  const [coherence, setCoherence] = useState(0.9);
  const [detectionRate, setDetectionRate] = useState(180);
  const [isPlaying, setIsPlaying] = useState(true);
  const [detectorState, setDetectorState] = useState(() => ({
    hits: [],
    counts: Array(BIN_COUNT).fill(0),
    total: 0,
  }));

  const frameRef = useRef();
  const lastTimeRef = useRef();
  const carryRef = useRef(0);
  const nextIdRef = useRef(0);

  const distribution = useMemo(() => {
    const envelopeWidth = clamp(0.86 - slitSeparation * 0.12 + wavelength * 0.18, 0.38, 0.92);
    const phaseScale = (slitSeparation / wavelength) * 5.8;

    const bins = Array.from({ length: BIN_COUNT }, (_, index) => {
      const position = -1 + (index / (BIN_COUNT - 1)) * 2;
      const envelope = Math.exp(-(position * position) / (2 * envelopeWidth * envelopeWidth));
      const classical = envelope;
      const interference = (1 + coherence * Math.cos(phaseScale * position)) * 0.5;
      const quantum = envelope * (0.05 + 0.95 * interference);

      return {
        classical,
        position,
        quantum,
      };
    });

    const quantumWeights = bins.map((bin) => bin.quantum);
    const classicalWeights = bins.map((bin) => bin.classical);
    const maxQuantum = Math.max(...quantumWeights, 1);
    const maxClassical = Math.max(...classicalWeights, 1);

    return {
      bins,
      cdf: buildCdf(quantumWeights),
      normalizedQuantum: quantumWeights.map((value) => value / maxQuantum),
      normalizedClassical: classicalWeights.map((value) => value / maxClassical),
      fringeSpacing: 2 / Math.max(phaseScale / Math.PI, 1e-6),
    };
  }, [coherence, slitSeparation, wavelength]);

  useEffect(() => {
    setDetectorState({
      hits: [],
      counts: Array(BIN_COUNT).fill(0),
      total: 0,
    });
    carryRef.current = 0;
    nextIdRef.current = 0;
  }, [distribution]);

  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(frameRef.current);
      lastTimeRef.current = undefined;
      return undefined;
    }

    const animate = (time) => {
      if (lastTimeRef.current == undefined) {
        lastTimeRef.current = time;
        frameRef.current = requestAnimationFrame(animate);
        return;
      }

      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = time;
      const rawBatch = carryRef.current + detectionRate * dt;
      const batchSize = Math.floor(rawBatch);
      carryRef.current = rawBatch - batchSize;

      if (batchSize > 0) {
        const sampledIndices = Array.from({ length: batchSize }, () =>
          sampleIndexFromCdf(distribution.cdf),
        );

        setDetectorState((previous) => {
          const nextCounts = [...previous.counts];
          const newHits = sampledIndices.map((binIndex) => {
            nextCounts[binIndex] += 1;

            return {
              id: nextIdRef.current++,
              x: 638 + Math.random() * 32,
              y: sampleHitY(binIndex),
            };
          });

          return {
            counts: nextCounts,
            hits: [...previous.hits, ...newHits].slice(-MAX_HITS),
            total: previous.total + batchSize,
          };
        });
      }

      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameRef.current);
      lastTimeRef.current = undefined;
    };
  }, [detectionRate, distribution.cdf, isPlaying]);

  const measuredProfile = useMemo(() => {
    const maxCount = Math.max(...detectorState.counts, 1);
    return detectorState.counts.map((count) => count / maxCount);
  }, [detectorState.counts]);

  const measuredPeak = Math.max(...detectorState.counts, 0);
  const centerIndex = Math.floor(BIN_COUNT / 2);
  const centerContrast =
    measuredPeak > 0
      ? detectorState.counts[centerIndex] / measuredPeak
      : distribution.normalizedQuantum[centerIndex];
  const statusSummary = getNarrative({ coherence, slitSeparation, wavelength });

  const renderProfilePath = (values, xStart, xScale) =>
    values
      .map((value, index) => {
        const x = xStart + value * xScale;
        const y = SCREEN_TOP + (index / (BIN_COUNT - 1)) * SCREEN_HEIGHT;
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');

  return (
    <div className="flex h-full min-h-[46rem] w-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--accent-blue)_14%,transparent),transparent_36%),radial-gradient(circle_at_bottom_right,color-mix(in_srgb,var(--accent-red)_9%,transparent),transparent_32%),var(--sim-bg)] text-[color:var(--text-primary)]">
      <div className="grid flex-1 lg:grid-cols-[1.4fr_0.95fr]">
        <div className="border-b border-[var(--grid-line)] lg:border-r lg:border-b-0">
          <div className="px-5 pt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
              Single detections build a fringe pattern
            </p>
            <p className="m-0 max-w-3xl text-sm leading-7 text-[color:var(--text-muted)]">
              Each dot is one detection event on the screen. The pattern only becomes visible after many arrivals, which is the key experimental clue that quantum predictions are probability amplitudes, not little classical trajectories.
            </p>
          </div>

          <div className="px-3 pb-4 pt-2 sm:px-5">
            <svg viewBox="0 0 760 400" className="h-auto w-full" role="img" aria-label="Double-slit build-up explorer">
              <defs>
                <linearGradient id="quantum-screen-fill" x1="0%" x2="100%" y1="0%" y2="0%">
                  <stop offset="0%" stopColor="color-mix(in srgb, var(--accent-blue) 14%, transparent)" />
                  <stop offset="100%" stopColor="color-mix(in srgb, white 65%, transparent)" />
                </linearGradient>
              </defs>

              <rect x="20" y="24" width="720" height="352" rx="28" fill="color-mix(in srgb, var(--bg-primary) 90%, white)" />

              <g>
                {Array.from({ length: 7 }, (_, index) => {
                  const x = 72 + index * 88;
                  return (
                    <line
                      key={`grid-x-${x}`}
                      x1={x}
                      x2={x}
                      y1="40"
                      y2="360"
                      stroke="color-mix(in srgb, var(--grid-line) 80%, transparent)"
                      strokeWidth="1"
                    />
                  );
                })}
                {Array.from({ length: 6 }, (_, index) => {
                  const y = 68 + index * 48;
                  return (
                    <line
                      key={`grid-y-${y}`}
                      x1="42"
                      x2="718"
                      y1={y}
                      y2={y}
                      stroke="color-mix(in srgb, var(--grid-line) 74%, transparent)"
                      strokeWidth="1"
                    />
                  );
                })}
              </g>

              <g transform="translate(104 202)">
                <circle r="34" fill="color-mix(in srgb, var(--accent-blue) 14%, white)" stroke="var(--accent-blue)" strokeWidth="3" />
                <circle r="7" fill="var(--accent-blue)" />
                <text x="0" y="62" textAnchor="middle" className="fill-[color:var(--text-primary)] text-[13px] font-semibold">
                  Source
                </text>
              </g>

              <g transform="translate(316 0)">
                <rect x="0" y="62" width="18" height="276" rx="9" fill="color-mix(in srgb, var(--text-primary) 82%, transparent)" />
                <rect x="0" y="138" width="18" height="34" rx="7" fill="white" />
                <rect x="0" y="228" width="18" height="34" rx="7" fill="white" />
                <text x="9" y="42" textAnchor="middle" className="fill-[color:var(--text-primary)] text-[13px] font-semibold">
                  Barrier
                </text>
              </g>

              <g>
                {Array.from({ length: 5 }, (_, index) => (
                  <path
                    key={`wavefront-${index}`}
                    d={`M ${138 + index * 34} 126 C ${176 + index * 34} 150, ${178 + index * 34} 254, ${138 + index * 34} 278`}
                    fill="none"
                    stroke="color-mix(in srgb, var(--accent-blue) 28%, transparent)"
                    strokeWidth="2"
                  />
                ))}
              </g>

              <path
                d={renderProfilePath(distribution.normalizedQuantum, 476, 112)}
                fill="none"
                stroke="var(--accent-blue)"
                strokeWidth="3"
                opacity="0.8"
              />
              <path
                d={renderProfilePath(distribution.normalizedClassical, 476, 112)}
                fill="none"
                stroke="#64748b"
                strokeWidth="2.5"
                strokeDasharray="8 8"
                opacity="0.9"
              />

              {detectorState.counts.map((count, index) => {
                const y = SCREEN_TOP + index * (SCREEN_HEIGHT / BIN_COUNT);
                const width = measuredPeak > 0 ? (count / measuredPeak) * 110 : 0;

                return (
                  <rect
                    key={`hist-${index}`}
                    x="478"
                    y={y + 1}
                    width={width}
                    height={Math.max(1, SCREEN_HEIGHT / BIN_COUNT - 2)}
                    rx="3"
                    fill="url(#quantum-screen-fill)"
                  />
                );
              })}

              <rect
                x="640"
                y={SCREEN_TOP}
                width="28"
                height={SCREEN_HEIGHT}
                rx="12"
                fill="color-mix(in srgb, var(--surface-elevated) 94%, white)"
                stroke="color-mix(in srgb, var(--grid-line) 94%, transparent)"
                strokeWidth="3"
              />

              {detectorState.hits.map((hit) => (
                <circle
                  key={hit.id}
                  cx={hit.x}
                  cy={hit.y}
                  r="2.4"
                  fill="color-mix(in srgb, var(--accent-blue) 78%, white)"
                  opacity="0.9"
                />
              ))}

              <g transform="translate(484 48)">
                <rect
                  x="0"
                  y="0"
                  width="136"
                  height="66"
                  rx="18"
                  fill="color-mix(in srgb, var(--surface-elevated) 95%, white)"
                  stroke="color-mix(in srgb, var(--grid-line) 92%, transparent)"
                />
                <text x="18" y="23" className="fill-[color:var(--text-muted)] text-[11px] font-semibold uppercase tracking-[0.16em]">
                  Pattern Type
                </text>
                <text x="18" y="46" className="fill-[color:var(--text-primary)] text-[21px] font-semibold">
                  Quantum
                </text>
              </g>

              <g transform="translate(494 320)">
                <circle cx="0" cy="0" r="5" fill="var(--accent-blue)" />
                <text x="14" y="4" className="fill-[color:var(--text-primary)] text-[12px] font-medium">
                  quantum probability
                </text>
                <line x1="0" x2="18" y1="20" y2="20" stroke="#64748b" strokeWidth="2.5" strokeDasharray="6 6" />
                <text x="26" y="24" className="fill-[color:var(--text-primary)] text-[12px] font-medium">
                  classical envelope
                </text>
              </g>
            </svg>
          </div>

          <div className="grid gap-3 border-t border-[var(--grid-line)] px-5 py-4 sm:grid-cols-3">
            <MetricCard
              label="Detections"
              value={detectorState.total.toLocaleString()}
              caption="More single hits make the interference structure easier to see."
            />
            <MetricCard
              label="Fringe Spacing"
              value={`${formatNumber(distribution.fringeSpacing, 2)} screen units`}
              caption="This widens when wavelength grows or slit spacing shrinks."
            />
            <MetricCard
              label="Center Brightness"
              value={`${Math.round(centerContrast * 100)}% of peak`}
              caption="The central band stays bright when the two paths stay coherent."
            />
          </div>
        </div>

        <div className="flex flex-col">
          <div className="border-b border-[var(--grid-line)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-blue)]">
                  Status
                </p>
                <p className="m-0 max-w-xl text-sm leading-7 text-[color:var(--text-primary)]">
                  {statusSummary}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsPlaying((current) => !current)}
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDetectorState({
                      hits: [],
                      counts: Array(BIN_COUNT).fill(0),
                      total: 0,
                    });
                    carryRef.current = 0;
                  }}
                  className="inline-flex items-center justify-center rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-2.5 text-[color:var(--text-muted)] shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
                  aria-label="Reset detections"
                  title="Reset detections"
                >
                  <RotateCcw className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-5 p-5">
            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                Controls
              </p>
              <div className="space-y-5">
                <ControlSlider
                  label="Effective Wavelength"
                  value={wavelength}
                  valueLabel={formatNumber(wavelength)}
                  min={0.35}
                  max={1.1}
                  step={0.01}
                  onChange={setWavelength}
                />
                <ControlSlider
                  label="Slit Separation"
                  value={slitSeparation}
                  valueLabel={formatNumber(slitSeparation)}
                  min={0.7}
                  max={2.2}
                  step={0.01}
                  onChange={setSlitSeparation}
                />
                <ControlSlider
                  label="Coherence"
                  value={coherence}
                  valueLabel={formatNumber(coherence)}
                  min={0.05}
                  max={1}
                  step={0.01}
                  onChange={setCoherence}
                />
                <ControlSlider
                  label="Detections per Second"
                  value={detectionRate}
                  valueLabel={`${Math.round(detectionRate)}`}
                  min={30}
                  max={420}
                  step={5}
                  onChange={setDetectionRate}
                />
              </div>
            </section>

            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 shadow-sm">
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                Pattern Comparison
              </p>
              <svg viewBox="0 0 320 220" className="h-auto w-full" aria-hidden="true">
                <rect x="18" y="20" width="284" height="176" rx="24" fill="color-mix(in srgb, var(--sim-bg) 88%, white)" />
                {Array.from({ length: 5 }, (_, index) => {
                  const y = 44 + index * 34;
                  return (
                    <line
                      key={`compare-y-${y}`}
                      x1="36"
                      x2="286"
                      y1={y}
                      y2={y}
                      stroke="color-mix(in srgb, var(--grid-line) 82%, transparent)"
                      strokeWidth="1"
                    />
                  );
                })}
                <path
                  d={distribution.normalizedQuantum
                    .map((value, index) => {
                      const x = 36 + (index / (BIN_COUNT - 1)) * 248;
                      const y = 180 - value * 124;
                      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
                    })
                    .join(' ')}
                  fill="none"
                  stroke="var(--accent-blue)"
                  strokeWidth="3"
                />
                <path
                  d={distribution.normalizedClassical
                    .map((value, index) => {
                      const x = 36 + (index / (BIN_COUNT - 1)) * 248;
                      const y = 180 - value * 124;
                      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
                    })
                    .join(' ')}
                  fill="none"
                  stroke="#64748b"
                  strokeWidth="2.5"
                  strokeDasharray="7 7"
                />
                <path
                  d={measuredProfile
                    .map((value, index) => {
                      const x = 36 + (index / (BIN_COUNT - 1)) * 248;
                      const y = 180 - value * 124;
                      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
                    })
                    .join(' ')}
                  fill="none"
                  stroke="#0f766e"
                  strokeWidth="2.5"
                  opacity="0.9"
                />
              </svg>
              <p className="mt-3 mb-0 text-sm leading-7 text-[color:var(--text-muted)]">
                Blue shows the quantum prediction, gray shows the classical no-interference envelope, and green shows what your accumulated detections have measured so far.
              </p>
            </section>

            <section className="rounded-3xl border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-5 shadow-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                Reading The Screen
              </p>
              <p className="m-0 text-sm leading-7 text-[color:var(--text-primary)]">
                The pattern changes most strongly with the ratio
                {' '}
                <span className="font-semibold">slit separation / wavelength</span>
                . Smaller ratios spread the fringes apart, while poorer coherence fills in the dark bands.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
