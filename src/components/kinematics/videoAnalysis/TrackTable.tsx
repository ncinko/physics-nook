import {
  columnLabel,
  sampleValue,
  type ColumnKey,
  type DerivedSample,
} from '../../../lib/kinematics/videoAnalysis';
import { fixed } from '../../../utils/format';

/**
 * The measured data set, as numbers. Clicking a row jumps the video back to
 * that frame so a misplaced point can be found and re-marked in one step; the
 * cross deletes it outright.
 */

interface TrackTableProps {
  label: string;
  color: string;
  samples: DerivedSample[];
  columns: readonly ColumnKey[];
  highlightedPointIndex: number | null;
  onSelectRow: (index: number) => void;
  onDeleteRow: (index: number) => void;
}

const cell = (sample: DerivedSample, column: ColumnKey) => {
  const value = sampleValue(sample, column);
  if (value === null || !Number.isFinite(value)) return '—';
  if (column === 'frame') return String(Math.round(value));
  if (column === 'px' || column === 'py') return fixed(value, 1);
  if (column === 'time') return fixed(value, 4);
  return fixed(value, 3);
};

export function TrackTable({
  label,
  color,
  samples,
  columns,
  highlightedPointIndex,
  onSelectRow,
  onDeleteRow,
}: TrackTableProps) {
  if (samples.length === 0) {
    return (
      <p className="m-0 px-1 py-6 text-center text-sm text-[var(--text-muted)]">
        No points yet. Set the scale, then click the moving object on each frame.
      </p>
    );
  }

  return (
    // Capped against the viewport as well as an absolute height: in fullscreen
    // on a short screen a fixed cap still eats the controls below it.
    <div className="max-h-[min(18rem,32vh)] overflow-auto rounded-lg border border-theme-grid">
      <table className="w-full min-w-[30rem] border-collapse text-sm">
        <caption className="sr-only">
          Measured positions and derived velocities for {label}. Selecting a row moves the video to
          that frame.
        </caption>
        <thead className="sticky top-0 z-10 bg-[var(--surface-elevated)]">
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="border-b border-theme-grid px-2 py-1.5 text-right font-semibold whitespace-nowrap"
              >
                {columnLabel(column)}
              </th>
            ))}
            <th scope="col" className="border-b border-theme-grid px-2 py-1.5">
              <span className="sr-only">Delete point</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {samples.map((sample, index) => {
            const selected = index === highlightedPointIndex;
            return (
              <tr
                key={`${sample.time}-${index}`}
                onClick={() => onSelectRow(index)}
                className="cursor-pointer transition-colors hover:bg-[color-mix(in_srgb,var(--accent-blue)_10%,transparent)]"
                style={
                  selected
                    ? { background: `color-mix(in srgb, ${color} 16%, transparent)` }
                    : undefined
                }
              >
                {columns.map((column) => (
                  <td
                    key={column}
                    className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap"
                  >
                    {cell(sample, column)}
                  </td>
                ))}
                <td className="px-1 py-1 text-center">
                  <button
                    type="button"
                    aria-label={`Delete the point at frame ${sample.frame}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteRow(index);
                    }}
                    className="rounded px-1.5 text-[var(--text-muted)] transition-colors hover:text-[var(--accent-red)]"
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default TrackTable;
