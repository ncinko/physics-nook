import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DAY_PER_SECOND_SPEED,
  EARTH_RADIUS_KM,
  HOUR_PER_SECOND_SPEED,
  MEAN_MOON_DISTANCE_KM,
  applySpaceTranslation,
  advanceSimulationTime,
  canUseClickForDescent,
  createSurfacePose,
  getCameraBasis,
  getEarthMoonSunSnapshot,
  getEclipseState,
  length,
  moonIlluminationFromLongitude,
  moonPhaseNameFromLongitude,
  moveSurfacePose,
} from '../../src/lib/astronomy/index.ts';

const closeTo = (actual: number, expected: number, epsilon: number) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} should be within ${epsilon} of ${expected}`,
  );
};

test('moon phase names follow the conventional longitude quadrants', () => {
  assert.equal(moonPhaseNameFromLongitude(0), 'New Moon');
  assert.equal(moonPhaseNameFromLongitude(45), 'Waxing Crescent');
  assert.equal(moonPhaseNameFromLongitude(90), 'First Quarter');
  assert.equal(moonPhaseNameFromLongitude(135), 'Waxing Gibbous');
  assert.equal(moonPhaseNameFromLongitude(180), 'Full Moon');
  assert.equal(moonPhaseNameFromLongitude(225), 'Waning Gibbous');
  assert.equal(moonPhaseNameFromLongitude(270), 'Third Quarter');
  assert.equal(moonPhaseNameFromLongitude(315), 'Waning Crescent');
  assert.equal(moonPhaseNameFromLongitude(359), 'New Moon');
});

test('idealized illumination fraction tracks phase longitude', () => {
  closeTo(moonIlluminationFromLongitude(0), 0, 1e-12);
  closeTo(moonIlluminationFromLongitude(90), 0.5, 1e-12);
  closeTo(moonIlluminationFromLongitude(180), 1, 1e-12);
  closeTo(moonIlluminationFromLongitude(270), 0.5, 1e-12);
});

test('simulation clock pauses, reverses, and advances by signed speed', () => {
  const start = new Date('2026-06-24T12:00:00.000Z');

  assert.equal(
    advanceSimulationTime(start, 1000, DAY_PER_SECOND_SPEED, false).toISOString(),
    start.toISOString(),
  );
  assert.equal(
    advanceSimulationTime(start, 1000, DAY_PER_SECOND_SPEED, true).toISOString(),
    '2026-06-25T12:00:00.000Z',
  );
  assert.equal(
    advanceSimulationTime(start, 2000, -HOUR_PER_SECOND_SPEED, true).toISOString(),
    '2026-06-24T10:00:00.000Z',
  );
});

test('ephemeris snapshot returns sane Earth-centered Moon and Sun distances', () => {
  const snapshot = getEarthMoonSunSnapshot(new Date('2026-06-24T12:00:00.000Z'));

  assert.ok(snapshot.moonDistanceKm > 350000);
  assert.ok(snapshot.moonDistanceKm < 410000);
  closeTo(snapshot.moonDistanceKm, MEAN_MOON_DISTANCE_KM, 40000);
  assert.ok(snapshot.sunDistanceKm > 0.98 * 149597870.69098932);
  assert.ok(snapshot.sunDistanceKm < 1.02 * 149597870.69098932);
  assert.ok(snapshot.phase.illuminationFraction >= 0);
  assert.ok(snapshot.phase.illuminationFraction <= 1);
  closeTo(length(snapshot.sunDirection), 1, 1e-12);
});

test('space camera translation follows camera yaw and pitch', () => {
  const start = { x: 0, y: 0, z: 0 };
  const forwardBasis = getCameraBasis(0, 0);
  const yawedBasis = getCameraBasis(Math.PI / 2, 0);
  const pitchedBasis = getCameraBasis(0, Math.PI / 6);

  assert.deepEqual(
    applySpaceTranslation(start, forwardBasis, { forward: 1, right: 0 }, 5),
    { x: 0, y: 0, z: -5 },
  );
  closeTo(applySpaceTranslation(start, yawedBasis, { forward: 1, right: 0 }, 4).x, 4, 1e-12);
  closeTo(applySpaceTranslation(start, yawedBasis, { forward: 0, right: 1 }, 4).z, 4, 1e-12);
  assert.ok(applySpaceTranslation(start, pitchedBasis, { forward: 1, right: 0 }, 2).y > 0);
});

test('surface walking preserves the globe radius over long and near-pole moves', () => {
  const radius = EARTH_RADIUS_KM;
  let pose = createSurfacePose(radius, 0, 0, 0);

  for (let index = 0; index < 180; index += 1) {
    pose = moveSurfacePose(pose, radius, {
      forwardDistance: 100,
      rightDistance: 25,
      turnRadians: 0.01,
    });
  }

  closeTo(length(pose.position), radius, 1e-6);
  closeTo(length(pose.forward), 1, 1e-12);
  closeTo(length(pose.right), 1, 1e-12);

  let polarPose = createSurfacePose(radius, Math.PI / 2 - 0.00001, 0, Math.PI / 3);
  for (let index = 0; index < 60; index += 1) {
    polarPose = moveSurfacePose(polarPose, radius, {
      forwardDistance: 50,
      rightDistance: -35,
      turnRadians: -0.02,
    });
  }

  closeTo(length(polarPose.position), radius, 1e-6);
  closeTo(length(polarPose.forward), 1, 1e-12);
  closeTo(length(polarPose.right), 1, 1e-12);
});

test('surface controls move across the tangent plane without changing radius', () => {
  const radius = EARTH_RADIUS_KM;
  const start = createSurfacePose(radius, 0.4, -1.2, 0.7);
  const moved = moveSurfacePose(start, radius, {
    forwardDistance: 25,
    rightDistance: -40,
  });

  closeTo(length(moved.position), radius, 1e-6);
  assert.notDeepEqual(moved.position, start.position);
  closeTo(length(moved.forward), 1, 1e-12);
  closeTo(length(moved.right), 1, 1e-12);
});

test('surface pointer-lock mode ignores click actions', () => {
  assert.equal(canUseClickForDescent('space', false), true);
  assert.equal(canUseClickForDescent('space', true), false);
  assert.equal(canUseClickForDescent('surface', false), false);
  assert.equal(canUseClickForDescent('transition', false), false);
});

test('sampled Moon path is not the old flat XZ orbit ring', () => {
  const snapshot = getEarthMoonSunSnapshot(new Date('2026-06-24T12:00:00.000Z'));
  const maxOutOfPlaneKm = Math.max(...snapshot.moonPathGeocentricKm.map((point) => Math.abs(point.y)));

  assert.ok(snapshot.moonPathGeocentricKm.length >= 96);
  assert.ok(maxOutOfPlaneKm > 10000);
});

test('eclipse wrapper detects known eclipses and ignores quiet windows', () => {
  const solar = getEclipseState(new Date('2024-04-08T18:18:00.000Z'));
  const lunar = getEclipseState(new Date('2025-03-14T06:58:00.000Z'));
  const quiet = getEclipseState(new Date('2026-06-24T12:00:00.000Z'));

  assert.equal(solar?.type, 'solar');
  assert.equal(solar?.kind, 'total');
  assert.ok((solar?.intensity ?? 0) > 0.95);
  assert.equal(lunar?.type, 'lunar');
  assert.equal(lunar?.kind, 'total');
  assert.ok((lunar?.intensity ?? 0) > 0.95);
  assert.equal(quiet, null);
});
