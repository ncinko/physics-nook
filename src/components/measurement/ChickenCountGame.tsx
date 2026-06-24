import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Button, ControlBar } from '../shared/InlineControls';
import { Readout } from '../shared/Readout';
import {
  CHICKEN_ROUND_SECONDS,
  CHICKEN_ROUNDS,
  chickenCountForRound,
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

interface StageSize {
  width: number;
  height: number;
}

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
    const y0 = 8 + random() * 76;
    const y1 = 8 + random() * 76;
    const yMid = Math.max(8, Math.min(84, (y0 + y1) / 2 + (random() - 0.5) * 16));
    const duration = 7.5 + random() * 6.5;
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

const formatNumber = (value: number) => value.toFixed(value % 1 === 0 ? 0 : 1);

const positionFromPercent = (percent: number, stageHeight: number, spriteHeight: number): number => {
  const maxY = Math.max(0, stageHeight - Math.max(SPRITE_H, spriteHeight) - 2);
  return Math.max(2, Math.min(maxY, (percent / 100) * stageHeight));
};

const ChickenBird = memo(function ChickenBird({
  chicken,
  running,
  stageSize,
}: {
  chicken: ChickenSpec;
  running: boolean;
  stageSize: StageSize;
}) {
  const stageWidth = stageSize.width || 720;
  const stageHeight = stageSize.height || 352;
  const spriteWidth = SPRITE_W * chicken.scale;
  const spriteHeight = SPRITE_H * chicken.scale;
  const xStart = spriteWidth / 2;
  const xEnd = Math.max(xStart, stageWidth - spriteWidth / 2);
  const xMid = (xStart + xEnd) / 2;
  const y0 = positionFromPercent(chicken.y0, stageHeight, spriteHeight);
  const yMid = positionFromPercent(chicken.yMid, stageHeight, spriteHeight);
  const y1 = positionFromPercent(chicken.y1, stageHeight, spriteHeight);
  const frame: ChickenFrameName = running ? (chicken.phase === 0 ? 'stepA' : 'stepB') : 'stand';

  return (
    <div
      className="chicken-count-bird absolute"
      data-dir={chicken.dir}
      style={
        {
          '--x-start': `${xStart.toFixed(1)}px`,
          '--x-mid': `${xMid.toFixed(1)}px`,
          '--x-end': `${xEnd.toFixed(1)}px`,
          '--y0': `${y0.toFixed(1)}px`,
          '--ymid': `${yMid.toFixed(1)}px`,
          '--y1': `${y1.toFixed(1)}px`,
          animationName: chicken.dir > 0 ? 'chicken-count-cross-ltr' : 'chicken-count-cross-rtl',
          animationDuration: `${chicken.duration}s`,
          animationDelay: `${chicken.delay}s`,
          animationPlayState: running ? 'running' : 'paused',
          zIndex: Math.round(chicken.yMid * 10),
        } as CSSProperties
      }
    >
      <div
        className="chicken-count-scale"
        style={{ transform: `scale(${chicken.scale})`, transformOrigin: 'center bottom' }}
      >
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
});

const ChickenFlock = memo(function ChickenFlock({
  chickens,
  running,
  stageSize,
}: {
  chickens: ChickenSpec[];
  running: boolean;
  stageSize: StageSize;
}) {
  return (
    <>
      {chickens.map((chicken) => (
        <ChickenBird key={chicken.id} chicken={chicken} running={running} stageSize={stageSize} />
      ))}
    </>
  );
});

interface ChickenCountGameProps {
  className?: string;
}

export function ChickenCountGame({ className = 'my-8' }: ChickenCountGameProps) {
  const [status, setStatus] = useState<GameStatus>('idle');
  const [roundIndex, setRoundIndex] = useState(0);
  const [trueCount, setTrueCount] = useState(30);
  const [seed, setSeed] = useState(1);
  const [estimateInput, setEstimateInput] = useState('');
  const [uncertaintyInput, setUncertaintyInput] = useState('');
  const [timeLeft, setTimeLeft] = useState(CHICKEN_ROUND_SECONDS);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [roundResults, setRoundResults] = useState<ChickenScore[]>([]);
  const [stageSize, setStageSize] = useState<StageSize>({ width: 0, height: 0 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const estimateInputRef = useRef<HTMLInputElement | null>(null);
  const endAtRef = useRef<number | null>(null);
  const finishedRef = useRef(false);

  const chickens = useMemo(() => createChickenSpecs(trueCount, seed), [seed, trueCount]);
  const estimate = parseNonNegative(estimateInput);
  const uncertainty = parseNonNegative(uncertaintyInput);
  const result: ChickenScore | null =
    status === 'revealed' && estimate !== null && uncertainty !== null
      ? scoreChickenEstimate({ trueCount, estimate, uncertainty, elapsedSeconds })
      : null;
  const displayedResult =
    result ??
    (status === 'revealed'
      ? scoreChickenEstimate({
          trueCount,
          estimate: 0,
          uncertainty: 0,
          elapsedSeconds: CHICKEN_ROUND_SECONDS,
        })
      : null);
  const roundConfig = CHICKEN_ROUNDS[roundIndex];
  const isFinalRound = roundIndex === CHICKEN_ROUNDS.length - 1;
  const gameComplete = status === 'idle' && roundResults.length >= CHICKEN_ROUNDS.length;
  const gameScore =
    roundResults.reduce((sum, score) => sum + score.score, 0) + (status === 'revealed' ? (displayedResult?.score ?? 0) : 0);

  const prepareRound = (nextRoundIndex: number, keepResults: ChickenScore[]) => {
    setRoundIndex(nextRoundIndex);
    setTrueCount(chickenCountForRound(nextRoundIndex));
    setSeed(Math.floor(Math.random() * 1_000_000_000));
    setEstimateInput('');
    setUncertaintyInput('');
    setElapsedSeconds(0);
    setTimeLeft(CHICKEN_ROUND_SECONDS);
    setRoundResults(keepResults);
    finishedRef.current = false;
    setStatus('running');
    window.setTimeout(() => estimateInputRef.current?.focus(), 0);
  };

  const finishRound = (remainingSeconds: number) => {
    if (finishedRef.current) {
      return;
    }
    finishedRef.current = true;
    const elapsed = CHICKEN_ROUND_SECONDS - Math.max(0, remainingSeconds);
    setElapsedSeconds(elapsed);
    setTimeLeft(0);
    setStatus('revealed');
  };

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
        finishRound(0);
      }
    }, 100);

    return () => {
      window.clearInterval(timer);
    };
  }, [status]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const updateStageSize = () => {
      const rect = stage.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      setStageSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };

    updateStageSize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateStageSize);
      return () => window.removeEventListener('resize', updateStageSize);
    }

    const observer = new ResizeObserver(updateStageSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const startGame = () => prepareRound(0, []);

  const revealNow = () => {
    if (status === 'running') {
      finishRound(timeLeft);
    }
  };

  const nextRound = () => {
    if (status !== 'revealed' || !displayedResult) {
      return;
    }
    const nextResults = [...roundResults, displayedResult];
    if (isFinalRound) {
      setRoundResults(nextResults);
      setStatus('idle');
      setRoundIndex(0);
      setTrueCount(30);
      setEstimateInput('');
      setUncertaintyInput('');
      setElapsedSeconds(0);
      setTimeLeft(CHICKEN_ROUND_SECONDS);
      return;
    }
    prepareRound(roundIndex + 1, nextResults);
  };

  const timerLabel = status === 'idle' ? `${CHICKEN_ROUND_SECONDS}.0 s` : `${timeLeft.toFixed(1)} s`;
  const inputsDisabled = status !== 'running';
  const startButtonLabel = roundResults.length >= CHICKEN_ROUNDS.length ? 'Play again' : 'Start game';

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
            <p className="mt-1 mb-0 text-sm leading-6 text-[var(--text-muted)]">
              {gameComplete
                ? `Game score ${gameScore}`
                : status === 'idle'
                ? ''
                : ``}
            </p>
          </div>
          <div className="rounded-full border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-3 py-1 text-right font-mono text-sm font-semibold tabular-nums">
            {timerLabel}
          </div>
        </div>

        <div
          ref={stageRef}
          className="chicken-count-stage relative min-h-[22rem] overflow-hidden rounded-lg border border-[var(--grid-line)] bg-[#22c55e]"
          aria-label="A timed field of running chickens to estimate"
        >
          <ChickenFlock chickens={chickens} running={status === 'running'} stageSize={stageSize} />
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-medium">
              <span>Estimate</span>
              <input
                ref={estimateInputRef}
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
            ) : status === 'revealed' ? (
              <Button type="button" onClick={nextRound}>
                {isFinalRound ? 'Finish game' : 'Next round'}
              </Button>
            ) : (
              <Button type="button" onClick={startGame}>
                {startButtonLabel}
              </Button>
            )}
          </ControlBar>
        </div>

        {status === 'idle' && (
          <p className="m-0 text-sm leading-6 text-[var(--text-muted)]">
            Count the flock, report an estimate with uncertainty, then repeat for three rounds.
          </p>
        )}

        {status === 'running' && (
          <p className="m-0 text-sm leading-6 text-[var(--text-muted)]" aria-live="polite">
            Enter your best count and the uncertainty range before time runs out. You can lock early.
          </p>
        )}

        {status === 'revealed' && (
          <>
            <Readout variant="cards">
              <Readout.Value label="true count" value={trueCount} />
              <Readout.Value
                label="your report"
                value={result ? formatGuess(result.estimate, result.uncertainty) : 'no valid report'}
              />
              <Readout.Value label="error" value={result ? formatNumber(result.error) : '—'} />
              <Readout.Value label="round score" value={displayedResult?.score ?? 0} />
            </Readout>
          </>
        )}
      </div>

      <style>{`
        @keyframes chicken-count-cross-ltr {
          0% {
            transform: translate3d(var(--x-start), var(--y0), 0) translateX(-50%);
          }
          50% {
            transform: translate3d(var(--x-mid), var(--ymid), 0) translateX(-50%);
          }
          100% {
            transform: translate3d(var(--x-end), var(--y1), 0) translateX(-50%);
          }
        }

        @keyframes chicken-count-cross-rtl {
          0% {
            transform: translate3d(var(--x-end), var(--y0), 0) translateX(-50%);
          }
          50% {
            transform: translate3d(var(--x-mid), var(--ymid), 0) translateX(-50%);
          }
          100% {
            transform: translate3d(var(--x-start), var(--y1), 0) translateX(-50%);
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
          animation-timing-function: linear;
          animation-iteration-count: infinite;
          animation-fill-mode: both;
          contain: layout style;
          will-change: transform;
        }

        .chicken-count-scale,
        .chicken-count-bob {
          will-change: transform;
        }

        .chicken-count-bob {
          animation: chicken-count-bob 300ms steps(2, end) infinite;
        }
      `}</style>
    </section>
  );
}
