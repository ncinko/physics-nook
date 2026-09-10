/**
 * A distance, sized to be read from across the room.
 *
 * Motion Match's whole difficulty is that the person who needs these numbers is
 * standing at the detector, several metres from the screen. That makes the type
 * scale a functional requirement rather than a matter of taste, and it is the
 * reason this is a component and not a class name: the fluid size, the
 * fixed-width placeholder and the tabular figures have to be the same wherever
 * a distance appears, or the card twitches as digits change and the eye loses
 * the number it was tracking.
 *
 * Sized in `cqw` against the plot wrapper's container, not in viewport units:
 * the card lives inside a fixed-aspect box whose height follows its own width,
 * and in fullscreen that box is nothing like the viewport.
 */

export type ReadingTone = 'primary' | 'muted' | 'onMark' | 'alert';

const TONE_CLASS: Record<ReadingTone, string> = {
  primary: 'text-[var(--text-primary)]',
  muted: 'text-[var(--text-muted)]',
  onMark: 'text-[var(--accent-green)]',
  alert: 'text-[var(--accent-red)]',
};

/**
 * The ceiling is deliberately high. Fullscreen on a projector is the case this
 * whole component exists for, and capping the number at a comfortable
 * on-page size would waste the room that mode buys.
 */
export const BIG_READING_SIZE = 'text-[clamp(1.75rem,9cqw,7rem)]';

interface BigReadingProps {
  /** Small caption above the number. Omit for a bare figure. */
  label?: string;
  /** The formatted value, or null when there is nothing to read. */
  value: string | null;
  tone?: ReadingTone;
  className?: string;
}

export default function BigReading({
  label,
  value,
  tone = 'primary',
  className = '',
}: BigReadingProps) {
  return (
    <div className={className.trim()}>
      {label && (
        <p className="text-[clamp(0.6rem,1.5cqw,0.8rem)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {label}
        </p>
      )}
      <p
        className={`${BIG_READING_SIZE} font-semibold leading-none tabular-nums ${
          value === null ? TONE_CLASS.muted : TONE_CLASS[tone]
        }`}
      >
        {value ?? '—'}
      </p>
    </div>
  );
}
