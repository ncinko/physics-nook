import { traceContours } from './contours.ts';
import { decodeElevations, COLUMNS, ROWS, HALF_EAST_METRES, HALF_NORTH_METRES,
  HIGHEST_METRES } from './hakoneElevation.ts';

/** A real landscape for the contour lesson: surveyed ground around Hakone,
 * Japan, in place of the modelled volcano in [terrain.ts]. Both modules expose
 * the same names, so `TopographicLandscape` swaps between them by changing one
 * import. See scripts/build-hakone-terrain.mjs for provenance. */

// World units the mesh is drawn in. The camera in TopographicLandscape is built
// around this box, so it matches the modelled landscape's extent exactly.
export const TERRAIN_WIDTH = 2000;
export const TERRAIN_DEPTH = 1600;

/** Contours every 200 m. A 100 m interval over 1.35 km of relief draws a net
 * too fine to read the spacing through at this figure's size. */
export const ELEVATION_LEVELS = [200, 400, 600, 800, 1000, 1200, 1400];

/** World units per metre of elevation. Eleven and a half kilometres of ground
 * compressed into 2000 units would leave the relief nearly flat, so heights
 * carry an exaggeration — the usual convention for a terrain model, and worth
 * saying out loud because it makes every slope look that much steeper than it
 * is. Chosen so the summit stands about as proud as it did over the narrower
 * window this landscape started from. */
export const EXAGGERATION = 2.5;
export const VERTICAL_SCALE = EXAGGERATION * TERRAIN_WIDTH / (HALF_EAST_METRES * 2);

/** Lake Ashi's surface, as the survey records it. */
export const LAKE_ASHI_METRES = 724.5;

/** Contours at or below this draw in the light colour: that is the ground the
 * forest covers, and a dark line on dark forest cannot be followed. */
export const LIGHT_CONTOUR_MAX = 600;

export const LANDSCAPE_DESCRIPTION =
  'the Hakone caldera in Japan, with the Kamiyama and Komagatake cone complex at its centre, '
  + 'Lake Ashi filling the caldera floor to the south-west, and the Hayakawa gorge cutting east';

export const ELEVATION_CREDIT = 'Elevation data: Geospatial Information Authority of Japan (processed)';

const metres = decodeElevations();
const CELL_EAST = HALF_EAST_METRES * 2 / (COLUMNS - 1);
const CELL_NORTH = HALF_NORTH_METRES * 2 / (ROWS - 1);

const clampColumn = (c: number) => Math.max(0, Math.min(COLUMNS - 1, c));
const clampRow = (r: number) => Math.max(0, Math.min(ROWS - 1, r));
const cell = (column: number, row: number) => metres[clampRow(row) * COLUMNS + clampColumn(column)];

/** Grid coordinates for a point in world units, x east and z south. */
const locate = (x: number, z: number) => ({
  column: (x + TERRAIN_WIDTH / 2) / TERRAIN_WIDTH * (COLUMNS - 1),
  row: (z + TERRAIN_DEPTH / 2) / TERRAIN_DEPTH * (ROWS - 1),
});

/** Surveyed elevation in metres. Cells are split along the same diagonal the
 * mesh and the contour tracer use, so this returns the height of the surface
 * actually drawn — bilinear interpolation would sit a metre or two off it. */
