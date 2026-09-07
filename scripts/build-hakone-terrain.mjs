#!/usr/bin/env node
// Regenerates src/lib/electromagnetism/hakoneElevation.ts from public elevation
// data. Run it only when the window or the grid resolution needs to change:
//
//   node scripts/build-hakone-terrain.mjs
//
// Source: the Geospatial Information Authority of Japan's DEM10B tiles
// (https://maps.gsi.go.jp/development/ichiran.html), served as plain text grids
// at https://cyberjapandata.gsi.go.jp/xyz/dem/{z}/{x}/{y}.txt. Their terms
// (https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html) allow reuse with
// attribution, and ask that processed data say so — hence the note the script
// writes into the generated module and the credit in the figure caption.
//
// Tiles are cached under .cache/gsi-dem so a re-run costs nothing.

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

// The map the landscape is cut from, centred where the lesson's reference view
// is centred: https://en-us.topographic-map.com/map-4q49nh/Hakone/
const CENTRE_LAT = 35.23725, CENTRE_LON = 139.0583;
const HALF_EAST = 4500, HALF_NORTH = 3600;  // metres from the centre
const COLUMNS = 201, ROWS = 161;            // 45 m per grid cell
const ZOOM = 14, TILE = 256;
const CACHE = join(process.cwd(), '.cache', 'gsi-dem');
const OUT = join(process.cwd(), 'src', 'lib', 'electromagnetism', 'hakoneElevation.ts');

const N = 2 ** ZOOM;
const tileX = lon => (lon + 180) / 360 * N;
const tileY = lat => {
  const r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * N;
};
// Web Mercator is conformal, so one scale covers both axes over a window this small.
const METRES_PER_TILE = 360 / N * 111320 * Math.cos(CENTRE_LAT * Math.PI / 180);
const METRES_PER_PIXEL = METRES_PER_TILE / TILE;
const originX = tileX(CENTRE_LON) * TILE, originY = tileY(CENTRE_LAT) * TILE;

const tiles = new Map();
async function tile(x, y) {
  const key = `${x}_${y}`;
  if (tiles.has(key)) return tiles.get(key);
  const file = join(CACHE, `${key}.txt`);
  if (!existsSync(file)) {
    const url = `https://cyberjapandata.gsi.go.jp/xyz/dem/${ZOOM}/${x}/${y}.txt`;
    const response = await fetch(url);
    // Tiles outside the surveyed area 404; treat them as absent, not fatal.
    writeFileSync(file, response.ok ? await response.text() : '');
    process.stdout.write(response.ok ? '.' : 'x');
  }
  const text = readFileSync(file, 'utf8').trim();
  let grid = null;
  if (text) {
    grid = new Float32Array(TILE * TILE);
    text.split('\n').forEach((line, r) => line.split(',').forEach((v, c) => {
      grid[r * TILE + c] = v === 'e' ? NaN : parseFloat(v);
    }));
  }
  tiles.set(key, grid);
  return grid;
}

async function pixel(gx, gy) {
  const grid = await tile(Math.floor(gx / TILE), Math.floor(gy / TILE));
  if (!grid) return NaN;
  return grid[(((gy % TILE) + TILE) % TILE | 0) * TILE + (((gx % TILE) + TILE) % TILE | 0)];
}

/** Bilinear elevation at a point given in metres east and north of the centre. */
async function elevation(east, north) {
  const gx = originX + east / METRES_PER_PIXEL, gy = originY - north / METRES_PER_PIXEL;
  const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
  const [a, b, c, d] = await Promise.all([pixel(x0, y0), pixel(x0 + 1, y0),
    pixel(x0, y0 + 1), pixel(x0 + 1, y0 + 1)]);
  const v = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  return Number.isFinite(v) ? v : 0;
}

