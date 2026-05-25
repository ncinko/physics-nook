export const DEFAULT_HBAR = 1;
export const DEFAULT_MASS = 1;

export interface ComplexField {
  re: Float64Array;
  im: Float64Array;
}

export interface ComplexField1D extends ComplexField {
  count: number;
  dx: number;
  xMin: number;
}

export interface ComplexField2D extends ComplexField {
  width: number;
  height: number;
  dx: number;
  dy: number;
  xMin: number;
  yMin: number;
}

export interface SplitStepOptions {
  dt: number;
  hbar?: number;
  mass?: number;
  absorber?: Float64Array;
}

export interface GaussianPacket1DOptions {
  count: number;
  xMin: number;
  xMax: number;
  x0: number;
  sigma: number;
  k0: number;
}

export interface GaussianPacket2DOptions {
  width: number;
  height: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  x0: number;
  y0: number;
  sigmaX: number;
  sigmaY: number;
  kx: number;
  ky?: number;
}

export type Quantum2DPresetId =
  | 'double-slit'
  | 'single-slit'
  | 'free-packet'
  | 'finite-barrier';

export interface Quantum2DPresetControls {
  size?: number;
  wavelength?: number;
  packetWidth?: number;
  potentialStrength?: number;
  slitSeparation?: number;
  slitWidth?: number;
}

export interface Quantum2DPreset {
  id: Quantum2DPresetId;
  title: string;
  description: string;
  field: ComplexField2D;
  potential: Float64Array;
  absorber: Float64Array;
  dt: number;
  barrierX: number | null;
}

const TWO_PI = Math.PI * 2;

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const isPowerOfTwo = (value: number) => value > 0 && (value & (value - 1)) === 0;

const assertPowerOfTwo = (value: number, label: string) => {
  if (!isPowerOfTwo(value)) {
    throw new Error(`${label} must be a power of two.`);
  }
};

const assertSameLength = (re: Float64Array, im: Float64Array) => {
  if (re.length !== im.length) {
    throw new Error('Real and imaginary arrays must have the same length.');
  }
};

export const createComplexField = (length: number): ComplexField => ({
  re: new Float64Array(length),
  im: new Float64Array(length),
});

export const cloneComplexField = <T extends ComplexField>(field: T): T => ({
  ...field,
  re: new Float64Array(field.re),
  im: new Float64Array(field.im),
});

export const probabilityAt = (re: Float64Array, im: Float64Array, index: number) =>
  re[index] * re[index] + im[index] * im[index];

export const totalProbability1D = (field: ComplexField1D) => {
  let sum = 0;

  for (let index = 0; index < field.count; index += 1) {
    sum += probabilityAt(field.re, field.im, index);
  }

  return sum * field.dx;
};

export const totalProbability2D = (field: ComplexField2D) => {
  let sum = 0;

  for (let index = 0; index < field.re.length; index += 1) {
    sum += probabilityAt(field.re, field.im, index);
  }

  return sum * field.dx * field.dy;
};

export const normalize1D = (field: ComplexField1D) => {
  const total = totalProbability1D(field);

  if (total <= 0) {
    return field;
  }

  const scale = 1 / Math.sqrt(total);

  for (let index = 0; index < field.count; index += 1) {
    field.re[index] *= scale;
    field.im[index] *= scale;
  }

  return field;
};

export const normalize2D = (field: ComplexField2D) => {
  const total = totalProbability2D(field);

  if (total <= 0) {
    return field;
  }

  const scale = 1 / Math.sqrt(total);

  for (let index = 0; index < field.re.length; index += 1) {
    field.re[index] *= scale;
    field.im[index] *= scale;
  }

  return field;
};

export const expectationX1D = (field: ComplexField1D) => {
  let weighted = 0;
  let total = 0;

  for (let index = 0; index < field.count; index += 1) {
    const x = field.xMin + index * field.dx;
    const probability = probabilityAt(field.re, field.im, index);
    weighted += x * probability;
    total += probability;
  }

  return total > 0 ? weighted / total : field.xMin;
};

export const varianceX1D = (field: ComplexField1D) => {
  const mean = expectationX1D(field);
  let weighted = 0;
  let total = 0;

  for (let index = 0; index < field.count; index += 1) {
    const x = field.xMin + index * field.dx;
    const probability = probabilityAt(field.re, field.im, index);
    weighted += (x - mean) * (x - mean) * probability;
    total += probability;
  }

  return total > 0 ? weighted / total : 0;
};

