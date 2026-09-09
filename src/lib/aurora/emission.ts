/**
 * Auroral emission lines and collisional quenching.
 *
 * An excited atom has two fates: radiate, or get hit by something first. The
 * competition is Stern-Volmer,
 *
 *   efficiency = A / (A + sum_i n_i k_i)
 *
 * where A is the Einstein coefficient and n_i k_i is the collisional
 * deactivation rate by species i. Because A varies by ten orders of magnitude
 * across the three auroral lines, they survive at wildly different altitudes -
 * and that, not any difference in what excites them, is why the aurora is
 * layered green below red.
 *
 * O(1D) is the extreme case: a forbidden transition with a 110 s lifetime.
 * Anywhere below ~250 km it is collisionally destroyed long before it can
 * radiate, so the red line only appears high up.
 *
 * Rate coefficients: Sander et al., JPL Publication 19-5 (2019); Slanger &
 * Copeland, Chem. Rev. 103, 4731 (2003).
 */

import { numberDensity, speciesFraction, type Species } from './atmosphere.ts';
import { depositionProfile, type DepositionSample } from './penetration.ts';

export type LineId = 'green' | 'red' | 'blue';

export interface AuroralLine {
  id: LineId;
  /** Vacuum wavelength, nm. */
  wavelengthNm: number;
  label: string;
  /** Transition, for display. */
  transition: string;
  /** Total radiative rate of the upper state, s^-1. */
  einsteinA: number;
  /** Radiative lifetime of the upper state, s. */
  lifetimeS: number;
  /** Species whose density drives the excitation rate. */
  parent: Species;
  /**
   * Relative production yield of the upper state per unit energy deposited in
   * the parent species. A lumped empirical branching factor, not derived from
   * cross-sections: O(1D) is populated by more channels than O(1S) - direct
   * impact, cascade from 1S, and dissociative recombination of O2+ - so it is
   * produced several times more readily. Without this the model cannot
   * reproduce red-dominant (type A) aurora at soft precipitation energies.
   */
  excitationYield: number;
  /** Collisional deactivation rate coefficients, cm^3 s^-1. */
  quenchers: { species: Species; k: number }[];
}

export const AURORAL_LINES: AuroralLine[] = [
  {
    id: 'green',
    wavelengthNm: 557.7,
    label: 'Oxygen green',
    transition: 'O(¹S) → O(¹D)',
    einsteinA: 1.35,
    lifetimeS: 0.74,
    parent: 'o',
    excitationYield: 1,
    quenchers: [
      { species: 'o2', k: 4.1e-12 },
      { species: 'o', k: 2.0e-14 },
    ],
  },
  {
    id: 'red',
    wavelengthNm: 630.0,
    label: 'Oxygen red',
    transition: 'O(¹D) → O(³P)',
    einsteinA: 9.1e-3,
    lifetimeS: 110,
    parent: 'o',
    excitationYield: 3,
    quenchers: [
      { species: 'n2', k: 2.3e-11 },
      { species: 'o2', k: 2.9e-11 },
      // O(1D) + O is poorly constrained; Streit et al. (1976) quote 8e-12 as
      // an upper limit. Taking that limit puts the red crossover above 400 km,
      // which contradicts the observed 200-300 km red aurora, so we use the
      // smaller value auroral models generally adopt.
      { species: 'o', k: 2.0e-13 },
    ],
  },
  {
    id: 'blue',
    wavelengthNm: 427.8,
    label: 'Nitrogen blue',
    transition: 'N₂⁺(B²Σ) → N₂⁺(X²Σ)',
    einsteinA: 1.7e7,
    lifetimeS: 5.9e-8,
    parent: 'n2',
    excitationYield: 1,
    quenchers: [{ species: 'n2', k: 1.0e-9 }],
  },
];

export const getLine = (id: LineId): AuroralLine => {
  const line = AURORAL_LINES.find((candidate) => candidate.id === id);
  if (!line) throw new Error(`Unknown auroral line: ${id}`);
  return line;
};

/** Total collisional deactivation rate for a line at altitude, s^-1. */
export const quenchRate = (line: AuroralLine, altitudeKm: number): number => {
  const densities = numberDensity(altitudeKm);
  let rate = 0;
  for (const quencher of line.quenchers) {
    rate += densities[quencher.species] * quencher.k;
  }
  return rate;
};

/**
 * Fraction of excited atoms that radiate rather than being collisionally
 * deactivated, 0-1.
 */
export const quenchEfficiency = (
  line: AuroralLine,
  altitudeKm: number,
): number => {
  const collisional = quenchRate(line, altitudeKm);
  return line.einsteinA / (line.einsteinA + collisional);
};

/**
 * Altitude at which a line's radiative and collisional rates are equal - the
 * crossover below which it effectively stops emitting.
 *
 * Found by bisection; quenching rises monotonically as altitude falls.
 * Returns the lower bound when the line is never quenched in range, which is
 * the correct answer for the effectively unquenchable blue line.
 */
