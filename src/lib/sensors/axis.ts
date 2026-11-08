/**
 * Axis-range helpers for the sensor plot. DOM-free.
 *
 * A range is either manual (a student zoomed in) or absent (auto-scale). The
 * plot pads auto ranges itself; these helpers work on the numbers a person
 * types and the zoom buttons move.
 */

export interface AxisRange {
  min: number;
  max: number;
}

/** Smallest span a zoom may reach, so repeated zooming cannot collapse to a point. */
const MIN_SPAN = 1e-9;

export const boundsOf = (values: readonly number[]): AxisRange | null => {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === Infinity) return null;
  if (max - min < 1e-12) return { min: min - 0.5, max: max + 0.5 };
  const pad = (max - min) * 0.06;
  return { min: min - pad, max: max + pad };
};

/** factor < 1 zooms in about the centre of the range, factor > 1 zooms out. */
export const zoomRange = (range: AxisRange, factor: number): AxisRange => {
  const center = (range.min + range.max) / 2;
  const half = Math.max(MIN_SPAN, ((range.max - range.min) / 2) * factor);
  return { min: center - half, max: center + half };
};

/**
 * Applies one edited bound. Returns null when the text is not a number or
 * would make an empty or inverted range, so the caller can keep the old range.
 */
export const withBound = (range: AxisRange, which: 'min' | 'max', text: string): AxisRange | null => {
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return null;
  const next = which === 'min' ? { min: value, max: range.max } : { min: range.min, max: value };
  return next.max - next.min > MIN_SPAN ? next : null;
};

/**
 * The part of `view` that lies inside `extent`, or null when they do not
 * overlap. Used to start an analysis window on exactly what is on screen.
 */
export const clampWindow = (view: AxisRange, extent: AxisRange): AxisRange | null => {
  const min = Math.max(view.min, extent.min);
  const max = Math.min(view.max, extent.max);
  return max - min > MIN_SPAN ? { min, max } : null;
};