export const probabilityInRegion1D = (field: ComplexField1D, from: number, to: number) => {
  let sum = 0;

  for (let index = 0; index < field.count; index += 1) {
    const x = field.xMin + index * field.dx;

    if (x >= from && x <= to) {
      sum += probabilityAt(field.re, field.im, index);
    }
  }

  return sum * field.dx;
};

export const probabilityByPredicate2D = (
  field: ComplexField2D,
  predicate: (x: number, y: number, index: number) => boolean,
) => {
  let sum = 0;

  for (let yIndex = 0; yIndex < field.height; yIndex += 1) {
    const y = field.yMin + yIndex * field.dy;

    for (let xIndex = 0; xIndex < field.width; xIndex += 1) {
      const x = field.xMin + xIndex * field.dx;
      const index = yIndex * field.width + xIndex;

      if (predicate(x, y, index)) {
        sum += probabilityAt(field.re, field.im, index);
      }
    }
  }

  return sum * field.dx * field.dy;
};

export const analyticFreeGaussianSigma = (
  sigma0: number,
  time: number,
  mass = DEFAULT_MASS,
  hbar = DEFAULT_HBAR,
) => sigma0 * Math.sqrt(1 + (hbar * time / (2 * mass * sigma0 * sigma0)) ** 2);

export const createGaussianPacket1D = ({
  count,
  xMin,
  xMax,
  x0,
  sigma,
  k0,
}: GaussianPacket1DOptions): ComplexField1D => {
  const dx = (xMax - xMin) / count;
  const field: ComplexField1D = {
    ...createComplexField(count),
    count,
    dx,
    xMin,
  };

  for (let index = 0; index < count; index += 1) {
    const x = xMin + index * dx;
    const envelope = Math.exp(-((x - x0) * (x - x0)) / (4 * sigma * sigma));
    const phase = k0 * x;
    field.re[index] = envelope * Math.cos(phase);
    field.im[index] = envelope * Math.sin(phase);
  }

  return normalize1D(field);
};

export const createGaussianPacket2D = ({
  width,
  height,
  xMin,
  xMax,
  yMin,
  yMax,
  x0,
  y0,
  sigmaX,
  sigmaY,
  kx,
  ky = 0,
}: GaussianPacket2DOptions): ComplexField2D => {
  const dx = (xMax - xMin) / width;
  const dy = (yMax - yMin) / height;
  const field: ComplexField2D = {
    ...createComplexField(width * height),
    width,
    height,
    dx,
    dy,
    xMin,
    yMin,
  };

  for (let yIndex = 0; yIndex < height; yIndex += 1) {
    const y = yMin + yIndex * dy;

    for (let xIndex = 0; xIndex < width; xIndex += 1) {
      const x = xMin + xIndex * dx;
      const index = yIndex * width + xIndex;
      const xEnvelope = ((x - x0) * (x - x0)) / (4 * sigmaX * sigmaX);
      const yEnvelope = ((y - y0) * (y - y0)) / (4 * sigmaY * sigmaY);
      const envelope = Math.exp(-(xEnvelope + yEnvelope));
      const phase = kx * x + ky * y;
      field.re[index] = envelope * Math.cos(phase);
      field.im[index] = envelope * Math.sin(phase);
    }
  }

  return normalize2D(field);
};

export const buildSquareBarrier1D = (
  count: number,
  xMin: number,
  dx: number,
  from: number,
  to: number,
  height: number,
) => {
  const potential = new Float64Array(count);

  for (let index = 0; index < count; index += 1) {
    const x = xMin + index * dx;
    potential[index] = x >= from && x <= to ? height : 0;
  }

  return potential;
};

export const buildAbsorbingMask1D = (count: number, widthCells = 18, strength = 0.18) => {
  const mask = new Float64Array(count);

  for (let index = 0; index < count; index += 1) {
    const left = index;
    const right = count - 1 - index;
    const edgeDistance = Math.min(left, right);

    if (edgeDistance >= widthCells) {
      mask[index] = 1;
      continue;
    }

    const depth = (widthCells - edgeDistance) / widthCells;
    mask[index] = Math.exp(-strength * depth * depth);
  }

  return mask;
};

