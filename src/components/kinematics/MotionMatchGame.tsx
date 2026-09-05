import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, Dices, Trophy, WifiOff } from 'lucide-react';
import { Button } from '../shared/InlineControls';
import { fixed } from '../../utils/format';
import {
  generateLeaderboardName,
  isBlockedLeaderboardName,
  sanitizeLeaderboardName,
} from '../../lib/shared/leaderboardNames';
import {
  MAX_TOTAL_SCORE,
  MOTION_GAME_DEFAULTS,
  MOTION_GRAPH_COUNT,
  ROUND_SECONDS,
  SUBMISSION_PERIOD_SECONDS,
  attemptFeedback,
  fromMotionSamples,
  generateMotionGraphs,
  motionGameTotal,
  randomSeed,
  scoreAttempt,
  selectBestMotionGameScoresByUniqueName,
  type MotionGameLeaderboardScore,
} from '../../lib/kinematics/motionGame';
import { MOTION_DETECTOR_RANGE, type SensorContext } from '../../lib/vernier/sensorIds';
import { resample, velocityAt, type MotionSample } from '../../lib/vernier/motionStream';
import { DEFAULT_PERIOD_SECONDS } from '../../lib/vernier/ngioSession';
import { useVernierMotion } from '../hardware/useVernierMotion';
import VernierConnectPanel from '../hardware/VernierConnectPanel';
import TargetPlot, { type TracePoint } from './motionGame/TargetPlot';

// Motion Match: walk the shape of a graph.
//
// The recording loop runs on setInterval rather than requestAnimationFrame.
// The sample clock should follow the detector's 20 Hz period, not the display
// refresh, and a backgrounded tab throttles rAF to nothing — which would
// silently truncate a round mid-walk.

type Phase = 'setup' | 'ready' | 'countdown' | 'recording' | 'review' | 'finished';

interface RoundResult {
  samples: MotionSample[];
  score: number;
  feedback: string;
  retried: boolean;
}

const COUNTDOWN_SECONDS = 3;
const TICK_MS = 100;
const ON_MARK_TOLERANCE = 0.1;

const LOCAL_LIMIT = MOTION_GAME_DEFAULTS.leaderboardLimit;

/**
 * The heading names the quantity and nothing else. Telling someone how to walk
 * the curve would be reading the graph for them, which is the one thing this
 * activity is asking them to do. The shape is on screen; that is the whole
 * exercise. (The plot's aria-label still carries a description of the curve's
 * shape, which is the only account of it a screen-reader user gets.)
 */
const quantityTitle = (quantity: 'position' | 'velocity') =>
  quantity === 'position' ? 'Position vs time' : 'Velocity vs time';

interface LocalScore extends MotionGameLeaderboardScore {
  id: string;
}

