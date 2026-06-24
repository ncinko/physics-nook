import { useState } from 'react';
import { ControlBar, Slider, Select } from '../shared/InlineControls';
import {
  combine,
  combineHighLow,
  relativeUncertainty,
  type Measurement,
  type UncertaintyOp,
} from '../../lib/measurement/uncertainty';

// Inline "high–low machine": recompute a result at every extreme of its inputs,
// take the smallest and largest, and read the doubt off the bracket. Then the two
// algebra shortcuts (absolute add for + −, relative add for × ÷) are shown to
// land on the same answer.

const VIEW_WIDTH = 560;
const VIEW_HEIGHT = 120;
const PAD_X = 60;
const BASELINE = 64;

const OP_SYMBOL: Record<UncertaintyOp, string> = {
  add: '+',
  subtract: '−',
  multiply: '×',
  divide: '÷',
};

const num = (value: number) => value.toFixed(2);
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

export function PropagationBracket() {
  const [aValue, setAValue] = useState(6);
  const [aUnc, setAUnc] = useState(0.4);
  const [bValue, setBValue] = useState(3);
  const [bUnc, setBUnc] = useState(0.2);
  const [op, setOp] = useState<UncertaintyOp>('multiply');

  const a: Measurement = { value: aValue, uncertainty: aUnc };
  const b: Measurement = { value: bValue, uncertainty: bUnc };
  const bracket = combineHighLow(a, b, op);
  const rule = combine(a, b, op);
  const isAdditive = op === 'add' || op === 'subtract';

  const symbol = OP_SYMBOL[op];

  // The four extreme combinations, with their computed results.
  const aLow = a.value - a.uncertainty;
  const aHigh = a.value + a.uncertainty;
  const bLow = b.value - b.uncertainty;
  const bHigh = b.value + b.uncertainty;
  const apply = (x: number, y: number) =>
    op === 'add' ? x + y : op === 'subtract' ? x - y : op === 'multiply' ? x * y : x / y;
  const cornerRows = [
    { x: aLow, y: bLow },
    { x: aLow, y: bHigh },
    { x: aHigh, y: bLow },
    { x: aHigh, y: bHigh },
  ].map(({ x, y }) => ({ x, y, result: apply(x, y) }));

  const domainMin = Math.min(bracket.low, bracket.value);
  const domainMax = Math.max(bracket.high, bracket.value);
  const span = domainMax - domainMin || 1;
  const pad = span * 0.18;
  const lo = domainMin - pad;
  const hi = domainMax + pad;
  const toX = (value: number) => PAD_X + ((value - lo) / (hi - lo)) * (VIEW_WIDTH - PAD_X * 2);

  return (
    <div className="not-prose mx-auto my-8 flex max-w-[600px] flex-col gap-4 text-[var(--text-primary)]">
      <p className="m-0 text-center text-sm leading-6 text-[var(--text-muted)]">
        Combine two measurements. The bracket spans every plausible result — its half-width is the
        uncertainty you carry forward.
      </p>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label={`Result ${num(bracket.value)} ranges from ${num(bracket.low)} to ${num(bracket.high)}`}
        className="block h-auto w-full"
      >
        {/* plausible-result band */}
        <rect
          x={toX(bracket.low)}
          y={BASELINE - 14}
          width={Math.max(0, toX(bracket.high) - toX(bracket.low))}
          height={28}
          fill="var(--accent-purple)"
          opacity={0.22}
          rx={4}
        />
        <line x1={PAD_X} y1={BASELINE} x2={VIEW_WIDTH - PAD_X} y2={BASELINE} stroke="var(--text-muted)" strokeWidth={1.5} />

        {[
          { value: bracket.low, label: `low ${num(bracket.low)}`, color: 'var(--text-muted)' },
          { value: bracket.high, label: `high ${num(bracket.high)}`, color: 'var(--text-muted)' },
          { value: bracket.value, label: `best ${num(bracket.value)}`, color: 'var(--accent-red)' },
        ].map(({ value, label, color }) => (
          <g key={label}>
            <line x1={toX(value)} y1={BASELINE - 16} x2={toX(value)} y2={BASELINE + 16} stroke={color} strokeWidth={2} />
            <text x={toX(value)} y={BASELINE + 32} textAnchor="middle" fill={color} fontSize="12" fontWeight={600}>
              {label}
            </text>
          </g>
        ))}
      </svg>

      {/* the four extremes, smallest and largest highlighted */}
      <div className="rounded-lg border border-theme-grid bg-[var(--surface-elevated)] px-4 py-3 font-mono text-sm leading-7">
        {cornerRows.map(({ x, y, result }, index) => {
          const isLow = Math.abs(result - bracket.low) < 1e-9;
          const isHigh = Math.abs(result - bracket.high) < 1e-9;
          const tag = isLow ? ' ← low' : isHigh ? ' ← high' : '';
          const color = isLow || isHigh ? 'var(--accent-purple)' : 'var(--text-muted)';
          return (
            <div key={index} style={{ color, fontWeight: tag ? 700 : 400 }}>
              {num(x)} {symbol} {num(y)} = {num(result)}
              {tag}
            </div>
          );
        })}
      </div>

      <ControlBar>
        <Slider label="A" min={2} max={10} step={0.5} value={aValue} onChange={setAValue} format={num} />
        <Slider label="± on A" min={0.1} max={1} step={0.1} value={aUnc} onChange={setAUnc} format={(v) => v.toFixed(1)} />
        <Select
          label="operation"
          value={op}
          onChange={(value) => setOp(value as UncertaintyOp)}
          options={[
            { value: 'add', label: 'A + B' },
            { value: 'subtract', label: 'A − B' },
            { value: 'multiply', label: 'A × B' },
            { value: 'divide', label: 'A ÷ B' },
          ]}
        />
        <Slider label="B" min={2} max={10} step={0.5} value={bValue} onChange={setBValue} format={num} />
        <Slider label="± on B" min={0.1} max={1} step={0.1} value={bUnc} onChange={setBUnc} format={(v) => v.toFixed(1)} />
      </ControlBar>

      
    </div>
  );
}
