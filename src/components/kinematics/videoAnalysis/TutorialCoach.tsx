import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../shared/InlineControls';
import {
  TUTORIAL_STEPS,
  isLastTutorialStep,
  type TutorialProgress,
  type TutorialStep,
} from '../../../lib/kinematics/videoTutorial';

/**
 * The guided-tour overlay: a hole cut around one control, and a card next to it
 * saying what to do with it.
 *
 * Two decisions shape the whole component.
 *
 * It is positioned *absolutely inside the lab*, not fixed to the viewport. The
 * lab sits inside a simulation block whose section carries a `translate-x`, and
 * a transformed ancestor becomes the containing block for fixed descendants —
 * so `position: fixed` here would already not mean what it says. Measuring
 * every rectangle relative to the lab's own root sidesteps that, and keeps
 * working unchanged in fullscreen, where the block is fixed over the viewport.
 * It also means the page around the lab is never dimmed, which reads as a tour
 * of one tool rather than a takeover of the page.
 *
 * Nothing is trapped. The dimming is a single spread `box-shadow` on the hole
 * element and the whole overlay is `pointer-events: none` apart from the card
 * itself, so the highlighted control is genuinely clickable and so is
 * everything else. A student who wants to go and poke at something else mid-tour
 * can, and the step they are on will still be waiting.
 */

