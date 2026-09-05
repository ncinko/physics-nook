import { traceContours } from './contours.ts';

export const TERRAIN_WIDTH = 2000;
export const TERRAIN_DEPTH = 1600;
export const ELEVATION_LEVELS = [100, 200, 300, 400, 500, 600];

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function mountainCoordinates(x: number, z: number) {
  const dx = x + 75, dz = (z + 65) * 1.12;
  const r = Math.hypot(dx, dz), theta = Math.atan2(dz, dx);
  const ribs = Math.cos(9 * theta + 0.004 * r + 0.65 * Math.sin(3 * theta));
  return { r, theta, ribs };
}

/** A small, illustrative Rainier-inspired volcano, not surveyed elevation data.
 * Broad summit, asymmetric shoulders and radial glacier valleys. All three
 * axes retain the lesson's metre scale and 100 m contour interval.
 * Visual reference: https://www.nps.gov/mora/learn/nature/mount-rainier-glaciers.htm */
export function terrainHeight(x: number, z: number): number {
  const { r, theta, ribs } = mountainCoordinates(x, z);
  const radius = r * (1 + 0.065 * Math.cos(3 * theta) + 0.035 * Math.sin(5 * theta));
  const cone = 638 * Math.exp(-((Math.max(0, radius - 80) / 365) ** 1.55));
  const ridgeEnvelope = smoothstep(100, 240, r) * Math.exp(-(((r - 340) / 330) ** 2));
  const ridges = 46 * ribs * ridgeEnvelope;
  const shoulder = 45 * Math.exp(-(((x + 360) / 170) ** 2) - ((z + 25) / 210) ** 2);
  const crater = -14 * Math.exp(-(((x + 60) / 35) ** 2) - ((z + 70) / 30) ** 2);
  const detail = 7 * Math.sin(x / 22 + Math.sin(z / 51)) * Math.sin(z / 29) * ridgeEnvelope;
  return Math.max(0, cone + ridges + shoulder + crater + detail);
}

/** Glacier tongues descend through valleys; exposed ribs break up the snowline. */
export function terrainCover(x: number, z: number, height = terrainHeight(x, z)) {
  const { ribs } = mountainCoordinates(x, z);
  const forest = 1 - smoothstep(100, 230, height);
  const snowline = 295 + 115 * ribs + 12 * Math.sin(x / 21) * Math.cos(z / 26);
  const snow = smoothstep(snowline - 22, snowline + 35, height);
  return { forest, snow };
}

export function buildTerrain(columns = 321, rows = 257) {
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
