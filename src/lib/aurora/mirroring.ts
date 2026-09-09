/**
 * Guiding-centre motion of charged particles in the dipole field.
 *
 * A particle spiralling along a field line conserves its first adiabatic
 * invariant, mu = m v_perp^2 / 2B. As it moves poleward B rises, so v_perp
 * must rise too; since the total speed is fixed, v_parallel falls and the
 * particle turns around at its mirror point. Particles whose mirror point
 * would fall below the atmosphere never turn around - they hit the air and
 * make light. That set is the loss cone, and it is the whole reason the sky
 * glows.
 *
 * Reference: Walt, "Introduction to Geomagnetically Trapped Radiation" (1994).
 */

import {
  arcLengthPerLatitudeKm,
  equatorialFieldT,
  fieldRatio,
  footLatitudeRad,
} from './dipole.ts';

/** Altitude taken as the top of the absorbing atmosphere, km. */
export const ATMOSPHERE_TOP_KM = 100;

const square = (value: number): number => value * value;

/**
 * Field strength at the mirror point of a particle with the given equatorial
 * pitch angle, tesla.
 *
 *   B_m = B_eq / sin^2(alpha_eq)
 */
export const mirrorFieldT = (L: number, equatorialPitchRad: number): number => {
  const sinAlpha = Math.sin(equatorialPitchRad);
  if (sinAlpha <= 0) return Number.POSITIVE_INFINITY;
  return equatorialFieldT(L) / square(sinAlpha);
};

/**
 * Magnetic latitude of the mirror point, radians.
 *
 * Solves fieldRatio(lat) = 1 / sin^2(alpha_eq) by bisection. fieldRatio rises
 * monotonically from 1 at the equator, so the bracket is unambiguous.
 * Returns the northern (positive) solution.
 */
