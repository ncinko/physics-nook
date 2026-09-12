/**
 * The rules that differ between the two ways to play Motion Match.
 *
 * Match is the scored run: three graphs in a fixed order, one retry each, best
 * attempt counts, and a total that can go on the board — for one player, or for
 * two taking turns on the same graphs. Practice is one graph
 * at a time on real hardware, walked as many times as you like, with nothing
 * kept. Everything else — arming, the countdown, recording, scoring a single
 * attempt — is identical, so the component runs one machine and asks the
 * functions here which rules apply.
 *
 * Deliberately separate from `motionGame.ts`, and deliberately not imported by
 * it: that module is shared verbatim with the Cloudflare Function that rescores
 * submissions, and none of this is any of the server's business.
 */

import { createRng } from '../shared/rng.ts';
import type { MotionSample } from '../vernier/motionStream.ts';
import { MOTION_GRAPH_COUNT, generateMotionGraphs, type TargetGraph } from './motionGame.ts';

export type MotionActivity = 'match' | 'practice';

/** People sharing a match. Two take turns on the one detector. */
export type PlayerCount = 1 | 2;

/** One walk in a session: which graph, and who walks it (0 is Player 1). */
export interface Turn {
  graphIndex: number;
  player: number;
}

/** What a practice session asks for. 'mixed' rolls any of the three. */
export type PracticeQuantity = 'position' | 'velocity' | 'mixed';

export interface RoundResult {
  samples: MotionSample[];
  score: number;
  retried: boolean;
}

export interface RoundAttempt {
  samples: MotionSample[];
  score: number;
}

/**
 * Which member of `generateMotionGraphs`'s triple a practice round should walk.
 *
 * Index order is fixed by `MOTION_GRAPH_IDS`: 0 linear position, 1 curved
 * position, 2 velocity steps.
 *
 * Practice takes one graph out of the whole triple rather than calling a
 * generator directly, because `generateMotionGraphs` is the single entry point
 * the browser and the scoring endpoint both build targets through, and a second
 * way to build one is a second thing that can disagree with the first. Two
 * discarded graphs cost microseconds.
 *
 * The roll runs on a decorrelated sub-seed so the choice cannot correlate with
 * the shapes the same seed produced.
 */
export const pickPracticeGraphIndex = (quantity: PracticeQuantity, seed: number): number => {
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  if (quantity === 'velocity') return 2;
  if (quantity === 'position') return rng.int(0, 1);
  return rng.int(0, MOTION_GRAPH_COUNT - 1);
};

/** The single target a practice round walks. */
export const practiceGraph = (quantity: PracticeQuantity, seed: number): TargetGraph =>
  generateMotionGraphs(seed)[pickPracticeGraphIndex(quantity, seed)];

/**
 * Folds a finished attempt into whatever the round already held.
 *
 * Match keeps the better of the two attempts and records that the retry was
 * spent, so the score on the board is the best walk and the retry is gone
 * either way. Practice keeps the latest attempt and never spends anything: the
 * number on screen should be the walk you just did, and the retry button has to
 * still be there afterwards.
 */
export const mergeAttempt = (
  existing: RoundResult | null,
  attempt: RoundAttempt,
  activity: MotionActivity,
): RoundResult => {
  if (activity === 'practice') {
    return { samples: attempt.samples, score: attempt.score, retried: false };
  }

  if (existing && existing.score >= attempt.score) {
    return { ...existing, retried: true };
  }

  return { samples: attempt.samples, score: attempt.score, retried: existing !== null };
};

/** Practice retries are unlimited; a match round gets one. */
export const canRetryRound = (result: RoundResult, activity: MotionActivity): boolean =>
  activity === 'practice' || !result.retried;

// --- turns -----------------------------------------------------------------
//
// A session is a flat list of turns, and `nextRoundAction` walks it by index
// exactly as it walked graphs before there were two players. A two-player match
// has both players walk each graph before moving on, and swaps who goes first
// on every graph: whoever walks second has just watched the target being
// walked, and alternating is what keeps that head start from always landing on
// the same person.

/** Walks in a session: one for practice, one per graph per player otherwise. */
export const turnCount = (
  activity: MotionActivity,
  graphCount: number,
  players: PlayerCount,
): number => (activity === 'practice' ? 1 : graphCount * players);

/** Who walks which graph on a given turn. */
export const turnAt = (turnIndex: number, players: PlayerCount): Turn => {
  const graphIndex = Math.floor(turnIndex / players);
  const slot = turnIndex % players;
  return { graphIndex, player: graphIndex % 2 === 1 ? players - 1 - slot : slot };
};

/** The turn index on which `player` walks `graphIndex` — the inverse of `turnAt`. */
export const turnIndexFor = (graphIndex: number, player: number, players: PlayerCount): number =>
  graphIndex * players + (graphIndex % 2 === 1 ? players - 1 - player : player);

/** One player's results in graph order, picked out of the per-turn list. */
export const playerResults = <T>(
  results: readonly (T | null | undefined)[],
  player: number,
  players: PlayerCount,
  graphCount: number,
): (T | null)[] =>
  Array.from(
    { length: graphCount },
    (_, graphIndex) => results[turnIndexFor(graphIndex, player, players)] ?? null,
  );

export type MatchOutcome = { kind: 'win'; winner: number } | { kind: 'tie' };

/** Highest total wins. Equal totals are a tie; retries do not break it. */
export const matchOutcome = (totals: readonly number[]): MatchOutcome => {
  const best = Math.max(...totals);
  const leaders = totals.filter((total) => total === best);
  return leaders.length === 1 ? { kind: 'win', winner: totals.indexOf(best) } : { kind: 'tie' };
};

export type RoundAction = 'advance' | 'finish' | 'reroll';

/** What the button under a reviewed turn should do. */
export const nextRoundAction = (
  activity: MotionActivity,
  turnIndex: number,
  turnTotal: number,
): RoundAction => {
  if (activity === 'practice') return 'reroll';
  return turnIndex >= turnTotal - 1 ? 'finish' : 'advance';
};
