/**
 * Turning emission lines into screen colour.
 *
 * The point of doing this properly: the colour of the aurora on screen is
 * derived from the physics rather than art-directed. Feed in the line
 * intensities the quenching model produces, get back the colour a human eye
 * would actually see.
 *
 * Pipeline: wavelength -> CIE 1931 XYZ -> linear sRGB -> gamma-encoded sRGB.
 *
 * Colour-matching functions use the multi-lobe Gaussian fit from Wyman, Sklar
 * & Simons, "Simple Analytic Approximations to the CIE XYZ Color Matching
 * Functions", Journal of Computer Graphics Techniques 2(2), 2013. Accurate to
 * well within the precision this needs, and far smaller than a lookup table.
 */

import { AURORAL_LINES, type LineId } from './emission.ts';

export interface Xyz {
  x: number;
  y: number;
  z: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Piecewise Gaussian: a single lobe with different widths either side of its
 * peak, the building block of the Wyman fit.
 */
const piecewiseGaussian = (
  value: number,
  mean: number,
  sigmaLow: number,
  sigmaHigh: number,
): number => {
  const sigma = value < mean ? sigmaLow : sigmaHigh;
  const t = (value - mean) / sigma;
  return Math.exp(-0.5 * t * t);
};

/** CIE 1931 2-degree colour-matching functions at a wavelength in nm. */
export const colourMatch = (wavelengthNm: number): Xyz => {
  const x =
    1.056 * piecewiseGaussian(wavelengthNm, 599.8, 37.9, 31.0) +
    0.362 * piecewiseGaussian(wavelengthNm, 442.0, 16.0, 26.7) -
    0.065 * piecewiseGaussian(wavelengthNm, 501.1, 20.4, 26.2);

  const y =
    0.821 * piecewiseGaussian(wavelengthNm, 568.8, 46.9, 40.5) +
    0.286 * piecewiseGaussian(wavelengthNm, 530.9, 16.3, 31.1);

  const z =
    1.217 * piecewiseGaussian(wavelengthNm, 437.0, 11.8, 36.0) +
    0.681 * piecewiseGaussian(wavelengthNm, 459.0, 26.0, 13.8);

  return { x, y, z };
};

/** Convert CIE XYZ to linear sRGB (sRGB primaries, D65 white). */
export const xyzToLinearRgb = ({ x, y, z }: Xyz): Rgb => ({
  r: 3.2406 * x - 1.5372 * y - 0.4986 * z,
  g: -0.9689 * x + 1.8758 * y + 0.0415 * z,
  b: 0.0557 * x - 0.204 * y + 1.057 * z,
});

/** sRGB transfer function, linear -> gamma-encoded, both 0-1. */
export const encodeGamma = (channel: number): number => {
  const clamped = Math.max(0, Math.min(1, channel));
  return clamped <= 0.0031308
    ? 12.92 * clamped
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
};

/**
 * Scale a linear RGB triple into gamut by desaturating toward white rather
 * than clipping channels, which would shift the hue. Monochromatic sources sit
 * outside the sRGB gamut by construction, so this matters here.
 */
const desaturateIntoGamut = ({ r, g, b }: Rgb): Rgb => {
  const minimum = Math.min(r, g, b);
  if (minimum >= 0) return { r, g, b };
  const white = -minimum;
  return { r: r + white, g: g + white, b: b + white };
};

const normalisePeak = ({ r, g, b }: Rgb): Rgb => {
  const peak = Math.max(r, g, b);
  if (peak <= 0) return { r: 0, g: 0, b: 0 };
  return { r: r / peak, g: g / peak, b: b / peak };
};

/**
 * Gamma-encoded sRGB for a single monochromatic wavelength, each channel 0-1,
 * normalised so the brightest channel is 1.
 */
export const wavelengthToRgb = (wavelengthNm: number): Rgb => {
  const linear = normalisePeak(
    desaturateIntoGamut(xyzToLinearRgb(colourMatch(wavelengthNm))),
  );
  return {
    r: encodeGamma(linear.r),
    g: encodeGamma(linear.g),
    b: encodeGamma(linear.b),
  };
};

/** Same, as a CSS hex string. */
export const wavelengthToHex = (wavelengthNm: number): string => {
  const { r, g, b } = wavelengthToRgb(wavelengthNm);
  const channel = (value: number): string =>
    Math.round(Math.max(0, Math.min(1, value)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
};

/**
 * Composite colour of a set of weighted emission lines.
 *
 * Intensities are summed in XYZ - the only space where adding light is
 * physically meaningful - then converted once. Adding gamma-encoded RGB
 * instead would give the wrong mixture.
 *
 * `exposure` scales the result before gamma encoding, so a faint aurora comes
 * out dim rather than being renormalised back to full brightness.
 */
export const compositeColour = (
  intensities: Partial<Record<LineId, number>>,
  exposure = 1,
): Rgb => {
  let total: Xyz = { x: 0, y: 0, z: 0 };

  for (const line of AURORAL_LINES) {
    const weight = intensities[line.id] ?? 0;
    if (weight <= 0) continue;
    const match = colourMatch(line.wavelengthNm);
    total = {
      x: total.x + match.x * weight,
      y: total.y + match.y * weight,
      z: total.z + match.z * weight,
    };
  }

  if (total.x === 0 && total.y === 0 && total.z === 0) {
    return { r: 0, g: 0, b: 0 };
  }

  // Peak-normalise, then scale by exposure. Normalising on luminance instead
  // would blow out violet-dominant mixtures, where y is tiny and x/y, z/y
  // explode past the gamut.
  const linear = normalisePeak(
    desaturateIntoGamut(xyzToLinearRgb(total)),
  );
  const level = Math.max(0, exposure);

  return {
    r: encodeGamma(linear.r * level),
    g: encodeGamma(linear.g * level),
    b: encodeGamma(linear.b * level),
  };
};

/** Composite colour as a CSS rgb() string. */
export const compositeColourCss = (
  intensities: Partial<Record<LineId, number>>,
  exposure = 1,
): string => {
  const { r, g, b } = compositeColour(intensities, exposure);
  const channel = (value: number): number =>
    Math.round(Math.max(0, Math.min(1, value)) * 255);
  return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`;
};
