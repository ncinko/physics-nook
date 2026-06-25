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
  BINARY_PATH_SAMPLE_COUNT,
  BRIGHT_STAR_CATALOG,
  LIVE_EARTH_PROVIDERS,
  apparentAngularRadiusRadians,
  apparentAngularDiameterDegrees,
  applySpaceLookDrag,
  applySpaceTranslation,
  advanceSimulationTime,
  binarySceneScale,
  blurLiveEarthMask,
  buildLiveEarthWmsUrl,
  canUseClickForDescent,
  celestialDirectionFromRaDec,
  clampSurfacePitch,
  compositeLiveEarthLayers,
  createSurfacePose,
  cross,
  dot,
  earthRotationAngleForDate,
  formatSpeedLabel,
  getBinarySystemSnapshot,
  getCameraBasis,
  getEarthMoonSunSnapshot,
  getEclipseState,
  getSurfaceSkyBodies,
  getSurfaceSkyState,
  getSurfaceViewFrame,
  getSunRenderMode,
  length,
  liveEarthPixelBlendAlpha,
  liveEarthTextureKey,
  moonIlluminationFromLongitude,
  moonPhaseNameFromLongitude,
  moveAlienTowardPose,
  moveSurfacePose,
  nextAlienWorldMode,
  resolveLiveEarthLayers,
  skyProxyRadiusForAngularSize,
  spawnAlienNearPlayer,
  starVisualStyle,
  surfaceDirectionVisibility,
  isAlienCaught,
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

const testImageData = (
  width: number,
  height: number,
  pixels: Array<[number, number, number, number]>,
) => {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((pixel, index) => {
    data[index * 4] = pixel[0];
    data[index * 4 + 1] = pixel[1];
    data[index * 4 + 2] = pixel[2];
    data[index * 4 + 3] = pixel[3];
  });
  return { width, height, data };
};

const pixelAt = (
  data: Uint8ClampedArray,
  index: number,
): [number, number, number, number] => [
  data[index * 4],
  data[index * 4 + 1],
  data[index * 4 + 2],
  data[index * 4 + 3],
];

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

const directionAtAltitude = (altitudeRadians: number) => ({
  x: Math.cos(altitudeRadians),
  y: Math.sin(altitudeRadians),
  z: 0,
});

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

test('bright star catalog directions use the scene celestial basis', () => {
  vectorCloseTo(celestialDirectionFromRaDec(0, 0), { x: 1, y: 0, z: 0 }, 1e-12);
  vectorCloseTo(celestialDirectionFromRaDec(6, 0), { x: 0, y: 0, z: -1 }, 1e-12);
  vectorCloseTo(celestialDirectionFromRaDec(0, 90), { x: 0, y: 1, z: 0 }, 1e-12);

  const sirius = BRIGHT_STAR_CATALOG.find((star) => star.name === 'Sirius');
  assert.ok(BRIGHT_STAR_CATALOG.length >= 40);
  assert.ok(sirius);
  closeTo(length(celestialDirectionFromRaDec(sirius.raHours, sirius.decDegrees)), 1, 1e-12);
  assert.ok(celestialDirectionFromRaDec(sirius.raHours, sirius.decDegrees).y < 0);
});

test('star visual weighting keeps bright stars larger and more opaque than dim stars', () => {
  const bright = starVisualStyle({ magnitude: -1.46, bv: 0, spectralClass: 'A1V' });
  const dim = starVisualStyle({ magnitude: 6.2, bv: 1.5, spectralClass: 'M0III' });
  const blueWhite = starVisualStyle({ magnitude: 2, bv: -0.25, spectralClass: 'B1V' });
  const warm = starVisualStyle({ magnitude: 2, bv: 1.55, spectralClass: 'K5III' });

  assert.ok(bright.size > dim.size * 2);
  assert.ok(bright.alpha > dim.alpha);
  assert.ok(blueWhite.color.z > warm.color.z);
  assert.ok(warm.color.x > blueWhite.color.x);
});

