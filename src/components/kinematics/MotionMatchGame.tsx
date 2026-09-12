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
  MAX_GRAPH_SCORE,
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
import {
  canRetryRound,
  matchOutcome,
  mergeAttempt,
  nextRoundAction,
  pickPracticeGraphIndex,
  playerResults,
  turnAt,
  turnCount,
  type MotionActivity,
  type PlayerCount,
  type PracticeQuantity,
  type RoundResult,
} from '../../lib/kinematics/motionSession';
import { DEFAULT_SENSOR_CONTEXT } from '../../lib/vernier/sensorIds';
import { resample, velocityAt, type MotionSample } from '../../lib/vernier/motionStream';
import { DEFAULT_PERIOD_SECONDS } from '../../lib/vernier/ngioSession';
import { decideStream } from '../../lib/vernier/streamPolicy';
import { useVernierMotion } from '../hardware/useVernierMotion';
import { useDetectorCalibration } from '../hardware/useDetectorCalibration';
import VernierConnectPanel from '../hardware/VernierConnectPanel';
import TargetPlot, { type TracePoint } from './motionGame/TargetPlot';
import RoundOverlay, { type OverlayPhase } from './motionGame/RoundOverlay';
import ActivityChooser, { type ActivityChoice } from './motionGame/ActivityChooser';
import CalibratePanel from './motionGame/CalibratePanel';
import WalkerStrip from './motionGame/WalkerStrip';

// Motion Match: walk the shape of a graph.
//
// The recording loop runs on setInterval rather than requestAnimationFrame.
// The sample clock should follow the detector's 20 Hz period, not the display
// refresh, and a backgrounded tab throttles rAF to nothing — which would
// silently truncate a round mid-walk.

/**
 * Which screen is showing.
 *
 * `phase` is a screen enum, not a round enum — 'setup', 'calibrate' and
 * 'finished' are not phases of a walk. Keeping calibrate here rather than
 * making it a separate mode flag is what lets the detector's duty cycle stay a
 * pure function of this one value, which is the property that makes those
 * effects auditable.
 */
type Phase =
  | 'setup'
  | 'calibrate'
  | 'ready'
  | 'arming'
  | 'countdown'
  | 'recording'
  | 'review'
  | 'finished';

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
 * on the mark needs enough resolution to feel responsive but no more, and so
 * does calibrating — that wants a settled average, not resolution. Anything
 * else just needs a live reading so the connect panel has something to show.
 * Once the three rounds are scored nothing reads the detector at all, so it
 * stops rather than idling — a board being read over is no place for a
 * metronome.
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
 * same clothes. Add `?walker=1` to the URL to bring it back.
 *
 * Not to be confused with Practice mode, which is a real activity on real
 * hardware. The walker stands in for the detector; Practice stands in for
 * nothing.
 */
const isSimulatedWalkerEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('walker');
};

const NEXT_LABEL = {
  reroll: 'New graph',
  finish: 'See the total',
  advance: 'Next graph',
} as const;

const playerName = (player: number) => `Player ${player + 1}`;

function replaceAt<T>(list: readonly T[], index: number, value: T): T[] {
  return list.map((item, position) => (position === index ? value : item));
}

interface LocalScore extends MotionGameLeaderboardScore {
  id: string;
}