export const buildAbsorbingMask2D = (
  width: number,
  height: number,
  widthCells = 14,
  strength = 0.12,
) => {
  const mask = new Float64Array(width * height);

  for (let yIndex = 0; yIndex < height; yIndex += 1) {
    for (let xIndex = 0; xIndex < width; xIndex += 1) {
      const left = xIndex;
      const right = width - 1 - xIndex;
      const top = yIndex;
      const bottom = height - 1 - yIndex;
      const edgeDistance = Math.min(left, right, top, bottom);
      const index = yIndex * width + xIndex;

      if (edgeDistance >= widthCells) {
        mask[index] = 1;
        continue;
      }

      const depth = (widthCells - edgeDistance) / widthCells;
      mask[index] = Math.exp(-strength * depth * depth);
    }
  }

  return mask;
};

const applyAbsorber = (field: ComplexField, absorber?: Float64Array) => {
  if (!absorber) {
    return;
  }

  for (let index = 0; index < field.re.length; index += 1) {
    field.re[index] *= absorber[index];
    field.im[index] *= absorber[index];
  }
};

const applyPotentialPhase = (
  field: ComplexField,
  potential: Float64Array,
  phaseScale: number,
) => {
  for (let index = 0; index < field.re.length; index += 1) {
    const value = potential[index];

    if (value === 0) {
      continue;
    }

    const angle = -value * phaseScale;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const re = field.re[index];
    const im = field.im[index];
    field.re[index] = re * cos - im * sin;
    field.im[index] = re * sin + im * cos;
  }
};

const waveNumberForIndex = (index: number, count: number, spacing: number) => {
  const mode = index <= count / 2 ? index : index - count;
  return (TWO_PI * mode) / (count * spacing);
};

export const fftRadix2 = (re: Float64Array, im: Float64Array, inverse = false) => {
  assertSameLength(re, im);
  const count = re.length;
  assertPowerOfTwo(count, 'FFT length');

  let swapIndex = 0;

  for (let index = 1; index < count; index += 1) {
    let bit = count >> 1;

    while ((swapIndex & bit) !== 0) {
      swapIndex ^= bit;
      bit >>= 1;
    }

    swapIndex ^= bit;

    if (index < swapIndex) {
      const reTemp = re[index];
      const imTemp = im[index];
      re[index] = re[swapIndex];
      im[index] = im[swapIndex];
      re[swapIndex] = reTemp;
      im[swapIndex] = imTemp;
    }
  }

  for (let length = 2; length <= count; length <<= 1) {
    const halfLength = length >> 1;
    const angle = (inverse ? TWO_PI : -TWO_PI) / length;
    const lengthCos = Math.cos(angle);
    const lengthSin = Math.sin(angle);

    for (let start = 0; start < count; start += length) {
      let twiddleRe = 1;
      let twiddleIm = 0;

      for (let offset = 0; offset < halfLength; offset += 1) {
        const evenIndex = start + offset;
        const oddIndex = evenIndex + halfLength;
        const oddRe = re[oddIndex] * twiddleRe - im[oddIndex] * twiddleIm;
        const oddIm = re[oddIndex] * twiddleIm + im[oddIndex] * twiddleRe;
        const evenRe = re[evenIndex];
        const evenIm = im[evenIndex];

        re[evenIndex] = evenRe + oddRe;
        im[evenIndex] = evenIm + oddIm;
        re[oddIndex] = evenRe - oddRe;
        im[oddIndex] = evenIm - oddIm;

        const nextTwiddleRe = twiddleRe * lengthCos - twiddleIm * lengthSin;
        twiddleIm = twiddleRe * lengthSin + twiddleIm * lengthCos;
        twiddleRe = nextTwiddleRe;
      }
    }
  }

  if (inverse) {
    const scale = 1 / count;

    for (let index = 0; index < count; index += 1) {
      re[index] *= scale;
      im[index] *= scale;
    }
  }
};

