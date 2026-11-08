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

export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LabelRequest {
  /** The point being labelled, in plot pixels. */
  cx: number;
  cy: number;
  width: number;
  height: number;
}

const overlaps = (a: LabelBox, b: LabelBox, pad = 3): boolean =>
  a.x < b.x + b.width + pad &&
  a.x + a.width + pad > b.x &&
  a.y < b.y + b.height + pad &&
  a.y + a.height + pad > b.y;

const inside = (box: LabelBox, bounds: LabelBox): boolean =>
  box.x >= bounds.x &&
  box.y >= bounds.y &&
  box.x + box.width <= bounds.x + bounds.width &&
  box.y + box.height <= bounds.y + bounds.height;

/**
 * Places one label per request, in order, so that labels avoid each other and
 * the `occupied` boxes (typically the point markers) when there is room. Each
 * label tries a ring of positions around its point, nearest first, and keeps
 * the first that stays inside `bounds` and overlaps nothing. When nothing
 * fits it falls back to the nearest position inside the bounds, so a crowded
 * plot degrades to overlap rather than losing a label.
 */
export const placeLabels = (
  requests: readonly LabelRequest[],
  bounds: LabelBox,
  occupied: readonly LabelBox[] = [],
  gap = 12,
): LabelBox[] => {
  const placed: LabelBox[] = [];

  for (const { cx, cy, width, height } of requests) {
    const candidates: LabelBox[] = [];
    for (let tier = 0; tier < 4; tier += 1) {
      const rise = gap + height * tier + (tier > 0 ? 4 * tier : 0);
      const above = cy - rise - height;
      const below = cy + rise;
      const right = cx + gap;
      const left = cx - gap - width;
      const centered = cx - width / 2;
      candidates.push(
        { x: right, y: above, width, height },
        { x: left, y: above, width, height },
        { x: right, y: below, width, height },
        { x: left, y: below, width, height },
        { x: centered, y: above, width, height },
        { x: centered, y: below, width, height },
      );
    }

    const free = candidates.find(
      (box) =>
        inside(box, bounds) &&
        !placed.some((other) => overlaps(box, other)) &&
        !occupied.some((other) => overlaps(box, other, 1)),
    );

    const fallback = (): LabelBox => {
      const first = candidates[0];
      return {
        ...first,
        x: Math.min(Math.max(first.x, bounds.x), bounds.x + bounds.width - width),
        y: Math.min(Math.max(first.y, bounds.y), bounds.y + bounds.height - height),
      };
    };

    placed.push(free ?? fallback());
  }

  return placed;
};
