/**
 * The card that sits on the plot between walks.
 *
 * It is on the plot rather than under it because whoever reads it is about to
 * walk away from the screen: it should be the biggest thing in view and in the
 * place the eye is already resting. Recording is the one phase with no overlay
 * — nothing should cover the trace while it is being drawn.
 *
 * Everything here is sized against the plot's container query, so the card
 * grows with the plot in fullscreen. The mark and the live reading are the two
 * numbers a walker compares, so in `arming` they sit side by side at the same
 * size; a layout that wrapped mid-hold would be worse than two smaller numbers.
 *
 * Purely presentational — every decision about what the buttons mean is made by
 * the caller and arrives as a label and a callback.
 */

import { Button } from '../../shared/InlineControls';
import { fixed } from '../../../utils/format';
import BigReading, { BIG_READING_SIZE } from './BigReading';

export type OverlayPhase = 'ready' | 'arming' | 'countdown' | 'review';

interface RoundOverlayProps {
  phase: OverlayPhase;
  /** Where to stand when the countdown ends, in metres from the detector. */
  startMeters: number;
  holdSeconds: number;
  holdRemaining: number;
  /** Latest good reading, or null when the detector hears nothing. */
  liveDistance: number | null;
  onMark: boolean;
  countdown: number;
  /** The reviewed round's score, when there is one to show. */
  score: number | null;
  maxScore: number;
  canRetry: boolean;
  nextLabel: string;
  onArm: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onNext: () => void;
  /** Leaves the activity. Null while leaving would abandon a scored run. */
  onLeave: (() => void) | null;
}

export default function RoundOverlay({
  phase,
  startMeters,
  holdSeconds,
  holdRemaining,
  liveDistance,
  onMark,
  countdown,
  score,
  maxScore,
  canRetry,
  nextLabel,
  onArm,
  onCancel,
  onRetry,
  onNext,
  onLeave,
}: RoundOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
      <div className="pointer-events-auto w-[min(92%,44rem)] rounded-xl border border-[var(--grid-line)] bg-[var(--surface-elevated)] p-[clamp(0.75rem,2.5cqw,1.5rem)] text-center shadow-lg">
        {phase === 'ready' && (
          <>
            <BigReading label="Stand at" value={`${fixed(startMeters, 2)} m`} />
            {/* Three words, not a paragraph. The card has to fit inside the plot
                at every width, and the hold is explained where it happens — the
                next screen counts it down under a progress bar. */}
            <p className="mt-1 text-[clamp(0.7rem,1.6cqw,0.95rem)] text-[var(--text-muted)]">
              from the detector
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
              <Button className="btn-lg" onClick={onArm}>
                Begin the round
              </Button>
              {onLeave && (
                <Button variant="secondary" onClick={onLeave}>
                  Back
                </Button>
              )}
            </div>
          </>
        )}

        {phase === 'arming' && (
          <>
            {/* aria-hidden because these update four times a second: announcing
                each one would bury the sentence below, which is the part a
                screen-reader user actually needs. */}
            <div aria-hidden="true" className="grid grid-cols-2 gap-6">
              <BigReading label="Stand at" value={`${fixed(startMeters, 2)} m`} />
              <BigReading
                label="You are at"
                value={liveDistance === null ? null : `${fixed(liveDistance, 2)} m`}
                tone={onMark ? 'onMark' : 'primary'}
              />
            </div>

            <div
              aria-hidden="true"
              className="mt-3 h-2.5 w-full overflow-hidden rounded bg-[var(--grid-line)]"
            >
              <div
                className="h-full rounded bg-[var(--accent-green)]"
                style={{ width: `${((holdSeconds - holdRemaining) / holdSeconds) * 100}%` }}
              />
            </div>

            <p className="mt-2 text-[clamp(0.8rem,2cqw,1.15rem)]" role="status">
              {liveDistance === null ? (
                <span className="text-[var(--text-muted)]">
                  No echo yet — is anything in front of the detector?
                </span>
              ) : onMark ? (
                <span className="text-[var(--accent-green)]">
                  Hold it — starting in {Math.ceil(holdRemaining)}…
                </span>
              ) : (
                <span className="text-[var(--text-muted)]">
                  Move onto the mark: {fixed(startMeters, 2)} m.
                </span>
              )}
            </p>

            <Button variant="secondary" className="mt-2" onClick={onCancel}>
              Cancel
            </Button>
          </>
        )}

        {phase === 'countdown' && (
          <p
            className={`${BIG_READING_SIZE} font-semibold leading-none tabular-nums text-[var(--accent-red)]`}
            role="status"
          >
            {countdown > 0 ? countdown : 'Go'}
          </p>
        )}

        {phase === 'review' && score !== null && (
          <>
            <p
              className={`${BIG_READING_SIZE} font-semibold leading-none tabular-nums text-[var(--text-primary)]`}
            >
              {score}
              <span className="text-[clamp(0.85rem,3cqw,1.5rem)] text-[var(--text-muted)]">
                {' '}
                / {maxScore}
              </span>
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              {canRetry && (
                <Button variant="secondary" className="btn-lg" onClick={onRetry}>
                  Walk it again
                </Button>
              )}
              <Button className="btn-lg" onClick={onNext}>
                {nextLabel}
              </Button>
              {onLeave && (
                <Button variant="secondary" onClick={onLeave}>
                  Back
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
