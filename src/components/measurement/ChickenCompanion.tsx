import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { X } from 'lucide-react';
import { ChickenCountGame } from './ChickenCountGame';
import {
  CHICKEN_COLS,
  CHICKEN_FRAME_PIXELS,
  CHICKEN_ROWS,
  type ChickenFrameName,
} from './ChickenSprite';

const CELL = 3;
const SPRITE_W = CHICKEN_COLS * CELL;
const SPRITE_H = CHICKEN_ROWS * CELL;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

type ChickenAction = 'openGame' | 'flee';

interface ChickenCompanionProps {
  action?: ChickenAction;
}

export const CHICKEN_COUNT_OPEN_EVENT = 'measurement:chicken-count:open';

export function ChickenCompanion({ action = 'flee' }: ChickenCompanionProps) {
  const [frame, setFrame] = useState<ChickenFrameName>('stand');
  const [facing, setFacing] = useState(1);
  const [gameOpen, setGameOpen] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const xFracRef = useRef(0.82);
  const yPxRef = useRef(22);
  const liftRef = useRef(0);
  const fleeRef = useRef<(() => void) | null>(null);

  const pixels = useMemo(() => CHICKEN_FRAME_PIXELS[frame], [frame]);
  const label = action === 'openGame' ? 'Open the chicken counting game' : 'Make the chicken run away';

  const activate = useCallback(() => {
    if (action === 'openGame') {
      setGameOpen(true);
      return;
    }
    fleeRef.current?.();
  }, [action]);

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

  useLayoutEffect(() => {
    applyTransform();
  });

  useEffect(() => {
    let alive = true;
    let fleeing = false;
    let run = 0;
    let rafId: number | null = null;
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

    const hopTo = (targetFrac: number, done: () => void, minF = 0.05, maxF = 0.95) => {
      const myRun = run;
      const fromX = xFracRef.current;
      const toX = clamp(targetFrac, minF, maxF);
      const fromY = yPxRef.current;
      const toY = clamp(fromY + rand(-8, 8), 14, 66);
      const dist = Math.abs(toX - fromX);

      setFacing(toX >= fromX ? 1 : -1);
      setFrame('hop');

      const hopHeight = clamp(10 + dist * 140, 10, 28);
      const duration = 170 + dist * 430;
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
          setFrame('stand');
          done();
        }
      };

      rafId = requestAnimationFrame(tick);
    };

    const peck = (done: () => void) => {
      const steps: ChickenFrameName[] = ['peck', 'stand', 'peck', 'stand'];
      let index = 0;
      const step = () => {
        if (index >= steps.length) {
          done();
          return;
        }
        setFrame(steps[index]);
        index += 1;
        later(step, 150);
      };
      step();
    };

    const hopBurst = (remaining: number, dirSign = Math.random() < 0.5 ? -1 : 1) => {
      const target = xFracRef.current + dirSign * rand(0.025, 0.06);
      hopTo(target, () => {
        if (remaining > 1) {
          later(() => hopBurst(remaining - 1, dirSign), rand(70, 160));
        } else {
          rest();
        }
      });
    };

    const startBurst = () => hopBurst(2 + Math.floor(rand(0, 3)));

    const rest = () => {
      setFrame('stand');
      if (Math.random() < 0.5) {
        later(() => peck(() => later(startBurst, rand(600, 1700))), rand(1200, 3200));
      } else {
        later(startBurst, rand(2600, 6200));
      }
    };

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

    const flee = () => {
      if (fleeing) {
        return;
      }
      fleeing = true;
      run += 1;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      timers.forEach(clearTimeout);
      timers.clear();

      const dirSign = xFracRef.current < 0.5 ? -1 : 1;
      const exit = dirSign < 0 ? -0.3 : 1.3;
      const hopOut = () => {
        const next = xFracRef.current + dirSign * rand(0.13, 0.2);
        const reachedEdge = dirSign < 0 ? next <= -0.2 : next >= 1.2;
        hopTo(
          reachedEdge ? exit : next,
          () => {
            if (reachedEdge) {
              later(returnFromFlee, 30000);
            } else {
              later(hopOut, rand(60, 130));
            }
          },
          -0.35,
          1.35,
        );
      };
      hopOut();
    };
    fleeRef.current = flee;

    const onResize = () => applyTransform();
    window.addEventListener('resize', onResize);

    later(startBurst, 700);

    return () => {
      alive = false;
      run += 1;
      fleeRef.current = null;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', onResize);
    };
  }, [applyTransform]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      activate();
    }
  };

  useEffect(() => {
    if (!gameOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setGameOpen(false);
      }
    };
    window.addEventListener('keydown', onWindowKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onWindowKeyDown);
    };
  }, [gameOpen]);

  return (
    <>
      <div
        ref={wrapRef}
        role="button"
        tabIndex={0}
        aria-label={label}
        onClick={activate}
        onKeyDown={onKeyDown}
        style={{
          position: 'fixed',
          pointerEvents: 'auto',
          cursor: 'pointer',
          zIndex: 1,
          opacity: 0.92,
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
                onClick={(event) => {
                  event.stopPropagation();
                  activate();
                }}
                style={{ pointerEvents: 'auto', cursor: 'pointer' }}
              />
            ))}
          </g>
        </svg>
      </div>

      {action === 'openGame' && gameOpen && (
        <div
          className="fixed inset-0 z-[80] overflow-y-auto bg-black/45 px-3 py-5 backdrop-blur-sm sm:px-5"
          onClick={() => setGameOpen(false)}
        >
          <div className="mx-auto flex min-h-full max-w-4xl items-center">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Chicken counting game"
              className="w-full"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-2 flex justify-end">
                <button
                  ref={closeButtonRef}
                  type="button"
                  aria-label="Close chicken counting game"
                  onClick={() => setGameOpen(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-sm transition hover:border-[var(--accent-blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-blue)]"
                >
                  <X aria-hidden="true" size={18} strokeWidth={2.5} />
                </button>
              </div>
              <ChickenCountGame className="my-0" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
