/**
 * Motion Match: the model behind the graph-matching game.
 *
 * Three target curves — two position-time, one velocity-time — that a player
 * matches by walking in front of an ultrasonic motion detector. This module
 * holds the targets, the scoring, and the leaderboard validator, and is shared
 * verbatim between the browser island and the Cloudflare Function so the two
 * can never disagree about what a score means.
 *
 * DESIGN CONSTRAINT: every target fits in about two metres of floor.
 * The detector reads from 0.15 m to 6 m, but a person needs room to stop, and
 * a classroom or hallway rarely offers more. So all three curves live between
 * 0.60 m and 2.30 m and never ask for more than 0.40 m/s — a walk, not a dash.
 * That is what makes a perfect match physically achievable rather than a
 * target you approach asymptotically.
 */

import {
  MAX_PLAUSIBLE_SPEED,
  resample,
  velocityAt,
  type MotionSample,
} from '../vernier/motionStream.ts';
import { isBlockedLeaderboardName, sanitizeLeaderboardName } from './stopZones.ts';

export type MotionGraphId = 'position-linear' | 'position-curved' | 'velocity-steps';

export type GraphQuantity = 'position' | 'velocity';

/**
 * A segment runs from the previous segment's end to `until`, arriving at
 * `value`. `hold` keeps `value` throughout, so a hold's `value` must equal the
 * previous segment's — checked in tests rather than left to trust.
 */
export interface TargetSegment {
  until: number;
  value: number;
  ease: 'hold' | 'linear' | 'smooth';
}

export interface TargetGraph {
  id: MotionGraphId;
  label: string;
  quantity: GraphQuantity;
  durationSeconds: number;
  /** Value of the plotted quantity at t = 0. */
  startValue: number;
  /** Where to stand when the countdown ends, in metres from the detector. */
  startMeters: number;
  /** Plot bounds for the quantity, chosen per graph rather than autoscaled. */
  axisMin: number;
  axisMax: number;
  segments: TargetSegment[];
  hint: string;
}

export const ROUND_SECONDS = 14;

/** Scoring and submission both run on this grid. See `scoreAttempt`. */
export const SUBMISSION_PERIOD_SECONDS = 0.1;

export const GRID_POINTS = Math.floor(ROUND_SECONDS / SUBMISSION_PERIOD_SECONDS) + 1;

export const MOTION_GRAPHS: readonly TargetGraph[] = [
  {
    id: 'position-linear',
    label: 'Position vs time — straight lines',
    quantity: 'position',
    durationSeconds: ROUND_SECONDS,
    startValue: 0.7,
    startMeters: 0.7,
    axisMin: 0,
    axisMax: 2.6,
    segments: [
      { until: 3, value: 0.7, ease: 'hold' },
      { until: 7, value: 2.1, ease: 'linear' },
      { until: 9, value: 2.1, ease: 'hold' },
      { until: 13, value: 0.9, ease: 'linear' },
      { until: 14, value: 0.9, ease: 'hold' },
    ],
    hint: 'Stand still, walk back at a steady pace, stop, then return a little slower.',
  },
  {
    id: 'position-curved',
    label: 'Position vs time — a curve',
    quantity: 'position',
    durationSeconds: ROUND_SECONDS,
    startValue: 0.7,
    startMeters: 0.7,
    axisMin: 0,
    axisMax: 2.6,
    segments: [
      { until: 8, value: 2.3, ease: 'smooth' },
      { until: 13, value: 0.8, ease: 'linear' },
      { until: 14, value: 0.8, ease: 'hold' },
    ],
    hint: 'Ease away — slow, then quicker, then slow again — before a steady walk back.',
  },
  {
    id: 'velocity-steps',
    label: 'Velocity vs time',
    quantity: 'velocity',
    durationSeconds: ROUND_SECONDS,
    startValue: 0,
    startMeters: 0.6,
    axisMin: -0.6,
    axisMax: 0.6,
    // Integrates to 0.60 m -> 2.00 m -> 0.60 m, so the whole round fits in
    // 1.4 m of floor and ends where it began. The half-second ramps are not
    // decoration: a step change in velocity is not something a person can walk.
    segments: [
      { until: 2, value: 0, ease: 'hold' },
      { until: 2.5, value: 0.4, ease: 'linear' },
      { until: 5.5, value: 0.4, ease: 'hold' },
      { until: 6, value: 0, ease: 'linear' },
      { until: 8, value: 0, ease: 'hold' },
      { until: 8.5, value: -0.35, ease: 'linear' },
      { until: 12, value: -0.35, ease: 'hold' },
      { until: 12.5, value: 0, ease: 'linear' },
      { until: 14, value: 0, ease: 'hold' },
    ],
    hint: 'Positive means walking away from the detector. Hold each speed steady.',
  },
];

