import React, { useEffect, useRef, useState } from 'react';

const STAGE = {
  width: 480,
  height: 264,
  padding: {
    left: 34,
    right: 26,
    top: 42,
    bottom: 36,
  },
  domainLength: 10,
};

const TRANSVERSE_BASELINE_Y = 166;
const LONGITUDINAL_BASELINE_Y = 154;
const TRANSVERSE_SAMPLE_COUNT = 180;
const TRANSVERSE_PARTICLE_COUNT = 23;
const LONGITUDINAL_PARTICLE_COUNT = 20;
const LONGITUDINAL_ROW_OFFSETS = [-32, -12, 12, 32];
const HIGHLIGHT_INDEX = 10;
const AMPLITUDE_PX = 38;
const LONGITUDINAL_SHIFT_PX = 20;
const WAVELENGTH = 2.8;
const FREQUENCY = 0.44;

const positiveModulo = (value, modulus) => ((value % modulus) + modulus) % modulus;

const stageX = (xPhysical) =>
  STAGE.padding.left +
  (xPhysical / STAGE.domainLength) * (STAGE.width - STAGE.padding.left - STAGE.padding.right);

const phaseAt = (xPhysical, time) => 2 * Math.PI * (xPhysical / WAVELENGTH - FREQUENCY * time);

const wrappedCenters = ({ basePhysical, spacing, minPhysical, maxPhysical }) => {
  const firstCenter = minPhysical + positiveModulo(basePhysical - minPhysical, spacing);
  const centers = [];

  for (let xPhysical = firstCenter; xPhysical <= maxPhysical; xPhysical += spacing) {
    centers.push(stageX(xPhysical));
  }

  return centers;
};

const makeArrowHead = (x, y, direction) =>
  direction === 'right'
    ? `M ${x - 10} ${y - 7} L ${x} ${y} L ${x - 10} ${y + 7}`
    : direction === 'left'
      ? `M ${x + 10} ${y - 7} L ${x} ${y} L ${x + 10} ${y + 7}`
      : direction === 'up'
        ? `M ${x - 7} ${y + 10} L ${x} ${y} L ${x + 7} ${y + 10}`
        : `M ${x - 7} ${y - 10} L ${x} ${y} L ${x + 7} ${y - 10}`;

function MotionArrow({ x1, y1, x2, y2, label, labelX, labelY, color }) {
  const horizontal = Math.abs(y1 - y2) < 1;

  return (
    <g aria-hidden="true">
      <line x1={x1} x2={x2} y1={y1} y2={y2} stroke={color} strokeWidth="2.8" strokeLinecap="round" />
      <path
        d={horizontal ? makeArrowHead(x1, y1, 'left') : makeArrowHead(x1, y1, y2 > y1 ? 'up' : 'down')}
        fill="none"
        stroke={color}
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={horizontal ? makeArrowHead(x2, y2, 'right') : makeArrowHead(x2, y2, y2 > y1 ? 'down' : 'up')}
        fill="none"
        stroke={color}
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text x={labelX} y={labelY} fill={color} fontSize="13" fontWeight="700">
        {label}
      </text>
    </g>
  );
}

function WavePanel({ title, accent, description, children }) {
  return (
    <figure className="overflow-hidden rounded-[1.8rem] border border-[var(--grid-line)] bg-[var(--bg-primary)] shadow-sm">
      <div className="border-b border-[var(--grid-line)] px-5 py-4">
        <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: accent }}>
          {title}
        </p>
        <p className="mt-2 mb-0 max-w-md text-sm leading-7 text-[color:var(--text-muted)]">{description}</p>
      </div>
      <div className="p-4 md:p-5">{children}</div>
    </figure>
  );
}

