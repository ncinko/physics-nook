import { useState } from 'react';
import { ControlBar, Slider } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';

const VIEW_WIDTH = 560;
const VIEW_HEIGHT = 150;
const TRACK_LEFT = 64;
const TRACK_RIGHT = VIEW_WIDTH - 64;
const TRACK_Y = 84;
const MIN_EXPONENT = -9;
const MAX_EXPONENT = 9;

const trimNumber = (value: string) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);

const formatPlain = (coefficient: number, exponent: number) => {
  const value = coefficient * 10 ** exponent;
  if (exponent >= 3) return Math.round(value).toLocaleString('en-US');
  if (exponent >= 1) return trimNumber(value.toFixed(Math.max(0, 1 - exponent)));
  return trimNumber(value.toFixed(Math.abs(exponent) + 1));
};

const exponentToX = (exponent: number) =>
  TRACK_LEFT + ((exponent - MIN_EXPONENT) / (MAX_EXPONENT - MIN_EXPONENT)) * (TRACK_RIGHT - TRACK_LEFT);

const moveText = (exponent: number) => {
  if (exponent === 0) return 'The decimal point stays in the coefficient.';
  const direction = exponent > 0 ? 'right' : 'left';
  const places = Math.abs(exponent);
  return `Move the decimal ${places} place${places === 1 ? '' : 's'} ${direction}.`;
};

export function ScientificNotationSlider() {
  const [coefficient, setCoefficient] = useState(4.6);
  const [exponent, setExponent] = useState(-3);

  const coefficientLabel = coefficient.toFixed(1);
  const plain = formatPlain(coefficient, exponent);

  return (
    <div className="not-prose mx-auto my-8 flex max-w-[620px] flex-col gap-4 text-[var(--text-primary)]">
      <p className="m-0 text-center text-sm leading-6 text-[var(--text-muted)]">
        The exponent tells how far the decimal point moves
        when the value is written out normally.
      </p>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label={`${coefficientLabel} times ten to the ${exponent} equals ${plain}`}
        className="block h-auto w-full"
      >
        <text x={VIEW_WIDTH / 2} y={32} textAnchor="middle" fill="var(--text-primary)" fontSize="20" fontWeight={700}>
          {coefficientLabel} x 10^{exponent} = {plain}
        </text>
        <line x1={TRACK_LEFT} y1={TRACK_Y} x2={TRACK_RIGHT} y2={TRACK_Y} stroke="var(--grid-line)" strokeWidth={2} />
        {[-9, -6, -3, 0, 3, 6, 9].map((power) => (
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
        <circle cx={exponentToX(exponent)} cy={TRACK_Y} r={9} fill="var(--accent-blue)" />
        <text x={VIEW_WIDTH / 2} y={132} textAnchor="middle" fill="var(--text-muted)" fontSize="13">
          {moveText(exponent)}
        </text>
      </svg>

      <ControlBar>
        <Slider
          label="coefficient"
          min={1}
          max={9.9}
          step={0.1}
          value={coefficient}
          onChange={setCoefficient}
          format={(value) => value.toFixed(1)}
        />
        <Slider label="power n" min={MIN_EXPONENT} max={MAX_EXPONENT} step={1} value={exponent} onChange={setExponent} />
      </ControlBar>


    </div>
  );
}
