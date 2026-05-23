import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Waves, Wind } from 'lucide-react';

const STAGE = {
  width: 1040,
  height: 430,
  left: 76,
  boundary: 720,
  right: 968,
  top: 88,
  laneGap: 142,
  amplitude: 50,
};

const SAMPLE_COUNT = 190;
const LOOP_DURATION = 8.4;
const PULSE_WIDTH = 0.075;
const PARTICLE_COLUMNS = 46;
const PARTICLE_ROWS = 5;

const MODES = {
  fixedString: {
    key: 'fixedString',
    label: 'Fixed string end',
    shortLabel: 'Fixed end',
    group: 'String boundary',
    icon: Waves,
    accent: 'var(--accent-blue)',
    boundaryLabel: 'displacement node',
    exteriorLabel: 'rigid support',
    takeaway:
      'The fixed end cannot move. The reflected displacement is inverted so the incident and reflected waves add to zero at the boundary.',
    boundaryMath: 'displacement: incident + reflected = 0',
    reflectionSummary: 'displacement inverted',
    transmissionSummary: 'no transmitted string wave',
    lanes: [
      {
        key: 'displacement',
        title: 'String displacement',
        label: 'displacement node',
        accent: 'var(--accent-blue)',
        incidentAmp: 0.58,
        reflectedAmp: -0.58,
        transmittedAmp: 0,
      },
    ],
  },
  closedPipe: {
    key: 'closedPipe',
    label: 'Closed pipe end',
    shortLabel: 'Closed pipe',
    group: 'Sound boundary',
    icon: Wind,
    accent: 'var(--accent-red)',
    boundaryLabel: 'displacement node',
    exteriorLabel: 'closed wall',
    takeaway:
      'Air cannot flow through a closed wall. Air displacement cancels at the wall, while pressure variation reflects upright and reinforces there.',
    boundaryMath: 'air displacement: incident + reflected = 0; pressure reinforces',
    reflectionSummary: 'pressure upright',
    transmissionSummary: 'blocked at the wall',
    lanes: [
      {
        key: 'pressure',
        title: 'Pressure variation',
        label: 'pressure antinode',
        accent: 'var(--accent-red)',
        incidentAmp: 0.5,
        reflectedAmp: 0.5,
        transmittedAmp: 0,
      },
      {
        key: 'motion',
        title: 'Air displacement',
        label: 'displacement node',
        accent: '#0f766e',
        incidentAmp: 0.5,
        reflectedAmp: -0.5,
        transmittedAmp: 0,
        phaseOffset: 0.11,
      },
    ],
  },
  openPipe: {
    key: 'openPipe',
    label: 'Open pipe end',
    shortLabel: 'Open pipe',
    group: 'Sound boundary',
    icon: Wind,
    accent: '#0f766e',
    boundaryLabel: 'pressure node',
    exteriorLabel: 'outside air',
    takeaway:
      'Open does not mean boundary-free. The pressure variation at the opening stays near atmospheric pressure, so a reflected pressure wave cancels the incident pressure while some sound radiates outward.',
    boundaryMath: 'pressure: incident + reflected = 0; air displacement reinforces',
    reflectionSummary: 'pressure inverted',
    transmissionSummary: 'small radiated wave',
    lanes: [
      {
        key: 'pressure',
        title: 'Pressure variation',
        label: 'pressure node',
        accent: 'var(--accent-red)',
        incidentAmp: 0.5,
        reflectedAmp: -0.5,
        transmittedAmp: 0.18,
      },
      {
        key: 'motion',
        title: 'Air displacement',
        label: 'displacement antinode',
        accent: '#0f766e',
        incidentAmp: 0.5,
        reflectedAmp: 0.5,
        transmittedAmp: 0.28,
        phaseOffset: 0.11,
      },
    ],
  },
};

const MODE_OPTIONS = [MODES.fixedString, MODES.closedPipe, MODES.openPipe];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function stageXInterior(u) {
  return STAGE.left + u * (STAGE.boundary - STAGE.left);
}