export default function WaveMotionComparison() {
  const [time, setTime] = useState(0);
  const frameRef = useRef(null);
  const lastTimeRef = useRef(null);

  useEffect(() => {
    const tick = (timestamp) => {
      const previous = lastTimeRef.current ?? timestamp;
      lastTimeRef.current = timestamp;
      const dt = Math.min(Math.max((timestamp - previous) / 1000, 0.001), 0.04);
      setTime((current) => current + dt);
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
      lastTimeRef.current = null;
    };
  }, []);

  const transversePath = Array.from({ length: TRANSVERSE_SAMPLE_COUNT + 1 }, (_, index) => {
    const xPhysical = (index / TRANSVERSE_SAMPLE_COUNT) * STAGE.domainLength;
    const x = stageX(xPhysical);
    const y = TRANSVERSE_BASELINE_Y - AMPLITUDE_PX * Math.sin(phaseAt(xPhysical, time));

    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');

  const transverseParticles = Array.from({ length: TRANSVERSE_PARTICLE_COUNT }, (_, index) => {
    const xPhysical = (index / (TRANSVERSE_PARTICLE_COUNT - 1)) * STAGE.domainLength;
    const x = stageX(xPhysical);
    const y = TRANSVERSE_BASELINE_Y - AMPLITUDE_PX * Math.sin(phaseAt(xPhysical, time));

    return {
      x,
      y,
      isHighlight: index === HIGHLIGHT_INDEX,
    };
  });

  const longitudinalColumns = Array.from({ length: LONGITUDINAL_PARTICLE_COUNT }, (_, index) => {
    const xPhysical = (index / (LONGITUDINAL_PARTICLE_COUNT - 1)) * STAGE.domainLength;
    const phase = phaseAt(xPhysical, time);

    return {
      equilibriumX: stageX(xPhysical),
      x: stageX(xPhysical) + LONGITUDINAL_SHIFT_PX * Math.cos(phase),
      density: 0.42 + 0.56 * (0.5 + 0.5 * Math.sin(phase)),
      isHighlight: index === HIGHLIGHT_INDEX,
    };
  });

  const compressionCenters = wrappedCenters({
    basePhysical: WAVELENGTH * (FREQUENCY * time + 0.25),
    spacing: WAVELENGTH,
    minPhysical: -WAVELENGTH,
    maxPhysical: STAGE.domainLength + WAVELENGTH,
  });

  const rarefactionCenters = wrappedCenters({
    basePhysical: WAVELENGTH * (FREQUENCY * time + 0.75),
    spacing: WAVELENGTH,
    minPhysical: -WAVELENGTH,
    maxPhysical: STAGE.domainLength + WAVELENGTH,
  });

  const highlightTransverse = transverseParticles[HIGHLIGHT_INDEX];
  const highlightLongitudinal = longitudinalColumns[HIGHLIGHT_INDEX];
  const highlightEquilibriumX = highlightLongitudinal.equilibriumX;
  const highlightLongitudinalY = LONGITUDINAL_BASELINE_Y + LONGITUDINAL_ROW_OFFSETS[1];
  const arrowStartX = stageX(0.9);
  const arrowEndX = stageX(3.4);
  const longitudinalCompressionLabelX =
    compressionCenters.find((center) => center > STAGE.padding.left + 30 && center < STAGE.width - STAGE.padding.right - 40) ??
    stageX(3.2);
  const longitudinalRarefactionLabelX =
    rarefactionCenters.find((center) => center > STAGE.padding.left + 40 && center < STAGE.width - STAGE.padding.right - 30) ??
    stageX(6.4);

  return (
    <section
      className="overflow-hidden rounded-[2rem] border border-[var(--grid-line)] bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(249,115,22,0.12),transparent_34%),var(--sim-bg)] p-4 shadow-sm md:p-6"
      style={{ overflowAnchor: 'none' }}
    >
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">Particle Motion View</p>
          <p className="mt-2 mb-0 max-w-2xl text-sm leading-7 text-[color:var(--text-muted)]">
            Both waves travel to the right. The highlighted particle shows what the medium does while the disturbance passes through it.
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <WavePanel
          title="Transverse"
          accent="var(--accent-blue)"
          description="The wave pattern moves right while the highlighted particle oscillates up and down."
        >
          <svg viewBox={`0 0 ${STAGE.width} ${STAGE.height}`} className="h-auto w-full" role="img" aria-label="Transverse wave with a highlighted particle moving up and down while the wave moves right">
            <rect x="0" y="0" width={STAGE.width} height={STAGE.height} rx="28" fill="rgba(255,255,255,0.56)" />

            <line
              x1={STAGE.padding.left}
              x2={STAGE.width - STAGE.padding.right}
              y1={TRANSVERSE_BASELINE_Y}
              y2={TRANSVERSE_BASELINE_Y}
              stroke="rgba(71,85,105,0.32)"
              strokeWidth="1.8"
              strokeDasharray="8 8"
            />

            <line x1={arrowStartX} x2={arrowEndX} y1="32" y2="32" stroke="rgba(15,23,42,0.9)" strokeWidth="2.8" strokeLinecap="round" />
            <path d={makeArrowHead(arrowEndX, 32, 'right')} fill="none" stroke="rgba(15,23,42,0.9)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
            <text x={arrowStartX} y="18" fill="rgba(15,23,42,0.78)" fontSize="13" fontWeight="700">
              wave direction
            </text>

            <path d={transversePath} fill="none" stroke="rgba(59,130,246,0.24)" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
            <path d={transversePath} fill="none" stroke="rgba(37,99,235,0.96)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />

            {transverseParticles.map((particle, index) => (
              <g key={index}>
                {particle.isHighlight ? (
                  <circle cx={particle.x} cy={particle.y} r="12" fill="rgba(249,115,22,0.16)" />
                ) : null}
                <circle
                  cx={particle.x}
                  cy={particle.y}
                  r={particle.isHighlight ? 7.2 : 5}
                  fill={particle.isHighlight ? 'rgba(249,115,22,0.98)' : 'rgba(15,23,42,0.78)'}
                  stroke={particle.isHighlight ? 'rgba(255,255,255,0.92)' : 'none'}
                  strokeWidth={particle.isHighlight ? '2.4' : undefined}
                />
              </g>
            ))}

            <line
              x1={highlightTransverse.x}
              x2={highlightTransverse.x}
              y1={TRANSVERSE_BASELINE_Y - AMPLITUDE_PX - 10}
              y2={TRANSVERSE_BASELINE_Y + AMPLITUDE_PX + 10}
              stroke="rgba(249,115,22,0.28)"
              strokeWidth="2"
              strokeDasharray="6 6"
            />



          </svg>
        </WavePanel>

        <WavePanel
          title="Longitudinal"
          accent="#0f766e"
          description="The wave pattern moves right while the highlighted particle oscillates left and right."
        >
          <svg viewBox={`0 0 ${STAGE.width} ${STAGE.height}`} className="h-auto w-full" role="img" aria-label="Longitudinal wave with a highlighted particle moving left and right while the wave moves right">
            <rect x="0" y="0" width={STAGE.width} height={STAGE.height} rx="28" fill="rgba(255,255,255,0.56)" />
            <rect
              x={STAGE.padding.left - 12}
              y={LONGITUDINAL_BASELINE_Y - 58}
              width={STAGE.width - STAGE.padding.left - STAGE.padding.right + 24}
              height="116"
              rx="30"
              fill="rgba(148,163,184,0.08)"
              stroke="rgba(148,163,184,0.28)"
              strokeWidth="1.8"
            />

            {compressionCenters.map((center, index) => (
              <rect
                key={`compression-${index}`}
                x={center - 18}
                y={LONGITUDINAL_BASELINE_Y - 54}
                width="36"
                height="108"
                rx="18"
                fill="rgba(37,99,235,0.10)"
              />
            ))}

            {rarefactionCenters.map((center, index) => (
              <rect
                key={`rarefaction-${index}`}
                x={center - 28}
                y={LONGITUDINAL_BASELINE_Y - 48}
                width="56"
                height="96"
                rx="20"
                fill="rgba(15,118,110,0.08)"
              />
            ))}

            <line x1={arrowStartX} x2={arrowEndX} y1="32" y2="32" stroke="rgba(15,23,42,0.9)" strokeWidth="2.8" strokeLinecap="round" />
            <path d={makeArrowHead(arrowEndX, 32, 'right')} fill="none" stroke="rgba(15,23,42,0.9)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
            <text x={arrowStartX} y="18" fill="rgba(15,23,42,0.78)" fontSize="13" fontWeight="700">
              wave direction
            </text>

            {LONGITUDINAL_ROW_OFFSETS.map((rowOffset, rowIndex) =>
              longitudinalColumns.map((column, columnIndex) => {
                const isHighlight = rowIndex === 1 && column.isHighlight;

                return (
                  <g key={`${rowIndex}-${columnIndex}`}>
                    {isHighlight ? <circle cx={column.x} cy={LONGITUDINAL_BASELINE_Y + rowOffset} r="12" fill="rgba(249,115,22,0.16)" /> : null}
                    <circle
                      cx={column.x}
                      cy={LONGITUDINAL_BASELINE_Y + rowOffset}
                      r={isHighlight ? 7.2 : 4.7}
                      fill={
                        isHighlight
                          ? 'rgba(249,115,22,0.98)'
                          : `rgba(15,23,42,${Math.min(column.density, 0.94).toFixed(3)})`
                      }
                      stroke={isHighlight ? 'rgba(255,255,255,0.92)' : 'none'}
                      strokeWidth={isHighlight ? '2.4' : undefined}
                    />
                  </g>
                );
              }),
            )}

            <line
              x1={highlightEquilibriumX}
              x2={highlightEquilibriumX}
              y1={LONGITUDINAL_BASELINE_Y - 48}
              y2={LONGITUDINAL_BASELINE_Y + 16}
              stroke="rgba(249,115,22,0.28)"
              strokeWidth="2"
              strokeDasharray="6 6"
            />





          </svg>
        </WavePanel>
      </div>
    </section>
  );
}
