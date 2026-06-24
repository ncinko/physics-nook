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
