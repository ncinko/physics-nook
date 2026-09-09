/**
 * Curtain geometry: what an observer on the ground actually sees.
 *
 * An auroral curtain is not a painted texture. It is the set of field lines
 * threading a thin arc in the ionosphere, lit along their length wherever
 * precipitating electrons are depositing energy. You see the draped-fabric
 * shape because you are looking at a sheet of field lines edge-on.
 *
 * The lean of the curtain is not a chosen parameter either. Climbing a dipole
 * field line moves you equatorward as well as upward, and the resulting tilt
 * from vertical - about 12 degrees at auroral latitudes - falls straight out
 * of r = L R_E cos^2(lat).
 *
 * Coordinates are a local ENU frame in km, centred on the observer:
 * +x east, +y north, +z up.
 */

import { EARTH_RADIUS_KM, footLatitudeRad } from './dipole.ts';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CurtainVertex extends Vec3 {
  /** Altitude above the ground, km - what the emission profile is keyed on. */
  altitudeKm: number;
  /** Position along the arc, 0-1, for tapering the ends. */
  arcT: number;
}

export interface CurtainOptions {
  /** Shell the curtain sits on. */
  L: number;
  /** Observer's magnetic latitude, radians. */
  observerLatRad: number;
  /** Angular half-width of the arc, radians of longitude. */
  arcHalfWidthRad?: number;
  /** Samples along the arc. */
  arcSamples?: number;
  /** Lowest emitting altitude, km. */
  minAltitudeKm?: number;
  /** Highest emitting altitude, km. */
  maxAltitudeKm?: number;
  /** Samples up each field line. */
  altitudeSamples?: number;
  /** Amplitude of the folding, km. */
  foldAmplitudeKm?: number;
  /** Number of fold wavelengths across the arc. */
  foldWaves?: number;
  /** Animation phase, radians. */
  phase?: number;
}

/**
 * Southward (equatorward) displacement, in km, on climbing from the foot of a
 * field line to the given altitude.
 *
 * Exact dipole result: cos^2(lat) = r / (L R_E), so the latitude at altitude h
 * is arccos(sqrt((R_E + h) / (L R_E))), and the ground-projected displacement
 * is R_E times the latitude difference.
 */
export const equatorwardOffsetKm = (L: number, altitudeKm: number): number => {
  const footLat = footLatitudeRad(L, 0);
  const latAtAltitude = footLatitudeRad(L, altitudeKm);
  if (!Number.isFinite(footLat) || !Number.isFinite(latAtAltitude)) return 0;
  return EARTH_RADIUS_KM * (footLat - latAtAltitude);
};

/**
 * Tilt of the field line from vertical at the given altitude, radians.
 *
 * About 0.21 rad (12 degrees) for L = 6.5 at 200 km, matching the magnetic dip
 * angle, tan(I) = 2 tan(lat).
 */
export const curtainTiltRad = (L: number, altitudeKm: number): number => {
  if (altitudeKm <= 0) return 0;
  return Math.atan(equatorwardOffsetKm(L, altitudeKm) / altitudeKm);
};

/**
 * Ground distance from the observer to the foot of the curtain, km.
 *
 * Negative when the curtain is behind the observer, which the caller may want
 * to treat as "look south instead".
 */
export const groundDistanceKm = (L: number, observerLatRad: number): number => {
  const footLat = footLatitudeRad(L, 0);
  if (!Number.isFinite(footLat)) return Number.NaN;
  return EARTH_RADIUS_KM * (footLat - observerLatRad);
};

/**
 * Lateral displacement of the curtain's foot at arc position `t` (0-1).
 *
 * The travelling wave here is a phenomenological stand-in for the shear
 * instability that actually folds auroral arcs - it produces the right visual
 * structure, but it is not a solution of anything. Two incommensurate
 * harmonics keep it from looking periodic.
 */
export const foldOffsetKm = (
  t: number,
  amplitudeKm: number,
  waves: number,
  phase: number,
): number => {
  const primary = Math.sin(t * waves * Math.PI * 2 + phase);
  const secondary = 0.42 * Math.sin(t * waves * 1.618 * Math.PI * 2 - phase * 0.73);
  return amplitudeKm * (primary + secondary) * 0.7;
};

/**
 * Build one curtain as a grid of vertices, `arcSamples` wide by
 * `altitudeSamples` tall, ordered row-major from the bottom up.
 *
 * The renderer lofts consecutive rows into triangle strips; keeping the grid
 * generation here means the geometry is testable without a GPU.
 */
export const buildCurtainGrid = (options: CurtainOptions): CurtainVertex[] => {
  const {
    L,
    observerLatRad,
    arcHalfWidthRad = 0.05,
    arcSamples = 64,
    minAltitudeKm = 90,
    maxAltitudeKm = 400,
    altitudeSamples = 40,
    foldAmplitudeKm = 18,
    foldWaves = 3,
    phase = 0,
  } = options;

  const distance = groundDistanceKm(L, observerLatRad);
  if (!Number.isFinite(distance)) return [];

  // Arc half-width in km along the curtain, at the foot point's radius.
  const footLat = footLatitudeRad(L, 0);
  const arcHalfLengthKm = EARTH_RADIUS_KM * Math.cos(footLat) * arcHalfWidthRad;

  const vertices: CurtainVertex[] = [];

  for (let row = 0; row < altitudeSamples; row += 1) {
    const rowT = altitudeSamples === 1 ? 0 : row / (altitudeSamples - 1);
    const altitudeKm =
      minAltitudeKm + (maxAltitudeKm - minAltitudeKm) * rowT;
    const southward = equatorwardOffsetKm(L, altitudeKm);

    for (let column = 0; column < arcSamples; column += 1) {
      const arcT = arcSamples === 1 ? 0.5 : column / (arcSamples - 1);
      const east = (arcT * 2 - 1) * arcHalfLengthKm;

      // The fold travels along the arc and is carried up the field line, so
      // the whole sheet moves together rather than shearing apart.
      const fold = foldOffsetKm(arcT, foldAmplitudeKm, foldWaves, phase);

      vertices.push({
        x: east,
        y: distance - southward + fold,
        z: altitudeKm,
        altitudeKm,
        arcT,
      });
    }
  }

  return vertices;
};

/**
 * Triangle indices for a grid produced by buildCurtainGrid.
 *
 * Two triangles per cell, wound consistently so a single-sided material still
 * shows from the observer's side.
 */
export const buildCurtainIndices = (
  arcSamples: number,
  altitudeSamples: number,
): number[] => {
  const indices: number[] = [];

  for (let row = 0; row < altitudeSamples - 1; row += 1) {
    for (let column = 0; column < arcSamples - 1; column += 1) {
      const a = row * arcSamples + column;
      const b = a + 1;
      const c = a + arcSamples;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  return indices;
};

/**
 * Brightness taper across the arc and up the sheet.
 *
 * Curtains fade at their ends rather than stopping square, and the very top of
 * the emitting column is thin. Kept separate from the emission physics: this
 * is about the finite extent of the arc, not about which lines survive.
 */
export const curtainTaper = (arcT: number): number => {
  // Smooth cosine window, zero at both ends.
  return 0.5 - 0.5 * Math.cos(Math.PI * 2 * Math.min(Math.max(arcT, 0), 1));
};
