import { Select } from '../shared/InlineControls';
import Readout from '../shared/Readout';
import { sig, type FitKind, type FitSummary, type SeriesStats } from '../../lib/sensors/analysis';

const fmt = (value: number | null | undefined, digits = 3) =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);

const FIT_OPTIONS = [
  { value: 'none', label: 'No fit' },
  { value: 'linear', label: 'Linear' },
  { value: 'quadratic', label: 'Quadratic' },
  { value: 'proportional', label: 'Proportional' },
];

interface AnalysisStripProps {
  runLabel: string;
  window: { min: number; max: number };
  unit: string;
  stats: SeriesStats | null;
  area: number | null;
  peaks: number;
  fitKind: FitKind;
  onFitKind: (kind: FitKind) => void;
  fit: FitSummary | null;
}

/**
 * Statistics and curve fitting for the chosen window of one run. Shown only in
 * Analyze mode, so the default view stays a quiet graph.
 */
export default function AnalysisStrip({
  runLabel,
  window: range,
  unit,
  stats,
  area,
  peaks,
  fitKind,
  onFitKind,
  fit,
}: AnalysisStripProps) {
  return (
    <section
      aria-label="Analysis"
      className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-3 py-2"
    >
      <p className="type-label m-0">
        {runLabel}, t from {fmt(range.min, 2)} to {fmt(range.max, 2)} s
        <span className="ml-2 font-normal normal-case text-[var(--text-muted)]">
          Drag the dashed handles to change the window.
        </span>
      </p>
      {stats ? (
        <Readout variant="inline">
          <Readout.Value label="Max" value={fmt(stats.max)} unit={unit} />
          <Readout.Value label="Min" value={fmt(stats.min)} unit={unit} />
          <Readout.Value label="Mean" value={fmt(stats.mean)} unit={unit} />
          <Readout.Value label="Std dev" value={fmt(stats.std)} unit={unit} />
          <Readout.Value label="Area" value={fmt(area)} unit={`${unit}·s`} />
          <Readout.Value label="Peaks" value={String(peaks)} />
        </Readout>
      ) : (
        <p className="type-supporting m-0 text-[var(--text-muted)]">No samples in this window.</p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Select
          label="Fit"
          value={fitKind}
          onChange={(value) => onFitKind(value as FitKind)}
          options={FIT_OPTIONS}
        />
        {fitKind !== 'none' ? (
          fit ? (
            <span className="font-mono text-sm tabular-nums">
              {fit.equation} <span className="text-[var(--text-muted)]">· R² = {sig(fit.rSquared, 4)}</span>
            </span>
          ) : (
            <span className="type-supporting text-[var(--text-muted)]">
              Not enough points in the window for this fit.
            </span>
          )
        ) : null}
      </div>
    </section>
  );
}
