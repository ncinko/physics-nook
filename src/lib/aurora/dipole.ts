/**
 * Earth's magnetic field as a centred, axis-aligned dipole.
 *
 * The dipole is the simplest model that still gets the auroral geometry right:
 * field lines are labelled by the McIlwain parameter L (their equatorial
 * crossing distance in Earth radii), and the latitude at which a line reaches
 * the ground follows directly from L. That is why the auroral oval sits where
 * it does - it is a consequence of the geometry, not an input.
 *
 * Reference: Walt, "Introduction to Geomagnetically Trapped Radiation" (1994).
 */

/** Mean Earth radius, km. */
export const EARTH_RADIUS_KM = 6371.2;

/** Equatorial field strength at the surface, tesla (~31,200 nT). */
export const EQUATORIAL_SURFACE_FIELD_T = 3.12e-5;

const square = (value: number): number => value * value;

/**
 * Radius of a dipole field line at magnetic latitude `latRad`.
 *
 *   r = L * R_E * cos^2(lat)
 */
export const fieldLineRadiusKm = (L: number, latRad: number): number =>
  L * EARTH_RADIUS_KM * square(Math.cos(latRad));

/**
 * Ratio B(lat) / B_equator along a single field line.
 *
 *   B / B_eq = sqrt(1 + 3 sin^2 lat) / cos^6 lat
 *
 * Depends only on latitude, not on L, which is what makes mirroring and the
 * loss cone tractable analytically. Rises monotonically from 1 at the equator
 * toward infinity at the pole.
 */
export const fieldRatio = (latRad: number): number => {
  const cosLat = Math.cos(latRad);
  if (cosLat <= 0) return Number.POSITIVE_INFINITY;
  return Math.sqrt(1 + 3 * square(Math.sin(latRad))) / Math.pow(cosLat, 6);
};

/** Field strength at the equatorial crossing of shell L, tesla: B0 / L^3. */
export const equatorialFieldT = (L: number): number =>
  EQUATORIAL_SURFACE_FIELD_T / Math.pow(L, 3);

/** Field strength at magnetic latitude `latRad` on shell L, tesla. */
export const fieldMagnitudeT = (L: number, latRad: number): number =>
  equatorialFieldT(L) * fieldRatio(latRad);

/**
 * Magnetic latitude at which shell L reaches a given altitude.
 *
 * Setting r = R_E + altitude in r = L R_E cos^2(lat) gives
 * cos^2(lat) = (R_E + altitude) / (L R_E).
 *
 * Returns NaN when the shell never descends to that altitude.
 */
export const footLatitudeRad = (L: number, altitudeKm = 0): number => {
  const cosSquared = (EARTH_RADIUS_KM + altitudeKm) / (L * EARTH_RADIUS_KM);
  if (cosSquared > 1 || cosSquared < 0) return Number.NaN;
  return Math.acos(Math.sqrt(cosSquared));
};

/**
 * Latitude of the auroral oval for shell L, in degrees.
 *
 *   lat = arccos(1 / sqrt(L))
 *
 * Magnetotail field lines at L ~ 6-10 land at roughly 66-72 degrees, which is
 * the auroral oval as observed.
 */
export const ovalLatitudeDeg = (L: number): number =>
  (footLatitudeRad(L, 0) * 180) / Math.PI;

export interface FieldLinePoint {
  /** Magnetic latitude, radians. */
  latRad: number;
  /** Geocentric radius, km. */
  radiusKm: number;
  /** Altitude above the surface, km. */
  altitudeKm: number;
  /** Field magnitude at this point, tesla. */
  fieldT: number;
}

export interface TraceOptions {
  /** Lowest altitude to trace down to, km. Default 80. */
  minAltitudeKm?: number;
  /** Number of samples across the traced span. Default 96. */
  samples?: number;
  /** Trace only the northern half when true. Default false. */
  northOnly?: boolean;
}

/**
 * Sample a dipole field line from its northern foot, through the equator, to
 * its southern foot. Samples are evenly spaced in latitude, which concentrates
 * them near the equator where the line is longest - adequate for rendering,
 * and the arc-length element is available separately for particle motion.
 */
export const traceFieldLine = (
  L: number,
  options: TraceOptions = {},
): FieldLinePoint[] => {
  const { minAltitudeKm = 80, samples = 96, northOnly = false } = options;

  const maxLat = footLatitudeRad(L, minAltitudeKm);
  if (!Number.isFinite(maxLat)) return [];

  const minLat = northOnly ? 0 : -maxLat;
  const points: FieldLinePoint[] = [];

  for (let index = 0; index < samples; index += 1) {
    const t = samples === 1 ? 0 : index / (samples - 1);
    const latRad = minLat + (maxLat - minLat) * t;
    const radiusKm = fieldLineRadiusKm(L, latRad);
    points.push({
      latRad,
      radiusKm,
      altitudeKm: radiusKm - EARTH_RADIUS_KM,
      fieldT: fieldMagnitudeT(L, latRad),
    });
  }

  return points;
};

/**
 * Arc-length element along a dipole field line, km per radian of latitude.
 *
 *   ds/dlat = r_eq * cos(lat) * sqrt(1 + 3 sin^2 lat)
 *
 * Needed to convert a parallel velocity into a rate of change of latitude.
 */
export const arcLengthPerLatitudeKm = (L: number, latRad: number): number =>
  L *
  EARTH_RADIUS_KM *
  Math.cos(latRad) *
  Math.sqrt(1 + 3 * square(Math.sin(latRad)));