mkdirSync(CACHE, { recursive: true });
const cellEast = HALF_EAST * 2 / (COLUMNS - 1), cellNorth = HALF_NORTH * 2 / (ROWS - 1);
// Average the 7.8 m source over each output cell rather than point-sampling it.
// A point sample of a 45 m cell aliases, and aliased ground makes ragged contours.
const acrossEast = Math.round(cellEast / METRES_PER_PIXEL);
const acrossNorth = Math.round(cellNorth / METRES_PER_PIXEL);
const metres = new Int16Array(COLUMNS * ROWS);
for (let row = 0; row < ROWS; row++) {
  for (let column = 0; column < COLUMNS; column++) {
    const east = column * cellEast - HALF_EAST, north = HALF_NORTH - row * cellNorth;
    let total = 0, count = 0;
    for (let j = 0; j < acrossNorth; j++) for (let i = 0; i < acrossEast; i++) {
      total += await elevation(east + (i / acrossEast - 0.5) * cellEast,
        north + (j / acrossNorth - 0.5) * cellNorth);
      count++;
    }
    metres[row * COLUMNS + column] = Math.round(total / count);
  }
}
process.stdout.write('\n');

// Along-row differences, which is what makes a smooth height field compress.
const deltas = new Int16Array(COLUMNS * ROWS);
for (let row = 0; row < ROWS; row++) for (let column = 0; column < COLUMNS; column++) {
  const i = row * COLUMNS + column;
  deltas[i] = column ? metres[i] - metres[i - 1] : (row ? metres[i] - metres[i - COLUMNS] : metres[i]);
}
const encoded = Buffer.from(deltas.buffer).toString('base64');
let lowest = Infinity, highest = -Infinity;
for (const v of metres) { lowest = Math.min(lowest, v); highest = Math.max(highest, v); }

writeFileSync(OUT, `// GENERATED by scripts/build-hakone-terrain.mjs — do not edit by hand.
//
// Elevations around Hakone, Japan, centred on ${CENTRE_LAT}, ${CENTRE_LON}:
// a ${HALF_EAST * 2 / 1000} km by ${HALF_NORTH * 2 / 1000} km window holding the caldera, the Kamiyama
// and Komagatake cone complex, the north end of Lake Ashi and the Hayakawa
// gorge. Ground runs from ${lowest} m to ${highest} m.
//
// Processed from the Geospatial Information Authority of Japan's DEM10B tiles
// (https://cyberjapandata.gsi.go.jp/xyz/dem/), resampled from a 7.8 m grid to
// ${Math.round(cellEast)} m cells by area averaging. Used with attribution under the GSI terms of
// use; see https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html.

export const CENTRE = { latitude: ${CENTRE_LAT}, longitude: ${CENTRE_LON} };
export const HALF_EAST_METRES = ${HALF_EAST};
export const HALF_NORTH_METRES = ${HALF_NORTH};
export const COLUMNS = ${COLUMNS};
export const ROWS = ${ROWS};
export const LOWEST_METRES = ${lowest};
export const HIGHEST_METRES = ${highest};

/** Row-wise differences of the Int16 height field, little-endian, base64. */
const PACKED = '${encoded}';

/** Undo the packing: base64 to Int16 differences to absolute metres. */
export function decodeElevations(): Int16Array {
  const binary = typeof atob === 'function'
    ? atob(PACKED) : Buffer.from(PACKED, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const metres = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
  for (let row = 0; row < ROWS; row++) for (let column = 0; column < COLUMNS; column++) {
    const i = row * COLUMNS + column;
    if (column) metres[i] += metres[i - 1];
    else if (row) metres[i] += metres[i - COLUMNS];
  }
  return metres;
}
`);
console.log(`wrote ${OUT}`);
console.log(`${COLUMNS}x${ROWS} cells at ${Math.round(cellEast)} m, ${lowest}-${highest} m`);
console.log(`packed ${(encoded.length / 1024).toFixed(1)} KB base64`,
  `(${(deflateSync(Buffer.from(deltas.buffer), { level: 9 }).length / 1024).toFixed(1)} KB gzipped over the wire)`);
