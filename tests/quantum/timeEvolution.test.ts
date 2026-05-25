import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyticFreeGaussianSigma,
  buildAbsorbingMask1D,
  buildSquareBarrier1D,
  createGaussianPacket1D,
  createQuantum2DPreset,
  fftRadix2,
  probabilityInRegion1D,
  splitStep1D,
  totalProbability1D,
  totalProbability2D,
  varianceX1D,
} from '../../src/lib/quantum/timeEvolution.ts';

const maxError = (actual: Float64Array, expected: Float64Array) =>
  actual.reduce((peak, value, index) => Math.max(peak, Math.abs(value - expected[index])), 0);

test('radix-2 FFT round trip restores complex samples', () => {
  const re = Float64Array.from({ length: 16 }, (_, index) => Math.sin(index * 0.7) + index / 13);
  const im = Float64Array.from({ length: 16 }, (_, index) => Math.cos(index * 0.4) - index / 19);
  const originalRe = new Float64Array(re);
  const originalIm = new Float64Array(im);

  fftRadix2(re, im, false);
  fftRadix2(re, im, true);

  assert.ok(maxError(re, originalRe) < 1e-10);
  assert.ok(maxError(im, originalIm) < 1e-10);
});

test('free split-step evolution conserves one-dimensional probability without absorbers', () => {
  const field = createGaussianPacket1D({
    count: 256,
    xMin: -8,
    xMax: 8,
    x0: -2,
    sigma: 0.7,
    k0: 2.4,
  });
  const potential = new Float64Array(field.count);
  const initial = totalProbability1D(field);

  for (let index = 0; index < 120; index += 1) {
    splitStep1D(field, potential, { dt: 0.01 });
  }

  assert.ok(Math.abs(totalProbability1D(field) - initial) < 1e-8);
});

test('absorbing mask only decreases total probability', () => {
  const field = createGaussianPacket1D({
    count: 256,
    xMin: -8,
    xMax: 8,
    x0: 4.3,
    sigma: 0.7,
    k0: 4.2,
  });
  const potential = new Float64Array(field.count);
  const absorber = buildAbsorbingMask1D(field.count, 30, 0.12);
  const initial = totalProbability1D(field);

  for (let index = 0; index < 240; index += 1) {
    splitStep1D(field, potential, { absorber, dt: 0.01 });
  }

  const final = totalProbability1D(field);
  assert.ok(final <= initial + 1e-10);
  assert.ok(final < initial - 0.02);
});

test('free Gaussian packet width follows the analytic dispersion scale', () => {
  const sigma0 = 0.75;
  const totalTime = 1.2;
  const steps = 200;
  const field = createGaussianPacket1D({
    count: 512,
    xMin: -16,
    xMax: 16,
    x0: -1.5,
    sigma: sigma0,
    k0: 0,
  });
  const potential = new Float64Array(field.count);

  for (let index = 0; index < steps; index += 1) {
    splitStep1D(field, potential, { dt: totalTime / steps });
  }

  const measuredSigma = Math.sqrt(varianceX1D(field));
  const expectedSigma = analyticFreeGaussianSigma(sigma0, totalTime);
  assert.ok(Math.abs(measuredSigma - expectedSigma) < 0.06);
});

test('finite barrier scattering keeps reflected, transmitted, and absorbed probability accounted for', () => {
  const field = createGaussianPacket1D({
    count: 512,
    xMin: -14,
    xMax: 14,
    x0: -6.5,
    sigma: 0.68,
    k0: 3.2,
  });
  const barrierFrom = 0;
  const barrierTo = 0.75;
  const potential = buildSquareBarrier1D(
    field.count,
    field.xMin,
    field.dx,
    barrierFrom,
    barrierTo,
    6.8,
  );
  const absorber = buildAbsorbingMask1D(field.count, 38, 0.08);

  for (let index = 0; index < 900; index += 1) {
    splitStep1D(field, potential, { absorber, dt: 0.004 });
  }

  const total = totalProbability1D(field);
  const absorbed = 1 - total;
  const reflected = probabilityInRegion1D(field, field.xMin + 1.6, barrierFrom - 0.2);
  const nearBarrier = probabilityInRegion1D(field, barrierFrom - 0.2, barrierTo + 0.2);
  const transmitted = probabilityInRegion1D(field, barrierTo + 0.2, 12.4);
  const accounted = reflected + nearBarrier + transmitted + absorbed;

  assert.ok(reflected > 0.02);
  assert.ok(transmitted > 0.02);
  assert.ok(absorbed >= 0);
  assert.ok(Math.abs(accounted - 1) < 0.06);
});

test('2D preset builders create normalized fields and matching masks', () => {
  const presetIds = ['double-slit', 'single-slit', 'free-packet', 'finite-barrier'] as const;

  for (const id of presetIds) {
    const preset = createQuantum2DPreset(id, { size: 64 });
    const sampleCount = preset.field.width * preset.field.height;

    assert.equal(preset.field.width, 128);
    assert.equal(preset.field.height, 64);
    assert.equal(sampleCount, 128 * 64);
    assert.equal(preset.field.dx, preset.field.dy);
    assert.equal(preset.potential.length, sampleCount);
    assert.equal(preset.absorber.length, sampleCount);
    assert.ok(Math.abs(totalProbability2D(preset.field) - 1) < 1e-9);

    const potentialPeak = Math.max(...preset.potential);

    if (id === 'free-packet') {
      assert.equal(potentialPeak, 0);
    } else {
      assert.ok(potentialPeak > 0);
      assert.ok(preset.potential.some((value) => value === 0));
    }
  }
});
