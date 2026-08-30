/**
 * How a track is told apart from its neighbours on the stage, in the table, and
 * on the plot. Colour cycles the four theme accents; past four, the marker
 * shape starts varying too, so a fifth and sixth series stay distinguishable
 * without inventing hex values the theme does not know about.
 */

export const TRACK_ACCENTS = [
  'var(--accent-blue)',
  'var(--accent-red)',
  'var(--accent-green)',
  'var(--accent-purple)',
] as const;

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond';

const MARKER_SHAPES: MarkerShape[] = ['circle', 'square', 'triangle', 'diamond'];

const wrap = (index: number, length: number) => ((index % length) + length) % length;

export const trackColor = (index: number): string => TRACK_ACCENTS[wrap(index, TRACK_ACCENTS.length)];

export const trackShape = (index: number): MarkerShape =>
  MARKER_SHAPES[wrap(Math.floor(index / TRACK_ACCENTS.length), MARKER_SHAPES.length)];

/**
 * One `<path d>` for every marker shape, so callers never branch on shape when
 * rendering. `radius` is the half-width, in whatever units the surrounding
 * viewBox uses.
 */
export const markerPath = (shape: MarkerShape, cx: number, cy: number, radius: number): string => {
  const r = Math.max(0.5, radius);
  switch (shape) {
    case 'square':
      return `M ${cx - r} ${cy - r} h ${2 * r} v ${2 * r} h ${-2 * r} Z`;
    case 'triangle':
      return `M ${cx} ${cy - r} L ${cx + r} ${cy + r * 0.85} L ${cx - r} ${cy + r * 0.85} Z`;
    case 'diamond':
      return `M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`;
    case 'circle':
    default:
      return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
  }
};
