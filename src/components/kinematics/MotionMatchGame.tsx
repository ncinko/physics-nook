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
import { decideStream } from '../../lib/vernier/streamPolicy';
import { useVernierMotion } from '../hardware/useVernierMotion';
import VernierConnectPanel from '../hardware/VernierConnectPanel';
import TargetPlot, { type TracePoint } from './motionGame/TargetPlot';

// Motion Match: walk the shape of a graph.
//
// The recording loop runs on setInterval rather than requestAnimationFrame.
// The sample clock should follow the detector's 20 Hz period, not the display
// refresh, and a backgrounded tab throttles rAF to nothing — which would
// silently truncate a round mid-walk.

type Phase = 'setup' | 'ready' | 'arming' | 'countdown' | 'recording' | 'review' | 'finished';

interface RoundResult {
  samples: MotionSample[];
  score: number;
  retried: boolean;
}

const COUNTDOWN_SECONDS = 3;
const TICK_MS = 100;
const ON_MARK_TOLERANCE = 0.1;

/**
 * How long you must stand on the mark before the countdown starts on its own.
 *
 * Replaces a "start the round" button, which asked you to be in position and
 * within reach of the keyboard at the same time — the detector is across the
 * room from the screen, so those are different places.
 */
const HOLD_SECONDS = 3;

/**
 * Sample periods, loudest to quietest. The detector's ping is audible, so the
 * rate is not only a data question: pinging 20 times a second through a review
 * screen or a name entry box is unpleasant in a classroom.
 *
 * 20 Hz is the sensor manual's optimum and only a recording needs it. Getting
 * on the mark needs enough resolution to feel responsive but no more. Anything
 * else just needs a live reading so the connect panel's calibration check has
 * something to read. Once the three rounds are scored nothing reads the
 * detector at all, so it stops rather than idling — a board being read over is
 * no place for a metronome.
 */
const IDLE_PERIOD_SECONDS = 1;
const AIMING_PERIOD_SECONDS = 0.25;

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

/**
 * The simulated walker is kept, but not offered.
 *
 * It is how the whole game gets exercised without hardware — the recording
 * loop, scoring, retries and the local board all run identically off it — so
 * deleting it would cost the only way to test any of that. It just has no
 * business being a choice a reader can make: the activity is walking in front
 * of a detector, and a mouse-driven run is a different exercise wearing the
 * same clothes. Add `?practice=1` to the URL to bring it back.
 */
const isPracticeEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('practice');
};

interface LocalScore extends MotionGameLeaderboardScore {
  id: string;
}

