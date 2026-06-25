import type { Vec3 } from './ephemeris.ts';

export interface StarCatalogEntry {
  name: string;
  raHours: number;
  decDegrees: number;
  magnitude: number;
  bv?: number;
  spectralClass?: string;
}

export interface StarVisualStyle {
  color: Vec3;
  size: number;
  alpha: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const normalize = (vector: Vec3): Vec3 => {
  const magnitude = Math.hypot(vector.x, vector.y, vector.z);
  if (magnitude === 0) return { x: 0, y: 0, z: 0 };
  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude,
    z: vector.z / magnitude,
  };
};

const spectralBvFallback = (spectralClass?: string): number => {
  const key = spectralClass?.trim().slice(0, 1).toUpperCase();
  if (key === 'O') return -0.32;
  if (key === 'B') return -0.18;
  if (key === 'A') return 0.05;
  if (key === 'F') return 0.32;
  if (key === 'G') return 0.58;
  if (key === 'K') return 0.98;
  if (key === 'M') return 1.52;
  return 0.65;
};

export const celestialDirectionFromRaDec = (
  raHours: number,
  decDegrees: number,
): Vec3 => {
  const raRadians = raHours * Math.PI / 12;
  const decRadians = decDegrees * Math.PI / 180;
  const cosDec = Math.cos(decRadians);

  return normalize({
    x: cosDec * Math.cos(raRadians),
    y: Math.sin(decRadians),
    z: -cosDec * Math.sin(raRadians),
  });
};

export const starColorFromBV = (
  bvOrSpectral: number | undefined,
  spectralClass?: string,
): Vec3 => {
  const bv = clamp(bvOrSpectral ?? spectralBvFallback(spectralClass), -0.4, 1.9);
  const warmth = clamp((bv + 0.35) / 2.25, 0, 1);
  const blueTint = 1 - warmth;

  return {
    x: clamp(0.72 + warmth * 0.42, 0, 1),
    y: clamp(0.78 + (1 - Math.abs(warmth - 0.45) * 1.28) * 0.2, 0, 1),
    z: clamp(0.86 + blueTint * 0.28 - warmth * 0.46, 0, 1),
  };
};

export const starVisualStyle = (star: Pick<StarCatalogEntry, 'magnitude' | 'bv' | 'spectralClass'>): StarVisualStyle => {
  const brightness = clamp((6.6 - star.magnitude) / 8.2, 0, 1);
  const brightBias = brightness ** 1.45;

  return {
    color: starColorFromBV(star.bv, star.spectralClass),
    size: 1.05 + brightBias * 4.6,
    alpha: 0.28 + brightBias * 0.72,
  };
};

