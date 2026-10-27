import { useMemo, useState } from 'react';
import { Button } from '../../shared/InlineControls';
import { showMeasurement } from '../../../lib/kinematics/fitSummary';
import { analyzeRun, cartFitFrom, type CartRun } from '../../../lib/forces/cartRun';

/**
 * Every recorded run and what its fit found, one row each.
 *
 * Picking a row decides which run the graphs show. The label is editable in
 * place because the handout names runs by incline and trial ("C1"), and the
 * name is what ends up in the exported files and the spreadsheet columns.
 */

interface RunsPanelProps {
  runs: CartRun[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onRename: (id: number, label: string) => void;
  onDelete: (id: number) => void;
  onClearAll: () => void;
}

const cellClass = 'px-2 py-1.5 text-left align-middle';
const numberClass = `${cellClass} font-mono tabular-nums whitespace-nowrap`;

export function RunsPanel({
  runs,
  activeId,
  onSelect,
  onRename,
  onDelete,
  onClearAll,
}: RunsPanelProps) {
  const [confirmClear, setConfirmClear] = useState(false);

  const rows = useMemo(
    () =>
      runs.map((run) => {
        const analysis = analyzeRun(run);
        return { run, analysis, fit: cartFitFrom(analysis.result) };
      }),
    [runs],
  );

  if (runs.length === 0) {
    return (
      <p className="m-0 text-sm text-[var(--text-muted)]">
        No runs yet. Press Collect, release the cart, and press Stop once you have caught it.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-lg border border-[var(--grid-line)] bg-[var(--surface-elevated)]">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--grid-line)] text-[var(--text-muted)]">
              <th scope="col" className={`${cellClass} font-semibold`}>
                <span className="sr-only">Shown</span>
              </th>
              <th scope="col" className={`${cellClass} font-semibold`}>
                Run
              </th>
              <th scope="col" className={`${cellClass} font-semibold`}>
                a (m/s²)
              </th>
              <th scope="col" className={`${cellClass} font-semibold`}>
                v₀ (m/s)
              </th>
              <th scope="col" className={`${cellClass} font-semibold`}>
                Window (s)
              </th>
              <th scope="col" className={`${cellClass} font-semibold`}>
                Points
              </th>
              <th scope="col" className={`${cellClass} font-semibold`}>
                <span className="sr-only">Delete</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ run, analysis, fit }) => {
              const active = run.id === activeId;
              return (
                <tr
                  key={run.id}
                  onClick={() => onSelect(run.id)}
                  className={`cursor-pointer border-b border-[var(--grid-line)] last:border-b-0 ${
                    active ? 'bg-[var(--sim-bg)]' : ''
                  }`}
                >
                  <td className={cellClass}>
                    <input
                      type="radio"
                      name="cart-lab-active-run"
                      checked={active}
                      onChange={() => onSelect(run.id)}
                      aria-label={`Show ${run.label}`}
                      className="accent-[var(--accent-blue)]"
                    />
                  </td>
                  <td className={cellClass}>
                    <input
                      type="text"
                      value={run.label}
                      onChange={(event) => onRename(run.id, event.target.value)}
                      onFocus={() => onSelect(run.id)}
                      aria-label={`Name of ${run.label}`}
                      className="w-28 rounded-md border border-[var(--grid-line)] bg-[var(--surface-plot)] px-2 py-1 text-[var(--text-primary)]"
                    />
                  </td>
                  <td className={numberClass}>{fit ? showMeasurement(fit.a) : '—'}</td>
                  <td className={numberClass}>{fit ? showMeasurement(fit.v0) : '—'}</td>
                  <td className={numberClass}>
                    {fit && analysis.range
                      ? `${analysis.range.min.toFixed(2)} – ${analysis.range.max.toFixed(2)}`
                      : '—'}
                  </td>
                  <td className={numberClass}>{fit ? fit.pointCount : '—'}</td>
                  <td className={cellClass}>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(run.id);
                      }}
                      aria-label={`Delete ${run.label}`}
                      className="rounded px-2 py-0.5 text-lg leading-none text-[var(--text-muted)] hover:text-[var(--accent-red)]"
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

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          type="button"
          onClick={() => setConfirmClear((open) => !open)}
        >
          {confirmClear ? 'Keep my runs' : 'Clear all runs'}
        </Button>
        {confirmClear && (
          <Button
            type="button"
            onClick={() => {
              setConfirmClear(false);
              onClearAll();
            }}
          >
            Yes, delete all {runs.length}
          </Button>
        )}
      </div>
    </div>
  );
}

export default RunsPanel;
