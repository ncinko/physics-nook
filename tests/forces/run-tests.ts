import assert from 'node:assert/strict';
import {
  contactNormalForce,
  frictionForce,
  gravityForce,
  hookeForce,
  inverseSquareRelativeStrength,
  magnitude,
  netForce,
  resolveWallBounce,
  tongueTensionForce,
} from '../../src/lib/forces/index.ts';

const near = (actual: number, expected: number, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be near ${expected}`);
};

const spring = hookeForce({ x: 0.25, y: -0.1 }, 40);
near(spring.x, -10);
near(spring.y, 4);

const compressedNormal = contactNormalForce(0.02, { x: 0, y: -1 }, 2000);
near(compressedNormal.x, 0);
near(compressedNormal.y, -40);
assert.deepEqual(contactNormalForce(-0.02, { x: 0, y: -1 }, 2000), { x: 0, y: 0 });

const slackTongue = tongueTensionForce({ x: 10, y: 0 }, { x: 20, y: 0 }, 12, 5);
assert.equal(slackTongue.taut, false);
assert.deepEqual(slackTongue.force, { x: 0, y: 0 });

const tautTongue = tongueTensionForce({ x: 10, y: 0 }, { x: 30, y: 0 }, 12, 5);
assert.equal(tautTongue.taut, true);
near(tautTongue.stretch, 8);
near(tautTongue.force.x, 40);
near(tautTongue.force.y, 0);

assert.deepEqual(gravityForce(2, 9.8), { x: 0, y: 19.6 });

const staticFriction = frictionForce({
  normalMagnitude: 20,
  velocity: { x: 0, y: 0 },
  appliedForce: { x: 6, y: 0 },
  muStatic: 0.5,
  muKinetic: 0.3,
});
assert.equal(staticFriction.mode, 'static');
near(staticFriction.force.x, -6);

const kineticFriction = frictionForce({
  normalMagnitude: 20,
  velocity: { x: 2, y: 0 },
  appliedForce: { x: 0, y: 0 },
  muStatic: 0.5,
  muKinetic: 0.3,
});
assert.equal(kineticFriction.mode, 'kinetic');
near(kineticFriction.force.x, -6);

const rightWall = resolveWallBounce(
  {
    position: { x: 105, y: 50 },
    velocity: { x: 12, y: 0 },
  },
  10,
  { left: 0, right: 100, top: 0, bottom: 100 },
  0.5,
);
near(rightWall.state.position.x, 90);
near(rightWall.state.velocity.x, -6);
assert.equal(rightWall.impulses.length, 1);
assert.ok(rightWall.impulses[0].impulse.x < 0);

const combined = netForce([{ x: 3, y: 4 }, { x: -1, y: 2 }, { x: 0, y: -6 }]);
near(magnitude(combined), 2);

near(inverseSquareRelativeStrength(2, 1), 0.25);
near(inverseSquareRelativeStrength(0.5, 1), 4);

console.log('Forces helper tests passed.');
