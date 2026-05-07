import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ORBITAL_CONFIG,
  createOrbitBody,
  createSeedBodies,
  getColorForMass,
  getOrbitSystemEnergy,
  getRadiusForMass,
  sanitizeOrbitBody,
  stepOrbitBodies,
} from '../../packages/shared/src/solar.ts';

test('orbit body visual helpers stay deterministic across mass ranges', () => {
  assert.equal(getRadiusForMass(ORBITAL_CONFIG.creation.baseMass), getRadiusForMass(ORBITAL_CONFIG.creation.baseMass));
  assert.equal(getColorForMass(ORBITAL_CONFIG.creation.baseMass), 'hsl(240, 80%, 60%)');
  assert.equal(getColorForMass(ORBITAL_CONFIG.creation.maxMass), 'hsl(0, 80%, 60%)');
});

test('orbit body payloads reject invalid values and clamp risky extremes', () => {
  assert.equal(sanitizeOrbitBody({ x: Number.NaN, y: 0, vx: 0, vy: 0, mass: 10 }), null);

  const sanitized = sanitizeOrbitBody({
    x: ORBITAL_CONFIG.world.boundaryLimit * 2,
    y: -ORBITAL_CONFIG.world.boundaryLimit * 2,
    vx: ORBITAL_CONFIG.world.velocityLimit * 2,
    vy: -ORBITAL_CONFIG.world.velocityLimit * 2,
    mass: ORBITAL_CONFIG.creation.maxMass * 2,
  });

  assert.deepEqual(sanitized, {
    x: ORBITAL_CONFIG.world.boundaryLimit,
    y: -ORBITAL_CONFIG.world.boundaryLimit,
    vx: ORBITAL_CONFIG.world.velocityLimit,
    vy: -ORBITAL_CONFIG.world.velocityLimit,
    mass: ORBITAL_CONFIG.creation.maxMass,
  });
});

test('orbit bodies despawn after traveling beyond the outer margin', () => {
  const despawnLimit = ORBITAL_CONFIG.world.boundaryLimit + ORBITAL_CONFIG.world.despawnMargin;
  const bodies = [createOrbitBody('escapee', { x: despawnLimit - 2, y: 0, vx: 12, vy: 0, mass: 20 })];

  stepOrbitBodies(bodies, 1 / ORBITAL_CONFIG.tickRate);

  assert.equal(bodies.length, 0);
});

test('seed orbit advances and records trails during simulation steps', () => {
  const bodies = createSeedBodies();
  const orbiter = bodies.find((body) => body.id === 'seed-orbiter');
  assert.ok(orbiter);
  const startX = orbiter.x;
  const startY = orbiter.y;

  for (let index = 0; index < 8; index += 1) {
    stepOrbitBodies(bodies, 1 / ORBITAL_CONFIG.tickRate);
  }

  assert.notEqual(orbiter.x, startX);
  assert.notEqual(orbiter.y, startY);
  assert.ok(orbiter.path.length > 0);
});

test('stable two-body orbit keeps total energy nearly constant without collisions', () => {
  const separation = 600;
  const mass = 1000;
  const { gravity, softening } = ORBITAL_CONFIG.physics;
  const softenedDenominator = Math.pow(separation * separation + softening * softening, 1.5);
  const orbitalSpeed = Math.sqrt(((gravity * mass * separation) / softenedDenominator) * (separation / 2));
  const bodies = [
    createOrbitBody('left', { x: -separation / 2, y: 0, vx: 0, vy: -orbitalSpeed, mass }),
    createOrbitBody('right', { x: separation / 2, y: 0, vx: 0, vy: orbitalSpeed, mass }),
  ];
  const initialEnergy = getOrbitSystemEnergy(bodies);

  for (let index = 0; index < 4000; index += 1) {
    stepOrbitBodies(bodies, 1 / ORBITAL_CONFIG.tickRate);
  }

  assert.equal(bodies.length, 2);
  const finalEnergy = getOrbitSystemEnergy(bodies);
  const relativeDrift = Math.abs((finalEnergy - initialEnergy) / initialEnergy);
  assert.ok(relativeDrift < 0.0005, `relative energy drift was ${relativeDrift}`);
});

test('colliding orbit bodies merge with conserved mass and momentum', () => {
  const bodies = [
    createOrbitBody('a', { x: 0, y: 0, vx: 1, vy: 0, mass: 100 }),
    createOrbitBody('b', { x: 1, y: 0, vx: -1, vy: 0, mass: 100 }),
  ];

  stepOrbitBodies(bodies, 1 / ORBITAL_CONFIG.tickRate);

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].mass, 200);
  assert.ok(Math.abs(bodies[0].vx) < 1e-8);
});
