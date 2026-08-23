/**
 * Left-endpoint strips under a curve - the picture behind "displacement is the
 * area under v(t)" in the kinematics lesson's slope-vs-area section.
 *
 * The strips are deliberately sampled at their left edge rather than their
 * midpoint. A midpoint rule is more accurate at the same strip count, which is
 * exactly what makes it the wrong teaching picture here: the argument being
 * illustrated is that a strip is only a displacement once it is narrow enough
 * for v to barely change across it, and the left-edge rule keeps that error
 * visible until the strips really are narrow.
 *
 * `signed: false` measures each strip by its magnitude instead, which turns the
 * same sum into distance travelled rather than displacement.
 */

export interface AreaStrip {
  from: number;
  to: number;
  /** The curve's value at the sampled (left) edge, i.e. the strip's height. */
  height: number;
  /** Height times width, negative below the axis unless `signed` is false. */
  area: number;
}

export interface StripSum {
  /** Common width of every strip. */
  width: number;
  strips: AreaStrip[];
  total: number;
}

export interface StripOptions {
  /** Count strips below the axis as negative (the default) or as positive. */
  signed?: boolean;
}

export const stripsUnder = (
  valueOfT: (t: number) => number,
  from: number,
  to: number,
  count: number,
  { signed = true }: StripOptions = {},
): StripSum => {
  const stripCount = Math.max(1, Math.floor(count));
  const width = (to - from) / stripCount;

  const strips: AreaStrip[] = Array.from({ length: stripCount }, (_, index) => {
    const stripFrom = from + index * width;
    const height = valueOfT(stripFrom);
    return {
      from: stripFrom,
      to: stripFrom + width,
      height,
      area: (signed ? height : Math.abs(height)) * width,
    };
  });

  return {
    width,
    strips,
    total: strips.reduce((sum, strip) => sum + strip.area, 0),
  };
};
