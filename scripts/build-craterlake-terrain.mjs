#!/usr/bin/env node
// Regenerates src/lib/electromagnetism/craterLakeElevation.ts. Run it only when
// the window or the grid resolution needs to change:
//
//   node scripts/build-craterlake-terrain.mjs
//
// Source: the one-arcsecond tile N42W123 from the AWS Terrain Tiles open
// dataset; see scripts/lib/skadi.mjs. The tile is cached under .cache/skadi.

import { packLandscape } from './lib/pack-landscape.mjs';
import { openSkadiTile, localSampler, sourceMetres } from './lib/skadi.mjs';

// The lesson's reference view is centred at 42.93355, -122.0616
// (https://en-us.topographic-map.com/map-qt1htj/Crater-Lake-National-Park/),
// which falls on the water near the eastern shore; a window centred there would
// cut off the far rim. This one is centred on the lake instead, nudged east far
// enough to take in Mount Scott, the park's high point at 2718 m. The lake
// itself, flood-filled off its surveyed surface at 1882 m, runs from latitude
// 42.9044 to 42.9786 and longitude -122.1644 to -122.0500.
const CENTRE_LAT = 42.9400, CENTRE_LON = -122.0950;
const HALF_EAST = 7500, HALF_NORTH = 6000;  // metres from the centre
const COLUMNS = 241, ROWS = 193;            // 62 m per grid cell

const centre = { latitude: CENTRE_LAT, longitude: CENTRE_LON };
const tile = await openSkadiTile('N42W123');

await packLandscape({
  name: 'craterLake',
  centre,
  halfEast: HALF_EAST, halfNorth: HALF_NORTH, columns: COLUMNS, rows: ROWS,
  sourceMetres: sourceMetres(CENTRE_LAT),
  elevation: localSampler(tile, centre),
  header: `Elevations around Crater Lake, Oregon, centred on ${CENTRE_LAT}, ${CENTRE_LON}:
a ${HALF_EAST * 2 / 1000} km by ${HALF_NORTH * 2 / 1000} km window holding the whole caldera of Mount Mazama, the
lake that fills it, Wizard Island, and Mount Scott out to the east. The lake
surface stands at 1882 m and covers 53 km2.

Processed from the void-filled one-arcsecond tile N42W123 in the AWS Terrain
Tiles open dataset (https://registry.opendata.aws/terrain-tiles/), which over
the United States derives from the USGS National Elevation Dataset.`,
});
