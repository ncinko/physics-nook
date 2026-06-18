import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BUNNY_COLS,
  BUNNY_FRAME_PIXELS,
  BUNNY_ROWS,
  type BunnyFrameName,
} from './BunnySprite';

// A small pixel-art bunny that lives in the page background. It hops to random
// spots near the bottom of the viewport, pauses, and now and then wiggles its
// ears. Purely decorative: pointer events pass through and it is hidden from
// assistive tech. Animates for all visitors regardless of prefers-reduced-motion
// (an intentional product choice for this whimsical element). Shares its sprite
// with the vector-page interactives via BunnySprite.

const CELL = 3; // pixels per sprite cell
const SPRITE_W = BUNNY_COLS * CELL;
const SPRITE_H = BUNNY_ROWS * CELL;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function BunnyCompanion() {
  const [frame, setFrame] = useState<BunnyFrameName>('sit');
  const [facing, setFacing] = useState(1);

  const wrapRef = useRef<HTMLDivElement>(null);
  const xFracRef = useRef(0.12); // horizontal position as fraction of viewport width
  const yPxRef = useRef(20); // resting height above the bottom edge
  const liftRef = useRef(0); // extra height while airborne
  const fleeRef = useRef<(() => void) | null>(null); // set by the scheduler; fired on click
  // True only during the rare red-eyed "glare" window. Clicking the bunny while
  // this is set opens the hidden Caerbannog defense game instead of fleeing.
  const glaringRef = useRef(false);

  const pixels = useMemo(() => BUNNY_FRAME_PIXELS[frame], [frame]);

  // Push the current position straight to the DOM (no React re-render per frame).
  const applyTransform = useCallback(() => {
    const el = wrapRef.current;
    if (!el || typeof window === 'undefined') {
      return;
    }
    const x = xFracRef.current * window.innerWidth - SPRITE_W / 2;
    el.style.left = `${x}px`;
    el.style.bottom = `${yPxRef.current}px`;
    el.style.transform = `translateY(${-liftRef.current}px)`;
  }, []);

  // Re-sync position to the DOM after every render so React's reconciliation of
  // frame/facing changes doesn't reset the imperatively-driven left/bottom.
  useLayoutEffect(() => {
    applyTransform();
  });

  useEffect(() => {
    let alive = true;
    let fleeing = false;
    let run = 0; // bumped to invalidate the idle loop's pending hops/timers (e.g. on click)
    let rafId: number | null = null;
    let glareTimer: ReturnType<typeof setTimeout> | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const later = (fn: () => void, delay: number) => {
      const myRun = run;
      const id = setTimeout(() => {
        timers.delete(id);
        if (alive && myRun === run) {
          fn();
        }
      }, delay);
      timers.add(id);
    };

    // Play a one-shot hop arc to a target fraction, then resolve. The clamp range
    // widens past the screen edges so the flee animation can exit the viewport.
    const hopTo = (targetFrac: number, done: () => void, minF = 0.05, maxF = 0.95) => {
      const myRun = run;
      const fromX = xFracRef.current;
      const toX = clamp(targetFrac, minF, maxF);
      const fromY = yPxRef.current;
      const toY = clamp(fromY + rand(-10, 10), 12, 64);
      const dist = Math.abs(toX - fromX);

      // Any movement cancels a glare in progress so a mid-hop click can't open
      // the game while the bunny no longer looks like it's glaring.
      glaringRef.current = false;
      setFacing(toX >= fromX ? 1 : -1);
      setFrame('hop');

      const hopHeight = clamp(12 + dist * 180, 12, 34);
      const duration = 200 + dist * 500;
      const start = performance.now();

      const tick = (now: number) => {
        if (!alive || myRun !== run) {
          return;
        }
        const p = Math.min(1, (now - start) / duration);
        xFracRef.current = fromX + (toX - fromX) * p;
        yPxRef.current = fromY + (toY - fromY) * p;
        liftRef.current = Math.sin(Math.PI * p) * hopHeight;
        applyTransform();
        if (p < 1) {
          rafId = requestAnimationFrame(tick);
        } else {
          liftRef.current = 0;
          applyTransform();
          setFrame('sit');
          done();
        }
      };
      rafId = requestAnimationFrame(tick);
    };

    // A burst of tiny hops in one direction — hop-hop or hop-hop-hop — then rest.
    const doHopBurst = (remaining: number, dirSign = Math.random() < 0.5 ? -1 : 1) => {
      const target = clamp(xFracRef.current + dirSign * rand(0.02, 0.05), 0.06, 0.94);
      hopTo(target, () => {
        if (remaining > 1) {
          later(() => doHopBurst(remaining - 1, dirSign), rand(90, 200));
        } else {
          rest();
        }
      });
    };

    const startBurst = () => doHopBurst(2 + Math.floor(rand(0, 2)));

    // Wiggle the ears: a quick flop right/left while sitting.
    const wiggleEars = (onDone: () => void) => {
      const steps: BunnyFrameName[] = ['wiggleR', 'sit', 'wiggleL', 'sit', 'wiggleR', 'sit'];
      let i = 0;
      const step = () => {
        if (i >= steps.length) {
          onDone();
          return;
        }
        setFrame(steps[i]);
        i += 1;
        later(step, 120);
      };
      step();
    };

    // Sit still for a good while, sometimes wiggle, then hop again.
    const rest = () => {
      setFrame('sit');
      const pause = rand(3000, 7000);
      if (Math.random() < 0.4) {
        later(() => wiggleEars(() => later(startBurst, rand(700, 1800))), pause * 0.6);
      } else {
        later(startBurst, pause);
      }
    };

    // After hiding off-screen, hop back into view and resume the idle loop.
    const returnFromFlee = () => {
      hopTo(
        clamp(rand(0.2, 0.8), 0.06, 0.94),
        () => {
          fleeing = false;
          rest();
        },
        -0.35,
        1.35,
      );
    };

    // Click handler: the bunny panics, hops off the nearest edge in quick little
    // leaps, then hides for 30 seconds before hopping back in.
    const flee = () => {
      if (fleeing) {
        return;
      }
      fleeing = true;
      run += 1; // invalidate the idle loop's pending hops/timers
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      timers.forEach(clearTimeout);
      timers.clear();

      const dirSign = xFracRef.current < 0.5 ? -1 : 1;
      const exit = dirSign < 0 ? -0.3 : 1.3;
      const hopOut = () => {
        const next = xFracRef.current + dirSign * rand(0.14, 0.22);
        const reachedEdge = dirSign < 0 ? next <= -0.2 : next >= 1.2;
        hopTo(
          reachedEdge ? exit : next,
          () => {
            if (reachedEdge) {
              later(returnFromFlee, 30000);
            } else {
              later(hopOut, rand(60, 120));
            }
          },
          -0.35,
          1.35,
        );
      };
      hopOut();
    };
    fleeRef.current = flee;

    // The glare runs on its own timer (not the `run`-token hop loop, which
    // `flee()` invalidates) so it keeps recurring for the whole visit. Every
    // 10-20s, if the bunny is sitting on the ground, it flashes red eyes for
    // 1.5s; clicking during that window opens the hidden game (see onClick).
    const scheduleGlare = () => {
      glareTimer = setTimeout(runGlare, rand(10000, 20000));
    };
    function runGlare() {
      if (!alive) {
        return;
      }
      if (fleeing || liftRef.current > 0.5) {
        scheduleGlare(); // busy hopping/fleeing — try again later
        return;
      }
      glaringRef.current = true;
      setFrame('glare');
      glareTimer = setTimeout(() => {
        if (!alive) {
          return;
        }
        if (glaringRef.current) {
          glaringRef.current = false;
          // Only drop the glare frame if a hop hasn't already taken over.
          setFrame((f) => (f === 'glare' ? 'sit' : f));
        }
        scheduleGlare();
      }, 1500);
    }

    const onResize = () => applyTransform();
    window.addEventListener('resize', onResize);

    later(startBurst, 900);
    scheduleGlare();

    return () => {
      alive = false;
      fleeRef.current = null;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      if (glareTimer) {
        clearTimeout(glareTimer);
      }
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      aria-hidden="true"
      onClick={() => {
        // Easter egg: a click landing during the rare glare opens the hidden
        // Caerbannog defense game; any other click just makes the bunny flee.
        if (glaringRef.current) {
          glaringRef.current = false;
          window.dispatchEvent(new CustomEvent('caerbannog:open'));
        } else {
          fleeRef.current?.();
        }
      }}
      style={{
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: 1,
        opacity: 0.9,
        willChange: 'left, bottom, transform',
      }}
    >
      <svg
        width={SPRITE_W}
        height={SPRITE_H}
        viewBox={`0 0 ${SPRITE_W} ${SPRITE_H}`}
        role="presentation"
        style={{ display: 'block', shapeRendering: 'crispEdges' }}
      >
        <g transform={facing < 0 ? `translate(${SPRITE_W},0) scale(-1,1)` : undefined}>
          {pixels.map((px, i) => (
            <rect
              key={i}
              x={px.x * CELL}
              y={px.y * CELL}
              width={CELL}
              height={CELL}
              fill={px.fill}
              // Only the bunny's pixels are clickable; transparent gaps pass clicks through.
              style={{ pointerEvents: 'auto', cursor: 'pointer' }}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