export const fft2D = (
  re: Float64Array,
  im: Float64Array,
  width: number,
  height: number,
  inverse = false,
) => {
  assertSameLength(re, im);
  assertPowerOfTwo(width, 'FFT width');
  assertPowerOfTwo(height, 'FFT height');

  const rowRe = new Float64Array(width);
  const rowIm = new Float64Array(width);

  for (let yIndex = 0; yIndex < height; yIndex += 1) {
    const rowStart = yIndex * width;

    for (let xIndex = 0; xIndex < width; xIndex += 1) {
      rowRe[xIndex] = re[rowStart + xIndex];
      rowIm[xIndex] = im[rowStart + xIndex];
    }

    fftRadix2(rowRe, rowIm, inverse);

    for (let xIndex = 0; xIndex < width; xIndex += 1) {
      re[rowStart + xIndex] = rowRe[xIndex];
      im[rowStart + xIndex] = rowIm[xIndex];
    }
  }

  const columnRe = new Float64Array(height);
  const columnIm = new Float64Array(height);

  for (let xIndex = 0; xIndex < width; xIndex += 1) {
    for (let yIndex = 0; yIndex < height; yIndex += 1) {
      const index = yIndex * width + xIndex;
      columnRe[yIndex] = re[index];
      columnIm[yIndex] = im[index];
    }

    fftRadix2(columnRe, columnIm, inverse);

    for (let yIndex = 0; yIndex < height; yIndex += 1) {
      const index = yIndex * width + xIndex;
      re[index] = columnRe[yIndex];
      im[index] = columnIm[yIndex];
    }
  }
};

export const splitStep1D = (
  field: ComplexField1D,
  potential: Float64Array,
  { absorber, dt, hbar = DEFAULT_HBAR, mass = DEFAULT_MASS }: SplitStepOptions,
) => {
  if (potential.length !== field.count) {
    throw new Error('1D potential length must match the field sample count.');
  }

  applyPotentialPhase(field, potential, dt / (2 * hbar));
  fftRadix2(field.re, field.im, false);

  for (let index = 0; index < field.count; index += 1) {
    const k = waveNumberForIndex(index, field.count, field.dx);
    const angle = -(hbar * k * k * dt) / (2 * mass);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const re = field.re[index];
    const im = field.im[index];
    field.re[index] = re * cos - im * sin;
    field.im[index] = re * sin + im * cos;
  }

  fftRadix2(field.re, field.im, true);
  applyPotentialPhase(field, potential, dt / (2 * hbar));
  applyAbsorber(field, absorber);

  return field;
};

export const splitStep2D = (
  field: ComplexField2D,
  potential: Float64Array,
  { absorber, dt, hbar = DEFAULT_HBAR, mass = DEFAULT_MASS }: SplitStepOptions,
) => {
  if (potential.length !== field.width * field.height) {
    throw new Error('2D potential length must match the field grid.');
  }

  applyPotentialPhase(field, potential, dt / (2 * hbar));
  fft2D(field.re, field.im, field.width, field.height, false);

  for (let yIndex = 0; yIndex < field.height; yIndex += 1) {
    const ky = waveNumberForIndex(yIndex, field.height, field.dy);

    for (let xIndex = 0; xIndex < field.width; xIndex += 1) {
      const kx = waveNumberForIndex(xIndex, field.width, field.dx);
      const index = yIndex * field.width + xIndex;
      const angle = -(hbar * (kx * kx + ky * ky) * dt) / (2 * mass);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const re = field.re[index];
      const im = field.im[index];
      field.re[index] = re * cos - im * sin;
      field.im[index] = re * sin + im * cos;
    }
  }

  fft2D(field.re, field.im, field.width, field.height, true);
  applyPotentialPhase(field, potential, dt / (2 * hbar));
  applyAbsorber(field, absorber);

  return field;
};

export const buildVerticalBarrierPotential2D = ({
  width,
  height,
  barrierX,
  thickness,
  barrierHeight,
  yMin,
  dy,
  slits = [],
}: {
  width: number;
  height: number;
  barrierX: number;
  thickness: number;
  barrierHeight: number;
  yMin: number;
  dy: number;
  slits?: Array<{ center: number; width: number }>;
}) => {
  const potential = new Float64Array(width * height);
  const halfThickness = Math.max(1, Math.round(thickness / 2));

  for (let yIndex = 0; yIndex < height; yIndex += 1) {
    const y = yMin + yIndex * dy;
    const open = slits.some((slit) => Math.abs(y - slit.center) <= slit.width / 2);

    if (open) {
      continue;
    }

    for (
      let xIndex = Math.max(0, barrierX - halfThickness);
      xIndex <= Math.min(width - 1, barrierX + halfThickness);
      xIndex += 1
    ) {
      potential[yIndex * width + xIndex] = barrierHeight;
    }
  }

  return potential;
};

