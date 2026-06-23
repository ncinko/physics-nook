import { useState } from 'react';
import { ControlBar, Select, Slider } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';

interface PrefixOption {
  key: string;
  name: string;
  symbol: string;
  exponent: number;
}

const PREFIXES: PrefixOption[] = [
  { key: 'kilo', name: 'kilo', symbol: 'k', exponent: 3 },
  { key: 'centi', name: 'centi', symbol: 'c', exponent: -2 },
  { key: 'milli', name: 'milli', symbol: 'm', exponent: -3 },
  { key: 'micro', name: 'micro', symbol: '\u03bc', exponent: -6 },
  { key: 'nano', name: 'nano', symbol: 'n', exponent: -9 },
];

const POWERS = [-9, -6, -3, 0, 3];
const VIEW_WIDTH = 560;
const VIEW_HEIGHT = 130;
const AXIS_LEFT = 58;
const AXIS_RIGHT = VIEW_WIDTH - 58;
const AXIS_Y = 74;

const trimNumber = (value: string) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);

const formatDecimal = (value: number, exponent: number) => {
  if (value === 0) return '0';
  if (exponent < 0) {
    return trimNumber(value.toFixed(Math.abs(exponent) + 2));
  }
  return Math.round(value).toLocaleString('en-US');
};

const formatScientific = (value: number) => {
  if (value === 0) return '0 x 10^0';
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const coefficient = value / 10 ** exponent;
  return `${trimNumber(coefficient.toPrecision(3))} x 10^${exponent}`;
};

const powerToX = (power: number) =>
  AXIS_LEFT + ((power - POWERS[0]) / (POWERS[POWERS.length - 1] - POWERS[0])) * (AXIS_RIGHT - AXIS_LEFT);

export function PrefixScale() {
  const [prefixKey, setPrefixKey] = useState('milli');
  const [amount, setAmount] = useState(45);

  const prefix = PREFIXES.find((entry) => entry.key === prefixKey) ?? PREFIXES[2];
  const baseValue = amount * 10 ** prefix.exponent;
  const decimal = formatDecimal(baseValue, prefix.exponent);
  const scientific = formatScientific(baseValue);
  const original = `${amount} ${prefix.symbol}m`;

  return (
    <div className="not-prose mx-auto my-8 flex max-w-[620px] flex-col gap-4 text-[var(--text-primary)]">
      <p className="m-0 text-center text-sm leading-6 text-[var(--text-muted)]">
        Pick a prefix and amount. The prefix becomes a power of ten, then the result is
        rewritten in meters.
      </p>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label={`${original} equals ${decimal} meters, or ${scientific} meters`}
        className="block h-auto w-full"
      >
        <line x1={AXIS_LEFT} y1={AXIS_Y} x2={AXIS_RIGHT} y2={AXIS_Y} stroke="var(--grid-line)" strokeWidth={2} />
        {POWERS.map((power) => (
          <g key={power}>
            <line
              x1={powerToX(power)}
              y1={AXIS_Y - 10}
              x2={powerToX(power)}
              y2={AXIS_Y + 10}
              stroke={power === prefix.exponent ? 'var(--accent-blue)' : 'var(--text-muted)'}
              strokeWidth={power === prefix.exponent ? 3 : 1.5}
            />
            <text
              x={powerToX(power)}
              y={AXIS_Y + 30}
              textAnchor="middle"
              fill={power === prefix.exponent ? 'var(--accent-blue)' : 'var(--text-muted)'}
              fontSize="12"
              fontWeight={power === prefix.exponent ? 700 : 500}
            >
              10^{power}
            </text>
          </g>
        ))}
        <circle cx={powerToX(prefix.exponent)} cy={AXIS_Y} r={9} fill="var(--accent-blue)" />
        <text x={VIEW_WIDTH / 2} y={28} textAnchor="middle" fill="var(--text-primary)" fontSize="15" fontWeight={700}>
          {prefix.name} means multiply the base unit by 10^{prefix.exponent}
        </text>
      </svg>

      <ControlBar>
        <Slider label="amount" min={1} max={99} step={1} value={amount} onChange={setAmount} />
        <Select
          label="prefix"
          value={prefixKey}
          onChange={setPrefixKey}
          options={PREFIXES.map((entry) => ({
            value: entry.key,
            label: `${entry.name} (${entry.symbol})`,
          }))}
        />
      </ControlBar>

      <Readout>
        <Readout.Group label="Conversion">
          <Readout.Value label="start" value={original} />
          <Readout.Value label="replace prefix" value={`${amount} x 10^${prefix.exponent} m`} />
          <Readout.Value label="decimal" value={decimal} unit="m" />
          <Readout.Value label="scientific" value={scientific} unit="m" />
        </Readout.Group>
      </Readout>
    </div>
  );
}