interface TutorialCoachProps {
  /** Element the overlay measures against — the lab root. */
  rootRef: React.RefObject<HTMLDivElement | null>;
  index: number;
  progress: TutorialProgress;
  onIndexChange: (index: number) => void;
  /** Apply a step's `setMode` / `seekToFrame` / `setStepFrames`. */
  onEnterStep: (step: TutorialStep) => void;
  onExit: () => void;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const CARD_WIDTH = 340;
const GAP = 14;
const EDGE = 12;
/** Long enough that a completed step registers as "done" rather than skipped. */
const ADVANCE_DELAY_MS = 550;
/** Cheap enough to run forever, and immune to every way a layout can shift. */
const MEASURE_INTERVAL_MS = 200;

const sameRect = (a: Rect | null, b: Rect | null) => {
  if (a === null || b === null) return a === b;
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
};

export function TutorialCoach({
  rootRef,
  index,
  progress,
  onIndexChange,
  onEnterStep,
  onExit,
}: TutorialCoachProps) {
  const step = TUTORIAL_STEPS[index];
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [anchorRect, setAnchorRect] = useState<Rect | null>(null);
  const [rootSize, setRootSize] = useState({ width: 0, height: 0 });
  const [cardHeight, setCardHeight] = useState(0);

  // A step that is already satisfied the moment it opens has nothing to wait
  // for, so it must not auto-advance — see the note in videoTutorial.ts.
  const armedRef = useRef(false);
  const progressRef = useRef(progress);
  progressRef.current = progress;

  // The lab passes these as inline arrows. Depending on them directly would
  // tear down and restart the auto-advance timer on every single render, so it
  // would never actually fire.
  const onEnterStepRef = useRef(onEnterStep);
  onEnterStepRef.current = onEnterStep;
  const onIndexChangeRef = useRef(onIndexChange);
  onIndexChangeRef.current = onIndexChange;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    if (!step) return;
    armedRef.current = step.isComplete ? !step.isComplete(progressRef.current) : false;
    onEnterStepRef.current(step);
  }, [step]);

  // Bring the highlighted control into view, but only when it is genuinely off
  // screen: yanking the page around on every step is worse than a short scroll.
  useEffect(() => {
    if (!step?.anchor) return;
    const element = rootRef.current?.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const height = window.innerHeight || document.documentElement.clientHeight;
    if (rect.top >= 0 && rect.bottom <= height) return;
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [rootRef, step]);

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const rootBox = root.getBoundingClientRect();
    setRootSize((previous) =>
      Math.abs(previous.width - rootBox.width) < 0.5 &&
      Math.abs(previous.height - rootBox.height) < 0.5
        ? previous
        : { width: rootBox.width, height: rootBox.height },
    );

    const anchor = step?.anchor
      ? root.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`)
      : null;
    const next = anchor
      ? (() => {
          const box = anchor.getBoundingClientRect();
          return {
            left: box.left - rootBox.left,
            top: box.top - rootBox.top,
            width: box.width,
            height: box.height,
          };
        })()
      : null;
    setAnchorRect((previous) => (sameRect(previous, next) ? previous : next));
  }, [rootRef, step]);

  // Polling rather than observers: the anchor can move because the mode panel
  // swapped its contents, because the graph relaid out, because the window
  // resized, or because the page scrolled under a sticky element. One cheap
  // timer covers all of them, and the state only changes when the rect does.
  useLayoutEffect(() => {
    measure();
    const timer = window.setInterval(measure, MEASURE_INTERVAL_MS);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const height = card.getBoundingClientRect().height;
    setCardHeight((previous) => (Math.abs(previous - height) < 0.5 ? previous : height));
  });

  const complete = step?.isComplete?.(progress) ?? false;
  useEffect(() => {
    if (!step || !armedRef.current || !complete) return;
    armedRef.current = false;
    const timer = window.setTimeout(() => {
      if (!isLastTutorialStep(index)) onIndexChangeRef.current(index + 1);
    }, ADVANCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [complete, index, step]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExitRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!step) return null;

  const cardWidth = Math.min(CARD_WIDTH, Math.max(220, rootSize.width - 2 * EDGE));
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), Math.max(min, max));

  let cardLeft: number;
  let cardTop: number;
  if (anchorRect) {
    const below = anchorRect.top + anchorRect.height + GAP;
    const above = anchorRect.top - GAP - cardHeight;
    // Below the control by preference; above only when below would run off the
    // bottom and above genuinely fits.
    cardTop =
      below + cardHeight <= rootSize.height - EDGE || above < EDGE
        ? clamp(below, EDGE, Math.max(EDGE, rootSize.height - cardHeight - EDGE))
        : above;
    cardLeft = clamp(
      anchorRect.left + anchorRect.width / 2 - cardWidth / 2,
      EDGE,
      rootSize.width - cardWidth - EDGE,
    );
  } else {
    cardLeft = Math.max(EDGE, (rootSize.width - cardWidth) / 2);
    cardTop = Math.max(EDGE, (rootSize.height - cardHeight) / 2);
  }

  const status = step.status?.(progress) ?? null;
  const last = isLastTutorialStep(index);

  return (
    <div className="video-tutorial-overlay" role="dialog" aria-modal="false" aria-label="Guided tutorial">
      {anchorRect ? (
        <div
          className="video-tutorial-spotlight"
          style={{
            left: anchorRect.left - 6,
            top: anchorRect.top - 6,
            width: anchorRect.width + 12,
            height: anchorRect.height + 12,
          }}
        />
      ) : (
        <div className="video-tutorial-scrim" />
      )}

      <div
        ref={cardRef}
        className="video-tutorial-card"
        style={{ left: cardLeft, top: cardTop, width: cardWidth }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Step {index + 1} of {TUTORIAL_STEPS.length}
          </span>
          <button
            type="button"
            onClick={onExit}
            className="rounded text-xs font-medium text-[var(--text-muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--accent-blue)]"
          >
            End tour
          </button>
        </div>

        {/* Steps may carry no title at all, in which case the body speaks for
            itself and an empty heading would only add a gap. `normal-case` and
            the tracking reset undo the site-wide prose rule for h4, which is
            uppercase with wide letter-spacing — right for a section heading in
            a lesson, wrong for a sentence in a callout. */}
        {step.title.trim() !== '' && (
          <h4 className="m-0 text-base font-semibold normal-case tracking-normal text-[var(--text-primary)]">
            {step.title}
          </h4>
        )}

        {step.body.map((paragraph) => (
          <p key={paragraph} className="m-0 text-sm leading-6 text-[var(--text-primary)]">
            {paragraph}
          </p>
        ))}

        {status && (
          <p
            aria-live="polite"
            className="m-0 font-mono text-xs tabular-nums text-[var(--accent-green)]"
          >
            {status}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            variant="secondary"
            type="button"
            onClick={() => onIndexChange(index - 1)}
            disabled={index === 0}
          >
            Back
          </Button>
          <div
            aria-hidden="true"
            className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--grid-line)]"
          >
            <div
              className="h-full rounded-full bg-[var(--accent-blue)] transition-[width] duration-300"
              style={{ width: `${((index + 1) / TUTORIAL_STEPS.length) * 100}%` }}
            />
          </div>
          <Button type="button" onClick={() => (last ? onExit() : onIndexChange(index + 1))}>
            {last ? 'Finish' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default TutorialCoach;
