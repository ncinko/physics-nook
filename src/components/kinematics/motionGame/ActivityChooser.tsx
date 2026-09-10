/**
 * What to do with a connected detector.
 *
 * Follows the mode-row pattern the Video Analysis lab already uses: a row of
 * toggle buttons, with any settings belonging to the selected one below. The
 * three names say what they do, so there is no explanatory line under them —
 * a caption that only restates its button is noise on a screen someone is
 * about to walk away from. Nothing starts until the start button is pressed.
 */

import { Button } from '../../shared/InlineControls';
import type { PracticeQuantity } from '../../../lib/kinematics/motionSession';

export type ActivityChoice = 'match' | 'practice' | 'calibrate';

const CHOICES: Array<{ value: ActivityChoice; label: string }> = [
  { value: 'match', label: 'Match graphs' },
  { value: 'practice', label: 'Practice' },
  { value: 'calibrate', label: 'Calibrate' },
];

const QUANTITIES: Array<{ value: PracticeQuantity; label: string }> = [
  { value: 'position', label: 'Position vs time' },
  { value: 'velocity', label: 'Velocity vs time' },
  { value: 'mixed', label: 'Mixed' },
];

const START_LABEL: Record<ActivityChoice, string> = {
  match: 'Start the game',
  practice: 'Start practicing',
  calibrate: 'Open calibration',
};

interface ActivityChooserProps {
  choice: ActivityChoice;
  onChoiceChange: (choice: ActivityChoice) => void;
  practiceQuantity: PracticeQuantity;
  onPracticeQuantityChange: (quantity: PracticeQuantity) => void;
  /** False with the simulated walker connected — there is nothing to calibrate. */
  canCalibrate: boolean;
  onStart: () => void;
}

export default function ActivityChooser({
  choice,
  onChoiceChange,
  practiceQuantity,
  onPracticeQuantityChange,
  canCalibrate,
  onStart,
}: ActivityChooserProps) {
  const calibrateBlocked = choice === 'calibrate' && !canCalibrate;

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Activity
        </span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="What to do with the detector">
          {CHOICES.map((entry) => (
            <Button
              key={entry.value}
              type="button"
              variant={entry.value === choice ? 'primary' : 'secondary'}
              aria-pressed={entry.value === choice}
              className="px-4 py-2"
              onClick={() => onChoiceChange(entry.value)}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      </div>

      {choice === 'practice' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Graphs
          </span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Which graphs to practice">
            {QUANTITIES.map((entry) => (
              <Button
                key={entry.value}
                type="button"
                variant={entry.value === practiceQuantity ? 'primary' : 'secondary'}
                aria-pressed={entry.value === practiceQuantity}
                className="px-4 py-2"
                onClick={() => onPracticeQuantityChange(entry.value)}
              >
                {entry.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {calibrateBlocked && (
        <p className="text-sm text-[var(--text-muted)]">
          The simulated walker reports true distances already, so there is nothing to calibrate.
          Connect a LabQuest and a Motion Detector.
        </p>
      )}

      <div>
        <Button className="btn-lg" disabled={calibrateBlocked} onClick={onStart}>
          {START_LABEL[choice]}
        </Button>
      </div>
    </div>
  );
}
