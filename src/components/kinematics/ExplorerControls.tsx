import type { ReactNode } from 'react';

/**
 * Shared furniture for the two graph explorers, so the position/velocity pair
 * and the velocity/acceleration pair read as the same instrument one derivative
 * apart.
 */

/**
 * Which reading of the pair of graphs is on show.
 *
 * The two are genuinely different ideas and were previously drawn on top of one
 * another, which made it hard to tell which line answered which question:
 *
 * - `slope`   the upper curve's steepness, as an average across an interval
 *             (a secant) and at a single instant (a tangent)
 * - `area`    the region under the lower curve across that same interval, which
 *             accumulates back into a change in the upper quantity
 */
export type Interpretation = 'slope' | 'area';

export function InterpretationToggle({
  value,
  onChange,
  label,
}: {
  value: Interpretation;
  onChange: (next: Interpretation) => void;
  label: string;
}) {
  const option = (key: Interpretation, text: string) => {
    const active = value === key;
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onChange(key)}
        className={[
          'px-3 py-1.5 text-sm font-semibold transition-colors',
          'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-blue)]',
          active
            ? 'bg-[var(--accent-blue)] text-white'
            : 'bg-[var(--bg-primary)] text-[var(--text-muted)] hover:text-[var(--accent-blue)]',
        ].join(' ')}
      >
        {text}
      </button>
    );
  };

  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex divide-x divide-[var(--grid-line)] overflow-hidden rounded-md border border-[var(--grid-line)] shadow-sm"
    >
      {option('slope', 'Slope')}
      {option('area', 'Area')}
    </div>
  );
}

/** One colour-coded number, sized to sit in a row beside its siblings. */
export function MetricPanel({
  label,
  value,
  accent,
}: {
  label: string;
  value: ReactNode;
  accent: string;
}) {
  return (
    <div className="border border-[var(--grid-line)] bg-[var(--bg-primary)] p-3 shadow-sm">
      <div className="text-xs font-semibold uppercase text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums" style={{ color: accent }}>
        {value}
      </div>
    </div>
  );
}
