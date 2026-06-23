import { useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ControlBar, Button, Select } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';
import {
  formatMeasurement,
  relativeUncertainty,
  type Measurement,
} from '../../lib/measurement/uncertainty';

// Inline illustration for "every measurement is best ± a doubt". You drag the
// reading along the ruler yourself, and it snaps to the marks and the halfway
// points between them — the only places a real reading can land. It turns green
// when your ± band actually covers the object's true edge, which is also a first
// taste of the error-bar test later on the page: the reading is reasonable
// exactly when the true value sits inside your stated uncertainty.

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 250;
const MARGIN_LEFT = 30;
const PLOT_WIDTH = VIEW_WIDTH - MARGIN_LEFT * 2;
const CM_MAX = 10;
const PX_PER_CM = PLOT_WIDTH / CM_MAX;
const toX = (cm: number) => MARGIN_LEFT + cm * PX_PER_CM;

const OBJECT_TOP = 70;
const OBJECT_BOTTOM = 118;
const RULER_TOP = 150;
const RULER_BOTTOM = 205;
const HANDLE_TOP = OBJECT_TOP - 18;

const RESOLUTIONS = {
  cm: { division: 1, label: 'Centimeter ruler — 1 cm marks' },
  mm: { division: 0.1, label: 'Millimeter ruler — 1 mm marks' },
} as const;

type ResolutionKey = keyof typeof RESOLUTIONS;

const randomLength = () => Math.round((1 + Math.random() * 8.4) * 100) / 100;

