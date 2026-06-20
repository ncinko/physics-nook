import assert from 'node:assert/strict';
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

console.log('electromagnetism tests passed');
