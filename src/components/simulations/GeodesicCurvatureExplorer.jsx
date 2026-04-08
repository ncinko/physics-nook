import React, { startTransition, useEffect, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';

const VIEW = {
  width: 760,
  height: 470,
  marginX: 58,
  marginTop: 38,
  marginBottom: 46,
};

const WORLD = {
  xMin: -4.2,
  xMax: 4.2,
  tMin: 0,
  tMax: 8.2,
};

const PRESETS = {
  converging: {
    label: 'Converging',
    strength: 1.05,
    width: 1.35,
    spread: 2.35,
    helper: 'Positive curvature focuses nearby free-fall paths toward one another.',
  },
  flat: {
    label: 'Flat',
    strength: 0,
    width: 1.35,
    spread: 2.35,
    helper: 'With no curvature, initially parallel geodesics stay nearly parallel.',
  },
  diverging: {
    label: 'Diverging',
    strength: -1.05,
    width: 1.35,
    spread: 2.35,
    helper: 'Negative curvature makes the same bundle spread apart as it evolves.',
  },
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const lerp = (start, end, t) => start + (end - start) * t;

const formatNumber = (value, digits = 2) => {
  const fixed = value.toFixed(digits);
  if (fixed === '-0.00' || fixed === '-0.0') {
    return fixed.slice(1);
  }
  return fixed;
};

const worldToScreen = (x, t) => {
  const usableWidth = VIEW.width - VIEW.marginX * 2;
  const usableHeight = VIEW.height - VIEW.marginTop - VIEW.marginBottom;
  const normalizedX = (x - WORLD.xMin) / (WORLD.xMax - WORLD.xMin);
  const normalizedT = (t - WORLD.tMin) / (WORLD.tMax - WORLD.tMin);

  return {
    x: VIEW.marginX + normalizedX * usableWidth,
    y: VIEW.height - VIEW.marginBottom - normalizedT * usableHeight,
  };
};

const pointsToPath = (points) =>
  points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');

const getFieldProfile = (t, width) => Math.exp(-((t - 4.1) ** 2) / (2 * width * width));

const getGridWarp = (baseX, t, strength, width) =>
  -strength * 0.22 * baseX * getFieldProfile(t, width * 1.18) / (1 + 0.26 * baseX * baseX);

const buildGridLinePaths = (strength, width) => {
  const verticalSeeds = [-3, -2, -1, 0, 1, 2, 3];
  const horizontalSeeds = [0.8, 2.1, 3.4, 4.8, 6.1, 7.4];
  const verticalPaths = verticalSeeds.map((baseX) => {
    const points = [];

    for (let t = WORLD.tMin; t <= WORLD.tMax; t += 0.16) {
      points.push(worldToScreen(baseX + getGridWarp(baseX, t, strength, width), t));
    }

    return pointsToPath(points);
  });

  const horizontalPaths = horizontalSeeds.map((baseT) => {
    const points = [];

    for (let x = WORLD.xMin; x <= WORLD.xMax; x += 0.14) {
      const timeWarp = strength * 0.06 * Math.exp(-(x * x) / 6.5) * Math.sin((x / 4.2) * Math.PI);
      points.push(worldToScreen(x + getGridWarp(x, baseT, strength, width), baseT + timeWarp));
    }

    return pointsToPath(points);
  });

  return { verticalPaths, horizontalPaths };
};

const buildGeodesicBundle = (strength, width, spread) => {
  const worldPaths = [];
  const screenPaths = [];
  const count = 9;
  const dt = 0.045;

  for (let index = 0; index < count; index += 1) {
    const blend = count === 1 ? 0.5 : index / (count - 1);
    const seedX = lerp(-spread, spread, blend);
    const pathWorld = [];
    const pathScreen = [];
    let x = seedX;
    let vx = 0;

    for (let t = WORLD.tMin; t <= WORLD.tMax + 1e-6; t += dt) {
      pathWorld.push({ x, t });
      pathScreen.push(worldToScreen(x, t));

      const profile = getFieldProfile(t, width);
      const tidalAcceleration = -strength * 0.62 * x * profile / (1.2 + 0.55 * x * x);

      vx += tidalAcceleration * dt;
      x += vx * dt;
      x = clamp(x, WORLD.xMin + 0.15, WORLD.xMax - 0.15);
    }

    worldPaths.push(pathWorld);
    screenPaths.push(pathScreen);
  }

  const firstPath = worldPaths[0];
  const lastPath = worldPaths[worldPaths.length - 1];
  const initialWidth = lastPath[0].x - firstPath[0].x;
  const finalWidth = lastPath[lastPath.length - 1].x - firstPath[firstPath.length - 1].x;

  return {
    worldPaths,
    screenPaths,
    initialWidth,
    finalWidth,
    ratio: initialWidth === 0 ? 1 : finalWidth / initialWidth,
  };
};

const getFieldPalette = (strength) => {
  if (strength > 0.12) {
    return {
      chip: 'Converging curvature',
      chipClass:
        'border-[color:color-mix(in_srgb,#0f766e_34%,var(--grid-line))] bg-[color-mix(in_srgb,#0f766e_12%,var(--surface-elevated))] text-[#0f766e]',
      glow: '#99f6e4',
      core: '#0f766e',
      fill: 'rgba(15, 118, 110, 0.14)',
      path: '#0f766e',
      pathAlt: '#14b8a6',
    };
  }

  if (strength < -0.12) {
    return {
      chip: 'Diverging curvature',
      chipClass:
        'border-[color:color-mix(in_srgb,#b45309_34%,var(--grid-line))] bg-[color-mix(in_srgb,#f59e0b_14%,var(--surface-elevated))] text-[#b45309]',
      glow: '#fde68a',
      core: '#b45309',
      fill: 'rgba(245, 158, 11, 0.14)',
      path: '#c2410c',
      pathAlt: '#f59e0b',
    };
  }

  return {
    chip: 'Flat spacetime',
    chipClass:
      'border-[color:color-mix(in_srgb,#64748b_30%,var(--grid-line))] bg-[color-mix(in_srgb,#94a3b8_12%,var(--surface-elevated))] text-[#475569]',
    glow: '#cbd5e1',
    core: '#64748b',
    fill: 'rgba(148, 163, 184, 0.12)',
    path: '#64748b',
    pathAlt: '#94a3b8',
  };
};

const getBehaviorSummary = (ratio) => {
  if (ratio < 0.85) {
    return {
      title: 'Nearby geodesics are converging.',
      body: 'Curvature is focusing the bundle, so the separation between neighboring free-fall paths shrinks with time.',
    };
  }

  if (ratio > 1.15) {
    return {
      title: 'Nearby geodesics are diverging.',
      body: 'Curvature is defocusing the bundle, so the same initially parallel paths move farther apart.',
    };
  }

  return {
    title: 'Nearby geodesics stay nearly parallel.',
    body: 'With little or no curvature, there is very little geodesic deviation and the bundle width changes only slightly.',
  };
};

function ControlSlider({ label, value, min, max, step, valueLabel, onChange }) {
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

function StatCard({ label, value, helper }) {
  return (
    <div className="rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">
        {label}
      </p>
      <p className="mt-2 mb-0 text-xl font-semibold tracking-tight text-[color:var(--text-primary)]">{value}</p>
      <p className="mt-2 mb-0 text-sm leading-6 text-[color:var(--text-muted)]">{helper}</p>
    </div>
  );
}

export default function GeodesicCurvatureExplorer() {
  const [activePreset, setActivePreset] = useState('converging');
  const [curvatureStrength, setCurvatureStrength] = useState(PRESETS.converging.strength);
  const [fieldWidth, setFieldWidth] = useState(PRESETS.converging.width);
  const [bundleSpread, setBundleSpread] = useState(PRESETS.converging.spread);
  const [showGrid, setShowGrid] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [phase, setPhase] = useState(0.18);

  useEffect(() => {
    if (!isPlaying) {
      return undefined;
    }

    let animationFrame = null;
    let lastFrameTime = null;

    const animate = (timestamp) => {
      const previous = lastFrameTime ?? timestamp;
      const dt = clamp((timestamp - previous) / 1000, 0.001, 0.03);
      lastFrameTime = timestamp;

      setPhase((current) => {
        const next = current + dt * 0.11;
        return next >= 1 ? next - 1 : next;
      });

      animationFrame = window.requestAnimationFrame(animate);
    };

    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [isPlaying]);

  const handlePreset = (presetKey) => {
    const preset = PRESETS[presetKey];

    startTransition(() => {
      setActivePreset(presetKey);
      setCurvatureStrength(preset.strength);
      setFieldWidth(preset.width);
      setBundleSpread(preset.spread);
      setPhase(0.18);
    });
  };

  const handleStrengthChange = (value) => {
    setActivePreset('custom');
    setCurvatureStrength(value);
  };

  const handleWidthChange = (value) => {
    setActivePreset('custom');
    setFieldWidth(value);
  };

  const handleSpreadChange = (value) => {
    setActivePreset('custom');
    setBundleSpread(value);
  };

  const resetExplorer = () => {
    if (activePreset !== 'custom' && PRESETS[activePreset]) {
      handlePreset(activePreset);
      return;
    }

    setCurvatureStrength(0);
    setFieldWidth(1.35);
    setBundleSpread(2.35);
    setPhase(0.18);
  };

  const { verticalPaths, horizontalPaths } = buildGridLinePaths(curvatureStrength, fieldWidth);
  const bundle = buildGeodesicBundle(curvatureStrength, fieldWidth, bundleSpread);
  const palette = getFieldPalette(curvatureStrength);
  const behavior = getBehaviorSummary(bundle.ratio);
  const outermostLeftStart = worldToScreen(bundle.worldPaths[0][0].x, bundle.worldPaths[0][0].t);
  const outermostRightStart = worldToScreen(
    bundle.worldPaths[bundle.worldPaths.length - 1][0].x,
    bundle.worldPaths[bundle.worldPaths.length - 1][0].t,
  );
  const outermostLeftEnd = worldToScreen(
    bundle.worldPaths[0][bundle.worldPaths[0].length - 1].x,
    bundle.worldPaths[0][bundle.worldPaths[0].length - 1].t,
  );
  const outermostRightEnd = worldToScreen(
    bundle.worldPaths[bundle.worldPaths.length - 1][bundle.worldPaths[bundle.worldPaths.length - 1].length - 1].x,
    bundle.worldPaths[bundle.worldPaths.length - 1][bundle.worldPaths[bundle.worldPaths.length - 1].length - 1].t,
  );
  const center = worldToScreen(0, 4.1);

  return (
    <div className="flex h-full flex-col gap-5 bg-[radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--accent-blue)_12%,transparent),transparent_36%),radial-gradient(circle_at_bottom_left,color-mix(in_srgb,var(--accent-red)_10%,transparent),transparent_34%),var(--sim-bg)] p-5 text-[color:var(--text-primary)] md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[16rem] flex-1">
          <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${palette.chipClass}`}>
            {palette.chip}
          </div>
          <h2 className="mt-3 mb-0 text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">
            Geodesic Curvature Explorer
          </h2>
          <p className="mt-3 mb-0 max-w-3xl text-sm leading-7 text-[color:var(--text-muted)]">
            This toy 1+1-dimensional spacetime shows a bundle of nearby free-fall paths moving through a localized patch of curvature. Watch the same initially parallel geodesics converge, stay flat, or fan out depending on the sign of the curvature.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsPlaying((current) => !current)}
            className="flex items-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            onClick={resetExplorer}
            className="rounded-full border border-[var(--grid-line)] bg-[var(--bg-primary)] p-2.5 text-[color:var(--text-muted)] shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
            aria-label="Reset geodesic explorer"
            title="Reset geodesic explorer"
          >
            <RotateCcw className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_22rem]">
        <div className="overflow-hidden rounded-[1.75rem] border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--surface-elevated)_92%,transparent)] shadow-sm">
          <svg viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} className="block h-full w-full">
            <defs>
              <radialGradient id="curvature-glow" cx="50%" cy="50%" r="56%">
                <stop offset="0%" stopColor={palette.glow} stopOpacity="0.78" />
                <stop offset="62%" stopColor={palette.glow} stopOpacity="0.22" />
                <stop offset="100%" stopColor={palette.glow} stopOpacity="0" />
              </radialGradient>
            </defs>

            <rect x="0" y="0" width={VIEW.width} height={VIEW.height} fill="transparent" />

            <rect
              x={VIEW.marginX}
              y={VIEW.marginTop}
              width={VIEW.width - VIEW.marginX * 2}
              height={VIEW.height - VIEW.marginTop - VIEW.marginBottom}
              rx="28"
              fill="color-mix(in srgb, var(--bg-primary) 84%, transparent)"
              stroke="var(--grid-line)"
              strokeWidth="1.2"
            />

            <ellipse
              cx={center.x}
              cy={center.y}
              rx={98}
              ry={126}
              fill="url(#curvature-glow)"
              opacity={Math.min(Math.abs(curvatureStrength) * 0.9 + 0.1, 1)}
            />
            <ellipse
              cx={center.x}
              cy={center.y}
              rx={34}
              ry={46}
              fill={palette.fill}
              stroke={palette.core}
              strokeWidth="1.5"
              opacity={Math.min(Math.abs(curvatureStrength) * 0.95 + 0.14, 1)}
            />

            {showGrid &&
              verticalPaths.map((path, index) => (
                <path
                  key={`vertical-grid-${index}`}
                  d={path}
                  fill="none"
                  stroke="rgba(100, 116, 139, 0.24)"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              ))}

            {showGrid &&
              horizontalPaths.map((path, index) => (
                <path
                  key={`horizontal-grid-${index}`}
                  d={path}
                  fill="none"
                  stroke="rgba(100, 116, 139, 0.18)"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              ))}

            {showGuides && (
              <>
                <line
                  x1={outermostLeftStart.x}
                  y1={outermostLeftStart.y + 14}
                  x2={outermostRightStart.x}
                  y2={outermostRightStart.y + 14}
                  stroke="rgba(71, 85, 105, 0.7)"
                  strokeWidth="2"
                  strokeDasharray="6 7"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={outermostLeftEnd.x}
                  y1={outermostLeftEnd.y - 14}
                  x2={outermostRightEnd.x}
                  y2={outermostRightEnd.y - 14}
                  stroke={palette.core}
                  strokeWidth="2.2"
                  strokeDasharray="6 7"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={(outermostLeftStart.x + outermostRightStart.x) / 2}
                  y={outermostLeftStart.y + 34}
                  textAnchor="middle"
                  fill="rgba(71, 85, 105, 0.82)"
                  fontSize="12"
                  fontWeight="600"
                >
                  initial bundle
                </text>
                <text
                  x={(outermostLeftEnd.x + outermostRightEnd.x) / 2}
                  y={outermostLeftEnd.y - 24}
                  textAnchor="middle"
                  fill={palette.core}
                  fontSize="12"
                  fontWeight="700"
                >
                  final bundle
                </text>
              </>
            )}

            {bundle.screenPaths.map((screenPath, index) => {
              const offsetPhase = (phase + index * 0.082) % 1;
              const dotIndex = Math.min(
                screenPath.length - 1,
                Math.floor(offsetPhase * (screenPath.length - 1)),
              );
              const dot = screenPath[dotIndex];
              const stroke = index % 2 === 0 ? palette.path : palette.pathAlt;

              return (
                <g key={`bundle-path-${index}`}>
                  <path
                    d={pointsToPath(screenPath)}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={index === 0 || index === bundle.screenPaths.length - 1 ? 3.3 : 2.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    opacity={0.94}
                  />
                  <circle cx={dot.x} cy={dot.y} r="5.6" fill={stroke} opacity="0.92" />
                  <circle cx={dot.x} cy={dot.y} r="10.8" fill={stroke} opacity="0.14" />
                </g>
              );
            })}

            <line
              x1={VIEW.marginX}
              y1={VIEW.height - VIEW.marginBottom}
              x2={VIEW.width - VIEW.marginX}
              y2={VIEW.height - VIEW.marginBottom}
              stroke="rgba(15, 23, 42, 0.86)"
              strokeWidth="2.4"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={VIEW.marginX}
              y1={VIEW.height - VIEW.marginBottom}
              x2={VIEW.marginX}
              y2={VIEW.marginTop}
              stroke="rgba(15, 23, 42, 0.86)"
              strokeWidth="2.4"
              vectorEffect="non-scaling-stroke"
            />

            <text
              x={VIEW.width - VIEW.marginX}
              y={VIEW.height - 16}
              textAnchor="end"
              fill="rgba(15, 23, 42, 0.82)"
              fontSize="13"
              fontWeight="700"
            >
              space x
            </text>
            <text
              x={20}
              y={VIEW.marginTop + 8}
              fill="rgba(15, 23, 42, 0.82)"
              fontSize="13"
              fontWeight="700"
              transform={`rotate(-90 20 ${VIEW.marginTop + 8})`}
            >
              time t
            </text>
          </svg>
        </div>

        <div className="space-y-4">
          <div className="rounded-[1.5rem] border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--surface-elevated)_94%,transparent)] p-4 shadow-sm">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
              Curvature Presets
            </p>
            <div className="mt-3 grid gap-2">
              {Object.entries(PRESETS).map(([presetKey, preset]) => (
                <button
                  key={presetKey}
                  type="button"
                  onClick={() => handlePreset(presetKey)}
                  className={`rounded-2xl border px-4 py-3 text-left transition-all duration-300 ${
                    activePreset === presetKey
                      ? 'border-[color:color-mix(in_srgb,var(--accent-blue)_36%,var(--grid-line))] bg-[color-mix(in_srgb,var(--accent-blue)_10%,var(--surface-elevated))] shadow-sm'
                      : 'border-[var(--grid-line)] bg-[var(--bg-primary)] hover:-translate-y-0.5 hover:border-[var(--accent-blue)]'
                  }`}
                >
                  <span className="block text-sm font-semibold text-[color:var(--text-primary)]">{preset.label}</span>
                  <span className="mt-1 block text-sm leading-6 text-[color:var(--text-muted)]">{preset.helper}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
            <div className="space-y-4">
              <ControlSlider
                label="Curvature strength"
                value={curvatureStrength}
                min={-1.4}
                max={1.4}
                step={0.01}
                valueLabel={formatNumber(curvatureStrength, 2)}
                onChange={handleStrengthChange}
              />
              <ControlSlider
                label="Field width"
                value={fieldWidth}
                min={0.7}
                max={2.4}
                step={0.01}
                valueLabel={formatNumber(fieldWidth, 2)}
                onChange={handleWidthChange}
              />
              <ControlSlider
                label="Bundle spread"
                value={bundleSpread}
                min={1.3}
                max={3.2}
                step={0.01}
                valueLabel={formatNumber(bundleSpread, 2)}
                onChange={handleSpreadChange}
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <label className="inline-flex items-center gap-2 rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-3 py-2 text-xs font-medium text-[color:var(--text-muted)]">
                <input
                  type="checkbox"
                  checked={showGrid}
                  onChange={(event) => setShowGrid(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--accent-blue)]"
                />
                Show warped grid
              </label>
              <label className="inline-flex items-center gap-2 rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-3 py-2 text-xs font-medium text-[color:var(--text-muted)]">
                <input
                  type="checkbox"
                  checked={showGuides}
                  onChange={(event) => setShowGuides(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--accent-blue)]"
                />
                Show bundle guides
              </label>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <StatCard
              label="Initial Width"
              value={`${formatNumber(bundle.initialWidth, 2)} x units`}
              helper="The geodesics begin as an evenly spaced bundle."
            />
            <StatCard
              label="Final Width"
              value={`${formatNumber(bundle.finalWidth, 2)} x units`}
              helper="Compare the same bundle after it passes through the curved region."
            />
            <StatCard
              label="Width Ratio"
              value={`${formatNumber(bundle.ratio, 2)} x`}
              helper="Values below 1 indicate convergence; values above 1 indicate divergence."
            />
          </div>

          <div className="rounded-[1.5rem] border border-[var(--grid-line)] bg-[color-mix(in_srgb,var(--surface-elevated)_94%,transparent)] p-4 shadow-sm">
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">Interpretation</p>
            <p className="mt-3 mb-0 text-base font-semibold text-[color:var(--text-primary)]">{behavior.title}</p>
            <p className="mt-2 mb-0 text-sm leading-7 text-[color:var(--text-muted)]">{behavior.body}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