export function UncertainRuler() {
  const [trueLength, setTrueLength] = useState(4.3);
  const [resolution, setResolution] = useState<ResolutionKey>('cm');
  const [reading, setReading] = useState(1);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const division = RESOLUTIONS[resolution].division;
  const halfDivision = division / 2;
  const step = halfDivision; // marks and the halfway points between them
  const snap = (value: number) => {
    const snapped = Math.round(Math.min(CM_MAX, Math.max(0, value)) / step) * step;
    return Math.round(snapped * 1e6) / 1e6;
  };

  const measurement: Measurement = { value: reading, uncertainty: halfDivision };
  const relativePercent = relativeUncertainty(measurement) * 100;
  // Reasonable when the true edge falls inside the reading's ± band.
  const reasonable = Math.abs(reading - trueLength) < halfDivision;
  const readingColor = reasonable ? 'var(--accent-green)' : 'var(--text-muted)';
  const bandColor = reasonable ? 'var(--accent-green)' : 'var(--accent-purple)';

  const readingFromClientX = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return reading;
    const rect = svg.getBoundingClientRect();
    const scale = VIEW_WIDTH / rect.width;
    const svgX = (clientX - rect.left) * scale;
    return snap((svgX - MARGIN_LEFT) / PX_PER_CM);
  };

  const startDrag = (event: ReactPointerEvent<SVGRectElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    setReading(readingFromClientX(event.clientX));
  };
  const moveDrag = (event: ReactPointerEvent<SVGRectElement>) => {
    if (!dragging) return;
    setReading(readingFromClientX(event.clientX));
  };
  const endDrag = () => setDragging(false);

  const onKeyDown = (event: ReactKeyboardEvent<SVGGElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      setReading((r) => snap(r + step));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      setReading((r) => snap(r - step));
    }
  };

  const changeResolution = (key: ResolutionKey) => {
    const nextStep = RESOLUTIONS[key].division / 2;
    setReading((r) => Math.round(Math.round(r / nextStep) * nextStep * 1e6) / 1e6);
    setResolution(key);
  };

  const newObject = () => setTrueLength(randomLength());

  const tickCount = Math.round(CM_MAX / division);
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => {
    const cm = index * division;
    return { cm, isMajor: Math.abs(cm - Math.round(cm)) < 1e-9 };
  });
  // On the coarse ruler, draw the halfway snap targets so "between the marks" is
  // visible; on the fine ruler they are too dense, so the snapping speaks for itself.
  const halfMarks =
    division >= 1
      ? Array.from({ length: CM_MAX }, (_, index) => index + 0.5)
      : [];

  return (
    <div className="not-prose mx-auto my-8 flex max-w-[600px] flex-col gap-4 text-[var(--text-primary)]">
      <p className="m-0 text-center text-sm leading-6 text-[var(--text-muted)]">
        Drag the <span className="font-semibold">reading</span> along the ruler to measure the object.
        It snaps to a mark or halfway between two — it turns{' '}
        <span className="font-semibold text-[var(--accent-green)]">green</span> when your ± band covers
        the true edge.
      </p>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label={`Object measured at ${formatMeasurement(measurement)} centimeters; reading is ${reasonable ? 'reasonable' : 'not yet reasonable'}`}
        className="block h-auto w-full select-none"
        style={{ touchAction: 'none' }}
      >
        {/* doubt window: reading ± half a division, centered on the handle */}
        <rect
          x={toX(reading - halfDivision)}
          y={OBJECT_TOP - 10}
          width={division * PX_PER_CM}
          height={RULER_TOP - (OBJECT_TOP - 10) + 16}
          fill={bandColor}
          opacity={0.18}
        />

        {/* the object whose right edge is its true length */}
        <rect
          x={toX(0)}
          y={OBJECT_TOP}
          width={Math.max(0, toX(trueLength) - toX(0))}
          height={OBJECT_BOTTOM - OBJECT_TOP}
          rx={6}
          fill="var(--accent-blue)"
          opacity={0.55}
        />
        <text
          x={(toX(0) + toX(trueLength)) / 2}
          y={(OBJECT_TOP + OBJECT_BOTTOM) / 2 + 4}
          textAnchor="middle"
          fill="var(--text-primary)"
          fontSize="13"
          fontWeight={600}
        >
          object
        </text>

        {/* ruler body */}
        <rect
          x={toX(0)}
          y={RULER_TOP}
          width={PLOT_WIDTH}
          height={RULER_BOTTOM - RULER_TOP}
          rx={4}
          fill="var(--surface-elevated)"
          stroke="var(--grid-line)"
          strokeWidth={1}
        />
        {halfMarks.map((cm) => (
          <line
            key={`half-${cm}`}
            x1={toX(cm)}
            y1={RULER_TOP}
            x2={toX(cm)}
            y2={RULER_TOP + 11}
            stroke="var(--text-muted)"
            strokeWidth={1}
            opacity={0.55}
          />
        ))}
        {ticks.map(({ cm, isMajor }) => {
          const x = toX(cm);
          const length = isMajor ? 18 : 8;
          return (
            <g key={cm}>
              <line
                x1={x}
                y1={RULER_TOP}
                x2={x}
                y2={RULER_TOP + length}
                stroke="var(--text-muted)"
                strokeWidth={isMajor ? 1.5 : 1}
              />
              {isMajor && (
                <text x={x} y={RULER_TOP + 36} textAnchor="middle" fill="var(--text-muted)" fontSize="12">
                  {Math.round(cm)}
                </text>
              )}
            </g>
          );
        })}
        <text x={toX(CM_MAX) - 4} y={RULER_BOTTOM - 8} textAnchor="end" fill="var(--text-muted)" fontSize="11">
          cm
        </text>

        {/* the draggable reading handle */}
        <g
          tabIndex={0}
          role="slider"
          aria-label="Ruler reading"
          aria-valuemin={0}
          aria-valuemax={CM_MAX}
          aria-valuenow={reading}
          aria-valuetext={`${formatMeasurement(measurement)} centimeters`}
          onKeyDown={onKeyDown}
          style={{ cursor: dragging ? 'grabbing' : 'grab', outline: 'none' }}
        >
          <line
            x1={toX(reading)}
            y1={HANDLE_TOP}
            x2={toX(reading)}
            y2={RULER_TOP + 20}
            stroke={readingColor}
            strokeWidth={2.5}
          />
          <circle cx={toX(reading)} cy={HANDLE_TOP} r={8} fill={readingColor} />
          <text x={toX(reading)} y={HANDLE_TOP - 12} textAnchor="middle" fill={readingColor} fontSize="12" fontWeight={700}>
            reading
          </text>
        </g>

        {/* transparent hit area: drag (or click) anywhere to place the reading */}
        <rect
          x={toX(0)}
          y={HANDLE_TOP - 10}
          width={PLOT_WIDTH}
          height={RULER_TOP + 24 - (HANDLE_TOP - 10)}
          fill="transparent"
          style={{ cursor: dragging ? 'grabbing' : 'grab' }}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      </svg>

      <ControlBar>
        <Select
          label="Ruler"
          value={resolution}
          onChange={(value) => changeResolution(value as ResolutionKey)}
          options={[
            { value: 'cm', label: RESOLUTIONS.cm.label },
            { value: 'mm', label: RESOLUTIONS.mm.label },
          ]}
        />
        <Button variant="secondary" onClick={newObject}>
          New object
        </Button>
      </ControlBar>

      <Readout>
        <Readout.Group label="Your measurement">
          <Readout.Value label="L" value={formatMeasurement(measurement)} unit="cm" />
          <Readout.Value label="relative uncertainty" value={`${relativePercent.toFixed(1)}%`} />
          <Readout.Value
            label="reading"
            value={
              <span style={{ color: readingColor, fontWeight: 600 }}>
                {reasonable ? '✓ reasonable' : 'keep adjusting'}
              </span>
            }
          />
        </Readout.Group>
      </Readout>
    </div>
  );
}
