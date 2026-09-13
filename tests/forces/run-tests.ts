import assert from 'node:assert/strict';
import {
  BOUNDARY_PAD,
  BUBBLE_RADIUS,
  classifyForSystem,
  convexHull,
  distanceToHull,
  interactionScenes,
  SCENE_VIEW,
  systemBoundaryPath,
  thirdLawPair,
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

// --- interaction diagrams -------------------------------------------------

for (const scene of interactionScenes) {
  const objectIds = scene.objects.map((object) => object.id);
  assert.equal(new Set(objectIds).size, objectIds.length, `${scene.id} has duplicate object ids`);
  const linkIds = scene.interactions.map((interaction) => interaction.id);
  assert.equal(new Set(linkIds).size, linkIds.length, `${scene.id} has duplicate interaction ids`);

  for (const interaction of scene.interactions) {
    assert.ok(objectIds.includes(interaction.a) && objectIds.includes(interaction.b), `${scene.id}/${interaction.id} links unknown objects`);
    assert.notEqual(interaction.a, interaction.b, `${scene.id}/${interaction.id} links an object to itself`);
    // Third law: the two halves of every pair cancel.
    const { onA, onB } = thirdLawPair(interaction);
    near(onA.x + onB.x, 0);
    near(onA.y + onB.y, 0);
  }

  // Everything inside the boundary: every link is internal, nothing is left to draw.
  const everything = classifyForSystem(scene, objectIds);
  assert.equal(everything.external.length, 0);
  assert.equal(everything.internal.length, scene.interactions.length);

  // Layout guard: for every possible system, the boundary must stay clear of
  // every bubble left outside it, or the picture would lie about membership.
  for (let mask = 1; mask < 1 << objectIds.length; mask += 1) {
    const chosen = scene.objects.filter((_, index) => mask & (1 << index));
    const hull = convexHull(chosen.map((object) => object.position));
    for (const outsider of scene.objects.filter((object) => !chosen.includes(object))) {
      const clearance = distanceToHull(outsider.position, hull);
      assert.ok(
        clearance >= 2 * BUBBLE_RADIUS + BOUNDARY_PAD,
        `${scene.id}: boundary around ${chosen.map((object) => object.id).join('+')} overlaps ${outsider.id} (${clearance.toFixed(1)})`,
      );
    }
    assert.ok(systemBoundaryPath(scene, chosen.map((object) => object.id)).startsWith('M '));
  }
}

// The in-scene drawing: every object and every arrow tail lies inside it.
const inView = (point: { x: number; y: number }) =>
  point.x >= 0 && point.x <= SCENE_VIEW.width && point.y >= 0 && point.y <= SCENE_VIEW.height;
for (const scene of interactionScenes) {
  for (const object of scene.objects) {
    assert.ok(inView(object.inScene), `${scene.id}/${object.id} is drawn outside the scene`);
  }
  for (const interaction of scene.interactions) {
    assert.ok(inView(interaction.applyAt.a) && inView(interaction.applyAt.b), `${scene.id}/${interaction.id} has an arrow outside the scene`);
    // Hand-placed labels must fit inside the drawing. Estimate the width of a
    // 14px bold label at about 7.5 units per character.
    const objectLabel = (id: string) => scene.objects.find((object) => object.id === id)!.label;
    const labelText = { a: `${objectLabel(interaction.b)} on ${objectLabel(interaction.a)}`, b: `${objectLabel(interaction.a)} on ${objectLabel(interaction.b)}` };
    for (const end of ['a', 'b'] as const) {
      const spot = interaction.labelAt?.[end];
      if (!spot) continue;
      const width = labelText[end].length * 7.5;
      const left = spot.anchor === 'start' ? spot.x : spot.anchor === 'end' ? spot.x - width : spot.x - width / 2;
      assert.ok(left >= 0 && left + width <= SCENE_VIEW.width, `${scene.id}/${interaction.id} label ${end} runs off the scene`);
      assert.ok(spot.y >= 8 && spot.y <= SCENE_VIEW.height - 8, `${scene.id}/${interaction.id} label ${end} is too close to the edge`);
    }
    // Forces on Earth start at or below its surface, inside its body.
    for (const end of ['a', 'b'] as const) {
      if (interaction[end] === 'earth') {
        assert.ok(interaction.applyAt[end].y >= SCENE_VIEW.ground, `${scene.id}/${interaction.id} draws Earth's force above the ground`);
      }
    }
  }
}

// A single-object system reproduces the free-body builder's answer key.
const kindsOnNewt = (sceneId: string) =>
  classifyForSystem(interactionScenes.find((scene) => scene.id === sceneId)!, ['newt'])
    .external.map((force) => force.interaction.kind)
    .sort();
const answerKinds = (scenarioId: string) =>
  freeBodyScenarios
    .find((scenario) => scenario.id === scenarioId)!
    .candidates.filter((candidate) => candidate.belongs)
    .map((candidate) => candidate.kind)
    .sort();
assert.deepEqual(kindsOnNewt('table'), answerKinds('resting'));
assert.deepEqual(kindsOnNewt('hanging'), answerKinds('hanging'));

// Newt + box: the push becomes internal; floor and gravity links stay external.
const pushScene = interactionScenes.find((scene) => scene.id === 'pushing-box')!;
const pair = classifyForSystem(pushScene, ['newt', 'box']);
assert.deepEqual(pair.internal.map((interaction) => interaction.id), ['newt-box-push']);
assert.equal(pair.external.length, 6);
assert.ok(pair.external.every((force) => force.by === 'earth'));

// Newt alone: the box pushes him backward, the floor pushes him forward.
const newtAlone = classifyForSystem(pushScene, ['newt']);
const pushOnNewt = newtAlone.external.find((force) => force.interaction.id === 'newt-box-push')!;
assert.ok(pushOnNewt.force.x < 0);
assert.equal(pushOnNewt.by, 'box');
const floorOnNewt = newtAlone.external.find((force) => force.interaction.id === 'earth-newt-friction')!;
assert.ok(floorOnNewt.force.x > 0);

// Links with neither end inside are ignored entirely.
assert.equal(classifyForSystem(pushScene, ['box']).external.some((force) => force.interaction.id === 'earth-newt-gravity'), false);
assert.equal(systemBoundaryPath(pushScene, []), '');

console.log('Forces helper tests passed.');
