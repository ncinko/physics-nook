export const CHICKEN_ROUND_SECONDS = 20;
export const MIN_CHICKEN_COUNT = 42;
export const MAX_CHICKEN_COUNT = 68;

export interface ChickenEstimate {
  trueCount: number;
  estimate: number;
  uncertainty: number;
}

export interface ChickenScore {
  trueCount: number;
  estimate: number;
  uncertainty: number;
  low: number;
  high: number;
  error: number;
  discrepancy: number;
  coversTruth: boolean;
  accuracyPoints: number;
  precisionPoints: number;
  score: number;
  verdict: string;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const roundTenth = (value: number): number => Math.round(value * 10) / 10;

export const chickenCountForRandom = (random: () => number = Math.random): number => {
  const draw = clamp(random(), 0, 0.999999999);
  return MIN_CHICKEN_COUNT + Math.floor(draw * (MAX_CHICKEN_COUNT - MIN_CHICKEN_COUNT + 1));
};

export const scoreChickenEstimate = ({
  trueCount,
  estimate,
  uncertainty,
}: ChickenEstimate): ChickenScore => {
  const cleanTrueCount = Math.max(0, Math.round(trueCount));
  const cleanEstimate = Math.max(0, estimate);
  const cleanUncertainty = Math.max(0, uncertainty);
  const low = cleanEstimate - cleanUncertainty;
  const high = cleanEstimate + cleanUncertainty;
  const error = Math.abs(cleanEstimate - cleanTrueCount);
  const coversTruth = cleanTrueCount >= low && cleanTrueCount <= high;
  const discrepancy =
    cleanUncertainty === 0 ? (error === 0 ? 0 : Infinity) : error / cleanUncertainty;

  const accuracyWindow = Math.max(12, cleanTrueCount * 0.35);
  const accuracyPoints = 60 * clamp(1 - error / accuracyWindow, 0, 1);

  const tightUncertainty = Math.max(2, cleanTrueCount * 0.06);
  const wideUncertainty = Math.max(6, cleanTrueCount * 0.22);
  const precisionPoints = coversTruth
    ? 40 * clamp(1 - (cleanUncertainty - tightUncertainty) / (wideUncertainty - tightUncertainty), 0, 1)
    : 0;

  let verdict = 'Your interval missed the true count.';
  if (coversTruth && error <= tightUncertainty) {
    verdict = 'Accurate and well-sized: your range caught the truth without wasting much width.';
  } else if (coversTruth) {
    verdict = 'Honest uncertainty: your range caught the truth, but a narrower estimate would score higher.';
  } else if (error <= tightUncertainty) {
    verdict = 'Good center, but the uncertainty was too tight to include the truth.';
  }

  return {
    trueCount: cleanTrueCount,
    estimate: cleanEstimate,
    uncertainty: cleanUncertainty,
    low,
    high,
    error,
    discrepancy,
    coversTruth,
    accuracyPoints: roundTenth(accuracyPoints),
    precisionPoints: roundTenth(precisionPoints),
    score: Math.round(accuracyPoints + precisionPoints),
    verdict,
  };
};
