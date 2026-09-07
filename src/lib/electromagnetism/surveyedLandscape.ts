import { traceContours, type Contour } from './contours.ts';

/** Builds a landscape for the contour lesson out of a packed grid of surveyed
 * elevations. Hakone and Mount Rainier differ only in their window, their
 * contour interval and what covers the ground, so both come from here. The
 * modelled volcano in [terrain.ts] hand-rolls the same shape. */

/** World units the mesh is drawn in. Every landscape is fitted to this box, so
 * the camera in TopographicLandscape works unchanged whichever one is showing. */
export const TERRAIN_WIDTH = 2000;
export const TERRAIN_DEPTH = 1600;

/** How far heights are stretched against ground distance. Kilometres of ground
 * squeezed into 2000 world units would leave any of these landscapes nearly
 * flat, and doubling is the usual convention for a terrain model. Every
 * landscape uses the same figure, so the one that looks steeper is steeper —
 * which is the whole comparison the figure is for. Stated in the caption,
 * because it makes every slope look twice what it is. */
export const STANDARD_EXAGGERATION = 2;

/** The generated modules that scripts/build-*-terrain.mjs write. */
export interface ElevationSource {
  COLUMNS: number;
  ROWS: number;
  HALF_EAST_METRES: number;
  HALF_NORTH_METRES: number;
  LOWEST_METRES: number;
  HIGHEST_METRES: number;
  decodeElevations(): Int16Array;
}

export interface CoverModel {
  /** Elevation band, in metres, over which forest thins away to nothing. */
  forestTop: readonly [number, number];
  /** Slope band, rise over run, across which ground gets too steep for soil. */
  bareSlope: readonly [number, number];
  /** Elevation band over which permanent snow and ice take over, if any. */
  snowline?: readonly [number, number];
  /** A lake's surface height. The largest connected flat sheet at it is water. */
  lakeSurface?: number;
}

export interface LandscapeSpec {
  /** Shown on the control that switches between landscapes. */
  name: string;
  levels: readonly number[];
  /** Ground is far wider than it is tall, so heights are stretched to keep the
   * relief readable. The same factor is used for every landscape, which is what
   * makes their slopes comparable: whatever looks steeper here is steeper. */
  exaggeration: number;
  /** Contours at or below this draw in the light colour, for contrast against
   * whatever covers the low ground. */
  lightContourMax: number;
  description: string;
  credit: string;
  cover: CoverModel;
}

