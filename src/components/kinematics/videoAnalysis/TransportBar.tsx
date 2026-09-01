import { useEffect, useState } from 'react';
import { Button } from '../../shared/InlineControls';
import { fixed } from '../../../utils/format';

/**
 * The strip of playback controls under the clip: step a frame, play or pause,
 * and scrub. Deliberately spare — this is for *finding* the part of the clip
 * worth measuring, and everything to do with measuring lives in the mode panel
 * below it.
 *
 * The scrubber works in frame indices rather than seconds so that landing on a
 * frame is exact, and so releasing it leaves the video on a real frame that can
 * be marked straight away.
 */

interface TransportBarProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStepFrame: (delta: number) => void;
  currentFrame: number;
  frameCount: number;
  onSeekToFrame: (index: number) => void;
  time: number;
  duration: number;
  disabled: boolean;
}

/** Long enough to swallow a drag's stream of intermediate values. */
const SCRUB_COMMIT_MS = 120;

export function TransportBar({
  isPlaying,
  onTogglePlay,
  onStepFrame,
  currentFrame,
  frameCount,
  onSeekToFrame,
  time,
  duration,
  disabled,
}: TransportBarProps) {
  // While dragging, the thumb follows the pointer immediately and the seek is
  // committed behind it; without that the thumb fights the (slower) video.
  const [scrub, setScrub] = useState<number | null>(null);

  useEffect(() => {
    if (scrub === null) return;
    const timer = window.setTimeout(() => onSeekToFrame(scrub), SCRUB_COMMIT_MS);
    return () => window.clearTimeout(timer);
  }, [scrub, onSeekToFrame]);

  // Hand control back to the video once it has caught up with the drag.
  useEffect(() => {
    if (scrub !== null && currentFrame === scrub) setScrub(null);
  }, [currentFrame, scrub]);

  const lastFrame = Math.max(0, frameCount - 1);
  const position = Math.min(scrub ?? currentFrame, lastFrame);

  return (
    <div
      data-tour="transport"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-theme-grid bg-[var(--surface-elevated)] px-3 py-2"
    >
      <div className="flex items-center gap-1.5">
        <Button
          variant="secondary"
          type="button"
          aria-label="Back one frame"
          title="Back one frame"
          disabled={disabled || position <= 0}
          onClick={() => onStepFrame(-1)}
        >
          |◀
        </Button>
        <Button
          type="button"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          title={isPlaying ? 'Pause' : 'Play'}
          disabled={disabled}
          onClick={onTogglePlay}
        >
          {isPlaying ? '❚❚' : '▶'}
        </Button>
        <Button
          variant="secondary"
          type="button"
          aria-label="Forward one frame"
          title="Forward one frame"
          disabled={disabled || position >= lastFrame}
          onClick={() => onStepFrame(1)}
        >
          ▶|
        </Button>
      </div>

      <input
        type="range"
        min={0}
        max={lastFrame}
        step={1}
        value={position}
        disabled={disabled}
        aria-label="Scrub through the clip"
        aria-valuetext={`Frame ${position + 1} of ${frameCount}`}
        onChange={(event) => setScrub(Number(event.target.value))}
        className="h-1.5 min-w-[8rem] flex-1 cursor-pointer accent-[var(--accent-blue)]"
      />

      <span className="font-mono text-sm tabular-nums text-[var(--text-muted)]">
        {fixed(time, 2)} / {fixed(duration, 2)} s
      </span>
    </div>
  );
}

export default TransportBar;
