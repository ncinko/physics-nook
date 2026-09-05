export type ContourPoint = readonly [number, number];
export type ContourSegment = readonly [ContourPoint, ContourPoint];
export interface Contour { level: number; segments: ContourSegment[] }

/** Pick the closest drawn contour, including its endpoints, within a CSS-pixel
 * tolerance. Looking at the actual segments keeps hits out of masked cores. */
export function nearestContour(contours: readonly Contour[], x: number, y: number, tolerance = 7) {
  let best: { level: number; point: ContourPoint; distance: number } | null = null;
  for (const { level, segments } of contours) {
    for (const [a, b] of segments) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSquared)) : 0;
      const point: ContourPoint = [a[0] + t * dx, a[1] + t * dy];
      const distance = Math.hypot(x - point[0], y - point[1]);
      if (distance <= tolerance && (!best || distance < best.distance)) best = { level, point, distance };
    }
  }
  return best;
}

/** A linear, zero-anchored interval, with the extreme 2% excluded from the
 * displayed range. A singular charge must not determine the contour density.
 * At most 15 levels are selected, including zero when it is in range. */
export function choosePotentialLevels(samples: ArrayLike<number>, maxBands = 7) {
  const finite = Array.from(samples).filter(Number.isFinite);
  if (!finite.length) return { step: 1, limit: 0, levels: [] as number[] };
  const magnitudes = finite.map(Math.abs).sort((a, b) => a - b);
  const extent = magnitudes[Math.floor((magnitudes.length - 1) * 0.98)];
  if (extent < 1e-9) return { step: 1, limit: 0, levels: [] as number[] };
  const bands = Number.isFinite(maxBands) ? Math.max(1, Math.min(7, Math.floor(maxBands))) : 7;
  const rawStep = extent / bands;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const step = ([1, 2, 5, 10].find(n => n * power >= rawStep) ?? 10) * power;
  const count = Math.floor(extent / step);
  let min = Infinity, max = -Infinity;
  for (const v of finite) { min = Math.min(min, v); max = Math.max(max, v); }
  const levels: number[] = [];
  if (max > min) {
    for (let i = -count; i <= count; i++) {
      const level = i * step;
      if (level >= min && level <= max) levels.push(level === 0 ? 0 : level);
    }
  }
  return { step, limit: count * step, levels };
}

/** Piecewise-linear contours on a triangulated regular grid. The same diagonal
 * is used in every cell, so saddle cases have a consistent topology. NaN cells
 * mask charge cores. Coordinates span [0,width] × [0,height]. */
export function traceContours(
  values: ArrayLike<number>, columns: number, rows: number,
  width: number, height: number, levels: readonly number[],
): Contour[] {
  if (columns < 2 || rows < 2 || values.length !== columns * rows) {
    throw new Error('Contours require a complete grid of at least 2 × 2 samples.');
  }
  const result = levels.map(level => ({ level, segments: [] as ContourSegment[] }));
  const dx = width / (columns - 1), dy = height / (rows - 1);
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < columns - 1; x++) {
      const ids = [y * columns + x, y * columns + x + 1,
        (y + 1) * columns + x + 1, (y + 1) * columns + x];
      const points: ContourPoint[] = [[x * dx, y * dy], [(x + 1) * dx, y * dy],
        [(x + 1) * dx, (y + 1) * dy], [x * dx, (y + 1) * dy]];
      if (ids.some(i => !Number.isFinite(values[i]))) continue;
      for (const triangle of [[0, 1, 2], [0, 2, 3]]) {
        for (const contour of result) {
          const crossings: ContourPoint[] = [];
          for (let e = 0; e < 3; e++) {
            const a = triangle[e], b = triangle[(e + 1) % 3];
            const va = values[ids[a]], vb = values[ids[b]];
            // Half-open convention avoids duplicate crossings at vertices.
            if ((va > contour.level) === (vb > contour.level)) continue;
            const t = (contour.level - va) / (vb - va);
            crossings.push([points[a][0] + t * (points[b][0] - points[a][0]),
              points[a][1] + t * (points[b][1] - points[a][1])]);
          }
          if (crossings.length === 2 && Math.hypot(crossings[0][0] - crossings[1][0],
            crossings[0][1] - crossings[1][1]) > 1e-10) {
            contour.segments.push([crossings[0], crossings[1]]);
          }
        }
      }
    }
  }
  return result;
}
