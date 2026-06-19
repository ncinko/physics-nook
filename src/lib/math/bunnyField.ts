import { add, type Vector2 } from './vectors.ts';

/**
 * Pure model for the keyboard "Bunny Hops" interactive on the second vectors
 * page. Every keypress hops the bunny by a unit vector — one space right
 * (i-hat), left, up (j-hat), or down — and clamps it to a rectangular field.
 * A munched carrot respawns at a fresh random cell. DOM-free and deterministic
 * (the random source is injectable) so it can be unit tested in `tests/math`.
 */

export interface FieldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The open meadow the bunny roams. Origin sits at the center of the field. */
export const FIELD_BOUNDS: FieldBounds = { minX: -5, maxX: 5, minY: -3, maxY: 3 };

/** Where the bunny starts a run: the origin, so position equals displacement. */
export const FIELD_START: Vector2 = { x: 0, y: 0 };

export type StepName = 'right' | 'left' | 'up' | 'down';

/** The four unit-vector hops, keyed by direction. */
export const UNIT_STEPS: Record<StepName, Vector2> = {
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
};

const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/** Keep a cell inside the field. */
export const clampToField = (position: Vector2, bounds: FieldBounds = FIELD_BOUNDS): Vector2 => ({
  x: clampInt(position.x, bounds.minX, bounds.maxX),
  y: clampInt(position.y, bounds.minY, bounds.maxY),
});

/** Hop one unit step, clamped so the bunny never leaves the field. */
export const stepBunny = (
  position: Vector2,
  step: Vector2,
  bounds: FieldBounds = FIELD_BOUNDS,
): Vector2 => clampToField(add(position, step), bounds);

/** True when the bunny is sitting on the carrot's cell. */
export const carrotReached = (position: Vector2, carrot: Vector2): boolean =>
  position.x === carrot.x && position.y === carrot.y;

/** Number of cells in a field, used to draw a carrot at a random one. */
export const cellCount = (bounds: FieldBounds = FIELD_BOUNDS): number =>
  (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1);

/**
 * Pick a random integer cell within the field, never the `avoid` cell (so a new
 * carrot never spawns on top of the bunny). Cells are numbered left-to-right,
 * bottom-to-top; we draw from the cells excluding `avoid` and skip its index so
 * the carrot always moves. `random` is injectable for deterministic tests.
 */
export const randomCarrot = (
  avoid: Vector2,
  bounds: FieldBounds = FIELD_BOUNDS,
  random: () => number = Math.random,
): Vector2 => {
  const width = bounds.maxX - bounds.minX + 1;
  const total = cellCount(bounds);
  const avoidIndex = (avoid.y - bounds.minY) * width + (avoid.x - bounds.minX);

  let index = Math.floor(random() * (total - 1));
  if (index >= avoidIndex) {
    index += 1;
  }

  return {
    x: bounds.minX + (index % width),
    y: bounds.minY + Math.floor(index / width),
  };
};
