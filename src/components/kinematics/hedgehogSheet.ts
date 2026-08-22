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
 * One gait per sheet row, frames left to right. The walking row is only three
 * quarters full at four frames of a four-column grid; the braking row uses
 * three of its four cells.
 */

export const HEDGEHOG_SHEET_SRC = '/sprites/hedgehog.png';

export const HEDGEHOG_CELL_W = 56;
export const HEDGEHOG_CELL_H = 46;
export const HEDGEHOG_SHEET_COLS = 4;
export const HEDGEHOG_SHEET_ROWS = 3;

export const HEDGEHOG_SHEET_W = HEDGEHOG_CELL_W * HEDGEHOG_SHEET_COLS;
export const HEDGEHOG_SHEET_H = HEDGEHOG_CELL_H * HEDGEHOG_SHEET_ROWS;

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
  | 'brake3';

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
};

/** The pose to hold when the hedgehog is stopped: all four feet planted. */
export const HEDGEHOG_STAND_FRAME: HedgehogFrameName = 'walk1';
