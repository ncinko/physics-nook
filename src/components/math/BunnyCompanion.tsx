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
// assistive tech. Honors prefers-reduced-motion by sitting still. Shares its
// sprite with the vector-page interactives via BunnySprite.

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
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      return;
    }

    let alive = true;
    let rafId: number | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const later = (fn: () => void, delay: number) => {
      const id = setTimeout(() => {
        timers.delete(id);
        if (alive) {
          fn();
        }
      }, delay);
      timers.add(id);
    };

    // Play a one-shot hop arc to a target fraction, then resolve.
    const hopTo = (targetFrac: number, done: () => void) => {
      const fromX = xFracRef.current;
      const toX = clamp(targetFrac, 0.05, 0.95);
      const fromY = yPxRef.current;
      const toY = clamp(rand(12, 96), 12, 96);
      const dist = Math.abs(toX - fromX);

      setFacing(toX >= fromX ? 1 : -1);
      setFrame('hop');

      const hopHeight = clamp(34 + dist * 260, 34, 96);
      const duration = 300 + dist * 520;
      const start = performance.now();

      const tick = (now: number) => {
        if (!alive) {
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

    // A burst of 1–3 hops to a fresh spot, then a pause.
    const doHopBurst = (remaining: number) => {
      const reach = rand(0.12, 0.4) * (Math.random() < 0.5 ? -1 : 1);
      const target = clamp(xFracRef.current + reach, 0.06, 0.94);
      hopTo(target, () => {
        if (remaining > 1 && Math.random() < 0.6) {
          later(() => doHopBurst(remaining - 1), rand(120, 260));
        } else {
          rest();
        }
      });
    };

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
        later(step, 110);
      };
      step();
    };

    // Sit a while, occasionally wiggle, then hop again.
    const rest = () => {
      setFrame('sit');
      const pause = rand(1400, 3800);
      if (Math.random() < 0.4) {
        later(() => wiggleEars(() => later(() => doHopBurst(1 + Math.floor(rand(0, 3))), rand(500, 1400))), pause * 0.5);
      } else {
        later(() => doHopBurst(1 + Math.floor(rand(0, 3))), pause);
      }
    };

    const onResize = () => applyTransform();
    window.addEventListener('resize', onResize);

    later(() => doHopBurst(1 + Math.floor(rand(0, 3))), 900);

    return () => {
      alive = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      aria-hidden="true"
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
            <rect key={i} x={px.x * CELL} y={px.y * CELL} width={CELL} height={CELL} fill={px.fill} />
          ))}
        </g>
      </svg>
    </div>
  );
}
