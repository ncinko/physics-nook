import assert from 'node:assert/strict';
import {
  contactNormalForce,
  evaluateFreeBodySelection,
  freeBodyScenarios,
  frictionForce,
  gravityForce,
  hookeForce,
  inverseSquareRelativeStrength,
  magnitude,
  netForce,
  resolveWallBounce,
  solveIncline,
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


// --- incline solver -------------------------------------------------------

// A level surface has nothing to slide down, and the normal force carries the
// whole weight.
const level = solveIncline({ angleDeg: 0, mass: 2, muStatic: 0.5, muKinetic: 0.3 });
near(level.weightAlong, 0);
near(level.normal, 2 * 9.8);
near(level.acceleration, 0);
assert.equal(level.sliding, false);

// Below the slip angle static friction holds, and it supplies exactly the
// down-slope pull rather than its maximum.
const holding = solveIncline({ angleDeg: 20, mass: 2, muStatic: 0.6, muKinetic: 0.4 });
assert.equal(holding.sliding, false);
near(holding.acceleration, 0);
near(holding.friction, -holding.weightAlong);
assert.ok(Math.abs(holding.friction) < holding.maxStatic);

// Past the slip angle the block breaks free and kinetic friction takes over.
const slipping = solveIncline({ angleDeg: 35, mass: 2, muStatic: 0.3, muKinetic: 0.2 });
assert.equal(slipping.sliding, true);
assert.ok(slipping.acceleration > 0);
near(slipping.friction, -0.2 * slipping.normal);
near(slipping.acceleration, (slipping.weightAlong + slipping.friction) / 2);

// The slip angle is arctan(mu_s), and it does not depend on mass.
near(solveIncline({ angleDeg: 10, mass: 2, muStatic: 0.6, muKinetic: 0.4 }).slipAngleDeg, (Math.atan(0.6) * 180) / Math.PI, 1e-9);
const lightFrog = solveIncline({ angleDeg: 32, mass: 1, muStatic: 0.5, muKinetic: 0.5 });
const heavyFrog = solveIncline({ angleDeg: 32, mass: 40, muStatic: 0.5, muKinetic: 0.5 });
assert.equal(lightFrog.sliding, heavyFrog.sliding);
near(lightFrog.acceleration, heavyFrog.acceleration, 1e-12);

// N = mg cos(theta) shrinks as the ramp steepens.
const shallow = solveIncline({ angleDeg: 10, mass: 3, muStatic: 0.9, muKinetic: 0.9 });
const steep = solveIncline({ angleDeg: 30, mass: 3, muStatic: 0.9, muKinetic: 0.9 });
assert.ok(steep.normal < shallow.normal);
near(steep.normal, 3 * 9.8 * Math.cos(Math.PI / 6));

// mu_k above mu_s must not produce a block that accelerates backwards uphill.
const stickier = solveIncline({ angleDeg: 25, mass: 2, muStatic: 0.4, muKinetic: 0.8 });
assert.equal(stickier.sliding, false);
near(stickier.acceleration, 0);

// --- free-body scenarios --------------------------------------------------

// Every scenario needs at least one real force and at least one distractor,
// or the exercise has nothing to teach.
for (const scenario of freeBodyScenarios) {
  const ids = scenario.candidates.map((candidate) => candidate.id);
  assert.equal(new Set(ids).size, ids.length, `${scenario.id} has duplicate candidate ids`);
  assert.ok(scenario.candidates.some((candidate) => candidate.belongs), `${scenario.id} has no real forces`);
  assert.ok(scenario.candidates.some((candidate) => !candidate.belongs), `${scenario.id} has no distractors`);
  for (const candidate of scenario.candidates) {
    assert.ok(candidate.explanation.length > 0, `${scenario.id}/${candidate.id} needs an explanation`);
    near(magnitude(candidate.direction), 1, 1e-12);
  }
}

const resting = freeBodyScenarios.find((scenario) => scenario.id === 'resting');
assert.ok(resting);

const perfect = evaluateFreeBodySelection(
  resting,
  resting.candidates.filter((candidate) => candidate.belongs).map((candidate) => candidate.id),
);
assert.equal(perfect.correct, true);
assert.deepEqual(perfect.missing, []);
assert.deepEqual(perfect.extra, []);

// Selecting nothing reports every real force as missing, not as correct.
const empty = evaluateFreeBodySelection(resting, []);
assert.equal(empty.correct, false);
assert.equal(empty.missing.length, resting.candidates.filter((candidate) => candidate.belongs).length);
assert.deepEqual(empty.extra, []);

// The third-law partner is scored as an extra force, not a missing one.
const withPartner = evaluateFreeBodySelection(resting, ['weight', 'normal', 'newt-on-table']);
assert.equal(withPartner.correct, false);
assert.deepEqual(withPartner.missing, []);
assert.deepEqual(withPartner.extra, ['newt-on-table']);

// Unknown ids are ignored rather than counted against the reader.
assert.deepEqual(
  evaluateFreeBodySelection(resting, ['weight', 'normal', 'not-a-force']),
  { correct: true, missing: [], extra: [] },
);

console.log('Forces helper tests passed.');
