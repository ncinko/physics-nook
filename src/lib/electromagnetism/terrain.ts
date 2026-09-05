import { traceContours } from './contours.ts';

export const TERRAIN_WIDTH = 2000;
export const TERRAIN_DEPTH = 1600;
export const ELEVATION_LEVELS = [100, 200, 300, 400, 500, 600];

/** Elevation in metres: a broad mountain with a lower eastern shoulder. */
export function terrainHeight(x: number, z: number): number {
  return 650 * Math.exp(-(((x + 260) / 470) ** 2) - (z / 500) ** 2)
    + 320 * Math.exp(-(((x - 380) / 340) ** 2) - ((z - 170) / 370) ** 2);
}

export function buildTerrain(columns = 101, rows = 81) {
  const heights = new Float64Array(columns * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      heights[row * columns + col] = terrainHeight(
        col / (columns - 1) * TERRAIN_WIDTH - TERRAIN_WIDTH / 2,
        row / (rows - 1) * TERRAIN_DEPTH - TERRAIN_DEPTH / 2);
    }
  }
  return { columns, rows, heights, contours: traceContours(heights, columns, rows,
    TERRAIN_WIDTH, TERRAIN_DEPTH, ELEVATION_LEVELS) };
}
