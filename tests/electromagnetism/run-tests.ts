import assert from 'node:assert/strict';
import { choosePotentialLevels, traceContours } from '../../src/lib/electromagnetism/contours.ts';
import { buildTerrain, terrainHeight, ELEVATION_LEVELS } from '../../src/lib/electromagnetism/terrain.ts';
import {
  COULOMB_K,
  coulombFieldAt,
  conductivity,
  driftVelocity,
  fieldMagnitude,
  parallelResistance,
  pointPotential,
  potentialAt,
  seriesResistance,
  type PointCharge,
} from '../../src/lib/electromagnetism/index.ts';

const near = (actual: number, expected: number, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be near ${expected}`);
};

// Field of a point charge scales linearly with q and as 1/r².
near(fieldMagnitude(2e-6, 0.5), 2 * fieldMagnitude(1e-6, 0.5));
near(fieldMagnitude(1e-6, 0.25), 4 * fieldMagnitude(1e-6, 0.5));
near(fieldMagnitude(2e-6, 0.5), (COULOMB_K * 2e-6) / 0.25);

// Potential of a point charge: V = kQ/r, sign tracks the charge.
near(pointPotential(3e-6, 0.25), (COULOMB_K * 3e-6) / 0.25);
assert.ok(pointPotential(-1e-6, 0.5) < 0, 'negative charge gives negative potential');

// Superposition: two equal like charges placed symmetrically about a midpoint
// produce a net field that cancels at the midpoint.
const likeCharges: PointCharge[] = [
  { x: -10, y: 0, q: 1e-6 },
  { x: 10, y: 0, q: 1e-6 },
];
const midField = coulombFieldAt(likeCharges, 0, 0, 0);
near(midField.x, 0);
near(midField.y, 0);

// A dipole (+q, -q) has zero potential on the perpendicular bisector midpoint.
const dipole: PointCharge[] = [
  { x: -10, y: 0, q: 1e-6 },
  { x: 10, y: 0, q: -1e-6 },
];
near(potentialAt(dipole, 0, 0, 0), 0);

// Drude drift opposes the field and matches v_d = -eEτ/mₑ.
const vd = driftVelocity(1.0, 2.5e-14);
assert.ok(vd < 0, 'electron drift is opposite a positive field');
near(vd, -(1.602e-19 * 1.0 * 2.5e-14) / 9.109e-31, 1e-12);

// Conductivity is positive and grows with the collision time τ.
assert.ok(conductivity(8.5e28, 2.5e-14) > 0);
assert.ok(conductivity(8.5e28, 5e-14) > conductivity(8.5e28, 2.5e-14));

// Series and parallel resistance identities.
near(seriesResistance([30, 60]), 90);
near(parallelResistance([30, 60]), 20);
near(parallelResistance([10, 10, 10]), 10 / 3, 1e-9);

// Linear, signed voltage intervals are robust to charge singularities.
for (const sign of [-1, 1]) {
  const values = Array.from({ length: 1000 }, (_, i) => sign * i);
  values.push(sign * 1e12, NaN, Infinity);
  const { step, levels } = choosePotentialLevels(values);
  assert.ok(levels.length > 2 && levels.length <= 15);
  assert.ok(step < 1000, 'one extreme value must not set the interval');
  for (let i = 1; i < levels.length; i++) near(levels[i] - levels[i - 1], step);
  assert.ok(levels.every(v => v * sign >= 0));
}
assert.deepEqual(choosePotentialLevels([0, 0, NaN]).levels, []);
assert.deepEqual(choosePotentialLevels([50, 50, 50]).levels, []);
assert.deepEqual(choosePotentialLevels([]).levels, []);
const signed = choosePotentialLevels(Array.from({ length: 1001 }, (_, i) => i - 500));
assert.ok(signed.levels.includes(0));
assert.equal(signed.levels[0], -signed.levels.at(-1)!);
const mobileLevels = choosePotentialLevels(Array.from({ length: 1001 }, (_, i) => i - 500), 4);
assert.ok(mobileLevels.levels.length <= 9);
assert.ok(mobileLevels.step >= signed.step);

// A linear field has straight, correctly positioned contours, even at vertices.
const ramp = Array.from({ length: 25 }, (_, i) => (i % 5) + 2 * Math.floor(i / 5));
for (const contour of traceContours(ramp, 5, 5, 4, 4, [2, 4, 6])) {
  assert.ok(contour.segments.length > 0);
  for (const segment of contour.segments) for (const [x, y] of segment) near(x + 2 * y, contour.level);
}
assert.equal(traceContours([NaN, 1, 0, 1], 2, 2, 1, 1, [0.5])[0].segments.length, 0);
assert.equal(traceContours([0, 0, 0, 0], 2, 2, 1, 1, [0])[0].segments.length, 0);
assert.throws(() => traceContours([1], 1, 1, 1, 1, [0]));
assert.equal(traceContours([1, -1, -1, 1], 2, 2, 1, 1, [0])[0].segments.length, 2);

// Monopole contours follow r = kq/V; dipole's zero contour is the bisector.
const n = 101, span = 400;
const sampled = (fn: (x: number, y: number) => number) => Array.from({ length: n * n }, (_, i) =>
  fn((i % n) * span / (n - 1) - 200, Math.floor(i / n) * span / (n - 1) - 200));
for (const contour of traceContours(sampled((x, y) => 9000 / Math.sqrt(x * x + y * y + 25)), n, n, span, span, [100, 150, 200])) {
  for (const segment of contour.segments) for (const [x, y] of segment) {
    near(Math.hypot(x - 200, y - 200), Math.sqrt((9000 / contour.level) ** 2 - 25), 0.2);
  }
}
const zero = traceContours(sampled((x, y) => 9000 / Math.hypot(x + 60, y, 5) - 9000 / Math.hypot(x - 60, y, 5)), n, n, span, span, [0])[0];
assert.ok(zero.segments.length > 0);
for (const segment of zero.segments) for (const [x] of segment) near(x, 200);

// Every terrain contour lies on the same height field as the 3D mesh.
const terrain = buildTerrain();
assert.deepEqual(terrain.contours.map(c => c.level), ELEVATION_LEVELS);
for (const contour of terrain.contours) {
  assert.ok(contour.segments.length > 0);
  for (const segment of contour.segments) for (const [x, z] of segment) {
    near(terrainHeight(x - 1000, z - 800), contour.level, 1);
  }
  // All contours are closed: every endpoint connects to one other segment.
  const endpoints = new Map<string, number>();
  for (const segment of contour.segments) for (const p of segment) {
    const key = p.map(v => v.toFixed(6)).join(',');
    endpoints.set(key, (endpoints.get(key) ?? 0) + 1);
  }
  assert.ok([...endpoints.values()].every(count => count === 2));
}
console.log('electromagnetism tests passed');