export const findGraph = (id: MotionGraphId): TargetGraph | null =>
  MOTION_GRAPHS.find((graph) => graph.id === id) ?? null;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const smoothstep = (s: number): number => s * s * (3 - 2 * s);

/** The target value of a graph's quantity at time `t`. */
export const targetAt = (graph: TargetGraph, t: number): number => {
  const time = clamp(t, 0, graph.durationSeconds);
  let previousTime = 0;
  let previousValue = graph.startValue;

  for (const segment of graph.segments) {
    if (time <= segment.until) {
      if (segment.ease === 'hold') return segment.value;

      const span = segment.until - previousTime;
      const fraction = span > 0 ? clamp((time - previousTime) / span, 0, 1) : 1;
      const shaped = segment.ease === 'smooth' ? smoothstep(fraction) : fraction;
      return previousValue + shaped * (segment.value - previousValue);
    }

    previousTime = segment.until;
    previousValue = segment.value;
  }

  return previousValue;
};

/** The target sampled onto the scoring grid — also what the plot draws. */
export const targetSeries = (
  graph: TargetGraph,
  periodSeconds = SUBMISSION_PERIOD_SECONDS,
): { t: number; value: number }[] => {
  const count = Math.floor(graph.durationSeconds / periodSeconds) + 1;
  return Array.from({ length: count }, (_, index) => {
    const t = index * periodSeconds;
    return { t, value: targetAt(graph, t) };
  });
};

/**
 * Where the player has to be standing for a velocity target to stay in range.
 * Integrating the velocity curve gives the position it implies; the plot uses
 * this to draw a faint "you should be about here" band.
 */
export const impliedPosition = (graph: TargetGraph, t: number): number => {
  if (graph.quantity === 'position') return targetAt(graph, t);

  const stepSeconds = 0.01;
  let position = graph.startMeters;
  for (let time = 0; time < t; time += stepSeconds) {
    const span = Math.min(stepSeconds, t - time);
    position += targetAt(graph, time + span / 2) * span;
  }
  return position;
};

// --- scoring ---------------------------------------------------------------

export const TOLERANCES = {
  position: { full: 0.06, zero: 0.4 },
  velocity: { full: 0.08, zero: 0.45 },
} as const;

/**
 * Error to credit, with a flat-topped taper. Inside `full` the sample scores
 * 1.0 outright — 6 cm of position is inside ordinary walking sway, and without
 * that deadband a "perfect" run would be unreachable rather than merely hard.
 * Past `zero` it scores nothing.
 */
export const sampleScore = (error: number, full: number, zero: number): number => {
  if (!Number.isFinite(error)) return 0;
  if (error <= full) return 1;
  if (error >= zero) return 0;
  return (zero - error) / (zero - full);
};

export const MAX_GRAPH_SCORE = 100;
export const MAX_TOTAL_SCORE = MAX_GRAPH_SCORE * MOTION_GRAPHS.length;

/**
 * Scores one attempt out of 100.
 *
 * Scored on a fixed grid rather than over whatever samples arrived, which
 * matters for two reasons: it makes the client's displayed score and the
 * server's recomputed score identical by construction, and it means a short
 * recording loses the marks it never earned instead of averaging over the
 * three samples someone chose to submit.
 */
export const scoreAttempt = (graph: TargetGraph, samples: readonly MotionSample[]): number => {
  const grid = resample(samples, SUBMISSION_PERIOD_SECONDS, graph.durationSeconds);
  const tolerance = TOLERANCES[graph.quantity];

  let total = 0;

  grid.forEach((sample) => {
    if (sample.quality !== 'ok') return;

    const measured =
      graph.quantity === 'position' ? sample.distance : velocityAt(grid, sample.t);

    if (measured === null || !Number.isFinite(measured)) return;

    total += sampleScore(Math.abs(measured - targetAt(graph, sample.t)), tolerance.full, tolerance.zero);
  });

  return Math.round((MAX_GRAPH_SCORE * total) / grid.length);
};

export const motionGameTotal = (graphScores: readonly number[]): number =>
  graphScores.reduce((sum, score) => sum + score, 0);