test('live Earth imagery resolves near-now providers to safe cadence buckets', () => {
  const now = new Date('2026-06-25T19:02:33.000Z');
  const layers = resolveLiveEarthLayers(new Date('2026-06-25T19:02:33.000Z'), now);
  const layerIds = layers.map((layer) => layer.provider.id);
  const goesEast = layers.find((layer) => layer.provider.id === 'nasa-goes-east-geocolor');
  const mumi = layers.find((layer) => layer.provider.id === 'eumetview-multimission-natural');
  const viirs = layers.find((layer) => layer.provider.id === 'nasa-viirs-snpp-true-color');

  assert.deepEqual(
    layerIds,
    LIVE_EARTH_PROVIDERS.map((provider) => provider.id),
  );
  assert.ok(goesEast);
  assert.equal(goesEast.timeParameter, '2026-06-25T18:10:00Z');
  assert.ok(mumi);
  assert.equal(mumi.timeParameter, '2026-06-25T18:00:00Z');
  assert.ok(viirs);
  assert.equal(viirs.timeParameter, '2026-06-25');
  assert.equal(resolveLiveEarthLayers(new Date('2026-06-20T19:02:33.000Z'), now).length, 0);
});

test('live Earth WMS URLs target public GIBS and EUMETView layers', () => {
  const now = new Date('2026-06-25T19:02:33.000Z');
  const layers = resolveLiveEarthLayers(now, now);
  const goesUrl = buildLiveEarthWmsUrl(layers.find((layer) => layer.provider.id === 'nasa-goes-east-geocolor')!);
  const eumetUrl = buildLiveEarthWmsUrl(layers.find((layer) => layer.provider.id === 'eumetview-mtg-geocolour')!);

  assert.ok(goesUrl.startsWith('https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?'));
  assert.ok(goesUrl.includes('LAYERS=GOES-East_ABI_GeoColor'));
  assert.ok(goesUrl.includes('SRS=EPSG%3A4326'));
  assert.ok(goesUrl.includes('FORMAT=image%2Fpng'));
  assert.ok(goesUrl.includes('TRANSPARENT=TRUE'));
  assert.ok(eumetUrl.startsWith('https://view.eumetsat.int/geoserver/wms?'));
  assert.ok(eumetUrl.includes('LAYERS=mtg_fd%3Argb_geocolour'));
  assert.ok(eumetUrl.includes('CRS=CRS%3A84'));
  assert.ok(eumetUrl.includes('BBOX=-180%2C-89.9999%2C180%2C89.9999'));
});

test('live Earth pixel mask rejects transparent, black, and near-black no-data', () => {
  assert.equal(liveEarthPixelBlendAlpha(255, 255, 255, 0), 0);
  assert.equal(liveEarthPixelBlendAlpha(0, 0, 0, 255), 0);
  assert.equal(liveEarthPixelBlendAlpha(5, 4, 3, 255), 0);
  assert.ok(liveEarthPixelBlendAlpha(245, 248, 255, 255) > 0.9);
  assert.ok(liveEarthPixelBlendAlpha(30, 96, 180, 255) > 0.5);
});

test('live Earth compositing keeps fallback pixels under no-data regions', () => {
  const base = testImageData(3, 1, [
    [20, 80, 140, 255],
    [40, 100, 160, 255],
    [60, 120, 180, 255],
  ]);
  const live = testImageData(3, 1, [
    [255, 255, 255, 0],
    [0, 0, 0, 255],
    [240, 245, 255, 255],
  ]);
  const composite = compositeLiveEarthLayers(base, [{
    id: 'test',
    imageData: live,
    opacity: 1,
    priority: 1,
    maskBlurRadius: 0,
  }], 0);

  assert.deepEqual(pixelAt(composite.imageData.data, 0), [20, 80, 140, 255]);
  assert.deepEqual(pixelAt(composite.imageData.data, 1), [40, 100, 160, 255]);
  assert.ok(pixelAt(composite.imageData.data, 2)[0] > 200);
});

test('live Earth compositing blends overlapping valid providers', () => {
  const base = testImageData(1, 1, [[0, 0, 0, 255]]);
  const redLayer = testImageData(1, 1, [[255, 20, 20, 255]]);
  const blueLayer = testImageData(1, 1, [[20, 20, 255, 255]]);
  const composite = compositeLiveEarthLayers(base, [
    { id: 'red', imageData: redLayer, opacity: 1, priority: 1, maskBlurRadius: 0 },
    { id: 'blue', imageData: blueLayer, opacity: 0.5, priority: 2, maskBlurRadius: 0 },
  ], 0);
  const pixel = pixelAt(composite.imageData.data, 0);

  assert.ok(pixel[0] > 100);
  assert.ok(pixel[2] > 100);
});

test('live Earth mask blur wraps across the date line', () => {
  const mask = new Float32Array([1, 0, 0, 0, 0]);
  const blurred = blurLiveEarthMask(mask, 5, 1, 1);

  assert.ok(blurred[4] > 0);
  closeTo(blurred[4], blurred[1], 1e-12);
});

