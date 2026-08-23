/**
 * Layout of the kinematics hedgehog sprite sheet (public/sprites/hedgehog.png).
 *
 * The sheet was cut from a hand-supplied pixel-art reference of three gaits -
 * four walking poses, four running poses, and three braking poses. Each source
 * pose was scaled by one shared factor and bottom-aligned, so the character
 * keeps a constant size and its feet stay on the same line from frame to frame;
 * the remaining height differences are the leg extension and body bob, which is
 * the animation itself.
 *
 * One gait per sheet row, frames left to right. The braking row's fourth cell
 * carries the curled-up ball, which has no counterpart in the source art and is
 * generated from the sheet's own colours.
 *
 * Every cell is surrounded by a transparent gutter. Each sprite is bottom-
 * aligned, so its feet sit on the cell's last row; packed edge to edge, those
 * feet would be the immediate neighbour of the next cell's first row, and any
 * renderer that samples half a texel past the edge - a fractional device-pixel
 * ratio is enough - drags them into the sprite above. The gutter gives that
 * sampling something transparent to land on.
 */

export const HEDGEHOG_SHEET_SRC = '/sprites/hedgehog.png';

export const HEDGEHOG_CELL_W = 56;
export const HEDGEHOG_CELL_H = 46;
export const HEDGEHOG_SHEET_COLS = 4;
export const HEDGEHOG_SHEET_ROWS = 3;

/** Transparent margin around every cell, in sprite pixels. */
export const HEDGEHOG_GUTTER = 2;

const STRIDE_X = HEDGEHOG_CELL_W + HEDGEHOG_GUTTER;
const STRIDE_Y = HEDGEHOG_CELL_H + HEDGEHOG_GUTTER;

export const HEDGEHOG_SHEET_W = HEDGEHOG_GUTTER + HEDGEHOG_SHEET_COLS * STRIDE_X;
export const HEDGEHOG_SHEET_H = HEDGEHOG_GUTTER + HEDGEHOG_SHEET_ROWS * STRIDE_Y;

export type HedgehogFrameName =
  | 'walk1'
  | 'walk2'
  | 'walk3'
  | 'walk4'
  | 'run1'
  | 'run2'
  | 'run3'
  | 'run4'
  | 'brake1'
  | 'brake2'
  | 'brake3'
  | 'roll';

export interface HedgehogCell {
  col: number;
  row: number;
}

export const HEDGEHOG_CELLS: Record<HedgehogFrameName, HedgehogCell> = {
  walk1: { col: 0, row: 0 },
  walk2: { col: 1, row: 0 },
  walk3: { col: 2, row: 0 },
  walk4: { col: 3, row: 0 },
  run1: { col: 0, row: 1 },
  run2: { col: 1, row: 1 },
  run3: { col: 2, row: 1 },
  run4: { col: 3, row: 1 },
  brake1: { col: 0, row: 2 },
  brake2: { col: 1, row: 2 },
  brake3: { col: 2, row: 2 },
  roll: { col: 3, row: 2 },
};

/**
 * Radius of the curled ball in sprite pixels, measured to the spike tips. The
 * ball is drawn touching the bottom of its cell, so this is both the distance
 * from the feet anchor up to its centre and the radius it rolls on.
 */
export const HEDGEHOG_ROLL_RADIUS = 19;

/** The pose to hold when the hedgehog is stopped: all four feet planted. */
export const HEDGEHOG_STAND_FRAME: HedgehogFrameName = 'walk1';

/** Top-left corner of a cell's artwork within the sheet, in sprite pixels. */
export const cellOrigin = ({ col, row }: HedgehogCell) => ({
  x: HEDGEHOG_GUTTER + col * STRIDE_X,
  y: HEDGEHOG_GUTTER + row * STRIDE_Y,
});
