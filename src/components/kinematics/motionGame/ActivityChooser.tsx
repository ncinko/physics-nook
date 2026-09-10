/**
 * What to do with a connected detector.
 *
 * Follows the mode-row pattern the Video Analysis lab already uses: a row of
 * toggle buttons, the selected one's hint underneath, and any settings that
 * belong to that choice below that. Nothing starts until the start button is
 * pressed, so reading the hints costs nothing.
 */

import { Button } from '../../shared/InlineControls';
import type { PracticeQuantity } from '../../../lib/kinematics/motionSession';

export type ActivityChoice = 'match' | 'practice' | 'calibrate';

const CHOICES: Array<{ value: ActivityChoice; label: string; hint: string }> = [
  {
    value: 'match',
    label: 'Match graphs',
    hint: 'Three graphs, one retry each. Your best walk on each counts, and the total can go on the leaderboard.',
  },
  {
    value: 'practice',
    label: 'Practice',
    hint: 'One graph at a time, walked as often as you like. Nothing is scored or posted.',
  },
  {
    value: 'calibrate',
    label: 'Calibrate',
    hint: 'Check the detector against a tape measure and correct it if the two disagree.',
  },
];

const QUANTITIES: Array<{ value: PracticeQuantity; label: string }> = [
  { value: 'position', label: 'Position vs time' },
  { value: 'velocity', label: 'Velocity vs time' },
  { value: 'mixed', label: 'Mixed' },
];

const START_LABEL: Record<ActivityChoice, string> = {
  match: 'Start the game',
  practice: 'Start practising',
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
  const hint = CHOICES.find((entry) => entry.value === choice)?.hint ?? '';
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

      <p className="text-sm text-[var(--text-muted)]">{hint}</p>

      {choice === 'practice' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Graphs
          </span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Which graphs to practise">
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
