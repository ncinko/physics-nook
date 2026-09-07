import { traceContours } from './contours.ts';

export const TERRAIN_WIDTH = 2000;
export const TERRAIN_DEPTH = 1600;
export const ELEVATION_LEVELS = [100, 200, 300, 400, 500, 600];

/** This landscape is modelled directly in world units, so a metre of elevation
 * is a unit of mesh height. The surveyed alternative in [terrainHakone.ts]
 * needs a real scale here; both expose the same names so the component can
 * swap between them by changing one import. */
export const VERTICAL_SCALE = 1;
export const EXAGGERATION = 1;

/** Contours at or below this draw in the light colour, for contrast against
 * the forest that covers the lower slopes. */
export const LIGHT_CONTOUR_MAX = 200;

export const LANDSCAPE_DESCRIPTION =
  'a Mount Rainier-inspired snowy volcano, with glacier valleys and rocky ridges. A steep spire '
  + 'stands in front of it to the right and a long, low hill behind it to the right';

export const ELEVATION_CREDIT = '';

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
  return Math.max(0, cone + ridges + shoulder + crater + detail + companions(x, z));
}

/** Two neighbours that carry the same 100 m interval over very different
 * ground, so the spacing can be compared inside one view: a steep spire whose
 * contours land about 40 m of ground apart, and a long, low hill that spreads
 * its own more than three times wider. Both stay clear of the sampled area's
 * edge, or their contours would no longer close. */
function companions(x: number, z: number) {
  const spire = 505 * Math.exp(-((Math.hypot(x - 640, z - 300) / 148) ** 1.8));
  const hill = 280 * Math.exp(-(((x - 470) / 355) ** 2) - (((z + 420) / 250) ** 2));
  return spire + hill;
}

/** Glacier tongues descend through valleys; exposed ribs break up the snowline. */
export function terrainCover(x: number, z: number, height = terrainHeight(x, z)) {
  const { ribs } = mountainCoordinates(x, z);
  const forest = 1 - smoothstep(100, 230, height);
  const snowline = 295 + 115 * ribs + 12 * Math.sin(x / 21) * Math.cos(z / 26);
  const snow = smoothstep(snowline - 22, snowline + 35, height);
  // No standing water on this landscape; the surveyed one uses that share for
  // its lake, and the component blends the same four covers for both.
  return { forest, snow, water: 0 };
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
