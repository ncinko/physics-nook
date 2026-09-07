import * as elevation from './rainierElevation.ts';
import { surveyedLandscape } from './surveyedLandscape.ts';

export const rainier = surveyedLandscape(elevation, {
  name: 'Mount Rainier',
  // Contours every 400 m. The mountain carries 3.4 km of relief, so a finer
  // interval would band its flanks solid.
  levels: [1200, 1600, 2000, 2400, 2800, 3200, 3600, 4000],
  // Far less stretch than Hakone needs: an active stratovolcano rising 3.4 km
  // out of its valleys is steep enough to read almost as it stands.
  exaggeration: 1.5,
  focusHeight: 420,
  // The low ground here is forest, the same as at Hakone, but the contours that
  // cross it are the first two only.
  lightContourMax: 1600,
  description: 'Mount Rainier in Washington, an ice-capped stratovolcano standing 3.4 km above the '
    + 'forested valleys of the Nisqually, Carbon and White rivers that drain it',
  credit: 'Elevation data: USGS via the AWS Terrain Tiles open dataset',
  cover: {
    // Conifer forest gives way to subalpine parkland around Paradise, and the
    // last of it thins out near 2100 m.
    forestTop: [1600, 2100],
    bareSlope: [0.62, 1.05],
    // The permanent snowfield and the glaciers below it; the steepest faces
    // (Willis Wall, Gibraltar Rock) shed their snow and stay rock.
    snowline: [2050, 2600],
  },
});

export default rainier;
