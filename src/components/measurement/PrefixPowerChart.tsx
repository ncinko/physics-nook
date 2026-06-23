import { useState } from 'react';

interface PrefixExample {
  expression: string;
  note: string;
}

interface PrefixEntry {
  id: string;
  name: string;
  symbol: string;
  power: string;
  meaning: string;
  examples: PrefixExample[];
}

const PREFIXES: PrefixEntry[] = [
  {
    id: 'kilo',
    name: 'kilo',
    symbol: 'k',
    power: '10^3',
    meaning: 'Multiply the unit by one thousand.',
    examples: [
      { expression: '5 km = 5 x 10^3 m = 5000 m', note: 'A 5K race is 5 kilometers long.' },
      { expression: '17 kJ = 17 x 10^3 J = 17000 J', note: 'A gram of sugar stores about 17 kJ of food energy, which nutrition labels call about 4 Calories.' },
      { expression: '4 kcd = 4 x 10^3 cd = 4000 cd', note: 'Bright vehicle headlights and searchlights are often described in kilocandelas.' },
    ],
  },
  {
    id: 'centi',
    name: 'centi',
    symbol: 'c',
    power: '10^-2',
    meaning: 'Multiply the unit by one hundredth.',
    examples: [
      { expression: '15 cm = 15 x 10^-2 m = 0.15 m', note: 'A typical smartphone is about 15 cm tall.' },
      { expression: '250 cN = 250 x 10^-2 N = 2.5 N', note: 'That is about the weight of a 250 g apple on Earth.' },
    ],
  },
  {
    id: 'milli',
    name: 'milli',
    symbol: 'm',
    power: '10^-3',
    meaning: 'Multiply the unit by one thousandth.',
    examples: [
      { expression: '250 ms = 250 x 10^-3 s = 0.250 s', note: 'A quick human reaction time is often around 250 ms.' },
      { expression: '20 mA = 20 x 10^-3 A = 0.020 A', note: 'A small indicator LED often runs on about 10 to 20 mA.' },
      { expression: '15 mK = 15 x 10^-3 K = 0.015 K', note: 'Climate and lab sensors can resolve temperature changes of only a few millikelvin.' },
    ],
  },
  {
    id: 'micro',
    name: 'micro',
    symbol: '\u03bc',
    power: '10^-6',
    meaning: 'Multiply the unit by one millionth.',
    examples: [
      { expression: '50 \u03bcs = 50 x 10^-6 s = 0.000050 s', note: 'An ultrasonic distance sensor pulse can be timed in microseconds.' },
      { expression: '2 \u03bcmol = 2 x 10^-6 mol', note: 'Chemistry labs often dose reagents or nutrients in micromoles.' },
      { expression: '100 \u03bcm = 100 x 10^-6 m = 0.000100 m', note: 'A human hair is roughly 50 to 100 micrometers thick.' },
    ],
  },
  {
    id: 'nano',
    name: 'nano',
    symbol: 'n',
    power: '10^-9',
    meaning: 'Multiply the unit by one billionth.',
    examples: [
      { expression: '500 nm = 500 x 10^-9 m = 5.00 x 10^-7 m', note: 'Green-blue visible light has a wavelength near 500 nm.' },
      { expression: '30 ns = 30 x 10^-9 s = 3.0 x 10^-8 s', note: 'Light travels about 9 meters in 30 ns.' },
    ],
  },
];

export function PrefixPowerChart() {
  const [selectedId, setSelectedId] = useState('milli');
  const selected = PREFIXES.find((prefix) => prefix.id === selectedId) ?? PREFIXES[2]!;

  return (
    <div className="not-prose mx-auto my-8 max-w-[760px] text-[var(--text-primary)]">
      <p className="m-0 mb-4 text-center text-sm leading-6 text-[var(--text-muted)]">
        Click a prefix to see how its power of ten shows up across different SI units.
      </p>

      <div className="overflow-x-auto">
        <table className="mx-auto min-w-[28rem] border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr>
              <th className="border-b border-theme-grid px-4 py-3 font-semibold text-[var(--text-muted)]">Prefix</th>
              <th className="border-b border-theme-grid px-4 py-3 font-semibold text-[var(--text-muted)]">Symbol</th>
              <th className="border-b border-theme-grid px-4 py-3 font-semibold text-[var(--text-muted)]">Power</th>
            </tr>
          </thead>
          <tbody>
            {PREFIXES.map((prefix) => {
              const isSelected = selected.id === prefix.id;
              return (
                <tr key={prefix.id}>
                  <td colSpan={3} className="border-b border-theme-grid p-0">
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedId(prefix.id)}
                      className={[
                        'grid w-full grid-cols-[minmax(8rem,1fr)_minmax(5rem,0.7fr)_minmax(7rem,1fr)] text-left transition-colors outline-none',
                        isSelected
                          ? 'bg-[color:color-mix(in_srgb,var(--accent-blue)_14%,transparent)]'
                          : 'hover:bg-[color:color-mix(in_srgb,var(--accent-blue)_8%,transparent)] focus-visible:bg-[color:color-mix(in_srgb,var(--accent-blue)_8%,transparent)]',
                      ].join(' ')}
                    >
                      <span className="px-4 py-3 font-medium">{prefix.name}</span>
                      <span className="px-4 py-3 font-mono">{prefix.symbol}</span>
                      <span className="px-4 py-3 font-mono">{prefix.power}</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section
        aria-live="polite"
        className="mt-4 rounded-lg border border-theme-grid bg-[var(--surface-elevated)] px-4 py-4 shadow-sm"
      >
        <h3 className="m-0 text-base font-semibold">
          {selected.name} ({selected.symbol}) = {selected.power}
        </h3>
        <p className="m-0 mt-2 text-sm leading-6 text-[var(--text-muted)]">{selected.meaning}</p>
        <ul className="m-0 mt-3 grid list-none gap-3 p-0">
          {selected.examples.map((example) => (
            <li key={example.expression} className="rounded-md border border-theme-grid bg-[var(--bg-primary)] px-3 py-2">
              <div className="font-mono text-sm">{example.expression}</div>
              <div className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{example.note}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