function stageXExterior(u) {
  return STAGE.boundary + u * (STAGE.right - STAGE.boundary);
}

function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function getPulseProgress(time) {
  return positiveModulo(time, LOOP_DURATION) / LOOP_DURATION;
}

function pulseShape(u, center, amplitude) {
  const normalized = (u - center) / PULSE_WIDTH;
  return amplitude * Math.exp(-normalized * normalized);
}

function getPulseCenters(time) {
  const progress = getPulseProgress(time);
  const incident = -0.24 + progress * 2.48;

  return {
    incident,
    reflected: 2 - incident,
    transmitted: incident - 1,
  };
}

function laneY(laneIndex, laneCount) {
  const center = STAGE.height * 0.49;
  return center + (laneIndex - (laneCount - 1) / 2) * STAGE.laneGap;
}

function valueToY(value, baseline) {
  return baseline - value * STAGE.amplitude;
}

function incidentValue(lane, u, time) {
  const centers = getPulseCenters(time);
  return pulseShape(u, centers.incident - (lane.phaseOffset ?? 0), lane.incidentAmp);
}

function reflectedValue(lane, u, time) {
  const centers = getPulseCenters(time);
  return pulseShape(u, centers.reflected + (lane.phaseOffset ?? 0), lane.reflectedAmp);
}

function transmittedValue(lane, u, time) {
  const centers = getPulseCenters(time);
  return pulseShape(u, centers.transmitted - (lane.phaseOffset ?? 0), lane.transmittedAmp ?? 0);
}

function totalInteriorValue(lane, u, time) {
  return incidentValue(lane, u, time) + reflectedValue(lane, u, time);
}

function totalExteriorValue(lane, u, time) {
  return transmittedValue(lane, u, time);
}