export interface Landscape {
  name: string;
  ELEVATION_LEVELS: readonly number[];
  EXAGGERATION: number;
  VERTICAL_SCALE: number;
  FOCUS_HEIGHT: number;
  LIGHT_CONTOUR_MAX: number;
  LANDSCAPE_DESCRIPTION: string;
  ELEVATION_CREDIT: string;
  LOWEST_METRES: number;
  HIGHEST_METRES: number;
  terrainHeight(x: number, z: number): number;
  slope(x: number, z: number): number;
  terrainCover(x: number, z: number, height?: number): { forest: number; snow: number; water: number };
  buildTerrain(): { columns: number; rows: number; heights: Int16Array | Float64Array; contours: Contour[] };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function surveyedLandscape(source: ElevationSource, spec: LandscapeSpec): Landscape {
  const { COLUMNS, ROWS } = source;
  const metres = source.decodeElevations();
  const cellEast = source.HALF_EAST_METRES * 2 / (COLUMNS - 1);
  const cellNorth = source.HALF_NORTH_METRES * 2 / (ROWS - 1);
  const verticalScale = spec.exaggeration * TERRAIN_WIDTH / (source.HALF_EAST_METRES * 2);
  // The camera looks at the middle of the ground it is drawing, so a landscape
  // sits centred in frame whatever height its lowest valley happens to be at.
  // Derived rather than given, or it would drift out of step with the scale.
  const focusHeight = (source.LOWEST_METRES + source.HIGHEST_METRES) / 2 * verticalScale;

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
  const terrainHeight = (x: number, z: number) => {
    const { column, row } = locate(x, z);
    const c = Math.min(COLUMNS - 2, Math.floor(column)), r = Math.min(ROWS - 2, Math.floor(row));
    const fc = column - c, fr = row - r;
    const corner = cell(c, r);
    return fc >= fr
      ? corner + (cell(c + 1, r) - corner) * (fc - fr) + (cell(c + 1, r + 1) - corner) * fr
      : corner + (cell(c + 1, r + 1) - corner) * fc + (cell(c, r + 1) - corner) * (fr - fc);
  };

  /** Ground steepness in metres of rise per metre travelled, in real units — so
   * it is the true slope, not the exaggerated one the mesh draws. */
  const slope = (x: number, z: number) => {
    const { column, row } = locate(x, z);
    const c = Math.round(column), r = Math.round(row);
    return Math.hypot((cell(c + 1, r) - cell(c - 1, r)) / (2 * cellEast),
      (cell(c, r + 1) - cell(c, r - 1)) / (2 * cellNorth));
  };

  const lake = spec.cover.lakeSurface === undefined ? null : findLake(spec.cover.lakeSurface);

  /** The lake, as a 0-or-1 mask over the grid.
   *
   * Flat ground at a lake's own height turns up in a dozen other places around
   * it — terraces, a golf course, river flats — so a height test alone paints
   * blue patches across the hillsides. A lake is not merely ground at that
   * height, it is the single connected sheet of it, which is what this picks
   * out: every run of touching cells is measured and the largest wins. */
  function findLake(surface: number) {
    const flat = new Uint8Array(COLUMNS * ROWS);
    for (let i = 0; i < flat.length; i++) flat[i] = Math.abs(metres[i] - surface) <= 2 ? 1 : 0;
    const component = new Int32Array(COLUMNS * ROWS).fill(-1);
    const queue = new Int32Array(COLUMNS * ROWS);
    let bestSize = 0, bestSeed = -1;
    for (let seed = 0; seed < flat.length; seed++) {
      if (!flat[seed] || component[seed] >= 0) continue;
      let head = 0, tail = 0, size = 0;
      queue[tail++] = seed;
      component[seed] = seed;
      while (head < tail) {
        const i = queue[head++];
        size++;
        const column = i % COLUMNS, row = (i - column) / COLUMNS;
        const neighbours = [column > 0 ? i - 1 : -1, column < COLUMNS - 1 ? i + 1 : -1,
          row > 0 ? i - COLUMNS : -1, row < ROWS - 1 ? i + COLUMNS : -1];
        for (const j of neighbours) {
          if (j >= 0 && flat[j] && component[j] < 0) { component[j] = seed; queue[tail++] = j; }
        }
      }
      if (size > bestSize) { bestSize = size; bestSeed = seed; }
    }
    const mask = new Float32Array(COLUMNS * ROWS);
    if (bestSeed >= 0) for (let i = 0; i < mask.length; i++) if (component[i] === bestSeed) mask[i] = 1;
    return mask;
  }

  const lakeAt = (column: number, row: number) =>
    lake ? lake[clampRow(row) * COLUMNS + clampColumn(column)] : 0;

  /** What covers the ground, for the mesh colours: the shares of forest, of
   * permanent snow and of standing water, with bare rock taking the remainder. */
  const terrainCover = (x: number, z: number, height = terrainHeight(x, z)) => {
    // Sampled between cells, so a shoreline softens over a cell instead of
    // following the grid in steps.
    const { column, row } = locate(x, z);
    const c = Math.floor(column), r = Math.floor(row), fc = column - c, fr = row - r;
    const water = lake
      ? lakeAt(c, r) * (1 - fc) * (1 - fr) + lakeAt(c + 1, r) * fc * (1 - fr)
        + lakeAt(c, r + 1) * (1 - fc) * fr + lakeAt(c + 1, r + 1) * fc * fr
      : 0;
    // Rock shows through wherever the ground is too steep to hold anything.
    const bare = smoothstep(spec.cover.bareSlope[0], spec.cover.bareSlope[1], slope(x, z));
    const snowline = spec.cover.snowline;
    const snow = snowline
      ? smoothstep(snowline[0], snowline[1], height) * (1 - bare) * (1 - water) : 0;
    const forest = (1 - smoothstep(spec.cover.forestTop[0], spec.cover.forestTop[1], height))
      * (1 - bare) * (1 - water) * (1 - snow);
    return { forest, snow, water };
  };

  return {
    name: spec.name,
    ELEVATION_LEVELS: spec.levels,
    EXAGGERATION: spec.exaggeration,
    VERTICAL_SCALE: verticalScale,
    FOCUS_HEIGHT: focusHeight,
    LIGHT_CONTOUR_MAX: spec.lightContourMax,
    LANDSCAPE_DESCRIPTION: spec.description,
    ELEVATION_CREDIT: spec.credit,
    LOWEST_METRES: source.LOWEST_METRES,
    HIGHEST_METRES: source.HIGHEST_METRES,
    terrainHeight,
    slope,
    terrainCover,
    buildTerrain: () => ({
      columns: COLUMNS, rows: ROWS, heights: metres,
      contours: traceContours(metres, COLUMNS, ROWS, TERRAIN_WIDTH, TERRAIN_DEPTH, spec.levels),
    }),
  };
}
