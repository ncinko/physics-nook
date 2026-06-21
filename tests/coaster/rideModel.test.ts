import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GRAVITY,
  INITIAL_SPEED,
  MAX_SPEED,
  energy,
  gForces,
  stepRideSpeed,
} from '../../src/lib/coaster/rideModel.ts';

const dt = 1 / 120;

test('a downhill slope speeds the cart up and an uphill slope slows it down', () => {
  const downhill = stepRideSpeed({ speed: INITIAL_SPEED, slopeY: -0.5, dt });
  const uphill = stepRideSpeed({ speed: INITIAL_SPEED, slopeY: 0.5, dt });
  assert.ok(downhill > INITIAL_SPEED, 'downhill should accelerate');
  assert.ok(uphill < INITIAL_SPEED, 'uphill should decelerate');
});

test('friction opposes motion on a level section', () => {
  const next = stepRideSpeed({ speed: INITIAL_SPEED, slopeY: 0, dt });
  assert.ok(next < INITIAL_SPEED, 'friction should bleed speed when level');
  assert.ok(next > 0, 'a single step should not reverse the cart');
});

test('a brake removes speed faster than rolling friction alone', () => {
  const rolling = stepRideSpeed({ speed: 30, slopeY: 0, dt });
  const braked = stepRideSpeed({ speed: 30, slopeY: 0, dt, brakeDrag: 0.3 });
  assert.ok(braked < rolling, 'brake drag should decelerate harder');
});

test('a chain lift pulls a slow cart toward its target without overshooting', () => {
  const target = 8;
  let speed = 1;
  for (let i = 0; i < 600; i += 1) {
    speed = stepRideSpeed({ speed, slopeY: 0.5, dt, chainTarget: target });
  }
  assert.ok(speed > 1, 'chain lift should raise the speed of a slow cart');
  assert.ok(speed <= target + 1e-6, 'chain lift should not overshoot its target');
});

test('speed is clamped to the maximum', () => {
  const next = stepRideSpeed({ speed: MAX_SPEED, slopeY: -1, dt });
  assert.ok(next <= MAX_SPEED, 'speed must not exceed the clamp');
});

test('level cruising at constant speed reads about one vertical g', () => {
  // No kinematic acceleration: felt acceleration is just the reaction to gravity.
  const felt = { x: 0, y: GRAVITY, z: 0 };
  const up = { x: 0, y: 1, z: 0 };
  const lateral = { x: 1, y: 0, z: 0 };
  const g = gForces(felt, up, lateral);
  assert.ok(Math.abs(g.vertG - 1) < 1e-9, 'vertical g should be ~1');
  assert.ok(Math.abs(g.latG) < 1e-9, 'lateral g should be ~0');
  assert.ok(Math.abs(g.totalG - 1) < 1e-9, 'total g should be ~1');
});

test('energy bookkeeping reports KE and PE consistently', () => {
  const { pe, ke } = energy(10, 5);
  assert.equal(ke, 0.5 * 10 * 10);
  assert.equal(pe, GRAVITY * 5);
  // Trading height for speed at fixed total energy: lower, faster cart.
  const high = energy(0, 10);
  const low = energy(Math.sqrt(2 * GRAVITY * 10), 0);
  assert.ok(Math.abs((high.pe + high.ke) - (low.pe + low.ke)) < 1e-9);
});
