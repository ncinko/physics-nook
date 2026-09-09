/**
 * Upper-atmosphere composition, 80-500 km.
 *
 * Number densities of the three species that matter for auroral emission:
 * N2 and O2 quench excited states through collisions, and O is the parent of
 * both the green and red oxygen lines. The key structural fact is that N2 and
 * O2 fall off far faster than O, so the upper thermosphere is atomic-oxygen
 * dominated and collisionally quiet - which is what lets the long-lived red
 * transition survive up there.
 *
 * Log-linear interpolation over anchors representative of quiet mid-latitude
 * conditions (NRLMSISE-00 class values). Good to a factor of ~2, which is well
 * inside the accuracy this simulation needs; it is not a substitute for a real
 * MSIS call.
 */

export type Species = 'n2' | 'o2' | 'o';

export interface NumberDensities {
  /** Molecular nitrogen, cm^-3. */
  n2: number;
  /** Molecular oxygen, cm^-3. */
  o2: number;
  /** Atomic oxygen, cm^-3. */
  o: number;
}

/** Lowest altitude the anchor table covers, km. */
export const MIN_ALTITUDE_KM = 80;
/** Highest altitude the anchor table covers, km. */
export const MAX_ALTITUDE_KM = 500;

interface Anchor {
  altitudeKm: number;
  n2: number;
  o2: number;
  o: number;
}

const ANCHORS: Anchor[] = [
  { altitudeKm: 80, n2: 1.4e15, o2: 3.7e14, o: 4.0e10 },
  { altitudeKm: 90, n2: 1.4e14, o2: 3.4e13, o: 2.4e11 },
  { altitudeKm: 100, n2: 9.6e12, o2: 2.2e12, o: 4.5e11 },
  { altitudeKm: 110, n2: 1.9e12, o2: 3.6e11, o: 3.0e11 },
  { altitudeKm: 120, n2: 5.5e11, o2: 8.4e10, o: 1.6e11 },
  { altitudeKm: 150, n2: 5.8e10, o2: 6.5e9, o: 6.9e10 },
  { altitudeKm: 200, n2: 5.5e9, o2: 4.2e8, o: 2.4e10 },
  { altitudeKm: 250, n2: 8.0e8, o2: 4.5e7, o: 1.1e10 },
  { altitudeKm: 300, n2: 1.3e8, o2: 5.5e6, o: 5.2e9 },
  { altitudeKm: 400, n2: 4.0e6, o2: 1.1e5, o: 1.3e9 },
  { altitudeKm: 500, n2: 1.5e5, o2: 2.5e3, o: 3.5e8 },
];

/** Molar masses, g/mol, for converting number density to mass density. */
const MOLAR_MASS: Record<Species, number> = { n2: 28.014, o2: 31.998, o: 15.999 };

const AVOGADRO = 6.02214076e23;

const interpolateLog = (
  altitudeKm: number,
  lower: Anchor,
  upper: Anchor,
  key: Species,
): number => {
  const span = upper.altitudeKm - lower.altitudeKm;
  const t = span === 0 ? 0 : (altitudeKm - lower.altitudeKm) / span;
  const logLower = Math.log(lower[key]);
  const logUpper = Math.log(upper[key]);
  return Math.exp(logLower + (logUpper - logLower) * t);
};

/**
 * Extrapolate beyond the table using the scale height implied by the two
 * nearest anchors, so densities stay positive and monotonic rather than
 * clamping flat.
 */
const extrapolate = (
  altitudeKm: number,
  near: Anchor,
  next: Anchor,
  key: Species,
): number => {
  const span = next.altitudeKm - near.altitudeKm;
  const slope = (Math.log(next[key]) - Math.log(near[key])) / span;
  return Math.exp(Math.log(near[key]) + slope * (altitudeKm - near.altitudeKm));
};

/** Number densities of N2, O2 and O at the given altitude, cm^-3. */
export const numberDensity = (altitudeKm: number): NumberDensities => {
  const first = ANCHORS[0]!;
  const second = ANCHORS[1]!;
  const last = ANCHORS[ANCHORS.length - 1]!;
  const penultimate = ANCHORS[ANCHORS.length - 2]!;

  if (altitudeKm <= first.altitudeKm) {
    return {
      n2: extrapolate(altitudeKm, first, second, 'n2'),
      o2: extrapolate(altitudeKm, first, second, 'o2'),
      o: extrapolate(altitudeKm, first, second, 'o'),
    };
  }

  if (altitudeKm >= last.altitudeKm) {
    return {
      n2: extrapolate(altitudeKm, last, penultimate, 'n2'),
      o2: extrapolate(altitudeKm, last, penultimate, 'o2'),
      o: extrapolate(altitudeKm, last, penultimate, 'o'),
    };
  }

  let index = 0;
  while (
    index < ANCHORS.length - 2 &&
    ANCHORS[index + 1]!.altitudeKm < altitudeKm
  ) {
    index += 1;
  }

  const lower = ANCHORS[index]!;
  const upper = ANCHORS[index + 1]!;

  return {
    n2: interpolateLog(altitudeKm, lower, upper, 'n2'),
    o2: interpolateLog(altitudeKm, lower, upper, 'o2'),
    o: interpolateLog(altitudeKm, lower, upper, 'o'),
  };
};

/** Total number density of the three tracked species, cm^-3. */
export const totalNumberDensity = (altitudeKm: number): number => {
  const { n2, o2, o } = numberDensity(altitudeKm);
  return n2 + o2 + o;
};

/** Mass density at the given altitude, g/cm^3. */
export const massDensity = (altitudeKm: number): number => {
  const { n2, o2, o } = numberDensity(altitudeKm);
  return (
    (n2 * MOLAR_MASS.n2 + o2 * MOLAR_MASS.o2 + o * MOLAR_MASS.o) / AVOGADRO
  );
};

/**
 * Mass of atmosphere above the given altitude, g/cm^2.
 *
 * Integrated downward from 600 km with the trapezoid rule on a 1 km grid.
 * This is the column an incoming electron has to burn through, so it is what
 * sets the stopping altitude.
 */
export const columnDensityAbove = (altitudeKm: number): number => {
  const top = 600;
  if (altitudeKm >= top) return 0;

  const stepKm = 1;
  const stepCm = stepKm * 1e5;
  let column = 0;

  for (let z = altitudeKm; z < top; z += stepKm) {
    const lower = massDensity(z);
    const upper = massDensity(Math.min(z + stepKm, top));
    column += ((lower + upper) / 2) * stepCm;
  }

  return column;
};

/** Fraction of the local gas that is the given species, 0-1. */
export const speciesFraction = (altitudeKm: number, species: Species): number => {
  const densities = numberDensity(altitudeKm);
  const total = densities.n2 + densities.o2 + densities.o;
  if (total <= 0) return 0;
  return densities[species] / total;
};