export const BRIGHT_STAR_CATALOG: StarCatalogEntry[] = [
  { name: 'Sirius', raHours: 6.7525, decDegrees: -16.7161, magnitude: -1.46, bv: 0, spectralClass: 'A1V' },
  { name: 'Canopus', raHours: 6.3992, decDegrees: -52.6957, magnitude: -0.74, bv: 0.15, spectralClass: 'F0II' },
  { name: 'Arcturus', raHours: 14.261, decDegrees: 19.1824, magnitude: -0.05, bv: 1.23, spectralClass: 'K1.5III' },
  { name: 'Rigil Kentaurus', raHours: 14.6601, decDegrees: -60.8352, magnitude: -0.01, bv: 0.71, spectralClass: 'G2V' },
  { name: 'Vega', raHours: 18.6156, decDegrees: 38.7837, magnitude: 0.03, bv: 0, spectralClass: 'A0V' },
  { name: 'Capella', raHours: 5.2782, decDegrees: 45.998, magnitude: 0.08, bv: 0.8, spectralClass: 'G5III' },
  { name: 'Rigel', raHours: 5.2423, decDegrees: -8.2016, magnitude: 0.13, bv: -0.03, spectralClass: 'B8Ia' },
  { name: 'Procyon', raHours: 7.655, decDegrees: 5.225, magnitude: 0.34, bv: 0.42, spectralClass: 'F5IV' },
  { name: 'Betelgeuse', raHours: 5.9195, decDegrees: 7.4071, magnitude: 0.45, bv: 1.85, spectralClass: 'M2Iab' },
  { name: 'Achernar', raHours: 1.6286, decDegrees: -57.2368, magnitude: 0.46, bv: -0.16, spectralClass: 'B6V' },
  { name: 'Hadar', raHours: 14.0637, decDegrees: -60.373, magnitude: 0.61, bv: -0.23, spectralClass: 'B1III' },
  { name: 'Altair', raHours: 19.8464, decDegrees: 8.8683, magnitude: 0.76, bv: 0.22, spectralClass: 'A7V' },
  { name: 'Acrux', raHours: 12.4433, decDegrees: -63.0991, magnitude: 0.77, bv: -0.24, spectralClass: 'B0.5IV' },
  { name: 'Aldebaran', raHours: 4.5987, decDegrees: 16.5093, magnitude: 0.86, bv: 1.54, spectralClass: 'K5III' },
  { name: 'Spica', raHours: 13.4199, decDegrees: -11.1613, magnitude: 0.98, bv: -0.23, spectralClass: 'B1V' },
  { name: 'Antares', raHours: 16.4901, decDegrees: -26.432, magnitude: 1.06, bv: 1.83, spectralClass: 'M1.5Iab' },
  { name: 'Pollux', raHours: 7.7553, decDegrees: 28.0262, magnitude: 1.14, bv: 1, spectralClass: 'K0III' },
  { name: 'Fomalhaut', raHours: 22.9608, decDegrees: -29.6222, magnitude: 1.16, bv: 0.09, spectralClass: 'A3V' },
  { name: 'Deneb', raHours: 20.6905, decDegrees: 45.2803, magnitude: 1.25, bv: 0.09, spectralClass: 'A2Ia' },
  { name: 'Mimosa', raHours: 12.7953, decDegrees: -59.6888, magnitude: 1.25, bv: -0.23, spectralClass: 'B0.5III' },
  { name: 'Regulus', raHours: 10.1395, decDegrees: 11.9672, magnitude: 1.35, bv: -0.11, spectralClass: 'B8IV' },
  { name: 'Adhara', raHours: 6.9771, decDegrees: -28.9721, magnitude: 1.5, bv: -0.21, spectralClass: 'B2II' },
  { name: 'Shaula', raHours: 17.5601, decDegrees: -37.1038, magnitude: 1.62, bv: -0.22, spectralClass: 'B2IV' },
  { name: 'Castor', raHours: 7.5767, decDegrees: 31.8883, magnitude: 1.58, bv: 0.03, spectralClass: 'A1V' },
  { name: 'Gacrux', raHours: 12.5194, decDegrees: -57.1132, magnitude: 1.63, bv: 1.59, spectralClass: 'M3.5III' },
  { name: 'Bellatrix', raHours: 5.4189, decDegrees: 6.3497, magnitude: 1.64, bv: -0.22, spectralClass: 'B2III' },
  { name: 'Elnath', raHours: 5.4382, decDegrees: 28.6075, magnitude: 1.65, bv: -0.13, spectralClass: 'B7III' },
  { name: 'Miaplacidus', raHours: 9.22, decDegrees: -69.7172, magnitude: 1.67, bv: 0.02, spectralClass: 'A2IV' },
  { name: 'Alnilam', raHours: 5.6036, decDegrees: -1.2019, magnitude: 1.69, bv: -0.18, spectralClass: 'B0Ia' },
  { name: 'Alnair', raHours: 22.1372, decDegrees: -46.961, magnitude: 1.74, bv: -0.07, spectralClass: 'B7IV' },
  { name: 'Alioth', raHours: 12.9005, decDegrees: 55.9598, magnitude: 1.76, bv: -0.02, spectralClass: 'A1III' },
  { name: 'Alnitak', raHours: 5.6793, decDegrees: -1.9426, magnitude: 1.77, bv: -0.2, spectralClass: 'O9.5I' },
  { name: 'Dubhe', raHours: 11.0621, decDegrees: 61.751, magnitude: 1.79, bv: 1.07, spectralClass: 'K0III' },
  { name: 'Mirfak', raHours: 3.4054, decDegrees: 49.8612, magnitude: 1.79, bv: 0.48, spectralClass: 'F5Ib' },
  { name: 'Wezen', raHours: 7.1399, decDegrees: -26.3932, magnitude: 1.83, bv: 0.68, spectralClass: 'F8Ia' },
  { name: 'Sargas', raHours: 17.622, decDegrees: -42.9978, magnitude: 1.86, bv: 0.4, spectralClass: 'F1II' },
  { name: 'Kaus Australis', raHours: 18.4029, decDegrees: -34.3846, magnitude: 1.85, bv: -0.03, spectralClass: 'B9.5III' },
  { name: 'Avior', raHours: 8.3752, decDegrees: -59.5095, magnitude: 1.86, bv: 1.22, spectralClass: 'K3III' },
  { name: 'Alkaid', raHours: 13.7923, decDegrees: 49.3133, magnitude: 1.86, bv: -0.19, spectralClass: 'B3V' },
  { name: 'Menkalinan', raHours: 5.9921, decDegrees: 44.9474, magnitude: 1.9, bv: 0.01, spectralClass: 'A2IV' },
  { name: 'Atria', raHours: 16.8111, decDegrees: -69.0277, magnitude: 1.91, bv: 1.44, spectralClass: 'K2II' },
  { name: 'Alhena', raHours: 6.6285, decDegrees: 16.3993, magnitude: 1.93, bv: 0, spectralClass: 'A1IV' },
  { name: 'Peacock', raHours: 20.4275, decDegrees: -56.7351, magnitude: 1.94, bv: -0.2, spectralClass: 'B2IV' },
  { name: 'Mirzam', raHours: 6.3783, decDegrees: -17.9559, magnitude: 1.98, bv: -0.24, spectralClass: 'B1II' },
  { name: 'Polaris', raHours: 2.5303, decDegrees: 89.2641, magnitude: 1.98, bv: 0.6, spectralClass: 'F7Ib' },
  { name: 'Hamal', raHours: 2.1195, decDegrees: 23.4624, magnitude: 2, bv: 1.15, spectralClass: 'K2III' },
  { name: 'Alphard', raHours: 9.4598, decDegrees: -8.6586, magnitude: 1.99, bv: 1.44, spectralClass: 'K3II' },
  { name: 'Diphda', raHours: 0.7265, decDegrees: -17.9866, magnitude: 2.04, bv: 1.02, spectralClass: 'K0III' },
  { name: 'Nunki', raHours: 18.9211, decDegrees: -26.2967, magnitude: 2.05, bv: -0.13, spectralClass: 'B2.5V' },
  { name: 'Algol', raHours: 3.1361, decDegrees: 40.9556, magnitude: 2.09, bv: -0.05, spectralClass: 'B8V' },
];
