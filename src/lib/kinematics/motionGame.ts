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
  fillDropouts,
  resample,
  velocityAt,
  type MotionSample,
} from '../vernier/motionStream.ts';
import { isBlockedLeaderboardName, sanitizeLeaderboardName } from './stopZones.ts';
import { createRng, type Rng } from '../shared/rng.ts';

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
}

export const ROUND_SECONDS = 14;

/** Scoring and submission both run on this grid. See `scoreAttempt`. */
export const SUBMISSION_PERIOD_SECONDS = 0.1;

export const GRID_POINTS = Math.floor(ROUND_SECONDS / SUBMISSION_PERIOD_SECONDS) + 1;

/** Every round is two position graphs then a velocity graph, in that order. */
export const MOTION_GRAPH_IDS: readonly MotionGraphId[] = [
  'position-linear',
  'position-curved',
  'velocity-steps',
];

export const MOTION_GRAPH_COUNT = MOTION_GRAPH_IDS.length;

/**
 * The floor the targets are allowed to use. Not the detector's range — the
 * detector reads 0.15 m to 6 m — but the part of it a person can actually walk
 * in a classroom, with room to stop at either end.
 */
export const TARGET_BAND = { min: 0.6, max: 2.3 } as const;

/** A comfortable walk. Above this a target stops being matchable. */
export const MAX_TARGET_SPEED = 0.4;

/** Slowest a leg of the walk may be, so a target never reads as "stand still". */
const MIN_TARGET_SPEED = 0.2;

/** Shortest meaningful walk, in metres. */
const MIN_LEG_METRES = 0.4;

/** Velocity cannot step; a person needs this long to change pace. */
const RAMP_SECONDS = 0.5;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const round2 = (value: number): number => Math.round(value * 100) / 100;

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

// --- generation ------------------------------------------------------------
//
// Targets are generated per run rather than fixed, so the shapes cannot be
// memorised and a second attempt is a fresh problem. The generator is seeded:
// the server mints a seed alongside the run token, the browser builds the
// graphs from it, and the scoring endpoint rebuilds the identical graphs from
// the seed it stored. The curves themselves never travel over the wire and
// never have to be trusted.
//
// Randomness is bounded, not free. Every leg is checked against the walking
// band and the speed cap as it is chosen, and the velocity generator tracks the
// position its curve implies so the walk cannot drift out of the room. The
// property tests in tests/kinematics assert those invariants across hundreds of
// seeds, which is the real guarantee — not the constants here.

/**
 * Picks a reachable end point for one leg of a walk.
 *
 * Returns null when neither direction has room, which the callers treat as
 * "shorten this leg" rather than forcing an unwalkable jump.
 */
const pickLegTarget = (
  rng: Rng,
  from: number,
  durationSeconds: number,
  maxSpeed = MAX_TARGET_SPEED,
): number | null => {
  const reach = Math.min(maxSpeed * durationSeconds, TARGET_BAND.max - TARGET_BAND.min);

  const awayLow = from + MIN_LEG_METRES;
  const awayHigh = Math.min(TARGET_BAND.max, from + reach);
  const backHigh = from - MIN_LEG_METRES;
  const backLow = Math.max(TARGET_BAND.min, from - reach);

  const canGoAway = awayHigh >= awayLow;
  const canComeBack = backLow <= backHigh;

  if (!canGoAway && !canComeBack) return null;

  const goAway = canGoAway && canComeBack ? rng.next() < 0.5 : canGoAway;

  return goAway ? rng.range(awayLow, awayHigh) : rng.range(backLow, backHigh);
};

/** Position vs time, built from constant-velocity legs separated by pauses. */
const generateLinearPositionGraph = (rng: Rng): TargetGraph => {
  const legs = rng.int(2, 3);
  // Leg durations are tuned per count so the pauses that fill the rest of the
  // round never get squeezed below about a second.
  const legDuration = legs === 2 ? () => rng.range(3, 4.2) : () => rng.range(2.5, 3.2);
  const legDurations = Array.from({ length: legs }, legDuration);
  const pauseTotal = ROUND_SECONDS - legDurations.reduce((sum, value) => sum + value, 0);
  const pauseWeights = Array.from({ length: legs + 1 }, () => rng.range(0.7, 1.3));
  const weightTotal = pauseWeights.reduce((sum, value) => sum + value, 0);
  const pauses = pauseWeights.map((weight) => (weight / weightTotal) * pauseTotal);

  const start = round2(rng.range(TARGET_BAND.min, TARGET_BAND.min + 0.5));
  const segments: TargetSegment[] = [];
  let t = 0;
  let x = start;

  for (let index = 0; index < legs; index += 1) {
    t += pauses[index];
    segments.push({ until: round2(t), value: x, ease: 'hold' });

    const duration = legDurations[index];
    const next = pickLegTarget(rng, x, duration);
    t += duration;
    if (next !== null) x = round2(next);
    segments.push({ until: round2(t), value: x, ease: next === null ? 'hold' : 'linear' });
  }

  // Whatever rounding left over belongs to the final pause, so the last segment
  // lands exactly on the end of the round.
  segments.push({ until: ROUND_SECONDS, value: x, ease: 'hold' });

  return {
    id: 'position-linear',
    label: 'Position vs time',
    quantity: 'position',
    durationSeconds: ROUND_SECONDS,
    startValue: start,
    startMeters: start,
    axisMin: 0,
    axisMax: 2.6,
    segments,
  };
};

