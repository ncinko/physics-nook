import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

const VIEW_WIDTH = 560;
const VIEW_HEIGHT = 150;
const TRACK_LEFT = 64;
const TRACK_RIGHT = VIEW_WIDTH - 64;
const TRACK_Y = 84;
const MIN_EXPONENT = -9;
const MAX_EXPONENT = 9;
const COEFFICIENT = 6.7;
const TICK_EXPONENTS = [-9, -6, -3, 0, 3, 6, 9];

const trimNumber = (value: string) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const formatPlain = (coefficient: number, exponent: number) => {
  const value = coefficient * 10 ** exponent;
  if (exponent >= 3) return Math.round(value).toLocaleString('en-US');
  if (exponent >= 1) return trimNumber(value.toFixed(Math.max(0, 1 - exponent)));
  return trimNumber(value.toFixed(Math.abs(exponent) + 1));
};

const exponentToX = (exponent: number) =>
  TRACK_LEFT + ((exponent - MIN_EXPONENT) / (MAX_EXPONENT - MIN_EXPONENT)) * (TRACK_RIGHT - TRACK_LEFT);

const xToExponent = (x: number) => {
  const clampedX = clamp(x, TRACK_LEFT, TRACK_RIGHT);
  const fraction = (clampedX - TRACK_LEFT) / (TRACK_RIGHT - TRACK_LEFT);
  return Math.round(MIN_EXPONENT + fraction * (MAX_EXPONENT - MIN_EXPONENT));
};

const moveText = (exponent: number) => {
  if (exponent === 0) return 'The decimal point stays in the coefficient.';
  const direction = exponent > 0 ? 'right' : 'left';
  const places = Math.abs(exponent);
  return `Move the decimal ${places} place${places === 1 ? '' : 's'} ${direction}.`;
};

export function ScientificNotationSlider() {
  const [exponent, setExponent] = useState(-3);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);

  const coefficientLabel = COEFFICIENT.toFixed(1);
  const plain = formatPlain(COEFFICIENT, exponent);

  const updateExponentFromPointer = (event: PointerEvent<SVGElement>) => {
    const svg = event.currentTarget instanceof SVGSVGElement ? event.currentTarget : event.currentTarget.ownerSVGElement;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH;
    setExponent(xToExponent(x));
  };

  const handlePointerDown = (event: PointerEvent<SVGGElement>) => {
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    isDraggingRef.current = true;
    setIsDragging(true);
    updateExponentFromPointer(event);
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (isDraggingRef.current) updateExponentFromPointer(event);
  };

  const endDrag = (event: PointerEvent<SVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    isDraggingRef.current = false;
    setIsDragging(false);
  };

  const handleMarkerKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    const keySteps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowDown: -1,
      ArrowRight: 1,
      ArrowUp: 1,
      PageDown: -3,
      PageUp: 3,
    };

    if (event.key === 'Home') {
      event.preventDefault();
      setExponent(MIN_EXPONENT);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setExponent(MAX_EXPONENT);
      return;
    }

    const step = keySteps[event.key];
    if (step === undefined) return;

    event.preventDefault();
    setExponent((current) => clamp(current + step, MIN_EXPONENT, MAX_EXPONENT));
  };

  return (
    <div className="not-prose mx-auto my-8 flex max-w-[620px] flex-col gap-4 text-[var(--text-primary)]">


      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="group"
        aria-label={`${coefficientLabel} times ten to the ${exponent} equals ${plain}`}
        className="block h-auto w-full"
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <text x={VIEW_WIDTH / 2} y={32} textAnchor="middle" fill="var(--text-primary)" fontSize="20" fontWeight={700}>
          <tspan>{coefficientLabel} x 10</tspan>
          <tspan baselineShift="super" fontSize="12">
            {exponent}
          </tspan>
          <tspan> = {plain}</tspan>
        </text>
        <line x1={TRACK_LEFT} y1={TRACK_Y} x2={TRACK_RIGHT} y2={TRACK_Y} stroke="var(--grid-line)" strokeWidth={2} />
        {TICK_EXPONENTS.map((power) => (
          <g key={power}>
            <line
              x1={exponentToX(power)}
              y1={TRACK_Y - 8}
              x2={exponentToX(power)}
              y2={TRACK_Y + 8}
              stroke={power === exponent ? 'var(--accent-blue)' : 'var(--text-muted)'}
              strokeWidth={power === exponent ? 3 : 1.25}
            />
            <text
              x={exponentToX(power)}
              y={TRACK_Y + 27}
              textAnchor="middle"
              fill={power === exponent ? 'var(--accent-blue)' : 'var(--text-muted)'}
              fontSize="12"
              fontWeight={power === exponent ? 700 : 500}
            >
              {power}
            </text>
          </g>
        ))}
        <g
          role="slider"
          tabIndex={0}
          aria-label="Power of ten exponent"
          aria-valuemin={MIN_EXPONENT}
          aria-valuemax={MAX_EXPONENT}
          aria-valuenow={exponent}
          aria-valuetext={`10 to the ${exponent}`}
          onKeyDown={handleMarkerKeyDown}
          onPointerDown={handlePointerDown}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={() => {
            isDraggingRef.current = false;
            setIsDragging(false);
          }}
          style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
        >
          <circle cx={exponentToX(exponent)} cy={TRACK_Y} r={18} fill="transparent" />
          <circle cx={exponentToX(exponent)} cy={TRACK_Y} r={9} fill="var(--accent-blue)" />
        </g>
        <text x={VIEW_WIDTH / 2} y={132} textAnchor="middle" fill="var(--text-muted)" fontSize="13">
          {moveText(exponent)}
        </text>
      </svg>
    </div>
  );
}
