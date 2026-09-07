import * as elevation from './craterLakeElevation.ts';
import { surveyedLandscape, STANDARD_EXAGGERATION } from './surveyedLandscape.ts';

/** Crater Lake's surface, as the survey records it. */
export const CRATER_LAKE_METRES = 1882;

export const craterLake = surveyedLandscape(elevation, {
  name: 'Crater Lake',
  // Contours every 100 m. Only a kilometre of relief here, so a coarser
  // interval would leave the caldera wall carrying barely a line.
  // The 1700 and 2700 lines are dropped: this window barely reaches either, and
  // each would draw a speck rather than a contour worth reading.
  levels: [1800, 1900, 2000, 2100, 2200, 2300, 2400, 2500, 2600],
  exaggeration: STANDARD_EXAGGERATION,
  // Forest reaches most of the way up the outer flanks.
  lightContourMax: 2000,
  description: 'Crater Lake in Oregon, the flooded caldera of Mount Mazama, with Wizard Island '
    + 'standing in the lake, the rim ringing it, and Mount Scott out to the east',
  credit: 'Elevation data: USGS via the AWS Terrain Tiles open dataset',
  cover: {
    // Hemlock and lodgepole pine over the outer slopes, giving out near the rim.
    forestTop: [2000, 2450],
    // The caldera wall is bare rock and pumice, too steep to hold anything.
    bareSlope: [0.62, 1.05],
    lakeSurface: CRATER_LAKE_METRES,
  },
});

export default craterLake;