export default function MotionMatchGame({ className = '' }: { className?: string }) {
  const device = useVernierMotion();

  const [phase, setPhase] = useState<Phase>('setup');
  const [roundIndex, setRoundIndex] = useState(0);
  const [seed, setSeed] = useState(() => randomSeed());
  const [results, setResults] = useState<(RoundResult | null)[]>([null, null, null]);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [elapsed, setElapsed] = useState(0);
  const [liveTrace, setLiveTrace] = useState<MotionSample[]>([]);

  const [playerName, setPlayerName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [apiStatus, setApiStatus] = useState<'unknown' | 'online' | 'offline'>('unknown');
  const [cloudScores, setCloudScores] = useState<LocalScore[]>([]);
  const [localScores, setLocalScores] = useState<LocalScore[]>([]);

  const bufferRef = useRef<MotionSample[]>([]);
  const offsetRef = useRef<number | null>(null);
  const recordingRef = useRef(false);
  const runIdRef = useRef<string | null>(null);
  const submittedRef = useRef(false);
  const wallStartRef = useRef(0);

  // Targets are regenerated every run. In a cloud run the seed comes from the
  // server alongside the run token, so the endpoint can rebuild the same three
  // graphs when it scores the submission; practice runs just roll their own.
  const graphs = useMemo(() => generateMotionGraphs(seed), [seed]);
  const graph = graphs[roundIndex];
  const isPractice = device.sourceId === 'practice';
  const connected = device.status.kind === 'ready' || device.status.kind === 'streaming';

  // --- local leaderboard ---------------------------------------------------

  const loadLocalScores = useCallback((): LocalScore[] => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(MOTION_GAME_DEFAULTS.localStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? selectBestMotionGameScoresByUniqueName(parsed, LOCAL_LIMIT) : [];
    } catch {
      return [];
    }
  }, []);

  const saveLocalScore = useCallback(
    (entry: LocalScore) => {
      if (typeof window === 'undefined') return;
      try {
        const next = selectBestMotionGameScoresByUniqueName([...loadLocalScores(), entry], LOCAL_LIMIT);
        window.localStorage.setItem(MOTION_GAME_DEFAULTS.localStorageKey, JSON.stringify(next));
        setLocalScores(next);
      } catch {
        // A private window with storage disabled is not worth a visible error.
      }
    },
    [loadLocalScores],
  );

  const refreshLeaderboard = useCallback(async () => {
    try {
      const response = await fetch(`/api/kinematics/motion-game/leaderboard?limit=${LOCAL_LIMIT}`, {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Motion game leaderboard request failed: ${response.status}`);
      const body = await response.json();
      setCloudScores(Array.isArray(body.scores) ? body.scores : []);
      setApiStatus('online');
    } catch {
      setApiStatus('offline');
    }
  }, []);

  const createServerRun = useCallback(async () => {
    try {
      const response = await fetch('/api/kinematics/motion-game/run', {
        method: 'POST',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Motion game run request failed: ${response.status}`);
      const body = await response.json();
      runIdRef.current = typeof body.runId === 'string' ? body.runId : null;
      if (Number.isFinite(Number(body.seed))) setSeed(Number(body.seed) >>> 0);
      setApiStatus(runIdRef.current ? 'online' : 'offline');
    } catch {
      runIdRef.current = null;
      setApiStatus('offline');
    }
  }, []);

  useEffect(() => {
    setLocalScores(loadLocalScores());
    void refreshLeaderboard();
  }, [loadLocalScores, refreshLeaderboard]);

  // --- sample capture ------------------------------------------------------

  useEffect(
    () =>
      device.subscribe((sample) => {
        if (!recordingRef.current) return;

        // Timestamps stay on the device clock, rezeroed at the first sample of
        // the round. Using arrival time instead would fold USB jitter into
        // every velocity the scorer derives.
        if (offsetRef.current === null) offsetRef.current = sample.t;
        const t = sample.t - offsetRef.current;
        if (t > ROUND_SECONDS) return;

        bufferRef.current.push({ ...sample, t });
      }),
    [device],
  );

  // Drop the practice walker onto the round's start mark whenever a round is
  // waiting to begin. Doing it here rather than in each of beginGame/retry/next
  // keeps it correct when the targets have just been regenerated: `graph` is
  // derived from the new seed, which the callbacks cannot see yet.
  const practiceSource = device.practice;
  useEffect(() => {
    if (phase !== 'ready') return;
    practiceSource?.reset(graph.startMeters);
  }, [phase, graph.startMeters, practiceSource]);

  const finishRound = useCallback(() => {
    recordingRef.current = false;
    const samples = bufferRef.current.slice();
    const score = scoreAttempt(graph, samples);
    const feedback = attemptFeedback(graph, samples);

    setResults((previous) => {
      const next = [...previous];
      const existing = previous[roundIndex];
      // One retry per graph, better attempt counts.
      next[roundIndex] =
        existing && existing.score >= score
          ? { ...existing, retried: true }
          : { samples, score, feedback, retried: existing !== null };
      return next;
    });

    setLiveTrace(samples);
    setPhase('review');
  }, [graph, roundIndex]);

  // Countdown and recording clock.
  useEffect(() => {
    if (phase !== 'countdown' && phase !== 'recording') return undefined;

    const timer = setInterval(() => {
      const wallElapsed = (Date.now() - wallStartRef.current) / 1000;

      if (phase === 'countdown') {
        const remaining = COUNTDOWN_SECONDS - wallElapsed;
        setCountdown(Math.max(0, Math.ceil(remaining)));
        if (remaining <= 0) {
          bufferRef.current = [];
          offsetRef.current = null;
          recordingRef.current = true;
          wallStartRef.current = Date.now();
          setElapsed(0);
          setLiveTrace([]);
          setPhase('recording');
        }
        return;
      }

      const captured = bufferRef.current;
      const deviceElapsed = captured.length > 0 ? captured[captured.length - 1].t : 0;
      setElapsed(Math.min(deviceElapsed, ROUND_SECONDS));
      setLiveTrace(captured.slice());

      // Ends on the device clock, with the wall clock as a backstop so a
      // stalled sensor cannot leave the round running forever.
      if (deviceElapsed >= ROUND_SECONDS || wallElapsed >= ROUND_SECONDS + 2) {
        finishRound();
      }
    }, TICK_MS);

    return () => clearInterval(timer);
  }, [phase, finishRound]);

  // --- round control -------------------------------------------------------

  const beginGame = useCallback(async () => {
    submittedRef.current = false;
    runIdRef.current = null;
    setSubmitted(false);
    setPlayerName('');
    setNameError(null);
    setResults([null, null, null]);
    setRoundIndex(0);
    setLiveTrace([]);
    setPhase('ready');

    if (isPractice) {
      setSeed(randomSeed());
    } else {
      await createServerRun();
    }
    await device.startStream(DEFAULT_PERIOD_SECONDS);
  }, [createServerRun, device, isPractice]);

  const startCountdown = useCallback(() => {
    wallStartRef.current = Date.now();
    setCountdown(COUNTDOWN_SECONDS);
    setPhase('countdown');
  }, []);

  const retryRound = useCallback(() => {
    setLiveTrace([]);
    setPhase('ready');
  }, []);

  const nextRound = useCallback(() => {
    if (roundIndex >= MOTION_GRAPH_COUNT - 1) {
      void device.stopStream();
      setPhase('finished');
      return;
    }
    setRoundIndex(roundIndex + 1);
    setLiveTrace([]);
    setPhase('ready');
  }, [device, roundIndex]);

  // --- submission ----------------------------------------------------------

  const completed = results.filter((result): result is RoundResult => result !== null);
  const totalScore = motionGameTotal(completed.map((result) => result.score));
  const retriesUsed = completed.filter((result) => result.retried).length;
  const canPostToCloud = !isPractice && device.sourceId !== null;

  const handleScoreSubmit = useCallback(async () => {
    if (submittedRef.current || completed.length < MOTION_GRAPH_COUNT) return;

    if (isBlockedLeaderboardName(playerName)) {
      setNameError('That name cannot go on a shared board. Try another, or roll one.');
      return;
    }

    submittedRef.current = true;
    setSubmitted(true);

    const attempts = graphs.map((target, index) => ({
      graph: target.id,
      retried: completed[index].retried,
      samples: fromMotionSamples(
        resample(completed[index].samples, SUBMISSION_PERIOD_SECONDS, target.durationSeconds),
      ),
    }));

    const entry: LocalScore = {
      id: `local-${Date.now()}`,
      name: sanitizeLeaderboardName(playerName),
      score: totalScore,
      graph1Score: completed[0].score,
      graph2Score: completed[1].score,
      graph3Score: completed[2].score,
      retriesUsed,
      createdAt: Date.now(),
    };

    saveLocalScore(entry);

    if (!canPostToCloud || !runIdRef.current) {
      setApiStatus('offline');
      return;
    }

    setIsPosting(true);
    try {
      const response = await fetch('/api/kinematics/motion-game/leaderboard', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          runId: runIdRef.current,
          name: entry.name,
          score: entry.score,
          retriesUsed,
          attempts,
        }),
      });
      if (!response.ok) throw new Error(`Motion game score submit failed: ${response.status}`);
      const body = await response.json();
      setCloudScores(Array.isArray(body.scores) ? body.scores : []);
      setApiStatus('online');
    } catch {
      setApiStatus('offline');
    } finally {
      setIsPosting(false);
      runIdRef.current = null;
    }
  }, [canPostToCloud, completed, playerName, retriesUsed, saveLocalScore, totalScore]);

  // --- derived plot data ---------------------------------------------------

  const tracePoints: TracePoint[] = useMemo(() => {
    if (liveTrace.length === 0) return [];

    if (graph.quantity === 'position') {
      return liveTrace.map((sample) => ({
        t: sample.t,
        value: sample.quality === 'ok' ? sample.distance : null,
      }));
    }

    return liveTrace.map((sample) => ({
      t: sample.t,
      value: sample.quality === 'ok' ? velocityAt(liveTrace, sample.t) : null,
    }));
  }, [liveTrace, graph.quantity]);

  const liveDistance =
    device.latest && device.latest.quality === 'ok' ? device.latest.distance : null;
  const onMark =
    liveDistance !== null && Math.abs(liveDistance - graph.startMeters) <= ON_MARK_TOLERANCE;

  return (
    <div className={`not-prose px-5 py-4 ${className}`.trim()}>
      {phase === 'setup' && (
        <>
          <VernierConnectPanel device={device} />
          {connected && (
            <div className="mt-4">
              <Button onClick={() => void beginGame()}>Start the three graphs</Button>
              {isPractice && (
                <p className="mt-2 text-sm text-[var(--text-muted)]">
                  Practice runs are scored and saved on this device, but they do not go on the
                  shared board — a mouse and a pair of legs are not the same contest.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {phase !== 'setup' && phase !== 'finished' && (
        <div>
          <h3 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">
            Graph {roundIndex + 1} of {MOTION_GRAPH_COUNT}: {quantityTitle(graph.quantity)}
          </h3>

          {/* The controls sit on the plot rather than under it. Whoever presses
              them is about to walk away from the screen, so they should be the
              biggest thing in view and in the place the eye is already resting.
              Recording is the one phase with no overlay — nothing should cover
              the trace while it is being drawn. */}
          {/* The aspect ratio is on the wrapper, not left to the SVG's own
              intrinsic sizing. An inline SVG sized only by `width: 100%` can
              resolve to zero height, and then `inset-0` has no box to centre
              the controls in and the card spills out of the plot. Fixing the
              ratio here matches the viewBox and makes the overlay reliable. */}
          <div className="relative aspect-[720/340] w-full">
            <TargetPlot
              className="absolute inset-0 h-full w-full"
              graph={graph}
              trace={tracePoints}
              now={phase === 'recording' ? elapsed : null}
            />

            {phase !== 'recording' && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
                <div className="pointer-events-auto max-w-md rounded-xl border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-6 py-5 text-center shadow-lg">
                  {phase === 'ready' && (
                    <>
                      <p className="text-sm text-[var(--text-primary)]">
                        Stand {fixed(graph.startMeters, 2)} m from the detector.{' '}
                        {liveDistance === null ? (
                          <span className="text-[var(--text-muted)]">No echo yet.</span>
                        ) : (
                          <span
                            className={
                              onMark ? 'text-[var(--accent-green)]' : 'text-[var(--text-muted)]'
                            }
                          >
                            You are at {fixed(liveDistance, 2)} m.
                          </span>
                        )}
                      </p>
                      <Button
                        className="mt-3 px-6 py-2.5 text-base"
                        onClick={startCountdown}
                        disabled={!onMark}
                      >
                        {onMark ? 'Start the round' : 'Move onto the mark'}
                      </Button>
                    </>
                  )}

                  {phase === 'countdown' && (
                    <p
                      className="text-6xl font-semibold tabular-nums text-[var(--accent-red)]"
                      role="status"
                    >
                      {countdown > 0 ? countdown : 'Go'}
                    </p>
                  )}

                  {phase === 'review' && results[roundIndex] && (
                    <>
                      <p className="text-sm text-[var(--text-primary)]">
                        <strong>{results[roundIndex]!.score} / 100.</strong>{' '}
                        {results[roundIndex]!.feedback}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
                        {!results[roundIndex]!.retried && (
                          <Button variant="secondary" className="px-5 py-2.5" onClick={retryRound}>
                            Retry this graph
                          </Button>
                        )}
                        <Button className="px-6 py-2.5 text-base" onClick={nextRound}>
                          {roundIndex >= MOTION_GRAPH_COUNT - 1 ? 'See the total' : 'Next graph'}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {isPractice && (phase === 'ready' || phase === 'countdown' || phase === 'recording') && (
            <PracticeStrip device={device} />
          )}

          <div className="mt-3 min-h-[1.75rem]">
            {phase === 'recording' && (
              <p className="text-sm text-[var(--text-primary)]" role="status">
                Recording — {fixed(ROUND_SECONDS - elapsed, 1)} s left
              </p>
            )}
          </div>
        </div>
      )}

      {phase === 'finished' && (
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            {totalScore} out of {MAX_TOTAL_SCORE}
          </h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {graphs.map(
              (target, index) =>
                `Graph ${index + 1} (${target.quantity}) ${completed[index]?.score ?? 0}`,
            ).join(' · ')}
            {retriesUsed > 0 && ` · ${retriesUsed} retr${retriesUsed === 1 ? 'y' : 'ies'} used`}
          </p>

          {!submitted && canPostToCloud && (
            <form
              className="mt-4 flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void handleScoreSubmit();
              }}
            >
              <label className="text-sm text-[var(--text-primary)]" htmlFor="motion-game-name">
                Name for the board
              </label>
              <input
                id="motion-game-name"
                className="rounded border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-2 py-1 text-sm text-[var(--text-primary)]"
                maxLength={24}
                value={playerName}
                onChange={(event) => {
                  setPlayerName(event.target.value);
                  setNameError(null);
                }}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setPlayerName(generateLeaderboardName());
                  setNameError(null);
                }}
              >
                <Dices aria-hidden="true" className="mr-1 inline h-4 w-4 align-text-bottom" />
                Roll
              </Button>
              <Button type="submit" disabled={isPosting || playerName.trim().length === 0}>
                {isPosting ? 'Posting…' : 'Post score'}
              </Button>
              {nameError && (
                <p className="w-full text-sm text-[var(--accent-red)]" role="alert">
                  {nameError}
                </p>
              )}
            </form>
          )}

          {!canPostToCloud && (
            <p className="mt-3 text-sm text-[var(--text-muted)]">
              Practice runs stay on this device. Connect a LabQuest and a Motion Detector to play
              for the shared board.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={() => void beginGame()}>Play again</Button>
            <Button
              variant="secondary"
              onClick={() => {
                void device.disconnect();
                setPhase('setup');
              }}
            >
              Change detector
            </Button>
          </div>

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <Board
              label={apiStatus === 'online' ? 'Cloud leaderboard' : 'Cloud leaderboard (offline)'}
              online={apiStatus === 'online'}
              scores={cloudScores}
            />
            <Board label="This device" online scores={localScores} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Pointer and keyboard control for practice mode. Left is close to the
 * detector, right is far — the same orientation as distance on the plot above,
 * so the mental mapping is the one the graph already teaches.
 */
function PracticeStrip({ device }: { device: ReturnType<typeof useVernierMotion> }) {
  const min = MOTION_DETECTOR_RANGE.minMeters;
  const max = 2.6;
  const current = device.latest?.distance ?? min;

  const setFromClientX = (element: HTMLElement, clientX: number) => {
    const rect = element.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    device.practice?.setTarget(min + fraction * (max - min));
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Practice walker position"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(current.toFixed(2))}
      aria-valuetext={`${current.toFixed(2)} metres from the detector`}
      className="mt-3 h-12 w-full cursor-ew-resize touch-none rounded border border-[var(--grid-line)] bg-[var(--sim-bg)]"
      style={{ touchAction: 'none' }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setFromClientX(event.currentTarget, event.clientX);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 0) return;
        setFromClientX(event.currentTarget, event.clientX);
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.01 : 0.05;
        if (event.key === 'ArrowLeft') {
          device.practice?.setTarget((device.practice?.getTarget() ?? current) - step);
          event.preventDefault();
        }
        if (event.key === 'ArrowRight') {
          device.practice?.setTarget((device.practice?.getTarget() ?? current) + step);
          event.preventDefault();
        }
      }}
    >
      <div className="relative h-full">
        <div
          className="absolute top-1 h-10 w-1 -translate-x-1/2 rounded bg-[var(--accent-blue)]"
          style={{ left: `${((current - min) / (max - min)) * 100}%` }}
        />
        <span className="absolute bottom-1 left-2 text-[11px] text-[var(--text-muted)]">
          near ({min} m)
        </span>
        <span className="absolute right-2 bottom-1 text-[11px] text-[var(--text-muted)]">
          far ({max} m)
        </span>
      </div>
    </div>
  );
}

function Board({
  label,
  online,
  scores,
}: {
  label: string;
  online: boolean;
  scores: LocalScore[];
}) {
  return (
    <div>
      <h4 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
        <Trophy aria-hidden="true" className="h-4 w-4" />
        {label}
        {online ? (
          <Cloud aria-hidden="true" className="h-3.5 w-3.5 text-[var(--text-muted)]" />
        ) : (
          <WifiOff aria-hidden="true" className="h-3.5 w-3.5 text-[var(--text-muted)]" />
        )}
      </h4>
      {scores.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--text-muted)]">No scores yet.</p>
      ) : (
        <ol className="mt-2 space-y-1 text-sm">
          {scores.map((score, index) => (
            <li key={score.id} className="flex justify-between gap-3 text-[var(--text-primary)]">
              <span className="truncate">
                {index + 1}. {score.name}
              </span>
              <span className="font-mono">{score.score}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
