import React, { createContext, useContext, type ReactNode } from 'react';

// Flexible value readout for interactive islands. Presentation- and count-agnostic
// by design: default to the lightest form that makes the point.
//
//   variant="inline"  values flow inline with no surface — the lightest option.
//   variant="panel"   one grouped --surface-elevated container (default).
//   variant="cards"   one bordered card per value — opt-in, for dashboard-style
//                      standalone tools. Do not make this the default everywhere.
//
// Compose with <Readout.Group label> (optional) and <Readout.Value label value unit>.

export type ReadoutVariant = 'inline' | 'panel' | 'cards';

const VariantContext = createContext<ReadoutVariant>('panel');

interface ReadoutProps {
  children: ReactNode;
  variant?: ReadoutVariant;
  className?: string;
}

function ReadoutRoot({ children, variant = 'panel', className = '' }: ReadoutProps) {
  const containerByVariant: Record<ReadoutVariant, string> = {
    panel:
      'grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-3 rounded-lg border border-theme-grid bg-[var(--surface-elevated)] px-3 py-2 text-base',
    cards: 'grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3',
    inline: 'flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm',
  };
  return (
    <VariantContext.Provider value={variant}>
      <div className={`text-left text-[var(--text-primary)] ${containerByVariant[variant]} ${className}`.trim()}>
        {children}
      </div>
    </VariantContext.Provider>
  );
}

interface ReadoutGroupProps {
  label?: ReactNode;
  children: ReactNode;
}

export function ReadoutGroup({ label, children }: ReadoutGroupProps) {
  const variant = useContext(VariantContext);
  if (variant === 'inline') {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {label ? <span className="font-semibold text-[var(--text-muted)]">{label}:</span> : null}
        {children}
      </span>
    );
  }
  return (
    <section className="min-w-0">
      {label ? <div className="mb-1 font-semibold">{label}</div> : null}
      {children}
    </section>
  );
}

interface ReadoutValueProps {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
}

export function ReadoutValue({ label, value, unit }: ReadoutValueProps) {
  const variant = useContext(VariantContext);
  if (variant === 'cards') {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-theme-grid bg-[var(--surface-elevated)] px-3 py-2 shadow-sm">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</span>
        <span className="text-lg font-semibold">
          {value}
          {unit ? <span className="ml-1 text-sm font-normal text-[var(--text-muted)]">{unit}</span> : null}
        </span>
      </div>
    );
  }
  if (variant === 'inline') {
    return (
      <span className="whitespace-nowrap">
        <span className="text-[var(--text-muted)]">{label} = </span>
        {value}
        {unit ? <span className="ml-0.5 text-[var(--text-muted)]">{unit}</span> : null}
      </span>
    );
  }
  return (
    <div className="leading-relaxed">
      <span className="text-[var(--text-muted)]">{label} = </span>
      {value}
      {unit ? <span className="ml-1 text-[var(--text-muted)]">{unit}</span> : null}
    </div>
  );
}

export const Readout = Object.assign(ReadoutRoot, {
  Group: ReadoutGroup,
  Value: ReadoutValue,
});

export default Readout;
