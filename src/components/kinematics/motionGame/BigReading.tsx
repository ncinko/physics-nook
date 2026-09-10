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
 * Big enough to read from the detector, and no bigger. The ceiling is what
 * stops a fullscreen projector turning a two-digit distance into wall art;
 * past a point the extra size buys no legibility and only crowds the card.
 */
export const BIG_READING_SIZE = 'text-[clamp(1.5rem,5.5cqw,4rem)]';

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
      {/* `whitespace-nowrap`: the unit belongs to the number. Letting "m" wrap
          onto its own line reads as a second value for the half-second before
          the eye resolves it, which is exactly the wrong thing to do to someone
          reading this from across a room. */}
      <p
        className={`${BIG_READING_SIZE} font-semibold leading-none whitespace-nowrap tabular-nums ${
          value === null ? TONE_CLASS.muted : TONE_CLASS[tone]
        }`}
      >
        {value ?? '—'}
      </p>
    </div>
  );
}
