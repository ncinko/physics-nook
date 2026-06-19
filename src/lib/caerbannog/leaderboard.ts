/**
 * Pure scoring, validation, and ranking for the hidden "Rabbit of Caerbannog"
 * defense leaderboard. Mirrors the kinematics Goal Rush leaderboard so the
 * Pages Functions and the React island can share one deterministic, testable
 * definition of a run's score.
 *
 * A run's score rewards both surviving deep into the waves and playing
 * aggressively:
 *
 *   score = wave * enemiesSlain + goldCollected
 *
 * where `wave` is the wave reached when the keep fell, `enemiesSlain` is every
 * rabbit (and knight) felled across the run, and `goldCollected` is the total
 * gold earned before any was spent in the shop.
 */
import { sanitizeLeaderboardName } from '../kinematics/stopZones.ts';

export interface CaerbannogValidationResult {
  ok: boolean;
  name: string;
  score: number;
  wave: number;
  enemiesSlain: number;
  goldCollected: number;
  errors: string[];
}

export interface CaerbannogLeaderboardScore {
  name: string;
  score: number;
  wave: number;
  enemiesSlain: number;
  goldCollected: number;
  createdAt: number;
}

export const CAERBANNOG_DEFAULTS = {
  minScore: 0,
  maxScore: 100_000_000,
  maxWave: 2_000,
  maxEnemiesSlain: 500_000,
  maxGoldCollected: 5_000_000,
  leaderboardLimit: 10,
  localStorageKey: 'physics-nook-caerbannog-local-leaderboard-v1',
} as const;

/** The run score: deeper waves and richer, deadlier play all push it up. */
export const caerbannogScore = (wave: number, enemiesSlain: number, goldCollected: number): number =>
  wave * enemiesSlain + goldCollected;

export const validateCaerbannogScoreSubmission = (payload: {
  name?: unknown;
  score?: unknown;
  wave?: unknown;
  enemiesSlain?: unknown;
  goldCollected?: unknown;
}): CaerbannogValidationResult => {
  const errors: string[] = [];
  const name = sanitizeLeaderboardName(payload.name);
  const score = Number(payload.score);
  const wave = Number(payload.wave);
  const enemiesSlain = Number(payload.enemiesSlain);
  const goldCollected = Number(payload.goldCollected);

  if (!Number.isInteger(wave) || wave < 1 || wave > CAERBANNOG_DEFAULTS.maxWave) {
    errors.push('wave is outside the accepted range.');
  }

  if (
    !Number.isInteger(enemiesSlain) ||
    enemiesSlain < 0 ||
    enemiesSlain > CAERBANNOG_DEFAULTS.maxEnemiesSlain
  ) {
    errors.push('enemiesSlain is outside the accepted range.');
  }

  if (
    !Number.isInteger(goldCollected) ||
    goldCollected < 0 ||
    goldCollected > CAERBANNOG_DEFAULTS.maxGoldCollected
  ) {
    errors.push('goldCollected is outside the accepted range.');
  }

  if (!Number.isInteger(score)) {
    errors.push('score must be an integer.');
  } else if (score < CAERBANNOG_DEFAULTS.minScore || score > CAERBANNOG_DEFAULTS.maxScore) {
    errors.push('score is outside the accepted range.');
  }

  if (
    Number.isInteger(score) &&
    Number.isInteger(wave) &&
    Number.isInteger(enemiesSlain) &&
    Number.isInteger(goldCollected) &&
    score !== caerbannogScore(wave, enemiesSlain, goldCollected)
  ) {
    errors.push('score does not match wave, enemies, and gold totals.');
  }

  return {
    ok: errors.length === 0,
    name,
    score,
    wave,
    enemiesSlain,
    goldCollected,
    errors,
  };
};

/** Normalize a raw D1 row (snake_case columns) into a leaderboard score. */
export const normalizeCaerbannogScoreRow = (
  row: Record<string, unknown>,
): CaerbannogLeaderboardScore & { id: string } => ({
  id: String(row.id),
  name: sanitizeLeaderboardName(row.name),
  score: Number(row.score),
  wave: Number(row.wave),
  enemiesSlain: Number(row.enemies_slain ?? row.enemiesSlain),
  goldCollected: Number(row.gold_collected ?? row.goldCollected),
  createdAt: Number(row.created_at ?? row.createdAt),
});

/** Keep only each player's best score, highest first, capped at `limit`. */
export const selectBestCaerbannogScoresByUniqueName = <T extends CaerbannogLeaderboardScore>(
  scores: T[],
  limit = CAERBANNOG_DEFAULTS.leaderboardLimit,
) => {
  const bestByName = new Map<string, T>();

  scores.forEach((score) => {
    const key = sanitizeLeaderboardName(score.name).toLocaleLowerCase();
    const current = bestByName.get(key);

    if (
      !current ||
      score.score > current.score ||
      (score.score === current.score && score.createdAt < current.createdAt)
    ) {
      bestByName.set(key, score);
    }
  });

  return [...bestByName.values()]
    .sort((a, b) => b.score - a.score || a.createdAt - b.createdAt)
    .slice(0, limit);
};