export default function MotionMatchGame({ className = '' }: { className?: string }) {
  const device = useVernierMotion();

  const [phase, setPhase] = useState<Phase>('setup');
  const [roundIndex, setRoundIndex] = useState(0);
  const [seed, setSeed] = useState(() => randomSeed());
  const [allowPractice] = useState(isPracticeEnabled);
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

  const liveDistance =
    device.latest && device.latest.quality === 'ok' ? device.latest.distance : null;
  const onMark =
    liveDistance !== null && Math.abs(liveDistance - graph.startMeters) <= ON_MARK_TOLERANCE;

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

    setResults((previous) => {
      const next = [...previous];
      const existing = previous[roundIndex];
      // One retry per graph, better attempt counts.
      next[roundIndex] =
        existing && existing.score >= score
          ? { ...existing, retried: true }
          : { samples, score, retried: existing !== null };
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

  // --- detector duty cycle -------------------------------------------------

  /** Seconds between pings, or null to stop the detector outright. */
  const streamPeriod: number | null =
    phase === 'countdown' || phase === 'recording'
      ? DEFAULT_PERIOD_SECONDS
      : phase === 'ready' || phase === 'arming'
        ? AIMING_PERIOD_SECONDS
        : phase === 'finished'
          ? null
          : IDLE_PERIOD_SECONDS;

  // Destructured because the hook's value object is rebuilt on every sample;
  // depending on `device` here would restart the stream twenty times a second.
  const { startStream, setStreamPeriod, stopStream } = device;
  const statusKind = device.status.kind;
  const sourceId = device.sourceId;

  /** The source we have already opened a stream for, if any. */
  const streamedSourceRef = useRef<string | null>(null);
  /** The last rate we actually asked for, so a repeat is not a retune. */
  const streamPeriodRef = useRef(streamPeriod ?? IDLE_PERIOD_SECONDS);
  /** What the open stream is running at, or null when it is stopped. */
  const appliedPeriodRef = useRef<number | null>(null);

  // The stream starts as soon as a detector connects, not when a game begins:
  // the connect panel's calibration check needs a live reading, and before
  // this it had none, which is why it never reported anything. The rule for
  // when to do that lives in `decideStream`, which is tested.
  useEffect(() => {
    const decision = decideStream(sourceId, statusKind, streamedSourceRef.current);

    if (decision === 'forget') {
      streamedSourceRef.current = null;
      appliedPeriodRef.current = null;
      return;
    }

    if (decision === 'wait') return;

    streamedSourceRef.current = sourceId;
    appliedPeriodRef.current = streamPeriodRef.current;
    void startStream(streamPeriodRef.current);
  }, [sourceId, statusKind, startStream]);

  // Rate changes are their own effect so a status transition cannot trigger
  // one, and so this stays silent until a stream actually exists. It compares
  // against the rate in force rather than firing on every render: a retune
  // costs a stop/start round trip on the device, so asking for the rate it is
  // already running at has to be free.
  useEffect(() => {
    if (streamPeriod !== null) streamPeriodRef.current = streamPeriod;
    if (streamedSourceRef.current === null) return;
    if (appliedPeriodRef.current === streamPeriod) return;

    if (streamPeriod === null) {
      appliedPeriodRef.current = null;
      void stopStream();
      return;
    }

    // Leaving the finished board — "play again", or a new game — needs the
    // session opened again rather than retuned: `decideStream` sees the same
    // source it already streamed and will not do it for us.
    if (appliedPeriodRef.current === null) {
      appliedPeriodRef.current = streamPeriod;
      void startStream(streamPeriod);
      return;
    }

    appliedPeriodRef.current = streamPeriod;
    void setStreamPeriod(streamPeriod);
  }, [streamPeriod, sourceId, statusKind, setStreamPeriod, startStream, stopStream]);

  // --- getting on the mark -------------------------------------------------

  const [holdRemaining, setHoldRemaining] = useState(HOLD_SECONDS);
  const onMarkRef = useRef(false);

  useEffect(() => {
    onMarkRef.current = onMark;
  }, [onMark]);

  const startCountdown = useCallback(() => {
    wallStartRef.current = Date.now();
    setCountdown(COUNTDOWN_SECONDS);
    setPhase('countdown');
  }, []);

  useEffect(() => {
    if (phase !== 'arming') {
      setHoldRemaining(HOLD_SECONDS);
      return undefined;
    }

    // Held time is measured from a wall-clock mark rather than accumulated per
    // tick, so a throttled tab cannot make the hold appear to pass early.
    let heldSince: number | null = null;

    const timer = setInterval(() => {
      if (!onMarkRef.current) {
        heldSince = null;
        setHoldRemaining(HOLD_SECONDS);
        return;
      }

      if (heldSince === null) heldSince = Date.now();
      const remaining = HOLD_SECONDS - (Date.now() - heldSince) / 1000;
      setHoldRemaining(Math.max(0, remaining));

      if (remaining <= 0) startCountdown();
    }, TICK_MS);

    return () => clearInterval(timer);
  }, [phase, startCountdown]);

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
  }, [createServerRun, isPractice]);

  const armRound = useCallback(() => {
    setLiveTrace([]);
    setPhase('arming');
  }, []);

  const retryRound = useCallback(() => {
    setLiveTrace([]);
    setPhase('ready');
  }, []);

  const nextRound = useCallback(() => {
    if (roundIndex >= MOTION_GRAPH_COUNT - 1) {
      // The stream is not stopped here; it drops to the idle rate, which keeps
      // the connect panel's live reading and calibration check working.
      setPhase('finished');
      return;
    }
    setRoundIndex(roundIndex + 1);
    setLiveTrace([]);
    setPhase('ready');
  }, [roundIndex]);

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

  return (
    <div className={`not-prose px-5 py-4 ${className}`.trim()}>
      {phase === 'setup' && (
        <>
          <VernierConnectPanel device={device} allowPractice={allowPractice} />
          {connected && (
            <div className="mt-4">
              <Button onClick={() => void beginGame()}>Start the three graphs</Button>
              {isPractice && (
                <p className="mt-2 text-sm text-[var(--text-muted)]">
                  Simulated walker — scores stay on this device and never reach the shared board.
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
                        Stand {fixed(graph.startMeters, 2)} m from the detector. The round starts on
                        its own once you have held that spot for {HOLD_SECONDS} seconds.
                      </p>
                      <Button className="mt-3 px-6 py-2.5 text-base" onClick={armRound}>
                        Begin the round
                      </Button>
                    </>
                  )}

                  {phase === 'arming' && (
                    <>
                      <p className="text-sm text-[var(--text-primary)]">
                        Stand {fixed(graph.startMeters, 2)} m from the detector.
                      </p>

                      <p className="mt-2 text-sm" role="status">
                        {liveDistance === null ? (
                          <span className="text-[var(--text-muted)]">
                            No echo yet — is anything in front of the detector?
                          </span>
                        ) : onMark ? (
                          <span className="text-[var(--accent-green)]">
                            Hold it — starting in {Math.ceil(holdRemaining)}…
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)]">
                            You are at {fixed(liveDistance, 2)} m. Move onto the mark.
                          </span>
                        )}
                      </p>

                      <div
                        aria-hidden="true"
                        className="mt-3 h-1.5 w-full overflow-hidden rounded bg-[var(--grid-line)]"
                      >
                        <div
                          className="h-full rounded bg-[var(--accent-green)]"
                          style={{
                            width: `${((HOLD_SECONDS - holdRemaining) / HOLD_SECONDS) * 100}%`,
                          }}
                        />
                      </div>

                      <Button variant="secondary" className="mt-3" onClick={retryRound}>
                        Cancel
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
                      <p className="text-4xl font-semibold tabular-nums text-[var(--text-primary)]">
                        {results[roundIndex]!.score}
                        <span className="text-xl text-[var(--text-muted)]"> / 100</span>
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

          {isPractice &&
            (phase === 'ready' ||
              phase === 'arming' ||
              phase === 'countdown' ||
              phase === 'recording') && (
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
              Simulated runs stay on this device. Connect a LabQuest and a Motion Detector to play
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
 * Pointer and keyboard control for the simulated walker. Left is close to the
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
      aria-label="Simulated walker position"
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
