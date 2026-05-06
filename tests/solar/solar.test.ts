import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SOLAR_BODY_BY_ID,
  SOLAR_CONFIG,
  TAU,
  distanceVec,
  getBodyTransform,
  getCircumnavigationSeconds,
  getLaunchSite,
  getShipSpawnTransform,
  localSphericalToNormal,
  offsetLatLonBySurfaceMeters,
  wrapLongitudeDeg,
} from '../../packages/shared/src/solar.ts';

const closeTo = (actual: number, expected: number, epsilon = 1e-6) => {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} was not close to ${expected}`);
};

test('solar body transforms are deterministic for the same server time', () => {
  const first = getBodyTransform('earth', 123456789);
  const second = getBodyTransform('earth', 123456789);

  assert.deepEqual(first, second);
});

test('earth returns to its orbit position after one configured orbit', () => {
  const earth = SOLAR_BODY_BY_ID.earth;
  const start = getBodyTransform('earth', 0);
  const end = getBodyTransform('earth', earth.orbitSeconds * 1000);

  closeTo(distanceVec(start.position, end.position), 0, 1e-5);
});

test('longitude wrapping remains within signed longitude bounds', () => {
  assert.equal(wrapLongitudeDeg(181), -179);
  assert.equal(wrapLongitudeDeg(-181), 179);
  assert.equal(wrapLongitudeDeg(540), -180);
});

test('surface offsets wrap longitude without moving latitude unexpectedly at the equator', () => {
  const earth = SOLAR_BODY_BY_ID.earth;
  const moved = offsetLatLonBySurfaceMeters(0, 179, TAU * earth.radius * 0.02, 0, earth.radius);

  assert.ok(moved.longitudeDeg < -173 || moved.longitudeDeg > 179);
  closeTo(moved.latitudeDeg, 0);
});

test('shared spawn and ship placement stay near the Earth launch site', () => {
  const now = 987654321;
  const launch = getLaunchSite(now);
  const ship = getShipSpawnTransform(now);
  const distanceToLaunch = distanceVec(ship.position, launch.position);

  assert.equal(launch.body.id, SOLAR_CONFIG.launchSite.bodyId);
  assert.ok(distanceToLaunch < 14);
  closeTo(distanceVec(launch.up, localSphericalToNormal(SOLAR_CONFIG.launchSite.latitudeDeg, SOLAR_CONFIG.launchSite.longitudeDeg)), 0);
});

test('default Earth circumnavigation time is a few minutes at walking speed', () => {
  const seconds = getCircumnavigationSeconds(SOLAR_BODY_BY_ID.earth.radius, SOLAR_CONFIG.player.walkSpeed);

  assert.ok(seconds > 170);
  assert.ok(seconds < 190);
});