export const quenchCrossoverAltitudeKm = (
  line: AuroralLine,
  minAltitudeKm = 80,
  maxAltitudeKm = 500,
): number => {
  if (quenchRate(line, minAltitudeKm) < line.einsteinA) return minAltitudeKm;
  if (quenchRate(line, maxAltitudeKm) > line.einsteinA) return maxAltitudeKm;

  let low = minAltitudeKm;
  let high = maxAltitudeKm;

  for (let iteration = 0; iteration < 60; iteration += 1) {
    const mid = (low + high) / 2;
    if (quenchRate(line, mid) > line.einsteinA) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
};

/**
 * Volume emission rate for one line at one altitude, arbitrary units.
 *
 * Four factors: how much energy is being deposited there, how much of the
 * local gas is the parent species, how readily that species produces this
 * particular excited state, and what fraction of those excited atoms survive
 * long enough to radiate.
 */
export const volumeEmissionRate = (
  line: AuroralLine,
  altitudeKm: number,
  depositionRate: number,
): number =>
  depositionRate *
  speciesFraction(altitudeKm, line.parent) *
  line.excitationYield *
  quenchEfficiency(line, altitudeKm);

export interface EmissionSample {
  altitudeKm: number;
  green: number;
  red: number;
  blue: number;
}

export type EmissionNormalisation = 'per-line' | 'shared' | 'none';

export interface EmissionProfileOptions {
  minAltitudeKm?: number;
  maxAltitudeKm?: number;
  samples?: number;
  spectrumWidth?: number;
  /**
   * 'per-line' scales each line to its own peak, which compares the SHAPES of
   * the three profiles but destroys their relative brightness.
   * 'shared' divides all three by one common peak, preserving the ratios - the
   * only correct choice when the profile is being turned into colour.
   * 'none' leaves the raw rates alone.
   */
  normalisation?: EmissionNormalisation;
}

/**
 * Emission profile of all three lines against altitude.
 *
 * This is the array the renderer samples to colour a curtain: red near the
 * top, green through the middle, blue hugging the bottom. Use the default
 * 'shared' normalisation for that - scaling each line to its own peak would
 * make every altitude look equally bright in every colour and wash the
 * stratification out.
 */
export const emissionProfile = (
  energyKeV: number,
  options: EmissionProfileOptions = {},
): EmissionSample[] => {
  const {
    minAltitudeKm = 80,
    maxAltitudeKm = 450,
    samples = 128,
    spectrumWidth = 0.5,
    normalisation = 'shared',
  } = options;

  const deposition: DepositionSample[] = depositionProfile(energyKeV, {
    minAltitudeKm,
    maxAltitudeKm,
    samples,
    spectrumWidth,
  });

  const green = getLine('green');
  const red = getLine('red');
  const blue = getLine('blue');

  const profile: EmissionSample[] = deposition.map((sample) => ({
    altitudeKm: sample.altitudeKm,
    green: volumeEmissionRate(green, sample.altitudeKm, sample.rate),
    red: volumeEmissionRate(red, sample.altitudeKm, sample.rate),
    blue: volumeEmissionRate(blue, sample.altitudeKm, sample.rate),
  }));

  if (normalisation === 'per-line') {
    for (const id of ['green', 'red', 'blue'] as const) {
      let peak = 0;
      for (const sample of profile) peak = Math.max(peak, sample[id]);
      if (peak > 0) {
        for (const sample of profile) sample[id] /= peak;
      }
    }
  } else if (normalisation === 'shared') {
    let peak = 0;
    for (const sample of profile) {
      peak = Math.max(peak, sample.green, sample.red, sample.blue);
    }
    if (peak > 0) {
      for (const sample of profile) {
        sample.green /= peak;
        sample.red /= peak;
        sample.blue /= peak;
      }
    }
  }

  return profile;
};

/**
 * Column-integrated brightness of each line, relative to one another.
 *
 * Unlike emissionProfile these are NOT normalised against each other - the
 * ratios are the physical output, and they are what the spectrometer plots.
 */
export const columnBrightness = (
  energyKeV: number,
  options: EmissionProfileOptions = {},
): Record<LineId, number> => {
  const {
    minAltitudeKm = 80,
    maxAltitudeKm = 450,
    samples = 128,
    spectrumWidth = 0.5,
  } = options;

  const deposition = depositionProfile(energyKeV, {
    minAltitudeKm,
    maxAltitudeKm,
    samples,
    spectrumWidth,
  });

  const totals: Record<LineId, number> = { green: 0, red: 0, blue: 0 };
  if (deposition.length < 2) return totals;

  const stepKm =
    (deposition[deposition.length - 1]!.altitudeKm - deposition[0]!.altitudeKm) /
    (deposition.length - 1);

  for (const sample of deposition) {
    for (const line of AURORAL_LINES) {
      totals[line.id] +=
        volumeEmissionRate(line, sample.altitudeKm, sample.rate) * stepKm;
    }
  }

  return totals;
};
