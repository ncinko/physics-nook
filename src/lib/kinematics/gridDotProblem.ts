// Pure model for grid-dot problems: the reader places dots on a top-down meter
// grid and we grade them against an answer key. The cat problem on the 2D
// kinematics page is the first user; the grading is generic so other pages can
// pass their own answers.

export interface GridPoint {
  x: number;
  y: number;
}

export interface DotGrade {
  matched: GridPoint[];
  missing: GridPoint[];
  extra: GridPoint[];
  correct: boolean;
}

// Cat on the field: steady 4 m/s east; northward velocity grows at 1 m/s² until
// it reaches 4 m/s, then holds.
export const CAT_VX = 4;
export const CAT_AY = 1;
export const CAT_VY_MAX = 4;
export const CAT_STEPS = 6;

const POINT_EPSILON = 1e-6;

export function catPositionAt(t: number): GridPoint {
  const tCap = CAT_VY_MAX / CAT_AY;
  const y =
    t <= tCap
      ? 0.5 * CAT_AY * t * t
      : 0.5 * CAT_AY * tCap * tCap + CAT_VY_MAX * (t - tCap);
  return { x: CAT_VX * t, y };
}

export function catPathAnswer(steps = CAT_STEPS): GridPoint[] {
  return Array.from({ length: steps }, (_, i) => catPositionAt(i + 1));
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Snap a point in grid units to the nearest `step` intersection inside the grid. */
export function snapToGrid(x: number, y: number, step: number, cols: number, rows: number): GridPoint {
  const snap = (value: number, max: number) => clamp(Math.round(value / step) * step, 0, max);
  return { x: snap(x, cols), y: snap(y, rows) };
}

export function samePoint(a: GridPoint, b: GridPoint, tolerance = POINT_EPSILON): boolean {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

/** Add a dot, or remove it if one is already there. */
export function toggleDot(dots: GridPoint[], point: GridPoint): GridPoint[] {
  return dots.some((dot) => samePoint(dot, point))
    ? dots.filter((dot) => !samePoint(dot, point))
    : [...dots, point];
}

/** Order-independent grading; each answer point can be claimed by one dot only. */
export function gradeDots(placed: GridPoint[], answer: GridPoint[], tolerance = POINT_EPSILON): DotGrade {
  const unclaimed = [...answer];
  const matched: GridPoint[] = [];
  const extra: GridPoint[] = [];
  for (const dot of placed) {
    const index = unclaimed.findIndex((target) => samePoint(dot, target, tolerance));
    if (index === -1) {
      extra.push(dot);
    } else {
      matched.push(dot);
      unclaimed.splice(index, 1);
    }
  }
  return { matched, missing: unclaimed, extra, correct: unclaimed.length === 0 && extra.length === 0 };
}

/** One-line feedback, e.g. "4 of 6 dots correct, 1 extra dot." */
export function gradeSummary(grade: DotGrade, total: number): string {
  if (grade.correct) {
    return `All ${total} dots are in the right place.`;
  }
  const parts = [`${grade.matched.length} of ${total} dots correct`];
  if (grade.extra.length > 0) {
    parts.push(`${grade.extra.length} extra ${grade.extra.length === 1 ? 'dot' : 'dots'}`);
  }
  return `${parts.join(', ')}.`;
}
