import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Button, ControlBar } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';
import {
  CHICKEN_ROUND_SECONDS,
  chickenCountForRandom,
  scoreChickenEstimate,
  type ChickenScore,
} from '../../lib/measurement/chickenCount';
import {
  CHICKEN_COLS,
  CHICKEN_PALETTE,
  CHICKEN_ROWS,
  ChickenSprite,
  type ChickenFrameName,
} from './ChickenSprite';

type GameStatus = 'idle' | 'running' | 'revealed';

interface ChickenSpec {
  id: number;
  y0: number;
  yMid: number;
  y1: number;
  duration: number;
  delay: number;
  scale: number;
  dir: 1 | -1;
  phase: number;
  palette: number;
}

const INITIAL_COUNT = 52;
const GAME_CELL = 2.4;
const SPRITE_W = CHICKEN_COLS * GAME_CELL;
const SPRITE_H = CHICKEN_ROWS * GAME_CELL;

const PALETTES: Record<string, string>[] = [
  CHICKEN_PALETTE,
  { ...CHICKEN_PALETTE, o: '#ffffff', w: '#e5e7eb' },
  { ...CHICKEN_PALETTE, o: '#fde68a', w: '#f59e0b' },
  { ...CHICKEN_PALETTE, o: '#fed7aa', w: '#fb923c' },
];

