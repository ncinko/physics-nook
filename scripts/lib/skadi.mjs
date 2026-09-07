// Reads elevation from the AWS Terrain Tiles "skadi" set: one-arcsecond,
// void-filled .hgt tiles covering one degree square each, which over the United
// States derive from the USGS National Elevation Dataset.
// https://registry.opendata.aws/terrain-tiles/
//
// A .hgt tile is raw big-endian Int16, north edge first, west column first, and
// its samples sit on the degree boundaries — so the first and last rows are
// shared with the neighbouring tiles.

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

const SIDE = 3601;  // one arcsecond
const CACHE = join(process.cwd(), '.cache', 'skadi');
export const METRES_PER_DEGREE_LAT = 111132;
export const metresPerDegreeLon = latitude => 111320 * Math.cos(latitude * Math.PI / 180);

/** Downloads (once) and opens a tile such as 'N46W122'. */
export async function openSkadiTile(name) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `${name}.hgt.gz`);
  if (!existsSync(file)) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/skadi/${name.slice(0, 3)}/${name}.hgt.gz`;
    console.log(`fetching ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${name}: ${response.status}`);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  const samples = gunzipSync(readFileSync(file));
  if (samples.length !== SIDE * SIDE * 2) throw new Error(`unexpected size for ${name}: ${samples.length}`);
  // The name gives the tile's south-west corner, so its north edge is one more.
  const southLatitude = Number(name.slice(1, 3)) * (name[0] === 'N' ? 1 : -1);
  const westLongitude = Number(name.slice(4)) * (name[3] === 'E' ? 1 : -1);
  const northLatitude = southLatitude + 1;

  const sample = (row, column) => {
    if (row < 0 || column < 0 || row >= SIDE || column >= SIDE) return NaN;
    const value = samples.readInt16BE((row * SIDE + column) * 2);
    return value === -32768 ? NaN : value;  // voids, which these tiles do not have
  };

  /** Bilinear elevation at a latitude and longitude inside the tile. */
  const elevationAt = (latitude, longitude) => {
    const row = (northLatitude - latitude) * (SIDE - 1);
    const column = (longitude - westLongitude) * (SIDE - 1);
    const r = Math.floor(row), c = Math.floor(column), fr = row - r, fc = column - c;
    const value = sample(r, c) * (1 - fc) * (1 - fr) + sample(r, c + 1) * fc * (1 - fr)
      + sample(r + 1, c) * (1 - fc) * fr + sample(r + 1, c + 1) * fc * fr;
    return Number.isFinite(value) ? value : 0;
  };

  return { SIDE, northLatitude, westLongitude, sample, elevationAt };
}

/**
 * An `elevation(east, north)` sampler in metres from a centre point, for
 * packLandscape. A local tangent plane is plenty over a window this size.
 */
export function localSampler(tile, centre) {
  const perLon = metresPerDegreeLon(centre.latitude);
  return (east, north) => tile.elevationAt(
    centre.latitude + north / METRES_PER_DEGREE_LAT,
    centre.longitude + east / perLon);
}

/** Metres between source samples along the east axis at this latitude. */
export const sourceMetres = latitude => metresPerDegreeLon(latitude) / (SIDE - 1);
