import { DEFAULT_ABSORBER, DEFAULT_N, type Source } from './solver.ts';

export type BrushMode = 'wall' | 'erase' | 'shoal';

/** Default source strength, chosen so a fresh source gives clearly visible but gentle waves. */
export const DEFAULT_AMP = 0.15;
export const DEFAULT_FREQ = 0.05;
export const SHOAL_DEPTH = 0.35;

function insideMargin(i: number, j: number, n: number, margin: number): boolean {
  return Math.min(i, j, n - 1 - i, n - 1 - j) < margin;
}

/**
 * Stamp a soft disc into the depth map.
 *  - wall:  hard solid disc.
 *  - erase: restore open water of reference depth 1.
 *  - shoal: blend toward `value` with a soft edge; never touches walls.
 * Cells within `margin` of the domain edge (the absorber) are left alone.
 */
export function stampDisc(
  depth: Float32Array,
  n: number,
  cx: number,
  cy: number,
  r: number,
  mode: BrushMode,
  value: number,
  margin = 0,
): void {
  const j0 = Math.max(0, Math.floor(cy - r));
  const j1 = Math.min(n - 1, Math.ceil(cy + r));
  const i0 = Math.max(0, Math.floor(cx - r));
  const i1 = Math.min(n - 1, Math.ceil(cx + r));
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      if (insideMargin(i, j, n, margin)) continue;
      const dist = Math.hypot(i + 0.5 - cx, j + 0.5 - cy);
      if (dist > r) continue;
      const c = j * n + i;
      if (mode === 'wall') depth[c] = 0;
      else if (mode === 'erase') depth[c] = 1;
      else if (depth[c]! > 0) {
        const w = Math.min(1, (r - dist) / (0.4 * r));
        depth[c] = depth[c]! + (value - depth[c]!) * w;
      }
    }
  }
}

export function stampSegment(
  depth: Float32Array,
  n: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  mode: BrushMode,
  value: number,
  margin = 0,
): void {
  const length = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(length / Math.max(0.5, r * 0.4)));
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    stampDisc(depth, n, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, mode, value, margin);
  }
}

export interface PresetInfo {
  id: string;
  label: string;
  description: string;
}

export const PRESETS: PresetInfo[] = [
  { id: 'open', label: 'Open water', description: 'An empty pool. Place your own sources, barriers and shoals.' },
  { id: 'two-sources', label: 'Two sources', description: 'Two in-phase sources make a hyperbolic interference pattern.' },
  { id: 'double-slit', label: 'Double slit', description: 'A plane wave meets two slits; bright and dark fringes fan out behind.' },
  { id: 'single-slit', label: 'Single slit', description: 'A slit about two wavelengths wide diffracts a plane wave.' },
  { id: 'lens', label: 'Shoal lens', description: 'Shallow water is slow water, so a lens-shaped shoal focuses a plane wave.' },
  { id: 'harbor', label: 'Harbor', description: 'A breakwater with a gap guards a basin that rings like a resonator.' },
  { id: 'parabola', label: 'Parabolic reflector', description: 'A source at the focus becomes a plane wave after bouncing off the dish.' },
];

export interface BuiltPreset {
  depth: Float32Array;
  sources: Source[];
}

function point(x: number, y: number, freq = DEFAULT_FREQ, amp = DEFAULT_AMP): Source {
  return { x, y, freq, amp, phase: 0, half: 0, angle: 0 };
}

function lineSource(x: number, y: number, half: number, freq = DEFAULT_FREQ, amp = DEFAULT_AMP): Source {
  return { x, y, freq, amp, phase: 0, half, angle: Math.PI / 2 };
}

/** Vertical wall at x spanning y0..y1 with open gaps given as [centre, width]. */
function wallWithGaps(
  depth: Float32Array,
  n: number,
  x: number,
  y0: number,
  y1: number,
  gaps: Array<[number, number]>,
  r: number,
): void {
  const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
  let start = y0;
  for (const [centre, width] of sorted) {
    const gapLo = centre - width / 2;
    if (gapLo - r > start) stampSegment(depth, n, x, start, x, gapLo - r, r, 'wall', 0);
    start = centre + width / 2 + r;
  }
  if (y1 > start) stampSegment(depth, n, x, start, x, y1, r, 'wall', 0);
}

export function buildPreset(id: string, n = DEFAULT_N, absorber = DEFAULT_ABSORBER): BuiltPreset {
  const depth = new Float32Array(n * n).fill(1);
  const cx = n / 2;
  const cy = n / 2;
  const lo = absorber + 6;
  const hi = n - absorber - 6;
  const r = 3;
  let sources: Source[] = [];

  switch (id) {
    case 'two-sources':
      sources = [point(cx, cy - 40), point(cx, cy + 40)];
      break;
    case 'double-slit':
      wallWithGaps(depth, n, cx - 40, lo, hi, [[cy - 30, 10], [cy + 30, 10]], r);
      sources = [lineSource(cx - 170, cy, 130, 0.07)];
      break;
    case 'single-slit':
      wallWithGaps(depth, n, cx - 40, lo, hi, [[cy, 30]], r);
      sources = [lineSource(cx - 170, cy, 130)];
      break;
    case 'lens': {
      const R = 100;
      const offset = 70;
      const lx = cx + 20;
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
          if (insideMargin(i, j, n, absorber)) continue;
          const d1 = Math.hypot(i + 0.5 - (lx - offset), j + 0.5 - cy);
          const d2 = Math.hypot(i + 0.5 - (lx + offset), j + 0.5 - cy);
          if (d1 < R && d2 < R) depth[j * n + i] = SHOAL_DEPTH;
        }
      }
      sources = [lineSource(cx - 170, cy, 130)];
      break;
    }
    case 'harbor': {
      const wx = cx - 40;
      wallWithGaps(depth, n, wx, lo, hi, [[cy, 40]], r);
      stampSegment(depth, n, wx, cy - 120, cx + 150, cy - 120, r, 'wall', 0);
      stampSegment(depth, n, wx, cy + 120, cx + 150, cy + 120, r, 'wall', 0);
      stampSegment(depth, n, cx + 150, cy - 120, cx + 150, cy + 120, r, 'wall', 0);
      sources = [lineSource(cx - 170, cy, 130)];
      break;
    }
    case 'parabola': {
      const p = 60;
      const xv = cx + 100;
      let px = xv;
      let py = cy;
      for (let k = 1; k <= 60; k += 1) {
        const dy = (k / 60) * 110;
        const x = xv - (dy * dy) / (4 * p);
        stampSegment(depth, n, px, cy + (py - cy), x, cy + dy, r, 'wall', 0);
        stampSegment(depth, n, px, 2 * cy - py, x, cy - dy, r, 'wall', 0);
        px = x;
        py = cy + dy;
      }
      sources = [point(xv - p, cy)];
      break;
    }
    case 'open':
    default:
      sources = [];
      break;
  }

  return { depth, sources };
}
