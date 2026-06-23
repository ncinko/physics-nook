import { useState } from 'react';

interface SIUnit {
  id: string;
  quantity: string;
  unit: string;
  symbol: string;
  modernDefinition: string;
  simplifiedDefinition: string;
}

const UNITS: SIUnit[] = [
  {
    id: 'length',
    quantity: 'Length',
    unit: 'meter',
    symbol: 'm',
    modernDefinition:
      'Fixed by setting the speed of light in vacuum to exactly 299,792,458 meters per second; one meter is the path light travels in 1/299,792,458 of a second.',
    simplifiedDefinition: 'Most doors are about 2 meters high.',
  },
  {
    id: 'mass',
    quantity: 'Mass',
    unit: 'kilogram',
    symbol: 'kg',
    modernDefinition:
      'Fixed by setting the Planck constant to exactly 6.62607015 x 10^-34 joule seconds.',
    simplifiedDefinition: 'A liter bottle of water has a mass of about 1 kilogram.',
  },
  {
    id: 'time',
    quantity: 'Time',
    unit: 'second',
    symbol: 's',
    modernDefinition:
      'Fixed by setting the caesium-133 hyperfine transition frequency to exactly 9,192,631,770 hertz.',
    simplifiedDefinition: 'One second is about one steady clock tick, or roughly the spacing of a calm heartbeat.',
  },
  {
    id: 'current',
    quantity: 'Electric current',
    unit: 'ampere',
    symbol: 'A',
    modernDefinition:
      'Fixed by setting the elementary charge to exactly 1.602176634 x 10^-19 coulombs, with one coulomb equal to one ampere second.',
    simplifiedDefinition: 'Many small USB chargers send current on the order of 1 to 3 amperes.',
  },
  {
    id: 'temperature',
    quantity: 'Temperature',
    unit: 'kelvin',
    symbol: 'K',
    modernDefinition:
      'Fixed by setting the Boltzmann constant to exactly 1.380649 x 10^-23 joules per kelvin.',
    simplifiedDefinition:
      'A change of 1 kelvin is the same size as a change of 1 Celsius degree; room temperature is about 293 K.',
  },
  {
    id: 'amount',
    quantity: 'Amount of substance',
    unit: 'mole',
    symbol: 'mol',
    modernDefinition:
      'One mole contains exactly 6.02214076 x 10^23 specified elementary entities, the fixed Avogadro number.',
    simplifiedDefinition:
      'A mole is a huge counting unit, like a dozen but much larger; 18 grams of water is about 1 mole of water molecules.',
  },
  {
    id: 'luminous-intensity',
    quantity: 'Luminous intensity',
    unit: 'candela',
    symbol: 'cd',
    modernDefinition:
      'Fixed by setting the luminous efficacy of 540 x 10^12 hertz monochromatic radiation to exactly 683 lumens per watt.',
    simplifiedDefinition: 'A common candle flame is roughly 1 candela in brightness in a particular direction.',
  },
];

export function SIUnitDefinitions() {
  const [selectedId, setSelectedId] = useState('length');
  const selected = UNITS.find((unit) => unit.id === selectedId) ?? UNITS[0]!;

  return (
    <div className="not-prose mx-auto my-8 max-w-[760px] text-[var(--text-primary)]">
      <p className="m-0 mb-4 text-center text-sm leading-6 text-[var(--text-muted)]">
        Click a row to see how the modern SI defines that unit.
      </p>

      <div className="overflow-x-auto">
        <table className="mx-auto min-w-[34rem] border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr>
              <th className="border-b border-theme-grid px-4 py-3 font-semibold text-[var(--text-muted)]">Quantity</th>
              <th className="border-b border-theme-grid px-4 py-3 font-semibold text-[var(--text-muted)]">SI unit</th>
              <th className="border-b border-theme-grid px-4 py-3 font-semibold text-[var(--text-muted)]">Symbol</th>
            </tr>
          </thead>
          <tbody>
            {UNITS.map((unit) => {
              const isSelected = selected.id === unit.id;
              return (
                <tr key={unit.id}>
                  <td colSpan={3} className="border-b border-theme-grid p-0">
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedId(unit.id)}
                      className={[
                        'grid w-full grid-cols-[minmax(10rem,1.4fr)_minmax(7rem,1fr)_minmax(4rem,0.5fr)] text-left transition-colors outline-none',
                        isSelected
                          ? 'bg-[color:color-mix(in_srgb,var(--accent-blue)_14%,transparent)]'
                          : 'hover:bg-[color:color-mix(in_srgb,var(--accent-blue)_8%,transparent)] focus-visible:bg-[color:color-mix(in_srgb,var(--accent-blue)_8%,transparent)]',
                      ].join(' ')}
                    >
                      <span className="px-4 py-3 font-medium">{unit.quantity}</span>
                      <span className="px-4 py-3">{unit.unit}</span>
                      <span className="px-4 py-3 font-mono">{unit.symbol}</span>
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
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="m-0 text-base font-semibold">
            {selected.unit} ({selected.symbol})
          </h3>
          <a
            href="https://www.bipm.org/en/measurement-units/si-base-units"
            className="text-sm font-medium text-[var(--accent-blue)] no-underline hover:underline"
          >
            BIPM SI base units
          </a>
        </div>
        <dl className="mt-3 grid gap-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Modern definition</dt>
            <dd className="m-0 mt-1 leading-7">{selected.modernDefinition}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">In everyday terms</dt>
            <dd className="m-0 mt-1 leading-7">{selected.simplifiedDefinition}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
