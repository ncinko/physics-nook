/**
 * Hit testing for hover and pin on the sensor plot. DOM-free.
 *
 * Distances are measured in plot pixels (SVG user units), not data units, so a
 * point that looks closest to the pointer is the one chosen whatever the axis
 * scales are.
 */

export interface HoverCandidate {
  seriesKey: string;
  seriesLabel: string;
  x: number;
  y: number;
}

export interface PixelScale {
  x: (value: number) => number;
  y: (value: number) => number;
}

/** Closest candidate within `maxPixels` of (px, py), or null. */
export const nearestPoint = (
  candidates: readonly HoverCandidate[],
  px: number,
  py: number,
  scale: PixelScale,
  maxPixels = 28,
): HoverCandidate | null => {
  let best: HoverCandidate | null = null;
  let bestDistance = maxPixels * maxPixels;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) continue;
    const dx = scale.x(candidate.x) - px;
    const dy = scale.y(candidate.y) - py;
    const distance = dx * dx + dy * dy;
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
};
