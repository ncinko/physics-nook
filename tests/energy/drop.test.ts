import assert from 'node:assert/strict';
import test from 'node:test';
import {
  G,
  kineticEnergy,
  mechanicalEnergy,
  potentialEnergy,
  speedAfterFall,
  stepFall,
  type DropState,
} from '../../src/lib/energy/drop.ts';

test('kinetic energy follows 1/2 m v^2', () => {
  assert.equal(kineticEnergy(2, 0), 0);
  assert.equal(kineticEnergy(2, 3), 9);
  // Doubling speed quadruples kinetic energy.
  assert.equal(kineticEnergy(2, 6), 4 * kineticEnergy(2, 3));
});

test('potential energy follows m g h and scales with mass and height', () => {
  assert.equal(potentialEnergy(2, 0), 0);
  assert.ok(Math.abs(potentialEnergy(2, 3) - 2 * G * 3) < 1e-9);
  assert.equal(potentialEnergy(4, 3), 2 * potentialEnergy(2, 3));
});

test('a dropped object converts potential energy into kinetic energy', () => {
  const mass = 2;
  const dropHeight = 5;
  // At the top: all potential, no kinetic.
  assert.equal(speedAfterFall(dropHeight, dropHeight), 0);
  // Halfway down, the kinetic energy gained equals the potential energy lost.
  const half = dropHeight / 2;
  const v = speedAfterFall(dropHeight, half);
  const ke = kineticEnergy(mass, v);
  const peLost = potentialEnergy(mass, dropHeight) - potentialEnergy(mass, half);
  assert.ok(Math.abs(ke - peLost) < 1e-9);
});

test('free fall with a lossless bounce conserves total mechanical energy', () => {
  const mass = 2;
  const releaseHeight = 4;
  let state: DropState = { height: releaseHeight, velocity: 0 };
  const e0 = mechanicalEnergy({ mass, height: state.height, speed: state.velocity });

  let maxError = 0;
  for (let i = 0; i < 2000; i += 1) {
    state = stepFall(state, 1 / 240, { releaseHeight });
    const e = mechanicalEnergy({ mass, height: state.height, speed: state.velocity });
    maxError = Math.max(maxError, Math.abs(e - e0));
    assert.ok(state.height >= -1e-9 && state.height <= releaseHeight + 1e-6);
  }
  // Energy stays within a small band of its initial value across many bounces.
  assert.ok(maxError < e0 * 0.02, `energy drift ${maxError} exceeded tolerance`);
});

test('the bounce sends the object back up toward its release height', () => {
  const releaseHeight = 3;
  // A step that lands exactly on the ground should rebound upward.
  const landed = stepFall({ height: 0.001, velocity: -7 }, 1 / 60, { releaseHeight });
  assert.equal(landed.height, 0);
  assert.ok(landed.velocity > 0, 'velocity should reverse to point up');
  // Rebound speed corresponds to the full release-height energy.
  assert.ok(Math.abs(landed.velocity - Math.sqrt(2 * G * releaseHeight)) < 1e-9);
});
