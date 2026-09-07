import * as elevation from './hakoneElevation.ts';
import { surveyedLandscape, STANDARD_EXAGGERATION } from './surveyedLandscape.ts';

/** Lake Ashi's surface, as the survey records it. */
export const LAKE_ASHI_METRES = 724.5;

export const hakone = surveyedLandscape(elevation, {
  name: 'Hakone',
  // Contours every 200 m. A 100 m interval over 1.35 km of relief draws a net
  // too fine to read the spacing through at this figure's size.
  levels: [200, 400, 600, 800, 1000, 1200, 1400],
  exaggeration: STANDARD_EXAGGERATION,
  // Forest covers everything up to the high cones, and a dark line on dark
  // forest cannot be followed.
  lightContourMax: 600,
  description: 'the Hakone caldera in Japan, with the Kamiyama and Komagatake cone complex at its '
    + 'centre, Lake Ashi filling the caldera floor to the south-west, and the Hayakawa gorge cutting east',
  credit: 'Elevation data: Geospatial Information Authority of Japan (processed)',
  cover: {
    // Cedar and broadleaf forest covers the caldera, thinning with altitude.
    forestTop: [400, 1320],
    bareSlope: [0.62, 1.05],
    // Hakone holds no permanent snow; Lake Ashi is its one surface that is not ground.
    lakeSurface: LAKE_ASHI_METRES,
  },
});

export default hakone;