/** A one-line read on what went wrong, shown between rounds. */
export const attemptFeedback = (graph: TargetGraph, samples: readonly MotionSample[]): string => {
  const grid = resample(samples, SUBMISSION_PERIOD_SECONDS, graph.durationSeconds);
  const dropouts = grid.filter((sample) => sample.quality !== 'ok').length;

  if (dropouts > grid.length / 3) {
    return 'The detector lost you for much of that run — check nothing is between you and the sensor.';
  }

  let signedTotal = 0;
  let counted = 0;

  grid.forEach((sample) => {
    if (sample.quality !== 'ok') return;
    const measured = graph.quantity === 'position' ? sample.distance : velocityAt(grid, sample.t);
    if (measured === null || !Number.isFinite(measured)) return;
    signedTotal += measured - targetAt(graph, sample.t);
    counted += 1;
  });

  if (counted === 0) return 'No usable data from that run.';

  const bias = signedTotal / counted;
  const unit = graph.quantity === 'position' ? 'm' : 'm/s';

  if (Math.abs(bias) < TOLERANCES[graph.quantity].full) {
    return 'Well centred on the target the whole way through.';
  }

  const direction =
    graph.quantity === 'position'
      ? bias > 0
        ? 'too far from the detector'
        : 'too close to the detector'
      : bias > 0
        ? 'moving away faster than the target'
        : 'moving toward the detector faster than the target';

  return `On average ${Math.abs(bias).toFixed(2)} ${unit} ${direction}.`;
};

// --- leaderboard -----------------------------------------------------------

export const MOTION_GAME_DEFAULTS = {
  minScore: 0,
  maxScore: MAX_TOTAL_SCORE,
  maxRetries: MOTION_GRAPHS.length,
  leaderboardLimit: 10,
  localStorageKey: 'physics-nook-motion-game-local-leaderboard-v1',
} as const;

/**
 * A dropout is posted as distance 0. Zero is below the detector's 0.15 m floor,
 * so it cannot collide with a real reading, and it keeps the wire format to a
 * flat array of number pairs.
 */
export const DROPOUT_DISTANCE = 0;

export interface MotionGameAttempt {
  graph: MotionGraphId;
  retried: boolean;
  /** [t, distance] pairs on the submission grid. */
  samples: [number, number][];
}

export interface MotionGameLeaderboardScore {
  name: string;
  score: number;
  graph1Score: number;
  graph2Score: number;
  graph3Score: number;
  retriesUsed: number;
  createdAt: number;
}

export interface MotionGameValidationResult {
  ok: boolean;
  name: string;
  score: number;
  graphScores: number[];
  retriesUsed: number;
  errors: string[];
}

/**
 * NOT IMPLEMENTED, deliberately: a "does this look like real sensor noise?"
 * check.
 *
 * The idea was that a real sonar trace carries a millimetre or two of
 * high-frequency jitter while a curve generated from an equation carries none,
 * so `jitterRms` below a floor would flag a fabricated submission. It does not
 * survive the wire format. Distances are rounded to submit them, and that
 * rounding manufactures jitter of the same order as the real thing — the check
 * ends up measuring the serialiser, not the player. Raising the floor above
 * rounding noise would start rejecting honest runs that were interpolated
 * across a dropout.
 *
 * What actually protects this board is the single-use server-minted run token,
 * recomputing the score from the trace instead of trusting the submitted
 * number, and the physical plausibility bounds below. A determined forger who
 * synthesises a noisy trace still gets through; that is true of every
 * client-side game and is not worth pretending otherwise.
 */

export const toMotionSamples = (pairs: readonly [number, number][]): MotionSample[] =>
  pairs.map(([t, distance]) => ({
    t,
    distance,
    quality: distance === DROPOUT_DISTANCE ? 'dropout' : 'ok',
  }));

export const fromMotionSamples = (samples: readonly MotionSample[]): [number, number][] =>
  samples.map((sample) => [
    Number(sample.t.toFixed(2)),
    sample.quality === 'ok' ? Number(sample.distance.toFixed(4)) : DROPOUT_DISTANCE,
  ]);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Validates a submission by replaying the scoring over the posted trace.
 *
 * The submitted `score` is never trusted or stored — it is only compared
 * against the recomputed one, so inflating it fails rather than succeeds. The
 * plausibility checks then ask whether the trace could have come from a person
 * in front of a sonar at all. None of this defeats someone willing to
 * synthesise a noisy trace; no purely client-side game can. It defeats editing
 * a number in a request.
 */