export function terrainHeight(x: number, z: number): number {
  const { column, row } = locate(x, z);
  const c = Math.min(COLUMNS - 2, Math.floor(column)), r = Math.min(ROWS - 2, Math.floor(row));
  const fc = column - c, fr = row - r;
  const corner = cell(c, r);
  return fc >= fr
    ? corner + (cell(c + 1, r) - corner) * (fc - fr) + (cell(c + 1, r + 1) - corner) * fr
    : corner + (cell(c + 1, r + 1) - corner) * fc + (cell(c, r + 1) - corner) * (fr - fc);
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Ground steepness in metres of rise per metre travelled, in real units — so
 * it is the true slope, not the exaggerated one the mesh draws. */
export function slope(x: number, z: number): number {
  const { column, row } = locate(x, z);
  const c = Math.round(column), r = Math.round(row);
  return Math.hypot((cell(c + 1, r) - cell(c - 1, r)) / (2 * CELL_EAST),
    (cell(c, r + 1) - cell(c, r - 1)) / (2 * CELL_NORTH));
}

/** The lake, as a 0-or-1 mask over the grid.
 *
 * Flat ground at the lake's own height turns up in a dozen other places around
 * the caldera — terraces, a golf course, the Sengokuhara flats — so a height
 * test alone paints blue patches across the hillsides. A lake is not merely
 * ground at that height, it is the single connected sheet of it, which is what
 * this picks out: every run of touching cells is measured and the largest wins. */
function findLake() {
  const level = new Uint8Array(COLUMNS * ROWS);
  for (let i = 0; i < level.length; i++) {
    level[i] = Math.abs(metres[i] - LAKE_ASHI_METRES) <= 2 ? 1 : 0;
  }
  const mask = new Float32Array(COLUMNS * ROWS);
  const queue = new Int32Array(COLUMNS * ROWS);
  let bestSize = 0, bestSeed = -1;
  const component = new Int32Array(COLUMNS * ROWS).fill(-1);
  for (let seed = 0; seed < level.length; seed++) {
    if (!level[seed] || component[seed] >= 0) continue;
    let head = 0, tail = 0, size = 0;
    queue[tail++] = seed; component[seed] = seed;
    while (head < tail) {
      const i = queue[head++];
      size++;
      const column = i % COLUMNS, row = (i - column) / COLUMNS;
      if (column > 0) push(i - 1);
      if (column < COLUMNS - 1) push(i + 1);
      if (row > 0) push(i - COLUMNS);
      if (row < ROWS - 1) push(i + COLUMNS);
      function push(j: number) {
        if (level[j] && component[j] < 0) { component[j] = seed; queue[tail++] = j; }
      }
    }
    if (size > bestSize) { bestSize = size; bestSeed = seed; }
  }
  if (bestSeed >= 0) {
    for (let i = 0; i < mask.length; i++) if (component[i] === bestSeed) mask[i] = 1;
  }
  return mask;
}
const lake = findLake();

/** Cover for the mesh colours. Hakone holds no permanent snow, so that share
 * stays zero; Lake Ashi takes its place as the one surface that is not ground. */
export function terrainCover(x: number, z: number, height = terrainHeight(x, z)) {
  const steepness = slope(x, z);
  // Sampled between cells, so the shoreline softens over a cell instead of
  // following the grid in steps.
  const { column, row } = locate(x, z);
  const c = Math.floor(column), r = Math.floor(row), fc = column - c, fr = row - r;
  const water = lakeAt(c, r) * (1 - fc) * (1 - fr) + lakeAt(c + 1, r) * fc * (1 - fr)
    + lakeAt(c, r + 1) * (1 - fc) * fr + lakeAt(c + 1, r + 1) * fc * fr;
  // Cedar and broadleaf forest covers the caldera, thinning with altitude and
  // stripping off faces too steep to hold soil.
  const forest = (1 - smoothstep(400, 1320, height))
    * (1 - smoothstep(0.62, 1.05, steepness)) * (1 - water);
  return { forest, snow: 0, water };
}
const lakeAt = (column: number, row: number) =>
  lake[clampRow(row) * COLUMNS + clampColumn(column)];

export function buildTerrain() {
  return {
    columns: COLUMNS, rows: ROWS, heights: metres,
    contours: traceContours(metres, COLUMNS, ROWS, TERRAIN_WIDTH, TERRAIN_DEPTH, ELEVATION_LEVELS),
  };
}

export { HIGHEST_METRES, HALF_EAST_METRES, HALF_NORTH_METRES };
