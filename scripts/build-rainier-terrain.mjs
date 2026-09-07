#!/usr/bin/env node
// Regenerates src/lib/electromagnetism/rainierElevation.ts. Run it only when
// the window or the grid resolution needs to change:
//
//   node scripts/build-rainier-terrain.mjs
//
// Source: the void-filled one-arcsecond tile N46W122 from the AWS Terrain Tiles
// open dataset; see scripts/lib/skadi.mjs. The tile is cached under .cache/skadi.

import { packLandscape } from './lib/pack-landscape.mjs';
import { openSkadiTile, localSampler, sourceMetres } from './lib/skadi.mjs';

// The lesson's reference view is centred at 46.85469, -121.69718
// (https://en-us.topographic-map.com/map-llhmzs/Mount-Rainier-National-Park/),
// which sits 4.8 km east of the summit. The window is pulled back west so the
// whole edifice is in frame: above 2100 m the cone measures 15.6 km east-west
// by 12.6 km north-south, and this window clears that on every side.
const CENTRE_LAT = 46.8535, CENTRE_LON = -121.7450;
const HALF_EAST = 9000, HALF_NORTH = 7200;  // metres from the centre
const COLUMNS = 241, ROWS = 193;            // 75 m per grid cell

const centre = { latitude: CENTRE_LAT, longitude: CENTRE_LON };
const tile = await openSkadiTile('N46W122');

await packLandscape({
  name: 'rainier',
  centre,
  halfEast: HALF_EAST, halfNorth: HALF_NORTH, columns: COLUMNS, rows: ROWS,
  sourceMetres: sourceMetres(CENTRE_LAT),
  elevation: localSampler(tile, centre),
  header: `Elevations around Mount Rainier, Washington, centred on ${CENTRE_LAT}, ${CENTRE_LON}:
an ${HALF_EAST * 2 / 1000} km by ${HALF_NORTH * 2 / 1000} km window holding the whole volcano, its glaciers and
the valleys of the Nisqually, Carbon and White rivers around it. The summit,
Columbia Crest, stands at 4392 m.

Processed from the void-filled one-arcsecond tile N46W122 in the AWS Terrain
Tiles open dataset (https://registry.opendata.aws/terrain-tiles/), which over
the United States derives from the USGS National Elevation Dataset.`,
});