const seededRandom = (seed: number) => {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const createChickenSpecs = (count: number, seed: number): ChickenSpec[] => {
  const random = seededRandom(seed);
  return Array.from({ length: count }, (_, id) => {
    const y0 = 8 + random() * 78;
    const y1 = 8 + random() * 78;
    const yMid = Math.max(6, Math.min(88, (y0 + y1) / 2 + (random() - 0.5) * 18));
    const duration = 4.4 + random() * 5.6;
    return {
      id,
      y0,
      yMid,
      y1,
      duration,
      delay: -random() * duration,
      scale: 0.72 + random() * 0.48,
      dir: random() < 0.5 ? 1 : -1,
      phase: Math.floor(random() * 2),
      palette: Math.floor(random() * PALETTES.length),
    };
  });
};

const parseNonNegative = (value: string): number | null => {
  if (value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const formatGuess = (estimate: number, uncertainty: number) =>
  `${estimate.toFixed(estimate % 1 === 0 ? 0 : 1)} +/- ${uncertainty.toFixed(uncertainty % 1 === 0 ? 0 : 1)}`;

interface ChickenCountGameProps {
  className?: string;
}

export function ChickenCountGame({ className = 'my-8' }: ChickenCountGameProps) {
  const [status, setStatus] = useState<GameStatus>('idle');
  const [trueCount, setTrueCount] = useState(INITIAL_COUNT);
  const [seed, setSeed] = useState(1);
  const [estimateInput, setEstimateInput] = useState('');
  const [uncertaintyInput, setUncertaintyInput] = useState('');
  const [timeLeft, setTimeLeft] = useState(CHICKEN_ROUND_SECONDS);
  const [stepFrame, setStepFrame] = useState(0);
  const endAtRef = useRef<number | null>(null);

  const chickens = useMemo(() => createChickenSpecs(trueCount, seed), [seed, trueCount]);
  const estimate = parseNonNegative(estimateInput);
  const uncertainty = parseNonNegative(uncertaintyInput);
  const result: ChickenScore | null =
    status === 'revealed' && estimate !== null && uncertainty !== null
      ? scoreChickenEstimate({ trueCount, estimate, uncertainty })
      : null;

  useEffect(() => {
    if (status !== 'running') {
      return;
    }

    endAtRef.current = Date.now() + CHICKEN_ROUND_SECONDS * 1000;
    setTimeLeft(CHICKEN_ROUND_SECONDS);

    const timer = window.setInterval(() => {
      const endAt = endAtRef.current ?? Date.now();
      const remaining = Math.max(0, (endAt - Date.now()) / 1000);
      setTimeLeft(remaining);
      if (remaining <= 0) {
        window.clearInterval(timer);
        setStatus('revealed');
      }
    }, 100);

    return () => {
      window.clearInterval(timer);
    };
  }, [status]);

  useEffect(() => {
    if (status !== 'running') {
      return;
    }
    const animation = window.setInterval(() => {
      setStepFrame((frame) => (frame + 1) % 2);
    }, 150);
    return () => window.clearInterval(animation);
  }, [status]);

  const startRound = () => {
    setTrueCount(chickenCountForRandom());
    setSeed(Math.floor(Math.random() * 1_000_000_000));
    setEstimateInput('');
    setUncertaintyInput('');
    setTimeLeft(CHICKEN_ROUND_SECONDS);
    setStepFrame(0);
    setStatus('running');
  };

  const revealNow = () => {
    if (status === 'running') {
      setTimeLeft(0);
      setStatus('revealed');
    }
  };

  const timerLabel = status === 'idle' ? `${CHICKEN_ROUND_SECONDS}.0 s` : `${timeLeft.toFixed(1)} s`;
  const inputsDisabled = status !== 'running';

  return (
    <section
      className={`not-prose overflow-hidden rounded-lg border border-[var(--grid-line)] bg-[var(--sim-bg)] text-[var(--text-primary)] shadow-sm ${className}`.trim()}
    >
      <div className="grid gap-4 p-4 md:p-5">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div>
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
              Error vs. uncertainty
            </p>
            <h3 className="mt-1 mb-0 text-lg font-semibold leading-7">Chicken Count</h3>
          </div>
          <div className="rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-3 py-1 text-right font-mono text-sm font-semibold tabular-nums">
            {timerLabel}
          </div>
        </div>

        <div
          className="chicken-count-stage relative min-h-[22rem] overflow-hidden rounded-lg border border-[var(--grid-line)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--accent-blue)_14%,var(--bg-primary))_0_56%,color-mix(in_srgb,var(--accent-green)_18%,var(--bg-primary))_56%_100%)]"
          aria-label="A timed field of running chickens to estimate"
        >
          <div className="absolute inset-x-0 top-[56%] h-px bg-[color:color-mix(in_srgb,var(--accent-green)_50%,var(--grid-line))]" />
          <div className="absolute inset-x-0 bottom-12 h-10 opacity-45 [background:repeating-linear-gradient(90deg,color-mix(in_srgb,var(--accent-green)_42%,transparent)_0_4px,transparent_4px_16px)]" />

          {chickens.map((chicken) => {
            const frame: ChickenFrameName =
              status === 'running' ? (stepFrame === chicken.phase ? 'stepA' : 'stepB') : 'stand';
            return (
              <div
                key={chicken.id}
                className="chicken-count-bird absolute"
                data-dir={chicken.dir}
                style={
                  {
                    '--y0': `${chicken.y0}%`,
                    '--ymid': `${chicken.yMid}%`,
                    '--y1': `${chicken.y1}%`,
                    animationDuration: `${chicken.duration}s`,
                    animationDelay: status === 'running' ? `${chicken.delay}s` : '0s',
                    animationDirection: chicken.dir < 0 ? 'reverse' : 'normal',
                    animationPlayState: status === 'running' ? 'running' : 'paused',
                    zIndex: Math.round(chicken.y0 * 10),
                  } as CSSProperties
                }
              >
                <div className="chicken-count-scale" style={{ transform: `scale(${chicken.scale})` }}>
                  <div className="chicken-count-bob">
                    <svg
                      width={SPRITE_W}
                      height={SPRITE_H}
                      viewBox={`${-SPRITE_W / 2} ${-(CHICKEN_ROWS - 1) * GAME_CELL} ${SPRITE_W} ${SPRITE_H}`}
                      role="presentation"
                      style={{ display: 'block', overflow: 'visible', shapeRendering: 'crispEdges' }}
                    >
                      <g transform={`scale(${chicken.dir},1)`}>
                        <ChickenSprite frame={frame} cell={GAME_CELL} palette={PALETTES[chicken.palette]} />
                      </g>
                    </svg>
                  </div>
                </div>
              </div>
            );
          })}

          {status === 'revealed' && (
            <div className="absolute left-3 top-3 rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-3 py-1 text-sm font-semibold shadow-sm">
              True count: {trueCount}
            </div>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium">
              <span>Estimate</span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={estimateInput}
                disabled={inputsDisabled}
                onChange={(event) => setEstimateInput(event.target.value)}
                className="rounded-md border border-[var(--grid-line)] bg-[var(--bg-primary)] px-3 py-2 font-mono text-[var(--text-primary)] disabled:opacity-60"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              <span>+/- uncertainty</span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={uncertaintyInput}
                disabled={inputsDisabled}
                onChange={(event) => setUncertaintyInput(event.target.value)}
                className="rounded-md border border-[var(--grid-line)] bg-[var(--bg-primary)] px-3 py-2 font-mono text-[var(--text-primary)] disabled:opacity-60"
              />
            </label>
          </div>

          <ControlBar align="start" className="md:justify-end">
            {status === 'running' ? (
              <Button type="button" onClick={revealNow} variant="secondary">
                Lock estimate
              </Button>
            ) : (
              <Button type="button" onClick={startRound}>
                {status === 'idle' ? 'Start round' : 'New round'}
              </Button>
            )}
          </ControlBar>
        </div>

        {status === 'idle' && (
          <p className="m-0 text-sm leading-6 text-[var(--text-muted)]">
            Start a round, watch the flock for 20 seconds, then report a count with a plus-or-minus range.
          </p>
        )}

        {status === 'running' && (
          <p className="m-0 text-sm leading-6 text-[var(--text-muted)]" aria-live="polite">
            Enter your best count and the uncertainty range before time runs out. You can lock early.
          </p>
        )}

        {status === 'revealed' && (
          <>
            {result ? (
              <Readout variant="cards">
                <Readout.Value label="true count" value={trueCount} />
                <Readout.Value label="your report" value={formatGuess(result.estimate, result.uncertainty)} />
                <Readout.Value label="error" value={result.error.toFixed(result.error % 1 === 0 ? 0 : 1)} />
                <Readout.Value label="accuracy" value={`${result.accuracyPoints}/60`} />
                <Readout.Value label="precision" value={`${result.precisionPoints}/40`} />
                <Readout.Value label="score" value={`${result.score}/100`} />
              </Readout>
            ) : (
              <Readout variant="cards">
                <Readout.Value label="true count" value={trueCount} />
                <Readout.Value label="score" value="0/100" />
              </Readout>
            )}

            <p
              className="m-0 rounded-lg border px-3 py-2 text-sm font-semibold"
              style={{
                color: result?.coversTruth ? 'var(--accent-green)' : 'var(--accent-red)',
                borderColor: result?.coversTruth ? 'var(--accent-green)' : 'var(--accent-red)',
                background: result?.coversTruth
                  ? 'color-mix(in srgb, var(--accent-green) 12%, var(--bg-primary))'
                  : 'color-mix(in srgb, var(--accent-red) 10%, var(--bg-primary))',
              }}
            >
              {result ? result.verdict : 'No valid estimate and uncertainty were entered before the reveal.'}
            </p>
          </>
        )}
      </div>

      <style>{`
        @keyframes chicken-count-cross {
          0% {
            left: -3.8rem;
            top: var(--y0);
          }
          50% {
            top: var(--ymid);
          }
          100% {
            left: calc(100% + 3.8rem);
            top: var(--y1);
          }
        }

        @keyframes chicken-count-bob {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-0.25rem);
          }
        }

        .chicken-count-bird {
          animation-name: chicken-count-cross;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }

        .chicken-count-bob {
          animation: chicken-count-bob 300ms steps(2, end) infinite;
        }
      `}</style>
    </section>
  );
}
