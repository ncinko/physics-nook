/**
 * The rules that differ between the two ways to play Motion Match.
 *
 * Match is the scored run: three graphs in a fixed order, one retry each, best
 * attempt counts, and a total that can go on the board. Practice is one graph
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

export type RoundAction = 'advance' | 'finish' | 'reroll';

/** What the button under a reviewed round should do. */
export const nextRoundAction = (
  activity: MotionActivity,
  roundIndex: number,
  roundCount: number,
): RoundAction => {
  if (activity === 'practice') return 'reroll';
  return roundIndex >= roundCount - 1 ? 'finish' : 'advance';
};
