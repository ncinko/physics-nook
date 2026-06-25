import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DAY_PER_SECOND_SPEED,
  EARTH_RADIUS_KM,
  HOUR_PER_SECOND_SPEED,
  MINUTE_PER_SECOND_SPEED,
  MEAN_MOON_DISTANCE_KM,
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
  apparentAngularDiameterDegrees,
  applySpaceLookDrag,
  applySpaceTranslation,
  advanceSimulationTime,
  canUseClickForDescent,
  clampSurfacePitch,
  createSurfacePose,
  cross,
  dot,
  earthRotationAngleForDate,
  formatSpeedLabel,
  getCameraBasis,
  getEarthMoonSunSnapshot,
  getEclipseState,
  getSurfaceSkyState,
  getSurfaceViewFrame,
  getSunRenderMode,
  length,
  moonIlluminationFromLongitude,
  moonPhaseNameFromLongitude,
  moveSurfacePose,
  skyProxyRadiusForAngularSize,
  surfaceDirectionVisibility,
  turnSurfacePose,
} from '../../src/lib/astronomy/index.ts';

const closeTo = (actual: number, expected: number, epsilon: number) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} should be within ${epsilon} of ${expected}`,
  );
};

const vectorCloseTo = (
  actual: { x: number; y: number; z: number },
  expected: { x: number; y: number; z: number },
  epsilon: number,
) => {
  closeTo(actual.x, expected.x, epsilon);
  closeTo(actual.y, expected.y, epsilon);
  closeTo(actual.z, expected.z, epsilon);
};

const normalizeTestVector = (vector: { x: number; y: number; z: number }) => {
  const magnitude = Math.hypot(vector.x, vector.y, vector.z);
  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude,
    z: vector.z / magnitude,
  };
};

const subtractTestVectors = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
) => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

const DEGREES = Math.PI / 180;

const rotateY = (
  vector: { x: number; y: number; z: number },
  radians: number,
) => {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: cos * vector.x + sin * vector.z,
    y: vector.y,
    z: -sin * vector.x + cos * vector.z,
  };
};

const earthTextureSurfaceUp = (
  latitudeDegrees: number,
  longitudeDegrees: number,
  earthRotationRadians: number,
) => {
  const latitude = latitudeDegrees * DEGREES;
  // Three's sphere UVs map equirectangular Earth longitudes opposite local +z.
  const localLongitude = -longitudeDegrees * DEGREES;
  return rotateY({
    x: Math.cos(latitude) * Math.cos(localLongitude),
    y: Math.sin(latitude),
    z: Math.cos(latitude) * Math.sin(localLongitude),
  }, earthRotationRadians);
};

const sunAltitudeDegrees = (
  snapshot: ReturnType<typeof getEarthMoonSunSnapshot>,
  latitudeDegrees: number,
  longitudeDegrees: number,
) => {
  const up = earthTextureSurfaceUp(
    latitudeDegrees,
    longitudeDegrees,
    snapshot.earthRotationRadians,
  );
  const sky = getSurfaceSkyState(snapshot.sunDirection, up);
  return Math.asin(sky.sunAltitude) / DEGREES;
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

test('time speed labels stay compact for HUD preset buttons', () => {
  assert.equal(formatSpeedLabel(-DAY_PER_SECOND_SPEED), '-1 day');
  assert.equal(formatSpeedLabel(-HOUR_PER_SECOND_SPEED), '-1 hour');
  assert.equal(formatSpeedLabel(-MINUTE_PER_SECOND_SPEED), '-1 min');
  assert.equal(formatSpeedLabel(1), '1x');
  assert.equal(formatSpeedLabel(MINUTE_PER_SECOND_SPEED), '1 min');
  assert.equal(formatSpeedLabel(HOUR_PER_SECOND_SPEED), '1 hour');
  assert.equal(formatSpeedLabel(DAY_PER_SECOND_SPEED), '1 day');
  assert.equal(formatSpeedLabel(2 * DAY_PER_SECOND_SPEED), '2 days');
  assert.ok(!formatSpeedLabel(DAY_PER_SECOND_SPEED).includes('/s'));
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

test('Earth rotation keeps California daylight aligned with local afternoon', () => {
  const midAfternoon = getEarthMoonSunSnapshot(new Date('2026-06-24T21:52:45.000Z'));
  const evening = getEarthMoonSunSnapshot(new Date('2026-06-25T03:52:45.000Z'));
  const latitude = 36.6;
  const longitude = -121.9;

  closeTo(
    midAfternoon.earthRotationRadians,
    earthRotationAngleForDate(midAfternoon.date),
    1e-12,
  );
  assert.ok(
    sunAltitudeDegrees(midAfternoon, latitude, longitude) > 55,
    'California should still be in full daylight at 2:52 PM PDT on June 24, 2026',
  );
  assert.ok(
    sunAltitudeDegrees(evening, latitude, longitude) < 0,
    'California should be near/after sunset around 8:52 PM PDT on June 24, 2026',
  );
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

test('space drag yaws horizontally and pitches vertically without changing roll basis', () => {
  const start = { yaw: 0.25, pitch: 0.1 };
  const draggedRight = applySpaceLookDrag(start, 20, 0, 0.01);
  const draggedUp = applySpaceLookDrag(start, 0, -12, 0.01);
  const basis = getCameraBasis(draggedUp.yaw, draggedUp.pitch);

  assert.ok(draggedRight.yaw > start.yaw);
  closeTo(draggedRight.pitch, start.pitch, 1e-12);
  closeTo(draggedUp.yaw, start.yaw, 1e-12);
  assert.ok(draggedUp.pitch > start.pitch);
  closeTo(dot(cross(basis.forward, basis.up), basis.right), 1, 1e-12);
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
  const startFrame = getSurfaceViewFrame(start, 0);
  const moved = moveSurfacePose(start, radius, {
    forwardDistance: 25,
    rightDistance: -40,
  });
  const rightMoved = moveSurfacePose(start, radius, {
    forwardDistance: 0,
    rightDistance: 5,
  });
  const rightDisplacement = normalizeTestVector(subtractTestVectors(
    rightMoved.position,
    start.position,
  ));

  closeTo(length(moved.position), radius, 1e-6);
  assert.notDeepEqual(moved.position, start.position);
  closeTo(length(moved.forward), 1, 1e-12);
  closeTo(length(moved.right), 1, 1e-12);
  assert.ok(dot(rightDisplacement, startFrame.bodyRight) > 0.99);
});

test('surface yaw turns the body heading while pitch remains an independent head tilt', () => {
  const pose = createSurfacePose(EARTH_RADIUS_KM, 0.2, -0.4, 0.1);
  const pitch = 0.42;
  const turned = turnSurfacePose(pose, Math.PI / 2);
  const originalFrame = getSurfaceViewFrame(pose, pitch);
  const turnedFrame = getSurfaceViewFrame(turned, pitch);

  closeTo(dot(turned.up, pose.up), 1, 1e-12);
  assert.ok(dot(turned.forward, pose.forward) < 0.01);
  closeTo(dot(turned.forward, pose.right), 1, 1e-12);
  closeTo(dot(originalFrame.lookDirection, originalFrame.bodyForward), Math.cos(pitch), 1e-12);
  closeTo(dot(turnedFrame.lookDirection, turnedFrame.bodyForward), Math.cos(pitch), 1e-12);
});

test('surface pitch tilts the head without changing the tangent movement basis', () => {
  const pose = createSurfacePose(EARTH_RADIUS_KM, -0.35, 1.1, -0.45);
  const flatFrame = getSurfaceViewFrame(pose, 0);
  const pitchedFrame = getSurfaceViewFrame(pose, 0.72);

  vectorCloseTo(pitchedFrame.bodyForward, flatFrame.bodyForward, 1e-12);
  vectorCloseTo(pitchedFrame.bodyRight, flatFrame.bodyRight, 1e-12);
  closeTo(dot(cross(pitchedFrame.lookDirection, pitchedFrame.headUp), pitchedFrame.bodyRight), 1, 1e-12);
  assert.ok(dot(pitchedFrame.lookDirection, flatFrame.eyeUp) > 0.65);
  assert.ok(dot(pitchedFrame.headUp, flatFrame.eyeUp) > 0);
});

test('surface head-up frame stays aligned through full-globe and near-pole movement', () => {
  let pose = createSurfacePose(EARTH_RADIUS_KM, 0, 0, 0);
  const stepDistance = 2 * Math.PI * EARTH_RADIUS_KM / 240;

  for (let index = 0; index < 240; index += 1) {
    pose = moveSurfacePose(pose, EARTH_RADIUS_KM, {
      forwardDistance: stepDistance,
      rightDistance: 0,
    });
    const frame = getSurfaceViewFrame(pose, 0.35);
    assert.ok(dot(frame.headUp, frame.eyeUp) > 0.9);
    closeTo(dot(frame.bodyForward, frame.eyeUp), 0, 1e-12);
    closeTo(dot(frame.bodyRight, frame.eyeUp), 0, 1e-12);
  }

  let polarPose = createSurfacePose(EARTH_RADIUS_KM, Math.PI / 2 - 0.00001, 0, Math.PI / 5);
  for (let index = 0; index < 80; index += 1) {
    polarPose = moveSurfacePose(polarPose, EARTH_RADIUS_KM, {
      forwardDistance: 35,
      rightDistance: -20,
    });
    const frame = getSurfaceViewFrame(polarPose, -0.45);
    assert.ok(dot(frame.headUp, frame.eyeUp) > 0.85);
    closeTo(length(frame.lookDirection), 1, 1e-12);
  }
});

test('steep surface pitch never changes tangent movement direction', () => {
  const pose = createSurfacePose(EARTH_RADIUS_KM, 0.6, 0.8, 1.2);
  const steepPitch = clampSurfacePitch(10);
  const steepFrame = getSurfaceViewFrame(pose, steepPitch);
  const flatFrame = getSurfaceViewFrame(pose, 0);
  const moved = moveSurfacePose(pose, EARTH_RADIUS_KM, {
    forwardDistance: 120,
    rightDistance: -80,
  });

  vectorCloseTo(steepFrame.bodyForward, flatFrame.bodyForward, 1e-12);
  vectorCloseTo(steepFrame.bodyRight, flatFrame.bodyRight, 1e-12);
  closeTo(length(moved.position), EARTH_RADIUS_KM, 1e-6);
});

test('surface pointer-lock mode ignores click actions', () => {
  assert.equal(canUseClickForDescent('space', false), true);
  assert.equal(canUseClickForDescent('space', true), false);
  assert.equal(canUseClickForDescent('surface', false), false);
  assert.equal(canUseClickForDescent('transition', false), false);
});

test('true-distance angular helpers produce real Sun and Moon apparent sizes', () => {
  const moonDiameter = apparentAngularDiameterDegrees(MOON_RADIUS_KM, MEAN_MOON_DISTANCE_KM);
  const sunDiameter = apparentAngularDiameterDegrees(SUN_RADIUS_KM, 149597870.7);
  const proxyDistance = 420;
  const moonProxyRadius = skyProxyRadiusForAngularSize(
    proxyDistance,
    MOON_RADIUS_KM,
    MEAN_MOON_DISTANCE_KM,
  );

  assert.ok(moonDiameter > 0.49);
  assert.ok(moonDiameter < 0.53);
  assert.ok(sunDiameter > 0.52);
  assert.ok(sunDiameter < 0.54);
  closeTo(
    moonProxyRadius,
    proxyDistance * Math.tan((moonDiameter / 2) * Math.PI / 180),
    1e-12,
  );
  assert.ok(surfaceDirectionVisibility({ x: 1, y: 0.2, z: 0 }, { x: 0, y: 1, z: 0 }) > 0.99);
  assert.ok(surfaceDirectionVisibility({ x: 1, y: -0.2, z: 0 }, { x: 0, y: 1, z: 0 }) < 0.01);
});

test('Sun render mode uses infinity only for true-distance space view', () => {
  const eclipseSnapshot = getEarthMoonSunSnapshot(new Date('2024-04-08T18:18:00.000Z'));
  const sunDiameter = apparentAngularDiameterDegrees(SUN_RADIUS_KM, eclipseSnapshot.sunDistanceKm);

  assert.equal(getSunRenderMode('compact', 'space'), 'finite-scene');
  assert.equal(getSunRenderMode('true', 'space'), 'infinite-space');
  assert.equal(getSunRenderMode('true', 'surface', 'earth'), 'surface-proxy');
  assert.equal(getSunRenderMode('true', 'surface', 'moon'), 'finite-scene');
  assert.ok(sunDiameter > 0.52);
  assert.ok(sunDiameter < 0.54);
  assert.ok(eclipseSnapshot.sunDistanceKm > eclipseSnapshot.moonDistanceKm * 300);
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
