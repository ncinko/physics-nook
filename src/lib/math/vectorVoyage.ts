import { ZERO_VECTOR, add, magnitude, subtract, type Vector2 } from './vectors.ts';

/**
 * Pure model for the "Vector Voyage" interactive: a head-to-tail navigation
 * puzzle. The player chains move-vectors from a start point to a target while
 * routing around rectangular hedge obstacles. All geometry here is DOM-free and
 * deterministic so it can be unit tested in `tests/math`.
 */

export interface Rect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface VoyageLevel {
  id: string;
  name: string;
  hint: string;
  start: Vector2;
  target: Vector2;
  hedges: Rect[];
  /** Fewest moves a tidy route uses; shown as "par". */
  par: number;
  /** A worked route, as head-to-tail move vectors, used for "Show a route". */
  solutionMoves: Vector2[];
}

/** How close the path tip must land to the target to count as reached. */
export const REACH_TOLERANCE = 0.25;

export const pointInRect = (point: Vector2, rect: Rect): boolean =>
  point.x >= rect.minX &&
  point.x <= rect.maxX &&
  point.y >= rect.minY &&
  point.y <= rect.maxY;

/**
 * Liang–Barsky segment vs. axis-aligned box test. The box is shrunk by `eps`
 * so a segment that merely grazes a hedge edge (a legal route along the
 * boundary) is not counted as a crossing.
 */
export const segmentIntersectsRect = (
  a: Vector2,
  b: Vector2,
  rect: Rect,
  eps = 1e-6,
): boolean => {
  const minX = rect.minX + eps;
  const maxX = rect.maxX - eps;
  const minY = rect.minY + eps;
  const maxY = rect.maxY - eps;

  if (minX > maxX || minY > maxY) {
    return false;
  }

  const dx = b.x - a.x;
  const dy = b.y - a.y;

  let t0 = 0;
  let t1 = 1;

  const edges: Array<[number, number]> = [
    [-dx, a.x - minX],
    [dx, maxX - a.x],
    [-dy, a.y - minY],
    [dy, maxY - a.y],
  ];

  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) {
        return false;
      }
      continue;
    }

    const r = q / p;
    if (p < 0) {
      if (r > t1) {
        return false;
      }
      if (r > t0) {
        t0 = r;
      }
    } else {
      if (r < t0) {
        return false;
      }
      if (r < t1) {
        t1 = r;
      }
    }
  }

  return t0 <= t1;
};

/** True when the move from `a` to `b` crosses any hedge in the level. */
export const moveIsBlocked = (a: Vector2, b: Vector2, hedges: Rect[]): boolean =>
  hedges.some((hedge) => segmentIntersectsRect(a, b, hedge));

/** Tip positions visited by a list of head-to-tail moves, starting at `start`. */
export const pathPositions = (start: Vector2, moves: Vector2[]): Vector2[] => {
  const positions = [start];
  for (const move of moves) {
    positions.push(add(positions[positions.length - 1], move));
  }
  return positions;
};

/** Net displacement of a list of moves (their vector sum). */
export const totalDisplacement = (moves: Vector2[]): Vector2 =>
  moves.reduce((sum, move) => add(sum, move), ZERO_VECTOR);

export const isReached = (
  position: Vector2,
  target: Vector2,
  tolerance = REACH_TOLERANCE,
): boolean => magnitude(subtract(target, position)) <= tolerance;

export const voyageLevels: VoyageLevel[] = [
  {
    id: 'open-meadow',
    name: 'Open Meadow',
    hint: 'Nothing in the way. One big hop from burrow to carrot will do, or take a scenic route.',
    start: { x: -4, y: -2 },
    target: { x: 4, y: 3 },
    hedges: [],
    par: 1,
    solutionMoves: [{ x: 8, y: 5 }],
  },
  {
    id: 'around-the-hedge',
    name: 'Around the Hedge',
    hint: 'A straight hop is blocked. Bound over the hedge with two hops that add up to the same displacement.',
    start: { x: -4, y: 0 },
    target: { x: 4, y: 0 },
    hedges: [{ minX: -1, maxX: 1, minY: -3, maxY: 2 }],
    par: 2,
    solutionMoves: [
      { x: 4, y: 3 },
      { x: 4, y: -3 },
    ],
  },
  {
    id: 'switchback',
    name: 'Switchback',
    hint: 'Two staggered hedges. Hop below the first, then past the second — three hops that still sum to the trip.',
    start: { x: -4, y: 0 },
    target: { x: 4, y: 0 },
    hedges: [
      { minX: -2, maxX: -1, minY: -1, maxY: 4 },
      { minX: 1, maxX: 2, minY: -4, maxY: 1 },
    ],
    par: 3,
    solutionMoves: [
      { x: 4, y: -2.5 },
      { x: 0.5, y: 4.5 },
      { x: 3.5, y: -2 },
    ],
  },
];