/** Position vs time with an eased leg, so the curve bends instead of kinking. */
const generateCurvedPositionGraph = (rng: Rng): TargetGraph => {
  const start = round2(rng.range(TARGET_BAND.min, TARGET_BAND.min + 0.35));
  const outDuration = rng.range(6, 8);

  // A smoothstep peaks at 1.5x its average speed, so the displacement it can
  // cover in a given time is smaller than a straight leg's.
  const outReach = Math.min((MAX_TARGET_SPEED * outDuration) / 1.5, TARGET_BAND.max - start);
  const peak = round2(start + rng.range(Math.max(MIN_LEG_METRES, outReach * 0.75), outReach));

  const returnDuration = ROUND_SECONDS - outDuration - rng.range(0.8, 1.6);
  const easedReturn = rng.next() < 0.5;

  // Decided before the distance, because it changes how far the return leg may
  // travel: an eased leg peaks at 1.5x its average speed, so covering the same
  // ground costs half again as much peak pace as a straight one.
  const returnReach = Math.min(
    (MAX_TARGET_SPEED * returnDuration) / (easedReturn ? 1.5 : 1),
    peak - TARGET_BAND.min,
  );
  const end = round2(peak - rng.range(Math.max(MIN_LEG_METRES, returnReach * 0.6), returnReach));

  return {
    id: 'position-curved',
    label: 'Position vs time',
    quantity: 'position',
    durationSeconds: ROUND_SECONDS,
    startValue: start,
    startMeters: start,
    axisMin: 0,
    axisMax: 2.6,
    segments: [
      { until: round2(outDuration), value: peak, ease: 'smooth' },
      {
        until: round2(outDuration + returnDuration),
        value: end,
        ease: easedReturn ? 'smooth' : 'linear',
      },
      { until: ROUND_SECONDS, value: end, ease: 'hold' },
    ],
  };
};

/**
 * Velocity vs time: flat plateaus joined by short ramps.
 *
 * Generated by walking the position forward as each plateau is chosen, so the
 * curve is checked against the room while it is being built rather than being
 * generated and then rejected.
 */
const generateVelocityGraph = (rng: Rng): TargetGraph => {
  const moves = rng.int(2, 3);
  const start = round2(rng.range(TARGET_BAND.min, TARGET_BAND.min + 0.4));

  // Tighter pauses when there are more moves, so the plateaus stay long enough
  // to read as a held speed rather than a blip.
  const gapRange: [number, number] = moves === 3 ? [1.2, 1.8] : [1.4, 2.2];
  const gaps = Array.from({ length: moves }, () => rng.range(gapRange[0], gapRange[1]));
  const finalGap = rng.range(1, 1.6);

  // Each move spends two ramps, one up to speed and one back to rest. Budgeting
  // for only one is what previously pushed the last segment past the round.
  const plateauTotal =
    ROUND_SECONDS -
    gaps.reduce((sum, value) => sum + value, 0) -
    finalGap -
    moves * 2 * RAMP_SECONDS;
  const plateauWeights = Array.from({ length: moves }, () => rng.range(0.8, 1.2));
  const weightTotal = plateauWeights.reduce((sum, value) => sum + value, 0);

  const segments: TargetSegment[] = [];
  let t = 0;
  let position = start;

  for (let index = 0; index < moves; index += 1) {
    t += gaps[index];
    segments.push({ until: round2(t), value: 0, ease: 'hold' });

    const plateau = (plateauWeights[index] / weightTotal) * plateauTotal;
    // A plateau of length d flanked by two half-ramps displaces v*(d + ramp).
    const span = plateau + RAMP_SECONDS;
    const target = pickLegTarget(rng, position, span);

    if (target === null) {
      // No room either way: hold still through this slot rather than inventing
      // a move that would leave the band.
      t += RAMP_SECONDS + plateau + RAMP_SECONDS;
      segments.push({ until: round2(t), value: 0, ease: 'hold' });
      continue;
    }

    const speed = clamp(
      (target - position) / span,
      -MAX_TARGET_SPEED,
      MAX_TARGET_SPEED,
    );
    const signed =
      Math.abs(speed) < MIN_TARGET_SPEED ? Math.sign(speed) * MIN_TARGET_SPEED : speed;
    // Re-derive the landing point from the speed actually used, so the position
    // we carry forward is the one the curve really produces.
    const landing = clamp(position + signed * span, TARGET_BAND.min, TARGET_BAND.max);
    const applied = round2((landing - position) / span);

    t += RAMP_SECONDS;
    segments.push({ until: round2(t), value: applied, ease: 'linear' });
    t += plateau;
    segments.push({ until: round2(t), value: applied, ease: 'hold' });
    t += RAMP_SECONDS;
    segments.push({ until: round2(t), value: 0, ease: 'linear' });

    position = position + applied * span;
  }

  segments.push({ until: ROUND_SECONDS, value: 0, ease: 'hold' });

  return {
    id: 'velocity-steps',
    label: 'Velocity vs time',
    quantity: 'velocity',
    durationSeconds: ROUND_SECONDS,
    startValue: 0,
    startMeters: start,
    axisMin: -0.6,
    axisMax: 0.6,
    segments,
  };
};

