import { Readout } from '../../shared/Readout';
import {
  fitSummaryGroups,
  fitSummaryNote,
  fitSummaryProblem,
  type FitModel,
} from '../../../lib/kinematics/fitSummary';
import type { QuantityKey } from '../../../lib/kinematics/videoAnalysis';
import type { FitResult } from '../../../lib/math/leastSquares';

/**
 * Reads a fit back as physics rather than as anonymous coefficients: a line
 * through a velocity-time graph has an acceleration for a slope, and a parabola
 * through a position-time graph has half of one for its leading coefficient.
 *
 * What the reading is *compared* to is left to the student. Naming an expected
 * answer here would turn a measurement into a box to tick.
 *
 * All of the wording and rounding lives in `lib/kinematics/fitSummary`, because
 * the saved plot image prints the same numbers underneath the graph and the two
 * must not be able to disagree.
 */

interface FitPanelProps {
  result: FitResult | null;
  model: FitModel;
  xQuantity: QuantityKey;
  yQuantity: QuantityKey;
  seriesLabel: string;
}

export function FitPanel({ result, model, xQuantity, yQuantity, seriesLabel }: FitPanelProps) {
  const input = { result, model, xQuantity, yQuantity, seriesLabel };
  const problem = fitSummaryProblem(input);
  if (problem) {
    const failed = model !== 'none' && result !== null;
    return (
      <p
        className={`m-0 text-sm ${failed ? 'text-[var(--accent-red)]' : 'text-[var(--text-muted)]'}`}
      >
        {problem}
      </p>
    );
  }

  const groups = fitSummaryGroups(input);
  const note = fitSummaryNote(result);

  return (
    <div className="flex flex-col gap-2">
      <Readout>
        {groups.map((group) => (
          <Readout.Group key={group.label} label={group.label}>
            {group.values.map((value) => (
              <Readout.Value
                key={value.label}
                label={value.label}
                value={value.value}
                unit={value.unit}
              />
            ))}
          </Readout.Group>
        ))}
      </Readout>

      {note && <p className="m-0 text-xs leading-5 text-[var(--text-muted)]">{note}</p>}
    </div>
  );
}

export default FitPanel;