test('live Earth texture key can omit failed provider layers without disabling all live imagery', () => {
  const now = new Date('2026-06-25T19:02:33.000Z');
  const layers = resolveLiveEarthLayers(now, now);
  const fullKey = liveEarthTextureKey(layers);
  const withoutGoesEast = liveEarthTextureKey(
    layers.filter((layer) => layer.provider.id !== 'nasa-goes-east-geocolor'),
  );

  assert.notEqual(fullKey, 'static');
  assert.notEqual(withoutGoesEast, 'static');
  assert.ok(!withoutGoesEast.includes('nasa-goes-east-geocolor'));
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

test('topocentric surface sky bodies preserve Sun, Moon, and Earth apparent sizes', () => {
  const snapshot = getEarthMoonSunSnapshot(new Date('2026-06-24T12:00:00.000Z'));
  const earthSky = getSurfaceSkyBodies(snapshot, 'earth', { x: 0, y: 1, z: 0 });
  const moonNearSideUp = normalizeTestVector({
    x: -snapshot.moonGeocentricKm.x,
    y: -snapshot.moonGeocentricKm.y,
    z: -snapshot.moonGeocentricKm.z,
  });
  const moonSky = getSurfaceSkyBodies(snapshot, 'moon', moonNearSideUp);
  const sunFromEarthDiameter = earthSky.sun.angularRadiusRadians * 360 / Math.PI;
  const moonFromEarthDiameter = (earthSky.moon?.angularRadiusRadians ?? 0) * 360 / Math.PI;
  const sunFromMoonDiameter = moonSky.sun.angularRadiusRadians * 360 / Math.PI;
  const earthFromMoonDiameter = (moonSky.earth?.angularRadiusRadians ?? 0) * 360 / Math.PI;

  assert.ok(sunFromEarthDiameter > 0.52);
  assert.ok(sunFromEarthDiameter < 0.54);
  assert.ok(moonFromEarthDiameter > 0.48);
  assert.ok(moonFromEarthDiameter < 0.56);
  assert.ok(sunFromMoonDiameter > 0.52);
  assert.ok(sunFromMoonDiameter < 0.54);
  assert.ok(earthFromMoonDiameter > 1.8);
  assert.ok(earthFromMoonDiameter < 2.1);
  assert.ok(earthFromMoonDiameter > sunFromMoonDiameter * 3.4);
});

test('topocentric Moon direction includes parallax at the geocentric horizon', () => {
  const snapshot = getEarthMoonSunSnapshot(new Date('2026-06-24T12:00:00.000Z'));
  const moonDirection = normalizeTestVector(snapshot.moonGeocentricKm);
  const poleSafeAxis = Math.abs(moonDirection.y) < 0.9
    ? { x: 0, y: 1, z: 0 }
    : { x: 1, y: 0, z: 0 };
  const horizonUp = normalizeTestVector(cross(moonDirection, poleSafeAxis));
  const topocentricMoon = getSurfaceSkyBodies(snapshot, 'earth', horizonUp).moon;

  closeTo(dot(moonDirection, horizonUp), 0, 1e-12);
  assert.ok(topocentricMoon);
  assert.ok(dot(topocentricMoon.direction, horizonUp) < -0.01);
  assert.ok(Math.abs(dot(topocentricMoon.direction, horizonUp) - dot(moonDirection, horizonUp)) > 0.01);
});

test('surface sky-body visibility starts at apparent upper-limb horizon contact', () => {
  const up = { x: 0, y: 1, z: 0 };
  const sunRadius = apparentAngularRadiusRadians(SUN_RADIUS_KM, 149597870.7);

  assert.equal(surfaceDirectionVisibility(directionAtAltitude(-sunRadius * 1.02), up, sunRadius), 0);
  assert.ok(surfaceDirectionVisibility(directionAtAltitude(-sunRadius * 0.5), up, sunRadius) > 0);
  closeTo(surfaceDirectionVisibility(directionAtAltitude(0), up, sunRadius), 0.5, 1e-12);
  assert.equal(surfaceDirectionVisibility(directionAtAltitude(sunRadius), up, sunRadius), 1);
});

test('Sun render mode uses infinity only for true-distance space view', () => {
  const eclipseSnapshot = getEarthMoonSunSnapshot(new Date('2024-04-08T18:18:00.000Z'));
  const sunDiameter = apparentAngularDiameterDegrees(SUN_RADIUS_KM, eclipseSnapshot.sunDistanceKm);

  assert.equal(getSunRenderMode('compact', 'space'), 'finite-scene');
  assert.equal(getSunRenderMode('true', 'space'), 'infinite-space');
  assert.equal(getSunRenderMode('true', 'surface', 'earth'), 'surface-proxy');
  assert.equal(getSunRenderMode('true', 'surface', 'moon'), 'surface-proxy');
  assert.equal(getSunRenderMode('true', 'surface', 'binaryMoon'), 'finite-scene');
  assert.ok(sunDiameter > 0.52);
  assert.ok(sunDiameter < 0.54);
  assert.ok(eclipseSnapshot.sunDistanceKm > eclipseSnapshot.moonDistanceKm * 300);
});

test('binary system snapshot returns bounded bodies and orbit samples', () => {
  const snapshot = getBinarySystemSnapshot(new Date('2026-06-24T12:00:00.000Z'));

  assert.equal(binarySceneScale('compact'), 1);
  assert.equal(binarySceneScale('true'), 1);
  assert.equal(snapshot.planetPath.length, BINARY_PATH_SAMPLE_COUNT);
  assert.equal(snapshot.moonPath.length, BINARY_PATH_SAMPLE_COUNT);
  assert.ok(length(snapshot.primaryStar.position) > 1);
  assert.ok(length(snapshot.secondaryStar.position) > 1);
  assert.ok(length(snapshot.planetPosition) > 260);
  const moonPlanetDistance = length(subtractTestVectors(snapshot.moonPosition, snapshot.planetPosition));
  assert.ok(moonPlanetDistance > snapshot.planetRadius + snapshot.moonRadius + 12);
  assert.ok(length(subtractTestVectors(snapshot.planetPosition, snapshot.primaryStar.position)) > 240);
  assert.ok(length(subtractTestVectors(snapshot.planetPosition, snapshot.secondaryStar.position)) > 240);
  closeTo(length(snapshot.primaryDirectionFromMoon), 1, 1e-12);
  closeTo(length(snapshot.secondaryDirectionFromMoon), 1, 1e-12);
  assert.ok(snapshot.primaryDistanceFromMoonKm > 240_000_000);
  assert.ok(snapshot.secondaryDistanceFromMoonKm > 240_000_000);
});

test('binary star surface proxies preserve physical-looking angular sizes', () => {
  const snapshot = getBinarySystemSnapshot(new Date('2026-06-24T12:00:00.000Z'));
  const primaryDiameter = apparentAngularDiameterDegrees(
    snapshot.primaryStar.radiusKm,
    snapshot.primaryDistanceFromMoonKm,
  );
  const secondaryDiameter = apparentAngularDiameterDegrees(
    snapshot.secondaryStar.radiusKm,
    snapshot.secondaryDistanceFromMoonKm,
  );

  assert.ok(primaryDiameter > 0.2);
  assert.ok(primaryDiameter < 1.6);
  assert.ok(secondaryDiameter > 0.1);
  assert.ok(secondaryDiameter < 1.2);
});

test('alien idle meander preserves radius while moving toward a patrol target', () => {
  const player = createSurfacePose(MOON_RADIUS_KM, 0, 0, 0);
  const alien = spawnAlienNearPlayer(player, MOON_RADIUS_KM);
  const patrolTarget = moveSurfacePose(player, MOON_RADIUS_KM, {
    forwardDistance: MOON_RADIUS_KM * 0.16,
    rightDistance: MOON_RADIUS_KM * 0.05,
  });
  const startDistance = length(subtractTestVectors(alien.position, patrolTarget.position));
  const moved = moveAlienTowardPose(alien, patrolTarget, MOON_RADIUS_KM, MOON_RADIUS_KM * 0.04);
  const endDistance = length(subtractTestVectors(moved.position, patrolTarget.position));

  closeTo(length(moved.position), MOON_RADIUS_KM, 1e-6);
  assert.ok(endDistance < startDistance);
});

test('alien catch and world mapping use reversible moon portal rules', () => {
  const player = createSurfacePose(MOON_RADIUS_KM, 0, 0, 0);
  const alien = moveSurfacePose(player, MOON_RADIUS_KM, {
    forwardDistance: MOON_RADIUS_KM * 0.01,
    rightDistance: 0,
  });
  const farAlien = spawnAlienNearPlayer(player, MOON_RADIUS_KM);

  assert.equal(isAlienCaught(player, alien, MOON_RADIUS_KM * 0.02), true);
  assert.equal(isAlienCaught(player, farAlien, MOON_RADIUS_KM * 0.02), false);
  assert.equal(nextAlienWorldMode('earthMoonSun'), 'binarySystem');
  assert.equal(nextAlienWorldMode('binarySystem'), 'earthMoonSun');
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
