import {
  ArrowLeft,
  ArrowRight,
  Cloud,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  Timer,
  Trophy,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import {
  STOP_ZONE_DEFAULTS,
  advanceDwell,
  chooseNextZoneCenter,
  formatSeconds,
  isInsideStopZone,
  sanitizeLeaderboardName,
  shrinkZoneHalfWidth,
  wrapPosition,
  type HistoryPoint,
  type MotionState,
  type StopZoneState,
} from '../../lib/kinematics/stopZones';

type ApiStatus = 'checking' | 'online' | 'offline';

interface ScoreEntry {
  id?: string;
  name: string;
  timeMs: number;
  stops: number;
  createdAt: number;
}

interface Runtime {
  motion: MotionState;
  paused: boolean;
  pauseStartedAt: number | null;
  aMax: number;
  wrapWorld: boolean;
  gameOn: boolean;
  zone: StopZoneState;
  startedAt: number;
  timelineStartedAt: number;
  finalTimeMs: number | null;
  runId: string | null;
  tick: number;
}

interface Snapshot {
  motion: MotionState;
  paused: boolean;
  aMax: number;
  wrapWorld: boolean;
  gameOn: boolean;
  zone: StopZoneState;
  finalTimeMs: number | null;
  elapsedMs: number;
  timeLeftMs: number;
  tick: number;
}

const INITIAL_MOTION: MotionState = { x: 0, v: 0, a: 0 };
const nowSeconds = () =>
  (typeof performance === 'undefined' ? Date.now() : performance.now()) / 1000;

const initialZone = (now: number): StopZoneState => ({
  center: 2,
  halfWidth: STOP_ZONE_DEFAULTS.startZoneHalfWidthM,
  dwell: 0,
  stops: 0,
  deadline: now + STOP_ZONE_DEFAULTS.firstZoneTimeS,
  gameOver: false,
  won: false,
});

const createRuntime = (): Runtime => {
  const now = nowSeconds();

  return {
    motion: { ...INITIAL_MOTION },
    paused: false,
    pauseStartedAt: null,
    aMax: STOP_ZONE_DEFAULTS.aMax,
    wrapWorld: true,
    gameOn: false,
    zone: initialZone(now),
    startedAt: now,
    timelineStartedAt: now,
    finalTimeMs: null,
    runId: null,
    tick: 0,
  };
};

const makeSnapshot = (runtime: Runtime): Snapshot => {
  const now = nowSeconds();

  return {
    motion: { ...runtime.motion },
    paused: runtime.paused,
    aMax: runtime.aMax,
    wrapWorld: runtime.wrapWorld,
    gameOn: runtime.gameOn,
    zone: { ...runtime.zone },
    finalTimeMs: runtime.finalTimeMs,
    elapsedMs: runtime.finalTimeMs ?? Math.max(0, Math.round((now - runtime.startedAt) * 1000)),
    timeLeftMs: Math.max(0, Math.round((runtime.zone.deadline - now) * 1000)),
    tick: runtime.tick,
  };
};

const getCssColor = (name: string, fallback: string) => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

const buttonClass =
  'inline-flex items-center justify-center gap-2 rounded-md border border-[var(--grid-line)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition-colors hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)] disabled:cursor-not-allowed disabled:opacity-50';

export default function StopInZonesChallenge() {
  const runtimeRef = useRef<Runtime | null>(null);
  if (runtimeRef.current === null) {
    runtimeRef.current = createRuntime();
  }

  const historyRef = useRef<HistoryPoint[]>([]);
  const keysRef = useRef({ left: false, right: false });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const submittedRef = useRef(false);
  const [snapshot, setSnapshot] = useState(() => makeSnapshot(runtimeRef.current as Runtime));
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');
  const [cloudScores, setCloudScores] = useState<ScoreEntry[]>([]);
  const [localScores, setLocalScores] = useState<ScoreEntry[]>([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [isPosting, setIsPosting] = useState(false);

  const syncSnapshot = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }

    setSnapshot(makeSnapshot(runtime));
  }, []);

  const loadLocalScores = useCallback(() => {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const raw = window.localStorage.getItem(STOP_ZONE_DEFAULTS.localStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        return parsed.slice(0, 10) as ScoreEntry[];
      }
    } catch {
      return [];
    }

    return [];
  }, []);

  const saveLocalScore = useCallback((score: ScoreEntry) => {
    const next = [...loadLocalScores(), score]
      .sort((a, b) => a.timeMs - b.timeMs || a.createdAt - b.createdAt)
      .slice(0, 10);

    try {
      window.localStorage.setItem(STOP_ZONE_DEFAULTS.localStorageKey, JSON.stringify(next));
    } catch {
      // The leaderboard is a bonus path; the game should keep working without storage.
    }

    setLocalScores(next);
    return next;
  }, [loadLocalScores]);

  const refreshLeaderboard = useCallback(async () => {
    try {
      const response = await fetch('/api/kinematics/leaderboard?limit=10', {
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Leaderboard request failed: ${response.status}`);
      }

      const body = await response.json();
      const scores = Array.isArray(body.scores) ? body.scores : [];
      setCloudScores(scores);
      setApiStatus('online');
    } catch {
      setApiStatus('offline');
    }
  }, []);

  const createServerRun = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }

    try {
      const response = await fetch('/api/kinematics/run', {
        method: 'POST',
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Run request failed: ${response.status}`);
      }

      const body = await response.json();
      runtime.runId = typeof body.runId === 'string' ? body.runId : null;
      setApiStatus(runtime.runId ? 'online' : 'offline');
    } catch {
      runtime.runId = null;
      setApiStatus('offline');
    }
  }, []);

  const restart = useCallback((gameOn = runtimeRef.current?.gameOn ?? false) => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }

    const now = nowSeconds();
    runtime.motion = { ...INITIAL_MOTION };
    runtime.paused = false;
    runtime.pauseStartedAt = null;
    runtime.gameOn = gameOn;
    runtime.wrapWorld = gameOn ? true : runtime.wrapWorld;
    runtime.zone = initialZone(now);
    runtime.startedAt = now;
    runtime.timelineStartedAt = now;
    runtime.finalTimeMs = null;
    runtime.runId = null;
    runtime.tick += 1;
    historyRef.current = [];
    submittedRef.current = false;
    setNameModalOpen(false);
    syncSnapshot();

    if (gameOn) {
      void createServerRun();
    }
  }, [createServerRun, syncSnapshot]);

  const setPaused = useCallback((nextPaused: boolean) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.paused === nextPaused) {
      return;
    }

    const now = nowSeconds();
    if (nextPaused) {
      runtime.paused = true;
      runtime.pauseStartedAt = now;
    } else {
      const pausedFor = now - (runtime.pauseStartedAt ?? now);
      runtime.startedAt += pausedFor;
      runtime.timelineStartedAt += pausedFor;
      runtime.zone.deadline += pausedFor;
      runtime.paused = false;
      runtime.pauseStartedAt = null;
    }

    runtime.tick += 1;
    syncSnapshot();
  }, [syncSnapshot]);

  const setGameMode = useCallback((gameOn: boolean) => {
    restart(gameOn);
  }, [restart]);

  const setWrapWorld = useCallback((wrapWorld: boolean) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.gameOn) {
      return;
    }

    runtime.wrapWorld = wrapWorld;
    runtime.tick += 1;
    syncSnapshot();
  }, [syncSnapshot]);

  const setAMax = useCallback((value: number) => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }

    runtime.aMax = value;
    runtime.tick += 1;
    syncSnapshot();
  }, [syncSnapshot]);

  useEffect(() => {
    setLocalScores(loadLocalScores());
    void refreshLeaderboard();
  }, [loadLocalScores, refreshLeaderboard]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') {
        return;
      }

      if (event.key === 'ArrowLeft' || event.code === 'KeyA') {
        event.preventDefault();
        keysRef.current.left = true;
      }
      if (event.key === 'ArrowRight' || event.code === 'KeyD') {
        event.preventDefault();
        keysRef.current.right = true;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        setPaused(!(runtimeRef.current?.paused ?? false));
      }
      if (event.key.toLowerCase() === 'r') {
        restart();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.code === 'KeyA') {
        keysRef.current.left = false;
      }
      if (event.key === 'ArrowRight' || event.code === 'KeyD') {
        keysRef.current.right = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [restart, setPaused]);

  useAnimationFrame((dt) => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }

    if (runtime.paused || runtime.zone.gameOver) {
      runtime.tick += 1;
      if (runtime.tick % 6 === 0) {
        syncSnapshot();
      }
      return;
    }

    const inputA =
      keysRef.current.left === keysRef.current.right
        ? 0
        : keysRef.current.right
          ? runtime.aMax
          : -runtime.aMax;

    runtime.motion.a = inputA;
    runtime.motion.v += runtime.motion.a * dt;
    runtime.motion.x += runtime.motion.v * dt;

    if (runtime.wrapWorld) {
      runtime.motion.x = wrapPosition(runtime.motion.x, STOP_ZONE_DEFAULTS.worldHalfWidthM);
    }

    const now = nowSeconds();
    const t = now - runtime.timelineStartedAt;
    historyRef.current.push({ t, ...runtime.motion });
    const cutoff = t - STOP_ZONE_DEFAULTS.historySeconds - 0.25;
    while (historyRef.current.length && historyRef.current[0].t < cutoff) {
      historyRef.current.shift();
    }

    if (runtime.gameOn) {
      const inside = isInsideStopZone(
        runtime.motion.x,
        runtime.zone.center,
        runtime.zone.halfWidth,
        STOP_ZONE_DEFAULTS.worldHalfWidthM,
      );
      const dwellResult = advanceDwell({
        currentDwell: runtime.zone.dwell,
        dt,
        inside,
        velocity: runtime.motion.v,
      });

      runtime.zone.dwell = dwellResult.dwell;

      if (inside && dwellResult.stopComplete) {
        runtime.zone.stops += 1;
        runtime.zone.halfWidth = shrinkZoneHalfWidth(runtime.zone.halfWidth);
        runtime.zone.center = chooseNextZoneCenter({ currentPosition: runtime.motion.x });
        runtime.zone.dwell = 0;
        runtime.zone.deadline += STOP_ZONE_DEFAULTS.zoneTimeIncrementS;

        if (runtime.zone.stops >= STOP_ZONE_DEFAULTS.winStops) {
          runtime.zone.gameOver = true;
          runtime.zone.won = true;
          runtime.finalTimeMs = Math.max(0, Math.round((now - runtime.startedAt) * 1000));
          setNameModalOpen(true);
        }
      }

      if (!runtime.zone.gameOver && now > runtime.zone.deadline) {
        runtime.zone.gameOver = true;
        runtime.zone.won = false;
        runtime.finalTimeMs = Math.max(0, Math.round((now - runtime.startedAt) * 1000));
      }
    }

    runtime.tick += 1;
    syncSnapshot();
  });

  useEffect(() => {
    drawStage(canvasRef.current, snapshot);
  }, [snapshot]);

  useEffect(() => {
    const handleResize = () => {
      drawStage(canvasRef.current, snapshot);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [snapshot]);

  const leaderboardScores = apiStatus === 'online' ? cloudScores : localScores;
  const leaderboardLabel = apiStatus === 'online' ? 'Cloud leaderboard' : 'Local leaderboard';

  const handleScoreSubmit = async () => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.finalTimeMs === null || submittedRef.current) {
      setNameModalOpen(false);
      return;
    }

    submittedRef.current = true;
    const score = {
      name: sanitizeLeaderboardName(playerName),
      timeMs: runtime.finalTimeMs,
      stops: STOP_ZONE_DEFAULTS.winStops,
      createdAt: Date.now(),
    };

    saveLocalScore(score);
    setShowLeaderboard(true);
    setNameModalOpen(false);

    if (!runtime.runId) {
      setApiStatus('offline');
      return;
    }

    setIsPosting(true);
    try {
      const response = await fetch('/api/kinematics/leaderboard', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          runId: runtime.runId,
          name: score.name,
          timeMs: score.timeMs,
          stops: score.stops,
        }),
      });

      if (!response.ok) {
        throw new Error(`Score submit failed: ${response.status}`);
      }

      const body = await response.json();
      setCloudScores(Array.isArray(body.scores) ? body.scores : []);
      setApiStatus('online');
    } catch {
      setApiStatus('offline');
    } finally {
      setIsPosting(false);
    }
  };

  return (
    <div className="flex h-full min-h-[48rem] w-full flex-col bg-[var(--sim-bg)] text-[var(--text-primary)]">
      <div className="grid gap-4 border-b border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonClass}
            onClick={() => setPaused(!snapshot.paused)}
            title={snapshot.paused ? 'Resume' : 'Pause'}
          >
            {snapshot.paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
            {snapshot.paused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" className={buttonClass} onClick={() => restart()} title="Restart">
            <RotateCcw size={16} aria-hidden="true" />
            Restart
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => setShowLeaderboard((value) => !value)}
            title="Leaderboard"
          >
            <Trophy size={16} aria-hidden="true" />
            Leaderboard
          </button>
          <label className="inline-flex items-center gap-2 rounded-md border border-[var(--grid-line)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={snapshot.gameOn}
              onChange={(event) => setGameMode(event.target.checked)}
              className="h-4 w-4 accent-[var(--accent-blue)]"
            />
            Challenge mode
          </label>
          <label className="inline-flex items-center gap-2 rounded-md border border-[var(--grid-line)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={snapshot.wrapWorld}
              disabled={snapshot.gameOn}
              onChange={(event) => setWrapWorld(event.target.checked)}
              className="h-4 w-4 accent-[var(--accent-blue)]"
            />
            Wrap world
          </label>
        </div>

        <div className="flex min-w-[16rem] items-center gap-3">
          <Gauge size={18} className="text-[var(--accent-blue)]" aria-hidden="true" />
          <label className="flex flex-1 items-center gap-3 text-sm font-semibold">
            <span>{snapshot.aMax.toFixed(1)} m/s^2</span>
            <input
              type="range"
              min="0"
              max="10"
              step="0.1"
              value={snapshot.aMax}
              onChange={(event) => setAMax(Number(event.target.value))}
              className="w-full accent-[var(--accent-blue)]"
            />
          </label>
        </div>
      </div>

      {snapshot.gameOn && (
        <div className="grid gap-3 border-b border-[var(--grid-line)] bg-[var(--surface-elevated)] p-4 md:grid-cols-3">
          <Metric label="Stops" value={`${snapshot.zone.stops} / ${STOP_ZONE_DEFAULTS.winStops}`} icon={<Trophy size={18} />} />
          <Metric label="Time left" value={formatSeconds(snapshot.timeLeftMs)} icon={<Timer size={18} />} />
          <Metric label="Total time" value={formatSeconds(snapshot.elapsedMs)} icon={<Timer size={18} />} />
        </div>
      )}

      {snapshot.gameOn && snapshot.zone.gameOver && (
        <div
          className={`border-b p-3 text-center text-sm font-semibold ${
            snapshot.zone.won
              ? 'border-green-500 bg-green-100 text-green-950'
              : 'border-amber-500 bg-amber-100 text-amber-950'
          }`}
        >
          {snapshot.zone.won
            ? `Run complete: ${formatSeconds(snapshot.finalTimeMs)}`
            : 'Time expired. Restart for another run.'}
        </div>
      )}

      <div className="grid flex-1 gap-4 p-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="x" value={`${snapshot.motion.x.toFixed(2)} m`} />
            <Metric label="v" value={`${snapshot.motion.v.toFixed(2)} m/s`} />
            <Metric label="a" value={`${snapshot.motion.a.toFixed(2)} m/s^2`} />
          </div>

          <div className="relative min-h-[15rem] overflow-hidden border border-[var(--grid-line)] bg-[var(--bg-primary)] shadow-sm">
            <canvas
              ref={canvasRef}
              className="block h-64 w-full touch-none"
              aria-label="One-dimensional cart simulation with position, velocity, and acceleration vectors"
            />
            <div className="pointer-events-none absolute inset-x-4 bottom-3 flex justify-between text-xs font-semibold text-[var(--text-muted)]">
              <span className="inline-flex items-center gap-1"><ArrowLeft size={14} /> A or Left</span>
              <span className="inline-flex items-center gap-1">D or Right <ArrowRight size={14} /></span>
            </div>
          </div>

          <div className="grid gap-3">
            <MiniPlot historyRef={historyRef} tick={snapshot.tick} label="x(t) [m]" color="#0ea5a0" yMin={snapshot.gameOn ? -6 : null} yMax={snapshot.gameOn ? 6 : null} />
            <MiniPlot historyRef={historyRef} tick={snapshot.tick} label="v(t) [m/s]" color="#7c3aed" />
            <MiniPlot historyRef={historyRef} tick={snapshot.tick} label="a(t) [m/s^2]" color="#d97706" yMin={-snapshot.aMax - 1} yMax={snapshot.aMax + 1} />
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <div className="border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="m-0 text-base font-semibold">{leaderboardLabel}</h3>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--text-muted)]">
                {apiStatus === 'online' ? <Cloud size={15} /> : <WifiOff size={15} />}
                {apiStatus}
              </span>
            </div>
            {showLeaderboard ? (
              leaderboardScores.length > 0 ? (
                <ol className="m-0 space-y-2 p-0">
                  {leaderboardScores.map((score, index) => (
                    <li
                      key={`${score.id ?? score.name}-${score.timeMs}-${index}`}
                      className="grid grid-cols-[2.5rem_1fr_5.5rem] items-center gap-2 border-b border-[var(--grid-line)] pb-2 text-sm last:border-b-0 last:pb-0"
                    >
                      <span className="text-right font-semibold text-[var(--text-muted)]">#{index + 1}</span>
                      <span className="min-w-0 truncate font-semibold">{score.name}</span>
                      <span>{formatSeconds(score.timeMs)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="m-0 text-sm text-[var(--text-muted)]">No scores yet.</p>
              )
            ) : (
              <p className="m-0 text-sm text-[var(--text-muted)]">Open the leaderboard after a challenge run.</p>
            )}
            {isPosting && <p className="mt-3 mb-0 text-sm text-[var(--text-muted)]">Posting score...</p>}
          </div>

          <div className="border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
            <h3 className="m-0 text-base font-semibold">Challenge Rules</h3>
            <ul className="mt-3 mb-0 space-y-2 pl-5 text-sm leading-6 text-[var(--text-muted)]">
              <li>Stop inside each shaded zone with speed below {STOP_ZONE_DEFAULTS.velocityThresholdMps.toFixed(2)} m/s.</li>
              <li>Hold the stop for {STOP_ZONE_DEFAULTS.holdTimeS.toFixed(1)} s before the next zone appears.</li>
              <li>Finish {STOP_ZONE_DEFAULTS.winStops} stops before a zone timer runs out.</li>
            </ul>
          </div>
        </aside>
      </div>

      {nameModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            className="w-full max-w-sm border border-[var(--grid-line)] bg-[var(--bg-primary)] p-5 text-[var(--text-primary)] shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              void handleScoreSubmit();
            }}
          >
            <h3 className="m-0 text-lg font-semibold">Save run</h3>
            <p className="mt-2 mb-4 text-sm text-[var(--text-muted)]">
              {STOP_ZONE_DEFAULTS.winStops} stops in {formatSeconds(snapshot.finalTimeMs)}
            </p>
            <label className="block text-sm font-semibold">
              Display name
              <input
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
                maxLength={24}
                placeholder="Initials or display name"
                className="mt-2 w-full rounded-md border border-[var(--grid-line)] bg-[var(--sim-bg)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
                autoFocus
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={buttonClass} onClick={() => setNameModalOpen(false)}>
                Skip
              </button>
              <button type="submit" className={buttonClass}>
                <Trophy size={16} aria-hidden="true" />
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function useAnimationFrame(callback: (dt: number) => void) {
  const callbackRef = useRef(callback);
  const frameRef = useRef<number | null>(null);
  const previousRef = useRef<number | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const loop = (timestamp: number) => {
      if (previousRef.current !== null) {
        const dt = Math.min((timestamp - previousRef.current) / 1000, 0.05);
        callbackRef.current(dt);
      }
      previousRef.current = timestamp;
      frameRef.current = requestAnimationFrame(loop);
    };

    frameRef.current = requestAnimationFrame(loop);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);
}

function Metric({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border border-[var(--grid-line)] bg-[var(--bg-primary)] p-3 shadow-sm">
      {icon && <span className="text-[var(--accent-blue)]">{icon}</span>}
      <div>
        <div className="text-xs font-semibold uppercase text-[var(--text-muted)]">{label}</div>
        <div className="text-lg font-semibold">{value}</div>
      </div>
    </div>
  );
}

function MiniPlot({
  historyRef,
  tick,
  label,
  color,
  yMin,
  yMax,
}: {
  historyRef: MutableRefObject<HistoryPoint[]>;
  tick: number;
  label: string;
  color: string;
  yMin?: number | null;
  yMax?: number | null;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [width, setWidth] = useState(0);
  const height = 108;
  const padding = { left: 42, right: 12, top: 10, bottom: 24 };

  useEffect(() => {
    const parent = svgRef.current?.parentElement;
    if (!parent) {
      return undefined;
    }

    const resize = () => setWidth(parent.clientWidth);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);

    return () => observer.disconnect();
  }, []);

  const { path, zeroY } = useMemo(() => {
    const data = historyRef.current;
    if (!data.length || width <= 0) {
      return { path: '', zeroY: null as number | null };
    }

    const tMax = data[data.length - 1].t;
    const tMin = Math.max(0, tMax - STOP_ZONE_DEFAULTS.historySeconds);
    let min = yMin ?? Infinity;
    let max = yMax ?? -Infinity;

    if (yMin === null || yMin === undefined || yMax === null || yMax === undefined) {
      data.forEach((point) => {
        if (point.t < tMin) return;
        const value = pickHistoryValue(label, point);
        min = Math.min(min, value);
        max = Math.max(max, value);
      });
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { path: '', zeroY: null as number | null };
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }

    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const mapX = (t: number) => padding.left + ((t - tMin) / (tMax - tMin || 1)) * plotWidth;
    const mapY = (value: number) =>
      padding.top + (1 - (value - min) / (max - min || 1)) * plotHeight;

    const d = data
      .filter((point) => point.t >= tMin)
      .map((point, index) => {
        const x = mapX(point.t);
        const y = mapY(pickHistoryValue(label, point));
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

    return {
      path: d,
      zeroY: min < 0 && max > 0 ? mapY(0) : null,
    };
  }, [historyRef, label, tick, width, yMin, yMax]);

  return (
    <div className="border border-[var(--grid-line)] bg-[var(--bg-primary)] p-3 shadow-sm">
      <div className="mb-2 text-xs font-semibold text-[var(--text-muted)]">{label}</div>
      <svg ref={svgRef} width="100%" height={height} role="img" aria-label={`${label} trace`}>
        <rect x={0} y={0} width={width} height={height} fill="var(--bg-primary)" />
        {zeroY !== null && (
          <line
            x1={padding.left}
            x2={Math.max(padding.left, width - padding.right)}
            y1={zeroY}
            y2={zeroY}
            stroke="var(--grid-line)"
            strokeWidth={1}
          />
        )}
        <path d={path} fill="none" stroke={color} strokeWidth={2.5} />
      </svg>
    </div>
  );
}

function pickHistoryValue(label: string, point: HistoryPoint) {
  if (label.startsWith('x(')) return point.x;
  if (label.startsWith('v(')) return point.v;
  if (label.startsWith('a(')) return point.a;
  return 0;
}

function drawStage(canvas: HTMLCanvasElement | null, snapshot: Snapshot) {
  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, rect.width);
  const height = Math.max(220, rect.height);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const panel = getCssColor('--bg-primary', '#ffffff');
  const grid = getCssColor('--grid-line', '#d1d5db');
  const text = getCssColor('--text-primary', '#111827');
  const muted = getCssColor('--text-muted', '#4b5563');
  const positionColor = '#0ea5a0';
  const velocityColor = '#7c3aed';
  const accelerationColor = '#d97706';
  const cartColor = '#475569';
  const midY = Math.round(height * 0.62);
  const pxPerMeter = Math.max(48, Math.min(92, width / 12));
  let originX = Math.round(width / 2);
  if (!snapshot.wrapWorld) {
    originX -= snapshot.motion.x * pxPerMeter;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = panel;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  const viewMinM = -(originX / pxPerMeter);
  const viewMaxM = (width - originX) / pxPerMeter;
  for (let meter = Math.floor(viewMinM); meter <= Math.ceil(viewMaxM); meter += 1) {
    const x = originX + meter * pxPerMeter;
    ctx.beginPath();
    ctx.moveTo(x, midY - 16);
    ctx.lineTo(x, midY + 16);
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.font = `11px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(String(meter), x, midY + 32);
  }

  ctx.strokeStyle = muted;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(16, midY);
  ctx.lineTo(width - 16, midY);
  ctx.stroke();

  if (snapshot.gameOn) {
    drawZone(ctx, snapshot.zone.center, snapshot.zone.halfWidth, originX, pxPerMeter, midY, width);
  }

  const cartX = originX + snapshot.motion.x * pxPerMeter;
  const cartY = midY - 20;
  const cartW = 46;
  const cartH = 26;

  ctx.fillStyle = 'rgba(0,0,0,0.09)';
  ctx.beginPath();
  ctx.ellipse(cartX, midY + 9, cartW * 0.56, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = cartColor;
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1.5;
  roundedRect(ctx, cartX - cartW / 2, cartY - cartH / 2, cartW, cartH, 6);
  ctx.fill();
  ctx.stroke();

  const positionY = midY + 52;
  drawArrow(ctx, originX, positionY, originX + snapshot.motion.x * pxPerMeter, positionY, positionColor);
  drawArrow(
    ctx,
    cartX,
    cartY - cartH * 0.95,
    cartX + Math.max(-300, Math.min(300, snapshot.motion.v * 18)),
    cartY - cartH * 0.95,
    velocityColor,
  );
  drawArrow(
    ctx,
    cartX,
    cartY - cartH * 1.75,
    cartX + Math.max(-150, Math.min(150, snapshot.motion.a * 16)),
    cartY - cartH * 1.75,
    accelerationColor,
  );

  ctx.fillStyle = text;
  ctx.font = `600 12px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('position', Math.min(width - 70, Math.max(12, originX - 32)), positionY - 8);
  ctx.fillText('velocity', Math.min(width - 70, Math.max(12, cartX - 28)), cartY - cartH * 0.95 - 9);
  ctx.fillText('acceleration', Math.min(width - 94, Math.max(12, cartX - 42)), cartY - cartH * 1.75 - 9);

  if (snapshot.gameOn) {
    const inside = isInsideStopZone(
      snapshot.motion.x,
      snapshot.zone.center,
      snapshot.zone.halfWidth,
      STOP_ZONE_DEFAULTS.worldHalfWidthM,
    );
    const slow = Math.abs(snapshot.motion.v) <= STOP_ZONE_DEFAULTS.velocityThresholdMps;
    const dwellFrac = Math.min(1, snapshot.zone.dwell / STOP_ZONE_DEFAULTS.holdTimeS);
    const barWidth = Math.min(220, width - 32);
    const x = 16;
    const y = 16;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
    roundedRect(ctx, x, y, barWidth, 12, 6);
    ctx.fill();
    ctx.fillStyle = inside && slow ? '#16a34a' : '#94a3b8';
    roundedRect(ctx, x, y, barWidth * dwellFrac, 12, 6);
    ctx.fill();
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length < 4) {
    return;
  }
  const ux = dx / length;
  const uy = dy / length;
  const size = 6;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - ux * 10 - uy * size, y2 - uy * 10 + ux * size);
  ctx.lineTo(x2 - ux * 10 + uy * size, y2 - uy * 10 - ux * size);
  ctx.closePath();
  ctx.fill();
}

function drawZone(
  ctx: CanvasRenderingContext2D,
  centerM: number,
  halfWidthM: number,
  originX: number,
  pxPerMeter: number,
  midY: number,
  canvasWidth: number,
) {
  const leftPx = originX + (centerM - halfWidthM) * pxPerMeter;
  const rightPx = originX + (centerM + halfWidthM) * pxPerMeter;
  const worldPx = STOP_ZONE_DEFAULTS.worldHalfWidthM * 2 * pxPerMeter;
  const top = midY - 27;
  const height = 54;
  const pad = 16;

  ctx.fillStyle = 'rgba(59, 130, 246, 0.14)';
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;

  const drawSegment = (x1: number, x2: number) => {
    const width = Math.max(0, x2 - x1);
    if (width <= 0) {
      return;
    }
    roundedRect(ctx, x1, top, width, height, 7);
    ctx.fill();
    ctx.stroke();
  };

  if (leftPx >= pad && rightPx <= canvasWidth - pad) {
    drawSegment(leftPx, rightPx);
    return;
  }

  if (leftPx < pad) {
    drawSegment(pad, Math.min(rightPx, canvasWidth - pad));
    drawSegment(Math.max(leftPx + worldPx, pad), canvasWidth - pad);
  } else if (rightPx > canvasWidth - pad) {
    drawSegment(leftPx, canvasWidth - pad);
    drawSegment(pad, rightPx - worldPx);
  }
}