const getPresetDomain = (size: number) => {
  const yMin = -6;
  const yMax = 6;
  const height = size;
  const width = size * 2;
  const spacing = (yMax - yMin) / height;

  return {
    width,
    height,
    xMin: 0,
    xMax: width * spacing,
    yMin,
    yMax,
  };
};

export const createQuantum2DPreset = (
  id: Quantum2DPresetId,
  controls: Quantum2DPresetControls = {},
): Quantum2DPreset => {
  const size = controls.size ?? 128;
  assertPowerOfTwo(size, 'Preset grid size');

  const domain = getPresetDomain(size);
  assertPowerOfTwo(domain.width, 'Preset grid width');
  assertPowerOfTwo(domain.height, 'Preset grid height');
  const dx = (domain.xMax - domain.xMin) / domain.width;
  const dy = (domain.yMax - domain.yMin) / domain.height;
  const xIndexFor = (x: number) =>
    clamp(Math.round((x - domain.xMin) / dx), 0, domain.width - 1);
  const wavelength = controls.wavelength ?? 1.55;
  const kx = TWO_PI / wavelength;
  const packetWidth = controls.packetWidth ?? 0.72;
  const absorber = buildAbsorbingMask2D(
    domain.width,
    domain.height,
    Math.max(14, Math.round(size / 6)),
    0.08,
  );

  if (id === 'free-packet') {
    const field = createGaussianPacket2D({
      ...domain,
      x0: 3.1,
      y0: -0.6,
      sigmaX: packetWidth,
      sigmaY: packetWidth,
      kx,
      ky: 0.45,
    });

    return {
      id,
      title: 'Free Packet Spreading',
      description: 'A localized packet travels and disperses with no potential in its path.',
      field,
      potential: new Float64Array(domain.width * domain.height),
      absorber,
      dt: 0.006,
      barrierX: null,
    };
  }

  if (id === 'finite-barrier') {
    const barrierX = xIndexFor(6.25);
    const barrierHeight = controls.potentialStrength ?? 7.6;
    const field = createGaussianPacket2D({
      ...domain,
      x0: 2.4,
      y0: 0,
      sigmaX: packetWidth * 0.95,
      sigmaY: packetWidth * 1.35,
      kx,
    });

    return {
      id,
      title: 'Finite Barrier / Tunneling',
      description: 'A packet partially reflects and partially leaks through a finite barrier.',
      field,
      potential: buildVerticalBarrierPotential2D({
        width: domain.width,
        height: domain.height,
        barrierX,
        thickness: Math.max(2, Math.round(size * 0.03)),
        barrierHeight,
        yMin: domain.yMin,
        dy,
      }),
      absorber,
      dt: 0.005,
      barrierX: domain.xMin + barrierX * dx,
    };
  }

  const barrierX = xIndexFor(5.05);
  const slitWidth = controls.slitWidth ?? 0.82;
  const slitSeparation = controls.slitSeparation ?? 2.05;
  const wallHeight = controls.potentialStrength ?? 90;
  const slits =
    id === 'single-slit'
      ? [{ center: 0, width: slitWidth }]
      : [
          { center: -slitSeparation / 2, width: slitWidth },
          { center: slitSeparation / 2, width: slitWidth },
        ];
  const field = createGaussianPacket2D({
    ...domain,
    x0: 1.95,
    y0: 0,
    sigmaX: 0.82,
    sigmaY: 4.2,
    kx,
  });

  return {
    id,
    title: id === 'single-slit' ? 'Single Slit Diffraction' : 'Double Slit Plane Wave',
    description:
      id === 'single-slit'
        ? 'A broad wavefront diffracts through one aperture.'
        : 'A broad wavefront passes through two apertures and builds an interference field.',
    field,
    potential: buildVerticalBarrierPotential2D({
      width: domain.width,
      height: domain.height,
      barrierX,
      thickness: Math.max(2, Math.round(size * 0.025)),
      barrierHeight: wallHeight,
      yMin: domain.yMin,
      dy,
      slits,
    }),
    absorber,
    dt: 0.0045,
    barrierX: domain.xMin + barrierX * dx,
  };
};