export const validateMotionGameScoreSubmission = (payload: {
  name?: unknown;
  score?: unknown;
  retriesUsed?: unknown;
  attempts?: unknown;
}): MotionGameValidationResult => {
  const errors: string[] = [];
  const name = sanitizeLeaderboardName(payload.name);

  if (isBlockedLeaderboardName(payload.name)) {
    errors.push('name is not allowed. Please choose a different display name.');
  }

  const rawAttempts = Array.isArray(payload.attempts) ? payload.attempts : [];
  const graphScores: number[] = [];

  if (rawAttempts.length !== MOTION_GRAPHS.length) {
    errors.push(`exactly ${MOTION_GRAPHS.length} attempts are required.`);
  }

  MOTION_GRAPHS.forEach((graph, index) => {
    const row = asRecord(rawAttempts[index]);
    const position = index + 1;

    if (!row) {
      errors.push(`attempt ${position} is not a valid object.`);
      graphScores.push(0);
      return;
    }

    if (row.graph !== graph.id) {
      errors.push(`attempt ${position} is for the wrong graph.`);
      graphScores.push(0);
      return;
    }

    const pairs = Array.isArray(row.samples) ? row.samples : [];

    if (pairs.length !== GRID_POINTS) {
      errors.push(`attempt ${position} must carry exactly ${GRID_POINTS} samples.`);
      graphScores.push(0);
      return;
    }

    const parsed: [number, number][] = [];
    let malformed = false;

    for (let sampleIndex = 0; sampleIndex < pairs.length; sampleIndex += 1) {
      const pair = pairs[sampleIndex];
      if (!Array.isArray(pair) || pair.length !== 2) {
        malformed = true;
        break;
      }
      const t = Number(pair[0]);
      const distance = Number(pair[1]);
      if (!Number.isFinite(t) || !Number.isFinite(distance)) {
        malformed = true;
        break;
      }
      const expectedTime = sampleIndex * SUBMISSION_PERIOD_SECONDS;
      if (Math.abs(t - expectedTime) > SUBMISSION_PERIOD_SECONDS / 2) {
        malformed = true;
        break;
      }
      if (distance !== DROPOUT_DISTANCE && (distance < 0.15 || distance > 6)) {
        malformed = true;
        break;
      }
      parsed.push([t, distance]);
    }

    if (malformed) {
      errors.push(`attempt ${position} has samples outside the accepted range.`);
      graphScores.push(0);
      return;
    }

    const samples = toMotionSamples(parsed);
    const good = samples.filter((sample) => sample.quality === 'ok');

    if (good.length < GRID_POINTS / 4) {
      errors.push(`attempt ${position} has too few usable readings.`);
      graphScores.push(0);
      return;
    }

    for (let sampleIndex = 1; sampleIndex < good.length; sampleIndex += 1) {
      const dt = good[sampleIndex].t - good[sampleIndex - 1].t;
      const dx = Math.abs(good[sampleIndex].distance - good[sampleIndex - 1].distance);
      if (dt > 0 && dx / dt > MAX_PLAUSIBLE_SPEED) {
        errors.push(`attempt ${position} contains motion faster than a person can walk.`);
        break;
      }
    }

    graphScores.push(scoreAttempt(graph, samples));
  });

  const retriesUsed = Number(payload.retriesUsed);
  if (
    !Number.isInteger(retriesUsed) ||
    retriesUsed < 0 ||
    retriesUsed > MOTION_GAME_DEFAULTS.maxRetries
  ) {
    errors.push('retries used is outside the accepted range.');
  }

  const computedScore = motionGameTotal(graphScores);
  const submittedScore = Number(payload.score);

  if (!Number.isInteger(submittedScore)) {
    errors.push('score must be an integer.');
  } else if (
    submittedScore < MOTION_GAME_DEFAULTS.minScore ||
    submittedScore > MOTION_GAME_DEFAULTS.maxScore
  ) {
    errors.push('score is outside the accepted range.');
  } else if (submittedScore !== computedScore) {
    errors.push('score does not match the submitted attempts.');
  }

  return {
    ok: errors.length === 0,
    name,
    score: computedScore,
    graphScores,
    retriesUsed: Number.isInteger(retriesUsed) ? retriesUsed : 0,
    errors,
  };
};

export const normalizeMotionGameScoreRow = (
  row: Record<string, unknown>,
): MotionGameLeaderboardScore & { id: string } => ({
  id: String(row.id),
  name: sanitizeLeaderboardName(row.name),
  score: Number(row.score),
  graph1Score: Number(row.graph1_score ?? row.graph1Score),
  graph2Score: Number(row.graph2_score ?? row.graph2Score),
  graph3Score: Number(row.graph3_score ?? row.graph3Score),
  retriesUsed: Number(row.retries_used ?? row.retriesUsed),
  createdAt: Number(row.created_at ?? row.createdAt),
});

export const selectBestMotionGameScoresByUniqueName = <T extends MotionGameLeaderboardScore>(
  scores: T[],
  limit = MOTION_GAME_DEFAULTS.leaderboardLimit,
) => {
  const bestByName = new Map<string, T>();

  scores.forEach((score) => {
    const key = sanitizeLeaderboardName(score.name).toLocaleLowerCase();
    const current = bestByName.get(key);

    if (
      !current ||
      score.score > current.score ||
      (score.score === current.score && score.retriesUsed < current.retriesUsed) ||
      (score.score === current.score &&
        score.retriesUsed === current.retriesUsed &&
        score.createdAt < current.createdAt)
    ) {
      bestByName.set(key, score);
    }
  });

  return [...bestByName.values()]
    .sort(
      (a, b) => b.score - a.score || a.retriesUsed - b.retriesUsed || a.createdAt - b.createdAt,
    )
    .slice(0, limit);
};