/**
 * The three targets for one run. Same seed, same graphs — that is the contract
 * the browser and the scoring endpoint both rely on.
 */
export const generateMotionGraphs = (seed: number): TargetGraph[] => {
  const rng = createRng(seed);
  return [
    generateLinearPositionGraph(rng),
    generateCurvedPositionGraph(rng),
    generateVelocityGraph(rng),
  ];
};

export const randomSeed = (random: () => number = Math.random): number =>
  Math.floor(random() * 0xffffffff) >>> 0;

/**
 * A sentence describing the shape of a target, for the plot's accessible name.
 * It reports what the curve does, not how to walk it — the reading is the
 * exercise.
 */
export const describeTarget = (graph: TargetGraph): string => {
  const unit = graph.quantity === 'position' ? 'm' : 'm/s';
  const noun = graph.quantity === 'position' ? 'Distance from the detector' : 'Velocity';
  const points = [graph.startValue, ...graph.segments.map((segment) => segment.value)];

  // Collapse runs of equal values so a hold does not read as two waypoints.
  const waypoints = points.filter(
    (value, index) => index === 0 || Math.abs(value - points[index - 1]) > 1e-9,
  );

  return `${noun} target: ${waypoints.map((value) => `${value.toFixed(2)} ${unit}`).join(', then ')}.`;
};

// --- scoring ---------------------------------------------------------------

/**
 * RMS error at which a round scores nothing. Also the per-sample ceiling: one
 * wild excursion counts as a complete miss at that instant and no worse, so a
 * single bad moment cannot outweigh the rest of the walk the way an unbounded
 * squared error would.
 *
 * The velocity figure is much tighter than the position one because velocities
 * are small numbers: the targets never exceed 0.4 m/s, so scoring them against
 * a half-metre-per-second scale handed most of the marks to anyone who simply
 * stood still. Calibrated so that walking the target scores in the high
 * nineties, a fifth of a second of lag costs about ten, and standing still
 * through the whole round lands in the thirties — credit for the stationary
 * stretches it genuinely matched, and nothing more.
 */
export const SCORING_ZERO_AT = {
  position: 0.4,
  velocity: 0.25,
} as const;

/**
 * Width of the running mean applied before comparing. Half a second is long
 * enough to absorb a stumble, a bridged dropout, or the sonar picking up a
 * sleeve, and short enough to leave every real feature of the target intact —
 * the quickest thing any generated curve asks for is a half-second change of
 * pace.
 */
export const SCORING_SMOOTH_SECONDS = 0.5;

/**
 * Lost signal shorter than this is interpolated across before scoring, so a
 * brief disconnect costs nothing. Beyond it there is genuinely no measurement,
 * and those samples take the full per-sample penalty.
 */
export const SCORING_GAP_SECONDS = 1;

/**
 * Half-width of the faint band drawn around the target. Purely a visual aid for
 * someone walking — it is not a scoring threshold, and nothing inside it is
 * "free". The scoring below measures the actual distance from the line.
 */
export const GUIDE_BAND = {
  position: 0.1,
  velocity: 0.12,
} as const;

export const MAX_GRAPH_SCORE = 100;
export const MAX_TOTAL_SCORE = MAX_GRAPH_SCORE * MOTION_GRAPH_COUNT;