export const mirrorLatitudeRad = (equatorialPitchRad: number): number => {
  const sinAlpha = Math.sin(equatorialPitchRad);
  if (sinAlpha <= 0) return Math.PI / 2;
  const target = 1 / square(sinAlpha);
  if (target <= 1) return 0;

  let low = 0;
  let high = Math.PI / 2 - 1e-9;

  for (let iteration = 0; iteration < 80; iteration += 1) {
    const mid = (low + high) / 2;
    if (fieldRatio(mid) < target) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
};

/**
 * Fraction of the total speed still parallel to the field at `latRad`.
 *
 *   v_par / v = sqrt(1 - B(lat)/B_m) = sqrt(1 - fieldRatio(lat) sin^2 alpha_eq)
 *
 * Clamped at zero past the mirror point.
 */
export const parallelVelocityFraction = (
  latRad: number,
  equatorialPitchRad: number,
): number => {
  const ratio = fieldRatio(latRad) * square(Math.sin(equatorialPitchRad));
  if (ratio >= 1) return 0;
  return Math.sqrt(1 - ratio);
};

/**
 * Equatorial loss-cone half-angle for shell L, radians.
 *
 *   sin^2(alpha_lc) = B_eq / B_atm = 1 / fieldRatio(lat_atm)
 *
 * Particles with a smaller equatorial pitch angle precipitate rather than
 * mirror. The cone narrows with L: at L = 6 it is under 3 degrees, so only a
 * sliver of the distribution ever reaches the atmosphere.
 */
export const lossConeAngleRad = (
  L: number,
  atmosphereAltitudeKm = ATMOSPHERE_TOP_KM,
): number => {
  const latAtm = footLatitudeRad(L, atmosphereAltitudeKm);
  if (!Number.isFinite(latAtm)) return 0;
  return Math.asin(Math.sqrt(1 / fieldRatio(latAtm)));
};

/** True when a particle at this equatorial pitch angle precipitates. */
export const isInLossCone = (
  L: number,
  equatorialPitchRad: number,
  atmosphereAltitudeKm = ATMOSPHERE_TOP_KM,
): boolean =>
  Math.abs(equatorialPitchRad) < lossConeAngleRad(L, atmosphereAltitudeKm);

/**
 * Bounce period between conjugate mirror points, seconds.
 *
 *   T_b ~ (4 L R_E / v) (1.30 - 0.56 sin alpha_eq)
 *
 * The bracket is the standard empirical fit to the exact dipole integral,
 * accurate to better than 1% across the full pitch-angle range.
 */
export const bouncePeriodS = (
  L: number,
  speedMs: number,
  equatorialPitchRad: number,
): number => {
  const pathKm = 4 * L * 6371.2;
  const pathM = pathKm * 1000;
  return (pathM / speedMs) * (1.3 - 0.56 * Math.sin(equatorialPitchRad));
};

export interface GuidingCentreState {
  /** Shell the particle is bound to. */
  L: number;
  /** Current magnetic latitude, radians. */
  latRad: number;
  /** Equatorial pitch angle, radians - fixed by the invariant. */
  equatorialPitchRad: number;
  /** Total speed, m/s - fixed, since a static B field does no work. */
  speedMs: number;
  /** Direction of travel along the field: +1 poleward north, -1 south. */
  direction: 1 | -1;
  /** Set once the particle has descended past the atmosphere top. */
  precipitated: boolean;
}

/**
 * Advance a guiding centre along its field line by `dtSeconds`.
 *
 * Integrates dlat/dt = v_par / (ds/dlat), reflecting at the mirror point. A
 * particle inside the loss cone reaches the atmosphere before mirroring and is
 * flagged as precipitated rather than reflected.
 *
 * Returns a new state; the input is not mutated.
 */
export const stepGuidingCentre = (
  state: GuidingCentreState,
  dtSeconds: number,
): GuidingCentreState => {
  if (state.precipitated) return state;

  const { L, equatorialPitchRad, speedMs } = state;
  const mirrorLat = mirrorLatitudeRad(equatorialPitchRad);
  const atmosphereLat = footLatitudeRad(L, ATMOSPHERE_TOP_KM);

  const fraction = parallelVelocityFraction(state.latRad, equatorialPitchRad);
  const parallelSpeedKmS = (speedMs * fraction) / 1000;
  const perLatitude = arcLengthPerLatitudeKm(L, state.latRad);

  // Near the mirror point v_par -> 0, so nudge past it rather than stalling.
  const latRate =
    perLatitude > 1e-6 ? (parallelSpeedKmS / perLatitude) * state.direction : 0;

  let latRad = state.latRad + latRate * dtSeconds;
  let direction = state.direction;
  let precipitated = false;

  if (Number.isFinite(atmosphereLat) && Math.abs(latRad) >= atmosphereLat) {
    // Reached the atmosphere: this particle deposits its energy.
    latRad = Math.sign(latRad) * atmosphereLat;
    precipitated = true;
  } else if (Math.abs(latRad) >= mirrorLat) {
    // Mirrored: reflect about the turning point and reverse.
    latRad = Math.sign(latRad) * (2 * mirrorLat - Math.abs(latRad));
    direction = (direction * -1) as 1 | -1;
  } else if (fraction <= 0) {
    // Started exactly at rest parallel - kick it back toward the equator.
    direction = (direction * -1) as 1 | -1;
  }

  return { ...state, latRad, direction, precipitated };
};

/**
 * The first adiabatic invariant, mu = m v_perp^2 / 2B, in J/T.
 *
 * Exposed so tests can assert it stays constant across a bounce - the property
 * the whole guiding-centre approximation rests on.
 */
export const magneticMoment = (
  L: number,
  latRad: number,
  equatorialPitchRad: number,
  speedMs: number,
  massKg: number,
): number => {
  const fraction = parallelVelocityFraction(latRad, equatorialPitchRad);
  const perpendicularSquared = square(speedMs) * (1 - square(fraction));
  const fieldT = equatorialFieldT(L) * fieldRatio(latRad);
  return (massKg * perpendicularSquared) / (2 * fieldT);
};
