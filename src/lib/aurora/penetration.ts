/**
 * How deep precipitating electrons get before they stop.
 *
 * This is the link that makes the energy control physically meaningful: a
 * harder electron spectrum burns through more atmosphere before stopping, so
 * it deposits its energy lower down, where the air is dense and the long-lived
 * red transition is collisionally quenched. Soft precipitation stops high and
 * glows red; hard precipitation stops low and glows green and blue.
 *
 * Range parameterisation: Rees (1963), "Auroral ionization and excitation by
 * incident energetic electrons", Planet. Space Sci. 11, 1209.
 */

import { columnDensityAbove, massDensity } from './atmosphere.ts';

/**
 * Range of an electron in air, g/cm^2, for energy in keV.
 *
 *   R = 4.30e-7 + 5.36e-6 E^1.67
 */
export const electronRangeGCm2 = (energyKeV: number): number =>
  4.3e-7 + 5.36e-6 * Math.pow(Math.max(energyKeV, 0), 1.67);

/**
 * Altitude at which an electron of the given energy stops, km.
 *
 * Found by bisection on columnDensityAbove(z) = range(E). The column rises
 * monotonically as altitude falls, so the bracket is unambiguous.
 */
export const stoppingAltitudeKm = (energyKeV: number): number => {
  const range = electronRangeGCm2(energyKeV);

  let low = 50;
  let high = 600;

  for (let iteration = 0; iteration < 60; iteration += 1) {
    const mid = (low + high) / 2;
    if (columnDensityAbove(mid) > range) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
};

/**
 * Normalised energy-deposition profile for a monoenergetic beam.
 *
 * Uses the standard Rees shape: energy is deposited as a function of the
 * fraction of the range already traversed, peaking a little above the stopping
 * altitude rather than exactly at it. Approximated here by a smooth lobe in
 * scaled depth s = column(z) / range, which reproduces the observed shape -
 * a gradual rise, a peak near s ~ 0.7, and a sharp cutoff at s = 1.
 *
 * Returns an unnormalised rate; only the shape matters, since brightness is
 * scaled separately by the incident flux.
 */
export const depositionAt = (altitudeKm: number, energyKeV: number): number => {
  const range = electronRangeGCm2(energyKeV);
  if (range <= 0) return 0;

  const s = columnDensityAbove(altitudeKm) / range;
  if (s <= 0 || s >= 1) return 0;

  // Lobe peaking near s = 0.7, vanishing at both ends.
  const shape = Math.pow(s, 0.9) * Math.pow(1 - s, 0.75);

  // Convert per-unit-column into per-unit-altitude so the profile is a density
  // in z, not in column depth.
  const rho = massDensity(altitudeKm);
  return shape * rho;
};

export interface DepositionSample {
  altitudeKm: number;
  rate: number;
}

/**
 * Deposition profile sampled over an altitude span, peak-normalised to 1.
 *
 * `spectrumWidth` blends a small range of energies around `energyKeV` so the
 * profile is a realistic smear rather than a razor-thin monoenergetic layer.
 */
export const depositionProfile = (
  energyKeV: number,
  options: {
    minAltitudeKm?: number;
    maxAltitudeKm?: number;
    samples?: number;
    spectrumWidth?: number;
  } = {},
): DepositionSample[] => {
  const {
    minAltitudeKm = 80,
    maxAltitudeKm = 450,
    samples = 128,
    spectrumWidth = 0.5,
  } = options;

  // Sample a handful of energies spanning a factor of (1 +/- spectrumWidth).
  const energies: number[] = [];
  const energySteps: number = 5;
  for (let index = 0; index < energySteps; index += 1) {
    const t = energySteps === 1 ? 0.5 : index / (energySteps - 1);
    energies.push(energyKeV * (1 - spectrumWidth + 2 * spectrumWidth * t));
  }

  const profile: DepositionSample[] = [];
  let peak = 0;

  for (let index = 0; index < samples; index += 1) {
    const t = samples === 1 ? 0 : index / (samples - 1);
    const altitudeKm = minAltitudeKm + (maxAltitudeKm - minAltitudeKm) * t;

    let rate = 0;
    for (const energy of energies) {
      if (energy > 0) rate += depositionAt(altitudeKm, energy);
    }
    rate /= energies.length;

    if (rate > peak) peak = rate;
    profile.push({ altitudeKm, rate });
  }

  if (peak > 0) {
    for (const sample of profile) sample.rate /= peak;
  }

  return profile;
};

/** Altitude of peak energy deposition, km - where the aurora is brightest. */
export const peakDepositionAltitudeKm = (energyKeV: number): number => {
  const profile = depositionProfile(energyKeV, { samples: 256 });
  let best = profile[0];
  for (const sample of profile) {
    if (!best || sample.rate > best.rate) best = sample;
  }
  return best ? best.altitudeKm : Number.NaN;
};