function buildInteriorPath(lane, time, baseline, kind) {
  return Array.from({ length: SAMPLE_COUNT + 1 }, (_, index) => {
    const u = index / SAMPLE_COUNT;
    const value =
      kind === 'incident'
        ? incidentValue(lane, u, time)
        : kind === 'reflected'
          ? reflectedValue(lane, u, time)
          : totalInteriorValue(lane, u, time);
    const x = stageXInterior(u);
    const y = valueToY(value, baseline);

    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

function buildExteriorPath(lane, time, baseline) {
  return Array.from({ length: SAMPLE_COUNT + 1 }, (_, index) => {
    const u = index / SAMPLE_COUNT;
    const x = stageXExterior(u);
    const y = valueToY(totalExteriorValue(lane, u, time), baseline);

    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

function ModeButton({ mode, isActive, onClick }) {
  const Icon = mode.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all duration-200 ${
        isActive
          ? 'border-transparent bg-[var(--mode-color)] text-white shadow-sm'
          : 'border-[var(--grid-line)] bg-[var(--bg-primary)] text-[color:var(--text-primary)] hover:-translate-y-0.5 hover:border-[var(--mode-color)]'
      }`}
      style={{ '--mode-color': mode.accent }}
      aria-pressed={isActive}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-5">{mode.shortLabel}</span>
      </span>
    </button>
  );
}

function ViewToggleButton({ isActive, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-all duration-200 ${
        isActive
          ? 'border-transparent bg-slate-800 text-white shadow-sm'
          : 'border-[var(--grid-line)] bg-[var(--bg-primary)] text-[color:var(--text-muted)] hover:-translate-y-0.5 hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]'
      }`}
      aria-pressed={isActive}
    >
      {children}
    </button>
  );
}

function BoundaryDiagram({ mode, time }) {
  const hasTransmission = mode.lanes.some((lane) => Math.abs(lane.transmittedAmp ?? 0) > 0.001);

  return (
    <svg
      viewBox={`0 0 ${STAGE.width} ${STAGE.height}`}
      className="h-auto w-full"
      role="img"
      aria-label={`${mode.label} wave reflection diagram`}
    >
      <rect x="0" y="0" width={STAGE.width} height={STAGE.height} rx="24" fill="rgba(255,255,255,0.64)" />
      <rect
        x={STAGE.left}
        y="36"
        width={STAGE.boundary - STAGE.left}
        height="330"
        rx="18"
        fill="rgba(59,130,246,0.055)"
      />
      <rect
        x={STAGE.boundary}
        y="36"
        width={STAGE.right - STAGE.boundary}
        height="330"
        rx="18"
        fill={hasTransmission ? 'rgba(15,118,110,0.07)' : 'rgba(100,116,139,0.08)'}
      />

      <line
        x1={STAGE.boundary}
        x2={STAGE.boundary}
        y1="30"
        y2="374"
        stroke="rgba(15,23,42,0.7)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <text x={STAGE.left} y="24" fill="rgba(15,23,42,0.7)" fontSize="13" fontWeight="700">
        incoming medium
      </text>
      <text x={STAGE.boundary + 18} y="24" fill="rgba(15,23,42,0.7)" fontSize="13" fontWeight="700">
        {mode.exteriorLabel}
      </text>
      <text x={STAGE.boundary - 60} y="404" fill="rgba(15,23,42,0.82)" fontSize="14" fontWeight="800">
        boundary: {mode.boundaryLabel}
      </text>

      {mode.lanes.map((lane, laneIndex) => {
        const baseline = laneY(laneIndex, mode.lanes.length);
        const totalPath = buildInteriorPath(lane, time, baseline, 'total');
        const incidentPath = buildInteriorPath(lane, time, baseline, 'incident');
        const reflectedPath = buildInteriorPath(lane, time, baseline, 'reflected');
        const transmittedPath = buildExteriorPath(lane, time, baseline);
        const hasLaneTransmission = Math.abs(lane.transmittedAmp ?? 0) > 0.001;

        return (
          <g key={lane.key}>
            <line
              x1={STAGE.left}
              x2={STAGE.right}
              y1={baseline}
              y2={baseline}
              stroke="rgba(100,116,139,0.34)"
              strokeWidth="1.4"
              strokeDasharray="8 8"
            />
            <text x={STAGE.left} y={baseline - 34} fill="rgba(15,23,42,0.84)" fontSize="15" fontWeight="800">
              {lane.title}
            </text>
            <text x={STAGE.boundary + 16} y={baseline + 58} fill={lane.accent} fontSize="13" fontWeight="800">
              {lane.label}
            </text>

            <path
              d={incidentPath}
              fill="none"
              stroke="rgba(37,99,235,0.44)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={reflectedPath}
              fill="none"
              stroke="rgba(249,115,22,0.64)"
              strokeWidth="3"
              strokeDasharray="9 9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {hasLaneTransmission ? (
              <path
                d={transmittedPath}
                fill="none"
                stroke="rgba(15,118,110,0.56)"
                strokeWidth="3"
                strokeDasharray="4 9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}

            <path
              d={totalPath}
              fill="none"
              stroke="rgba(15,23,42,0.92)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {hasLaneTransmission ? (
              <path
                d={transmittedPath}
                fill="none"
                stroke="rgba(15,118,110,0.88)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </g>
        );
      })}

      <g transform="translate(76 382)">
        <circle cx="0" cy="0" r="5" fill="rgba(37,99,235,0.54)" />
        <text x="12" y="5" fill="rgba(15,23,42,0.7)" fontSize="12" fontWeight="700">
          incident pulse
        </text>
        <line x1="132" x2="160" y1="0" y2="0" stroke="rgba(249,115,22,0.72)" strokeWidth="3" strokeDasharray="8 6" />
        <text x="170" y="5" fill="rgba(15,23,42,0.7)" fontSize="12" fontWeight="700">
          reflected pulse
        </text>
        <line x1="314" x2="342" y1="0" y2="0" stroke="rgba(15,118,110,0.72)" strokeWidth="3" strokeDasharray="4 7" />
        <text x="352" y="5" fill="rgba(15,23,42,0.7)" fontSize="12" fontWeight="700">
          transmitted pulse
        </text>
        <line x1="522" x2="552" y1="0" y2="0" stroke="rgba(15,23,42,0.92)" strokeWidth="5" strokeLinecap="round" />
        <text x="564" y="5" fill="rgba(15,23,42,0.7)" fontSize="12" fontWeight="700">
          total
        </text>
      </g>
    </svg>
  );
}

function ParticlePipeDiagram({ mode, time }) {
  const pressureLane = mode.lanes.find((lane) => lane.key === 'pressure');
  const displacementLane = mode.lanes.find((lane) => lane.key === 'motion');
  const hasTransmission = mode.key === 'openPipe';
  const pipeTop = 82;
  const pipeHeight = 214;
  const pipeCenter = pipeTop + pipeHeight / 2;
  const rowSpacing = 28;
  const displacementScale = 46;
  const exteriorDisplacementScale = 34;

  if (!pressureLane || !displacementLane) {
    return null;
  }

  const interiorParticles = [];

  for (let row = 0; row < PARTICLE_ROWS; row += 1) {
    const rowOffset = (row - (PARTICLE_ROWS - 1) / 2) * rowSpacing;

    for (let column = 0; column < PARTICLE_COLUMNS; column += 1) {
      const u = (column + 0.5) / PARTICLE_COLUMNS;
      const pressure = totalInteriorValue(pressureLane, u, time);
      const displacement = totalInteriorValue(displacementLane, u, time);
      const intensity = clamp(Math.abs(pressure) / 0.7, 0, 1);
      const isCompression = pressure >= 0;

      interiorParticles.push({
        key: `interior-${row}-${column}`,
        x: stageXInterior(u) + displacement * displacementScale,
        y: pipeCenter + rowOffset,
        radius: isCompression ? 3.2 + intensity * 1.7 : 3.1 - intensity * 0.6,
        fill: `rgba(15,23,42,${0.36 + intensity * 0.34})`,
      });
    }
  }

  const exteriorParticles = [];

  if (hasTransmission) {
    for (let row = 0; row < PARTICLE_ROWS; row += 1) {
      const rowOffset = (row - (PARTICLE_ROWS - 1) / 2) * rowSpacing;

      for (let column = 0; column < 16; column += 1) {
        const u = (column + 0.5) / 16;
        const pressure = totalExteriorValue(pressureLane, u, time);
        const displacement = totalExteriorValue(displacementLane, u, time);
        const intensity = clamp(Math.abs(pressure) / 0.36, 0, 1);

        exteriorParticles.push({
          key: `exterior-${row}-${column}`,
          x: stageXExterior(u) + displacement * exteriorDisplacementScale,
          y: pipeCenter + rowOffset,
          radius: 2.9 + intensity * 1.1,
          fill: `rgba(15,118,110,${0.22 + intensity * 0.36})`,
        });
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${STAGE.width} ${STAGE.height}`}
      className="h-auto w-full"
      role="img"
      aria-label={`${mode.label} particle lattice compression pulse diagram`}
    >
      <rect x="0" y="0" width={STAGE.width} height={STAGE.height} rx="24" fill="rgba(255,255,255,0.64)" />
      <rect
        x={STAGE.left}
        y={pipeTop}
        width={STAGE.boundary - STAGE.left}
        height={pipeHeight}
        rx="18"
        fill="rgba(59,130,246,0.055)"
        stroke="rgba(100,116,139,0.24)"
        strokeWidth="1.4"
      />
      <rect
        x={STAGE.boundary}
        y={pipeTop}
        width={STAGE.right - STAGE.boundary}
        height={pipeHeight}
        rx="18"
        fill={hasTransmission ? 'rgba(15,118,110,0.07)' : 'rgba(100,116,139,0.08)'}
        stroke="rgba(100,116,139,0.18)"
        strokeWidth="1.2"
      />
      <line
        x1={STAGE.boundary}
        x2={STAGE.boundary}
        y1={pipeTop - 16}
        y2={pipeTop + pipeHeight + 16}
        stroke="rgba(15,23,42,0.72)"
        strokeWidth={hasTransmission ? 2.4 : 5.5}
        strokeLinecap="round"
      />

      <text x={STAGE.left} y="56" fill="rgba(15,23,42,0.72)" fontSize="13" fontWeight="800">
        air in pipe
      </text>
      <text x={STAGE.boundary + 18} y="56" fill="rgba(15,23,42,0.72)" fontSize="13" fontWeight="800">
        {mode.exteriorLabel}
      </text>
      <text x={STAGE.boundary - 60} y={pipeTop + pipeHeight + 46} fill="rgba(15,23,42,0.82)" fontSize="14" fontWeight="800">
        boundary: {mode.boundaryLabel}
      </text>

      {interiorParticles.map((particle) => (
        <circle
          key={particle.key}
          cx={particle.x}
          cy={particle.y}
          r={particle.radius}
          fill={particle.fill}
        />
      ))}
      {exteriorParticles.map((particle) => (
        <circle
          key={particle.key}
          cx={particle.x}
          cy={particle.y}
          r={particle.radius}
          fill={particle.fill}
        />
      ))}

      {hasTransmission ? (
        <g transform="translate(76 364)">
          <line x1="0" x2="36" y1="0" y2="0" stroke="rgba(15,118,110,0.72)" strokeWidth="3" strokeDasharray="4 7" />
          <text x="48" y="5" fill="rgba(15,23,42,0.72)" fontSize="12" fontWeight="700">
            radiated pulse
          </text>
        </g>
      ) : null}
    </svg>
  );
}

export default function BoundaryReflectionExplorer() {
  const [modeKey, setModeKey] = useState('openPipe');
  const [pipeView, setPipeView] = useState('traces');
  const [isPlaying, setIsPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const frameRef = useRef(null);
  const lastTimestampRef = useRef(null);

  useEffect(() => {
    if (!isPlaying) {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
      lastTimestampRef.current = null;
      return undefined;
    }

    const tick = (timestamp) => {
      const previous = lastTimestampRef.current ?? timestamp;
      const dt = clamp((timestamp - previous) / 1000, 0.001, 0.04);
      lastTimestampRef.current = timestamp;
      setTime((current) => current + dt);
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
      lastTimestampRef.current = null;
    };
  }, [isPlaying]);

  const mode = useMemo(() => MODES[modeKey], [modeKey]);
  const isPipeMode = mode.group === 'Sound boundary';
  const activePipeView = isPipeMode ? pipeView : 'traces';

  return (
    <section className="not-prose my-8 text-[color:var(--text-primary)]" style={{ overflowAnchor: 'none' }}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: mode.accent }}>
            {mode.group}
          </p>
          <h3 className="mt-2 mb-0 text-[1.35rem] font-semibold tracking-tight text-[color:var(--text-primary)]">
            {mode.label}
          </h3>
        </div>

      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {MODE_OPTIONS.map((option) => (
          <ModeButton
            key={option.key}
            mode={option}
            isActive={option.key === modeKey}
            onClick={() => {
              setModeKey(option.key);
              setTime(0);
            }}
          />
        ))}
        {isPipeMode ? (
          <div className="ml-auto inline-flex items-center gap-2">
            <ViewToggleButton isActive={pipeView === 'traces'} onClick={() => setPipeView('traces')}>
              Wave traces
            </ViewToggleButton>
            <ViewToggleButton isActive={pipeView === 'particles'} onClick={() => setPipeView('particles')}>
              Fluid view
            </ViewToggleButton>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setIsPlaying((playing) => !playing)}
          className={`${isPipeMode ? '' : 'ml-auto'} inline-flex items-center gap-2 rounded-lg bg-[var(--accent-blue)] px-3 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5`}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {isPlaying ? 'Pause' : 'Play'}
        </button>
      </div>

      {activePipeView === 'particles' ? (
        <ParticlePipeDiagram mode={mode} time={time} />
      ) : (
        <BoundaryDiagram mode={mode} time={time} />
      )}

      <p className="mt-3 mb-0 text-sm leading-7 text-[color:var(--text-muted)]">
        {mode.takeaway}
      </p>
    </section>
  );
}
