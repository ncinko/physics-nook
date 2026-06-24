import { sanitizeLeaderboardName } from '../kinematics/stopZones.ts';

export const CHICKEN_ROUND_SECONDS = 20;

export interface ChickenRoundConfig {
  round: number;
  min: number;
  max: number;
}

export const CHICKEN_ROUNDS: ChickenRoundConfig[] = [
  { round: 1, min: 20, max: 40 },
  { round: 2, min: 50, max: 100 },
  { round: 3, min: 100, max: 200 },
];

export interface ChickenEstimate {
  trueCount: number;
  estimate: number;
  uncertainty: number;
  elapsedSeconds: number;
  roundSeconds?: number;
}

export interface ChickenScore {
  trueCount: number;
  estimate: number;
  uncertainty: number;
  error: number;
  errorUncertaintyRatio: number;
  elapsedSeconds: number;
  accuracyScore: number;
  ratioMultiplier: number;
  speedBonus: number;
  score: number;
}

export interface ChickenCountLeaderboardRound {
  trueCount: number;
  estimate: number;
  uncertainty: number;
  elapsedSeconds: number;
  score: number;
}

export interface ChickenCountLeaderboardScore {
  name: string;
  score: number;
  totalError: number;
  totalElapsedSeconds: number;
  round1Count: number;
  round2Count: number;
  round3Count: number;
  createdAt: number;
}

export interface ChickenCountValidationResult {
  ok: boolean;
  name: string;
  score: number;
  totalError: number;
  totalElapsedSeconds: number;
  rounds: ChickenCountLeaderboardRound[];
  errors: string[];
}

export const CHICKEN_COUNT_DEFAULTS = {
  minScore: 0,
  maxScore: 1_000,
  maxReportValue: 1_000,
  leaderboardLimit: 10,
  localStorageKey: 'physics-nook-chicken-count-local-leaderboard-v1',
} as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const roundTenth = (value: number): number => Math.round(value * 10) / 10;

export const chickenCountForRound = (
  roundIndex: number,
  random: () => number = Math.random,
): number => {
  const config = CHICKEN_ROUNDS[clamp(Math.floor(roundIndex), 0, CHICKEN_ROUNDS.length - 1)];
  const draw = clamp(random(), 0, 0.999999999);
  return config.min + Math.floor(draw * (config.max - config.min + 1));
};