export default function MotionMatchGame({ className = '' }: { className?: string }) {
  const device = useVernierMotion();
  const calibration = useDetectorCalibration();

  const [phase, setPhase] = useState<Phase>('setup');
  const [activity, setActivity] = useState<MotionActivity>('match');
  const [players, setPlayers] = useState<PlayerCount>(1);
  const [choice, setChoice] = useState<ActivityChoice>('match');
  const [practiceQuantity, setPracticeQuantity] = useState<PracticeQuantity>('position');
  const [practicePick, setPracticePick] = useState(0);
  const [turnIndex, setTurnIndex] = useState(0);
  const [seed, setSeed] = useState(() => randomSeed());
  const [allowSimulated] = useState(isSimulatedWalkerEnabled);
  // One entry per turn, in the order they are walked. `playerResults` reads a
  // player's graphs back out of it.
  const [results, setResults] = useState<(RoundResult | null)[]>([]);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [elapsed, setElapsed] = useState(0);
  const [liveTrace, setLiveTrace] = useState<MotionSample[]>([]);

  const [playerNames, setPlayerNames] = useState(['', '']);
  const [nameErrors, setNameErrors] = useState<(string | null)[]>([null, null]);
  const [submitted, setSubmitted] = useState([false, false]);
  const [postingPlayer, setPostingPlayer] = useState<number | null>(null);
  const [apiStatus, setApiStatus] = useState<'unknown' | 'online' | 'offline'>('unknown');
  const [cloudScores, setCloudScores] = useState<LocalScore[]>([]);
  const [localScores, setLocalScores] = useState<LocalScore[]>([]);

  const bufferRef = useRef<MotionSample[]>([]);
  const offsetRef = useRef<number | null>(null);
  const recordingRef = useRef(false);
  /** One server run token per player, all minted against the same seed. */
  const runIdsRef = useRef<(string | null)[] | null>(null);
  const submittedRef = useRef([false, false]);
  const wallStartRef = useRef(0);

  // Targets are regenerated every run. In a cloud run the seed comes from the
  // server alongside the run token, so the endpoint can rebuild the same three
  // graphs when it scores the submission; walker runs just roll their own.
  const graphs = useMemo(() => generateMotionGraphs(seed), [seed]);

  // Practice walks one graph out of that same triple rather than calling a
  // generator of its own, so `generateMotionGraphs` stays the single way a
  // target is ever built — the contract the scoring endpoint depends on.
  const rounds = useMemo(
    () => (activity === 'practice' ? [graphs[practicePick]] : graphs),
    [activity, graphs, practicePick],
  );
  const sessionPlayers: PlayerCount = activity === 'practice' ? 1 : players;
  const turnTotal = turnCount(activity, rounds.length, sessionPlayers);
  const turn = turnAt(turnIndex, sessionPlayers);
  // `??` covers the tick where the activity has changed but the turn index has
  // not caught up yet.
  const graph = rounds[turn.graphIndex] ?? rounds[0];

  const isSimulated = device.sourceId === 'simulated';
  const connected = device.status.kind === 'ready' || device.status.kind === 'streaming';

  const liveDistance =
    device.latest && device.latest.quality === 'ok' ? device.latest.distance : null;
  const onMark =
    liveDistance !== null && Math.abs(liveDistance - graph.startMeters) <= ON_MARK_TOLERANCE;

  // --- calibration ---------------------------------------------------------

  // Destructured for the same reason as the stream controls below: the hook's
  // value object is rebuilt on every sample.
  const { setSensorContext } = device;
  const calibrationScale = calibration.scale;
  const sourceId = device.sourceId;
  useEffect(() => {
    // `sourceId` is a dependency because a freshly constructed source starts at
    // the default context and has to be told again.
    setSensorContext({ ...DEFAULT_SENSOR_CONTEXT, distanceScale: calibrationScale });
  }, [calibrationScale, sourceId, setSensorContext]);

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

  const createServerRun = useCallback(async (count: PlayerCount) => {
    try {
      const response = await fetch(`/api/kinematics/motion-game/run?players=${count}`, {
        method: 'POST',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Motion game run request failed: ${response.status}`);
      const body = await response.json();
      const ids: unknown[] = Array.isArray(body.runIds) ? body.runIds : [body.runId];
      const valid = ids.filter((id): id is string => typeof id === 'string');
      // A token short means a player whose score could not be checked, so the
      // whole match plays offline rather than posting for one player only.
      runIdsRef.current = valid.length === count ? valid : null;
      if (Number.isFinite(Number(body.seed))) setSeed(Number(body.seed) >>> 0);
      setApiStatus(runIdsRef.current ? 'online' : 'offline');
    } catch {
      runIdsRef.current = null;
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

  // Drop the simulated walker onto the round's start mark whenever a round is
  // waiting to begin. Doing it here rather than in each of the round callbacks
  // keeps it correct when the targets have just been regenerated: `graph` is
  // derived from the new seed, which the callbacks cannot see yet.
  const simulatedSource = device.simulated;
  useEffect(() => {
    if (phase !== 'ready') return;
    simulatedSource?.reset(graph.startMeters);
  }, [phase, graph.startMeters, simulatedSource]);

  const finishRound = useCallback(() => {
    recordingRef.current = false;
    const samples = bufferRef.current.slice();
    const score = scoreAttempt(graph, samples);

    setResults((previous) => {
      const next = [...previous];
      next[turnIndex] = mergeAttempt(previous[turnIndex] ?? null, { samples, score }, activity);
      return next;
    });

    setLiveTrace(samples);
    setPhase('review');
  }, [activity, graph, turnIndex]);

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
      : phase === 'ready' || phase === 'arming' || phase === 'calibrate'
        ? AIMING_PERIOD_SECONDS
        : phase === 'finished'
          ? null
          : IDLE_PERIOD_SECONDS;

  // Destructured because the hook's value object is rebuilt on every sample;
  // depending on `device` here would restart the stream twenty times a second.
  const { startStream, setStreamPeriod, stopStream } = device;
  const statusKind = device.status.kind;

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

  const beginActivity = useCallback(
    async (next: MotionActivity, count: PlayerCount = 1) => {
      submittedRef.current = [false, false];
      setSubmitted([false, false]);
      setPlayerNames(['', '']);
      setNameErrors([null, null]);
      setResults([]);
      setTurnIndex(0);
      setLiveTrace([]);
      setActivity(next);
      setPlayers(count);
      setPhase('ready');

      if (next === 'practice') {
        // The pick is taken from the seed being set, not from `seed` state,
        // which this callback cannot see updated yet.
        const nextSeed = randomSeed();
        setSeed(nextSeed);
        setPracticePick(pickPracticeGraphIndex(practiceQuantity, nextSeed));
        runIdsRef.current = null;
        return;
      }

      if (isSimulated) {
        runIdsRef.current = null;
        setSeed(randomSeed());
        return;
      }

      // Reuse tokens already held rather than minting more. The endpoint
      // allows 60 runs an hour per IP hash and a classroom shares one address,
      // so stepping in and out of the menu should not spend that budget. A
      // held set only fits if it has a live token for every player: two players
      // cannot share one, and they must share a seed, so a mismatch mints anew.
      const held = runIdsRef.current;
      if (held === null || held.length !== count || held.some((id) => id === null)) {
        await createServerRun(count);
      }
    },
    [createServerRun, isSimulated, practiceQuantity],
  );

  const leaveActivity = useCallback(() => {
    recordingRef.current = false;
    setLiveTrace([]);
    setPhase('setup');
  }, []);

  const armRound = useCallback(() => {
    setLiveTrace([]);
    setPhase('arming');
  }, []);

  const retryRound = useCallback(() => {
    setLiveTrace([]);
    setPhase('ready');
  }, []);

  const nextRound = useCallback(() => {
    const action = nextRoundAction(activity, turnIndex, turnTotal);

    if (action === 'reroll') {
      const nextSeed = randomSeed();
      setSeed(nextSeed);
      setPracticePick(pickPracticeGraphIndex(practiceQuantity, nextSeed));
      setResults([]);
      setLiveTrace([]);
      setPhase('ready');
      return;
    }

    if (action === 'finish') {
      // The stream is not stopped here; it drops to the idle rate, which keeps
      // the connect panel's live reading working.
      setPhase('finished');
      return;
    }

    setTurnIndex(turnIndex + 1);
    setLiveTrace([]);
    setPhase('ready');
  }, [activity, practiceQuantity, turnTotal, turnIndex]);

  // --- submission ----------------------------------------------------------

  const standings = useMemo(
    () =>
      Array.from({ length: sessionPlayers }, (_, player) => {
        const rows = playerResults(results, player, sessionPlayers, MOTION_GRAPH_COUNT);
        const done = rows.filter((row): row is RoundResult => row !== null);
        return {
          rows,
          complete: done.length === MOTION_GRAPH_COUNT,
          total: motionGameTotal(done.map((row) => row.score)),
          retriesUsed: done.filter((row) => row.retried).length,
        };
      }),
    [results, sessionPlayers],
  );

  // Practice never mints a run token, so it could not post even if it tried.
  // Saying so here keeps the reason next to the other two gates.
  const canPostToCloud = activity === 'match' && !isSimulated && device.sourceId !== null;

  const handleScoreSubmit = useCallback(
    async (player: number) => {
      if (activity !== 'match') return;
      const standing = standings[player];
      if (!standing || !standing.complete || submittedRef.current[player]) return;

      const name = playerNames[player];
      if (isBlockedLeaderboardName(name)) {
        setNameErrors((previous) =>
          replaceAt(previous, player, 'That name cannot go on a shared board. Try another, or roll one.'),
        );
        return;
      }

      submittedRef.current = replaceAt(submittedRef.current, player, true);
      setSubmitted((previous) => replaceAt(previous, player, true));

      const rows = standing.rows as RoundResult[];
      const attempts = graphs.map((target, index) => ({
        graph: target.id,
        retried: rows[index].retried,
        samples: fromMotionSamples(
          resample(rows[index].samples, SUBMISSION_PERIOD_SECONDS, target.durationSeconds),
        ),
      }));

      const entry: LocalScore = {
        id: `local-${Date.now()}-${player}`,
        name: sanitizeLeaderboardName(name),
        score: standing.total,
        graph1Score: rows[0].score,
        graph2Score: rows[1].score,
        graph3Score: rows[2].score,
        retriesUsed: standing.retriesUsed,
        createdAt: Date.now(),
      };

      saveLocalScore(entry);

      const runId = runIdsRef.current?.[player] ?? null;
      if (!canPostToCloud || !runId) {
        setApiStatus('offline');
        return;
      }

      setPostingPlayer(player);
      try {
        const response = await fetch('/api/kinematics/motion-game/leaderboard', {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({
            runId,
            name: entry.name,
            score: entry.score,
            retriesUsed: standing.retriesUsed,
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
        setPostingPlayer(null);
        // Spent either way: the endpoint consumes a token it accepted, and a
        // rejected one is not going to pass on a second try.
        if (runIdsRef.current) runIdsRef.current = replaceAt(runIdsRef.current, player, null);
      }
    },
    [activity, canPostToCloud, graphs, playerNames, saveLocalScore, standings],
  );

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

  const roundResult = results[turnIndex] ?? null;

  // Leaving is offered freely in practice, where nothing is at stake, and in a
  // match only before the first walk — a misclick should not be able to throw
  // away a scored run in progress.
  const canLeave =
    activity === 'practice'
      ? phase === 'ready' || phase === 'review'
      : phase === 'ready' && turnIndex === 0 && !results.some(Boolean);

  const turnPlayer = sessionPlayers === 2 ? playerName(turn.player) : null;

  const heading =
    activity === 'practice'
      ? `Practice: ${quantityTitle(graph.quantity)}`
      : `${turnPlayer ? `${turnPlayer} · ` : ''}Graph ${turn.graphIndex + 1} of ${rounds.length}: ${quantityTitle(graph.quantity)}`;

  const nextAction = nextRoundAction(activity, turnIndex, turnTotal);
  const nextLabel = (() => {
    if (sessionPlayers === 1) return NEXT_LABEL[nextAction];
    if (nextAction === 'finish') return 'See who won';
    const upcoming = turnAt(turnIndex + 1, sessionPlayers);
    return upcoming.graphIndex === turn.graphIndex
      ? `${playerName(upcoming.player)}'s turn`
      : NEXT_LABEL.advance;
  })();

  const finishedHeading = (() => {
    if (sessionPlayers === 1) return `${standings[0]?.total ?? 0} out of ${MAX_TOTAL_SCORE}`;
    const totals = standings.map((standing) => standing.total);
    const outcome = matchOutcome(totals);
    if (outcome.kind === 'tie') return `A tie at ${totals[0]} each`;
    const loser = outcome.winner === 0 ? 1 : 0;
    return `${playerName(outcome.winner)} wins, ${totals[outcome.winner]} to ${totals[loser]}`;
  })();

  const renderPlayerResult = (player: number) => {
    const standing = standings[player];
    if (!standing) return null;
    const fieldId = `motion-game-name-${player}`;

    return (
      <>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {graphs
            .map(
              (target, index) =>
                `Graph ${index + 1} (${target.quantity}) ${standing.rows[index]?.score ?? 0}`,
            )
            .join(' · ')}
          {standing.retriesUsed > 0 &&
            ` · ${standing.retriesUsed} retr${standing.retriesUsed === 1 ? 'y' : 'ies'} used`}
        </p>

        {!submitted[player] && canPostToCloud && (
          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void handleScoreSubmit(player);
            }}
          >
            <label className="text-sm text-[var(--text-primary)]" htmlFor={fieldId}>
              Name for the board
            </label>
            <input
              id={fieldId}
              className="rounded border border-[var(--grid-line)] bg-[var(--surface-elevated)] px-2 py-1 text-sm text-[var(--text-primary)]"
              maxLength={24}
              value={playerNames[player]}
              onChange={(event) => {
                const value = event.target.value;
                setPlayerNames((previous) => replaceAt(previous, player, value));
                setNameErrors((previous) => replaceAt(previous, player, null));
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setPlayerNames((previous) => replaceAt(previous, player, generateLeaderboardName()));
                setNameErrors((previous) => replaceAt(previous, player, null));
              }}
            >
              <Dices aria-hidden="true" className="mr-1 inline h-4 w-4 align-text-bottom" />
              Roll
            </Button>
            <Button
              type="submit"
              disabled={postingPlayer !== null || playerNames[player].trim().length === 0}
            >
              {postingPlayer === player ? 'Posting…' : 'Post score'}
            </Button>
            {nameErrors[player] && (
              <p className="w-full text-sm text-[var(--accent-red)]" role="alert">
                {nameErrors[player]}
              </p>
            )}
          </form>
        )}
      </>
    );
  };

  return (
    <div className={`not-prose px-5 py-4 ${className}`.trim()}>
      {phase === 'setup' && (
        <>
          <VernierConnectPanel
            device={device}
            allowSimulated={allowSimulated}
            distanceScale={calibration.scale}
            onResetCalibration={calibration.reset}
          />
          {connected && (
            <>
              <ActivityChooser
                choice={choice}
                onChoiceChange={setChoice}
                practiceQuantity={practiceQuantity}
                onPracticeQuantityChange={setPracticeQuantity}
                canCalibrate={device.sourceId === 'webusb'}
                onStart={(count) => {
                  if (choice === 'calibrate') setPhase('calibrate');
                  else void beginActivity(choice, count);
                }}
              />
              {isSimulated && (
                <p className="mt-2 text-sm text-[var(--text-muted)]">
                  Simulated walker — scores stay on this device and never reach the shared board.
                </p>
              )}
            </>
          )}
        </>
      )}

      {phase === 'calibrate' && (
        <CalibratePanel device={device} calibration={calibration} onBack={() => setPhase('setup')} />
      )}

      {phase !== 'setup' && phase !== 'calibrate' && phase !== 'finished' && (
        <div>
          <h3 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">{heading}</h3>

          {/* The aspect ratio is on the wrapper, not left to the SVG's own
              intrinsic sizing. An inline SVG sized only by `width: 100%` can
              resolve to zero height, and then `inset-0` has no box to centre
              the controls in and the card spills out of the plot. Fixing the
              ratio here matches the viewBox and makes the overlay reliable.

              It is also the overlay's container query: the card's type scales
              with the plot, which is what makes the start mark readable from
              the far end of the room in fullscreen. */}
          <div className="@container relative aspect-[720/340] w-full">
            <TargetPlot
              className="absolute inset-0 h-full w-full"
              graph={graph}
              trace={tracePoints}
              now={phase === 'recording' ? elapsed : null}
            />

            {phase !== 'recording' && (
              <RoundOverlay
                phase={phase as OverlayPhase}
                player={turnPlayer}
                startMeters={graph.startMeters}
                holdSeconds={HOLD_SECONDS}
                holdRemaining={holdRemaining}
                liveDistance={liveDistance}
                onMark={onMark}
                countdown={countdown}
                score={roundResult ? roundResult.score : null}
                maxScore={MAX_GRAPH_SCORE}
                canRetry={roundResult !== null && canRetryRound(roundResult, activity)}
                nextLabel={nextLabel}
                onArm={armRound}
                onCancel={retryRound}
                onRetry={retryRound}
                onNext={nextRound}
                onLeave={canLeave ? leaveActivity : null}
              />
            )}
          </div>

          {isSimulated && phase !== 'review' && <WalkerStrip device={device} />}

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
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">{finishedHeading}</h3>

          {sessionPlayers === 1 ? (
            renderPlayerResult(0)
          ) : (
            <div className="mt-3 grid gap-5 sm:grid-cols-2">
              {standings.map((standing, player) => (
                <div key={player}>
                  <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                    {playerName(player)}:{' '}
                    <span className="tabular-nums">
                      {standing.total} out of {MAX_TOTAL_SCORE}
                    </span>
                  </h4>
                  {renderPlayerResult(player)}
                </div>
              ))}
            </div>
          )}

          {!canPostToCloud && (
            <p className="mt-3 text-sm text-[var(--text-muted)]">
              Simulated runs stay on this device. Connect a LabQuest and a Motion Detector to play
              for the shared board.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={() => void beginActivity('match', players)}>Play again</Button>
            <Button variant="secondary" onClick={() => setPhase('setup')}>
              Back to the menu
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
