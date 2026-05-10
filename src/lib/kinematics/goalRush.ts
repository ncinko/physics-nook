import { sanitizeLeaderboardName } from './stopZones.ts';

export interface GoalRushValidationResult {
  ok: boolean;
  name: string;
  score: number;
  goldenHits: number;
  normalHits: number;
  durationMs: number;
  errors: string[];
}

export interface GoalRushLeaderboardScore {
  name: string;
  score: number;
  goldenHits: number;
  normalHits: number;
  durationMs: number;
  createdAt: number;
}

export const GOAL_RUSH_DEFAULTS = {
  gameTimeS: 30,
  goldenValue: 3,
  normalValue: 1,
  minScore: 0,
  maxScore: 500,
  minDurationMs: 10_000,
  maxDurationMs: 5 * 60 * 1000,
  leaderboardLimit: 10,
  localStorageKey: 'physics-nook-kinematics-goal-rush-local-leaderboard-v1',
} as const;

export const validateGoalRushScoreSubmission = (payload: {
  name?: unknown;
  score?: unknown;
  goldenHits?: unknown;
  normalHits?: unknown;
  durationMs?: unknown;
}): GoalRushValidationResult => {
  const errors: string[] = [];
  const name = sanitizeLeaderboardName(payload.name);
  const score = Number(payload.score);
  const goldenHits = Number(payload.goldenHits);
  const normalHits = Number(payload.normalHits);
  const durationMs = Number(payload.durationMs);

  if (!Number.isInteger(score)) {
    errors.push('score must be an integer.');
  } else if (score < GOAL_RUSH_DEFAULTS.minScore || score > GOAL_RUSH_DEFAULTS.maxScore) {
    errors.push('score is outside the accepted range.');
  }

  if (!Number.isInteger(goldenHits) || goldenHits < 0) {
    errors.push('goldenHits must be a non-negative integer.');
  }

  if (!Number.isInteger(normalHits) || normalHits < 0) {
    errors.push('normalHits must be a non-negative integer.');
  }

  if (
    Number.isInteger(score) &&
    Number.isInteger(goldenHits) &&
    Number.isInteger(normalHits) &&
    score !== goldenHits * GOAL_RUSH_DEFAULTS.goldenValue + normalHits * GOAL_RUSH_DEFAULTS.normalValue
  ) {
    errors.push('score does not match hit totals.');
  }

  if (!Number.isInteger(durationMs)) {
    errors.push('durationMs must be an integer.');
  } else if (
    durationMs < GOAL_RUSH_DEFAULTS.minDurationMs ||
    durationMs > GOAL_RUSH_DEFAULTS.maxDurationMs
  ) {
    errors.push('durationMs is outside the accepted range.');
  }

  return {
    ok: errors.length === 0,
    name,
    score,
    goldenHits,
    normalHits,
    durationMs,
    errors,
  };
};

export const selectBestGoalRushScoresByUniqueName = <T extends GoalRushLeaderboardScore>(
  scores: T[],
  limit = GOAL_RUSH_DEFAULTS.leaderboardLimit,
) => {
  const bestByName = new Map<string, T>();

  scores.forEach((score) => {
    const key = sanitizeLeaderboardName(score.name).toLocaleLowerCase();
    const current = bestByName.get(key);

    if (
      !current ||
      score.score > current.score ||
      (score.score === current.score && score.durationMs < current.durationMs) ||
      (score.score === current.score &&
        score.durationMs === current.durationMs &&
        score.createdAt < current.createdAt)
    ) {
      bestByName.set(key, score);
    }
  });

  return [...bestByName.values()]
    .sort((a, b) => b.score - a.score || a.durationMs - b.durationMs || a.createdAt - b.createdAt)
    .slice(0, limit);
};