export const scoreChickenEstimate = ({
  trueCount,
  estimate,
  uncertainty,
  elapsedSeconds,
  roundSeconds = CHICKEN_ROUND_SECONDS,
}: ChickenEstimate): ChickenScore => {
  const cleanTrueCount = Math.max(0, Math.round(trueCount));
  const cleanEstimate = Math.max(0, estimate);
  const cleanUncertainty = Math.max(0, uncertainty);
  const cleanRoundSeconds = Math.max(1, roundSeconds);
  const cleanElapsedSeconds = clamp(elapsedSeconds, 0, cleanRoundSeconds);
  const error = Math.abs(cleanEstimate - cleanTrueCount);
  const errorUncertaintyRatio =
    cleanUncertainty === 0 ? (error === 0 ? 0 : Infinity) : error / cleanUncertainty;

  const accuracyScale = Math.max(4, cleanTrueCount * 0.18);
  const accuracyScore = 160 * Math.exp(-error / accuracyScale);

  const ratioMultiplier = Number.isFinite(errorUncertaintyRatio)
    ? 1 / (1 + Math.max(0, errorUncertaintyRatio - 1) ** 2)
    : 0;

  const speedBonus = 45 * clamp(1 - cleanElapsedSeconds / cleanRoundSeconds, 0, 1);
  const score = Math.round(accuracyScore * ratioMultiplier + speedBonus);

  return {
    trueCount: cleanTrueCount,
    estimate: cleanEstimate,
    uncertainty: cleanUncertainty,
    error,
    errorUncertaintyRatio: roundTenth(errorUncertaintyRatio),
    elapsedSeconds: roundTenth(cleanElapsedSeconds),
    accuracyScore: roundTenth(accuracyScore),
    ratioMultiplier: roundTenth(ratioMultiplier),
    speedBonus: roundTenth(speedBonus),
    score,
  };
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const isFiniteNonNegative = (value: number, max: number) =>
  Number.isFinite(value) && value >= 0 && value <= max;

export const chickenCountGameScore = (rounds: Pick<ChickenCountLeaderboardRound, 'score'>[]): number =>
  rounds.reduce((sum, round) => sum + round.score, 0);

export const validateChickenCountScoreSubmission = (payload: {
  name?: unknown;
  score?: unknown;
  rounds?: unknown;
}): ChickenCountValidationResult => {
  const errors: string[] = [];
  const name = sanitizeLeaderboardName(payload.name);
  const submittedScore = Number(payload.score);
  const rawRounds = Array.isArray(payload.rounds) ? payload.rounds : [];
  const rounds: ChickenCountLeaderboardRound[] = [];
  let totalError = 0;
  let totalElapsedSeconds = 0;

  if (rawRounds.length !== CHICKEN_ROUNDS.length) {
    errors.push(`exactly ${CHICKEN_ROUNDS.length} rounds are required.`);
  }

  rawRounds.slice(0, CHICKEN_ROUNDS.length).forEach((rawRound, index) => {
    const row = asRecord(rawRound);
    const config = CHICKEN_ROUNDS[index];
    if (!row) {
      errors.push(`round ${index + 1} is not a valid object.`);
      return;
    }

    const trueCount = Number(row.trueCount);
    const estimate = Number(row.estimate);
    const uncertainty = Number(row.uncertainty);
    const elapsedSeconds = Number(row.elapsedSeconds);
    const score = Number(row.score);

    if (!Number.isInteger(trueCount) || trueCount < config.min || trueCount > config.max) {
      errors.push(`round ${index + 1} true count is outside the accepted range.`);
    }

    if (!isFiniteNonNegative(estimate, CHICKEN_COUNT_DEFAULTS.maxReportValue)) {
      errors.push(`round ${index + 1} estimate is outside the accepted range.`);
    }

    if (!isFiniteNonNegative(uncertainty, CHICKEN_COUNT_DEFAULTS.maxReportValue)) {
      errors.push(`round ${index + 1} uncertainty is outside the accepted range.`);
    }

    if (!isFiniteNonNegative(elapsedSeconds, CHICKEN_ROUND_SECONDS)) {
      errors.push(`round ${index + 1} elapsed time is outside the accepted range.`);
    }

    if (!Number.isInteger(score) || score < CHICKEN_COUNT_DEFAULTS.minScore || score > CHICKEN_COUNT_DEFAULTS.maxScore) {
      errors.push(`round ${index + 1} score is outside the accepted range.`);
    }

    if (
      Number.isInteger(trueCount) &&
      Number.isFinite(estimate) &&
      Number.isFinite(uncertainty) &&
      Number.isFinite(elapsedSeconds) &&
      Number.isInteger(score)
    ) {
      const computed = scoreChickenEstimate({ trueCount, estimate, uncertainty, elapsedSeconds });
      totalError += computed.error;
      totalElapsedSeconds += computed.elapsedSeconds;
      rounds.push({
        trueCount: computed.trueCount,
        estimate: computed.estimate,
        uncertainty: computed.uncertainty,
        elapsedSeconds: computed.elapsedSeconds,
        score: computed.score,
      });

      if (score !== computed.score) {
        errors.push(`round ${index + 1} score does not match the report.`);
      }
    }
  });

  const computedScore = chickenCountGameScore(rounds);

  if (!Number.isInteger(submittedScore)) {
    errors.push('score must be an integer.');
  } else if (
    submittedScore < CHICKEN_COUNT_DEFAULTS.minScore ||
    submittedScore > CHICKEN_COUNT_DEFAULTS.maxScore
  ) {
    errors.push('score is outside the accepted range.');
  } else if (submittedScore !== computedScore) {
    errors.push('score does not match the submitted rounds.');
  }

  return {
    ok: errors.length === 0,
    name,
    score: computedScore,
    totalError: roundTenth(totalError),
    totalElapsedSeconds: roundTenth(totalElapsedSeconds),
    rounds,
    errors,
  };
};

export const normalizeChickenCountScoreRow = (
  row: Record<string, unknown>,
): ChickenCountLeaderboardScore & { id: string } => ({
  id: String(row.id),
  name: sanitizeLeaderboardName(row.name),
  score: Number(row.score),
  totalError: Number(row.total_error ?? row.totalError),
  totalElapsedSeconds: Number(row.total_elapsed_seconds ?? row.totalElapsedSeconds),
  round1Count: Number(row.round1_count ?? row.round1Count),
  round2Count: Number(row.round2_count ?? row.round2Count),
  round3Count: Number(row.round3_count ?? row.round3Count),
  createdAt: Number(row.created_at ?? row.createdAt),
});

export const selectBestChickenCountScoresByUniqueName = <T extends ChickenCountLeaderboardScore>(
  scores: T[],
  limit = CHICKEN_COUNT_DEFAULTS.leaderboardLimit,
) => {
  const bestByName = new Map<string, T>();

  scores.forEach((score) => {
    const key = sanitizeLeaderboardName(score.name).toLocaleLowerCase();
    const current = bestByName.get(key);

    if (
      !current ||
      score.score > current.score ||
      (score.score === current.score && score.totalError < current.totalError) ||
      (score.score === current.score &&
        score.totalError === current.totalError &&
        score.totalElapsedSeconds < current.totalElapsedSeconds) ||
      (score.score === current.score &&
        score.totalError === current.totalError &&
        score.totalElapsedSeconds === current.totalElapsedSeconds &&
        score.createdAt < current.createdAt)
    ) {
      bestByName.set(key, score);
    }
  });

  return [...bestByName.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.totalError - b.totalError ||
        a.totalElapsedSeconds - b.totalElapsedSeconds ||
        a.createdAt - b.createdAt,
    )
    .slice(0, limit);
};
