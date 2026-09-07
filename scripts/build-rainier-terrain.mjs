#!/usr/bin/env node
// Regenerates src/lib/electromagnetism/rainierElevation.ts. Run it only when
// the window or the grid resolution needs to change:
//
//   node scripts/build-rainier-terrain.mjs
//
// Source: the void-filled one-arcsecond elevation tile N46W122 from the public
// AWS Terrain Tiles bucket (https://registry.opendata.aws/terrain-tiles/),
// which over the United States is built from the USGS National Elevation
// Dataset. Public domain; credited anyway. The 14 MB tile is cached under
// .cache/skadi so a re-run costs nothing.

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { packLandscape } from './lib/pack-landscape.mjs';

// The lesson's reference view is centred at 46.85469, -121.69718
// (https://en-us.topographic-map.com/map-llhmzs/Mount-Rainier-National-Park/),
// which sits 4.8 km east of the summit. The window is pulled back west so the
// whole edifice is in frame: above 2100 m the cone measures 15.6 km east-west
// by 12.6 km north-south, and this window clears that on every side.
const CENTRE_LAT = 46.8535, CENTRE_LON = -121.7450;
const HALF_EAST = 9000, HALF_NORTH = 7200;  // metres from the centre
const COLUMNS = 241, ROWS = 193;            // 75 m per grid cell

const TILE = 'N46W122', SIDE = 3601, TILE_LAT = 47, TILE_LON = -122;
const CACHE = join(process.cwd(), '.cache', 'skadi');
const METRES_PER_DEGREE_LAT = 111132;
const METRES_PER_DEGREE_LON = 111320 * Math.cos(CENTRE_LAT * Math.PI / 180);

mkdirSync(CACHE, { recursive: true });
const file = join(CACHE, `${TILE}.hgt.gz`);
if (!existsSync(file)) {
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/skadi/${TILE.slice(0, 3)}/${TILE}.hgt.gz`;
  console.log(`fetching ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${TILE}: ${response.status}`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}
// A .hgt tile is raw big-endian Int16, north edge first, west column first.
const samples = gunzipSync(readFileSync(file));
if (samples.length !== SIDE * SIDE * 2) throw new Error(`unexpected tile size ${samples.length}`);

const sample = (row, column) => {
  if (row < 0 || column < 0 || row >= SIDE || column >= SIDE) return NaN;
  const value = samples.readInt16BE((row * SIDE + column) * 2);
  return value === -32768 ? NaN : value;  // voids; this tile has none
};

/** Bilinear elevation at a point given in metres east and north of the centre. */
function elevation(east, north) {
  const latitude = CENTRE_LAT + north / METRES_PER_DEGREE_LAT;
  const longitude = CENTRE_LON + east / METRES_PER_DEGREE_LON;
  const row = (TILE_LAT - latitude) * (SIDE - 1);
  const column = (longitude - TILE_LON) * (SIDE - 1);
  const r = Math.floor(row), c = Math.floor(column), fr = row - r, fc = column - c;
  const value = sample(r, c) * (1 - fc) * (1 - fr) + sample(r, c + 1) * fc * (1 - fr)
    + sample(r + 1, c) * (1 - fc) * fr + sample(r + 1, c + 1) * fc * fr;
  return Number.isFinite(value) ? value : 0;
}

await packLandscape({
  name: 'rainier',
  centre: { latitude: CENTRE_LAT, longitude: CENTRE_LON },
  halfEast: HALF_EAST, halfNorth: HALF_NORTH, columns: COLUMNS, rows: ROWS,
  sourceMetres: METRES_PER_DEGREE_LON / (SIDE - 1),
  elevation,
  header: `Elevations around Mount Rainier, Washington, centred on ${CENTRE_LAT}, ${CENTRE_LON}:
an ${HALF_EAST * 2 / 1000} km by ${HALF_NORTH * 2 / 1000} km window holding the whole volcano, its glaciers and
the valleys of the Nisqually, Carbon and White rivers around it. The summit,
Columbia Crest, stands at 4392 m.

Processed from the void-filled one-arcsecond tile ${TILE} in the AWS Terrain
Tiles open dataset (https://registry.opendata.aws/terrain-tiles/), which over
the United States derives from the USGS National Elevation Dataset.`,
});
