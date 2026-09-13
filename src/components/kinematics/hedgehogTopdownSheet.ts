/**
 * Layout of the top-down hedgehog sprite sheet (public/sprites/hedgehog-topdown.png),
 * drawn for the 2D field, where the hedgehog is seen from above rather than
 * from the side.
 *
 * The sheet was cut from a pixel-art reference of three gaits - three idle
 * poses, six walking poses, and eight running poses - and cleaned up for
 * animation:
 *
 * - Every pose was reduced to its true pixel grid and recoloured to the side-view
 *   sheet's palette, so the two hedgehogs are visibly the same animal.
 * - The walk keeps four of its six poses, neutral / right paw / neutral / left
 *   paw; the other two repeated those and unbalanced the stride.
 * - The running poses were drawn smaller than the walk and stretched and
 *   squashed in no particular order. Four were kept and reordered into
 *   stretch / mid / squash / mid, scaled up to the walk's size, and the squash
 *   was halved so the bob reads as running rather than as flicker.
 * - Shrinking the source smeared the eyes into the dark fur around them, so each
 *   frame's eyes were redrawn as a clean pair of 2x2 blocks, mirrored about the
 *   nose (a single row in the blink frame, idle2). * - Every frame pins the nose tip to one row and the body's centre to the middle
 *   of the cell, so the head holds still while the paws and spines move, and the
 *   sprite spins cleanly about its middle.
 *
 * The nose points down the sheet. One gait per row, frames left to right, each
 * cell square and surrounded by a transparent gutter so a rotated or fractionally
 * scaled draw never samples a neighbour.
 */

export const HEDGEHOG_TOPDOWN_SHEET_SRC = '/sprites/hedgehog-topdown.png';

export const HEDGEHOG_TOPDOWN_CELL = 38;
export const HEDGEHOG_TOPDOWN_SHEET_COLS = 4;
export const HEDGEHOG_TOPDOWN_SHEET_ROWS = 3;

/** Transparent margin around every cell, in sprite pixels. */
export const HEDGEHOG_TOPDOWN_GUTTER = 2;

const STRIDE = HEDGEHOG_TOPDOWN_CELL + HEDGEHOG_TOPDOWN_GUTTER;

export const HEDGEHOG_TOPDOWN_SHEET_W = HEDGEHOG_TOPDOWN_GUTTER + HEDGEHOG_TOPDOWN_SHEET_COLS * STRIDE;
export const HEDGEHOG_TOPDOWN_SHEET_H = HEDGEHOG_TOPDOWN_GUTTER + HEDGEHOG_TOPDOWN_SHEET_ROWS * STRIDE;

export type HedgehogTopdownFrameName =
  | 'idle1'
  | 'idle2'
  | 'idle3'
  | 'walk1'
  | 'walk2'
  | 'walk3'
  | 'walk4'
  | 'run1'
  | 'run2'
  | 'run3'
  | 'run4';

export interface HedgehogTopdownCell {
  col: number;
  row: number;
}

export const HEDGEHOG_TOPDOWN_CELLS: Record<HedgehogTopdownFrameName, HedgehogTopdownCell> = {
  idle1: { col: 0, row: 0 },
  idle2: { col: 1, row: 0 },
  idle3: { col: 2, row: 0 },
  walk1: { col: 0, row: 1 },
  walk2: { col: 1, row: 1 },
  walk3: { col: 2, row: 1 },
  walk4: { col: 3, row: 1 },
  run1: { col: 0, row: 2 },
  run2: { col: 1, row: 2 },
  run3: { col: 2, row: 2 },
  run4: { col: 3, row: 2 },
};

/** Top-left corner of a cell's artwork within the sheet, in sprite pixels. */
export const topdownCellOrigin = ({ col, row }: HedgehogTopdownCell) => ({
  x: HEDGEHOG_TOPDOWN_GUTTER + col * STRIDE,
  y: HEDGEHOG_TOPDOWN_GUTTER + row * STRIDE,
});