/**
 * Centred running mean, skipping holes. Returns null only where the whole
 * window is empty.
 */
const runningMean = (
  values: readonly (number | null)[],
  windowSeconds: number,
  periodSeconds: number,
): (number | null)[] => {
  const half = Math.max(1, Math.round(windowSeconds / (2 * periodSeconds)));

  return values.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let offset = index - half; offset <= index + half; offset += 1) {
      const value = values[offset];
      if (offset < 0 || offset >= values.length || value === null || !Number.isFinite(value)) {
        continue;
      }
      sum += value;
      count += 1;
    }
    return count > 0 ? sum / count : null;
  });
};

/**
 * Scores one attempt out of 100, from how far the walk actually was from the
 * target.
 *
 * The score is `100 x (1 - rms / zeroAt)` over the whole round, so every
 * centimetre of error costs marks — there is no band inside which a run is
 * simply "correct". Matching a target closely is meant to be hard; 100 requires
 * being right to within a couple of millimetres on average, which no one walks.
 *
 * Two deliberate softenings, both aimed at the sensor rather than the player.
 * Gaps shorter than `SCORING_GAP_SECONDS` are interpolated across, and both
 * traces then pass through the same running mean, so a momentary disconnect or
 * a spurious echo is smoothed away instead of scored. The *target* is smoothed
 * too, which is what keeps that fair: a corner is rounded off on both sides of
 * the comparison, so the filter never asks for something it has just erased.
 *
 * Scored on a fixed grid rather than over whatever samples arrived. That makes
 * the browser's displayed score and the server's recomputed score identical by
 * construction, and it means a short recording loses the marks it never earned
 * instead of averaging over the handful of samples someone chose to submit.
 */
export const scoreAttempt = (graph: TargetGraph, samples: readonly MotionSample[]): number => {
  const grid = resample(samples, SUBMISSION_PERIOD_SECONDS, graph.durationSeconds);
  const bridged = fillDropouts(grid, SCORING_GAP_SECONDS);
  const zeroAt = SCORING_ZERO_AT[graph.quantity];

  const measured = bridged.map((sample) => {
    if (sample.quality !== 'ok') return null;
    return graph.quantity === 'position' ? sample.distance : velocityAt(bridged, sample.t);
  });
  const target = bridged.map((sample) => targetAt(graph, sample.t));

  const smoothedMeasured = runningMean(measured, SCORING_SMOOTH_SECONDS, SUBMISSION_PERIOD_SECONDS);
  const smoothedTarget = runningMean(target, SCORING_SMOOTH_SECONDS, SUBMISSION_PERIOD_SECONDS);

  if (smoothedMeasured.length === 0) return 0;

  let sumSquares = 0;

  smoothedMeasured.forEach((value, index) => {
    const wanted = smoothedTarget[index];
    const error =
      value === null || !Number.isFinite(value) || wanted === null
        ? zeroAt
        : Math.min(Math.abs(value - wanted), zeroAt);
    sumSquares += error * error;
  });

  const rms = Math.sqrt(sumSquares / smoothedMeasured.length);

  return Math.round(MAX_GRAPH_SCORE * Math.max(0, 1 - rms / zeroAt));
};

export const motionGameTotal = (graphScores: readonly number[]): number =>
  graphScores.reduce((sum, score) => sum + score, 0);

// --- leaderboard -----------------------------------------------------------

export const MOTION_GAME_DEFAULTS = {
  minScore: 0,
  maxScore: MAX_TOTAL_SCORE,
  maxRetries: MOTION_GRAPH_COUNT,
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
export const validateMotionGameScoreSubmission = (
  payload: {
    name?: unknown;
    score?: unknown;
    retriesUsed?: unknown;
    attempts?: unknown;
  },
  /**
   * The seed the run was minted with. Targets are rebuilt from it here rather
   * than taken from the payload, so a player cannot submit a run scored against
   * easier curves than the ones they were shown.
   */
  seed: number,
): MotionGameValidationResult => {
  const graphs = generateMotionGraphs(seed);
  const errors: string[] = [];
  const name = sanitizeLeaderboardName(payload.name);

  if (isBlockedLeaderboardName(payload.name)) {
    errors.push('name is not allowed. Please choose a different display name.');
  }

  const rawAttempts = Array.isArray(payload.attempts) ? payload.attempts : [];
  const graphScores: number[] = [];

  if (rawAttempts.length !== MOTION_GRAPH_COUNT) {
    errors.push(`exactly ${MOTION_GRAPH_COUNT} attempts are required.`);
  }

  graphs.forEach((graph, index) => {
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
