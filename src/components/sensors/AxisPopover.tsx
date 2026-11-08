import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '../shared/InlineControls';
import { withBound, zoomRange, type AxisRange } from '../../lib/sensors/axis';

const fmt = (value: number) => (Number.isFinite(value) ? value.toFixed(3) : '');

interface AxisPopoverProps {
  axis: 'x' | 'y';
  label: string;
  unit: string;
  range: AxisRange;
  manual: boolean;
  onChange: (range: AxisRange | null) => void;
  onClose: () => void;
  className?: string;
}

/**
 * Range controls for one axis, opened from its label on the plot. Closes on
 * Escape, on a click anywhere outside, or on a second click of the label.
 * A half-typed number sits in a draft until Enter or blur commits it, so
 * typing a minus sign does not collapse the plot.
 */
export default function AxisPopover({
  axis,
  label,
  unit,
  range,
  manual,
  onChange,
  onClose,
  className = '',
}: AxisPopoverProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<{ which: 'min' | 'max'; text: string } | null>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (rootRef.current?.contains(target)) return;
      // The label toggles the popover itself; closing here would reopen it.
      if (target?.closest(`[data-axis-label="${axis}"]`)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onClose();
      document.querySelector<SVGGElement>(`[data-axis-label="${axis}"]`)?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    rootRef.current?.querySelector('input')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [axis, onClose]);

  const commit = () => {
    if (draft) {
      const next = withBound(range, draft.which, draft.text);
      if (next) onChange(next);
    }
    setDraft(null);
  };

  const field = (which: 'min' | 'max') => (
    <input
      type="text"
      inputMode="decimal"
      aria-label={`${label} axis ${which}`}
      value={draft?.which === which ? draft.text : fmt(range[which])}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft({ which, text: event.target.value })}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setDraft(null);
      }}
      className="w-20 rounded-md border border-[var(--grid-line)] bg-[var(--surface-plot)] px-2 py-1 text-right font-mono text-sm tabular-nums text-[var(--text-primary)]"
    />
  );

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={`${label} axis range`}
      className={`absolute z-10 flex flex-col gap-2 rounded-[var(--radius-control)] border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-3 shadow-md ${className}`.trim()}
    >
      <p className="type-label m-0">
        {label} range ({unit})
      </p>
      <div className="flex items-center gap-1.5 text-sm">
        {field('min')}
        <span className="text-[var(--text-muted)]">to</span>
        {field('max')}
      </div>
      <div className="flex items-center gap-1.5">
        <Button variant="secondary" aria-label={`Zoom in on ${label}`} onClick={() => onChange(zoomRange(range, 0.5))}>
          <ZoomIn aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button variant="secondary" aria-label={`Zoom out on ${label}`} onClick={() => onChange(zoomRange(range, 2))}>
          <ZoomOut aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button variant="secondary" disabled={!manual} onClick={() => onChange(null)}>
          Autoscale
        </Button>
      </div>
    </div>
  );
}
