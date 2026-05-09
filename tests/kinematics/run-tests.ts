import assert from 'node:assert/strict';
import {
  STOP_ZONE_DEFAULTS,
  advanceDwell,
  chooseNextZoneCenter,
  isInsideStopZone,
  sanitizeLeaderboardName,
  selectBestScoresByUniqueName,
  shrinkZoneHalfWidth,
  validateScoreSubmission,
  wrapDelta,
  wrapPosition,
} from '../../src/lib/kinematics/stopZones.ts';

const near = (actual: number, expected: number, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be near ${expected}`);
};

near(wrapDelta(5.8, -5.8, 6), -0.4);
near(wrapDelta(-5.8, 5.8, 6), 0.4);
near(wrapPosition(6.2, 6), -5.8);
near(wrapPosition(-6.2, 6), 5.8);

assert.equal(isInsideStopZone(5.9, -5.9, 0.3, 6), true);
assert.equal(isInsideStopZone(2.0, 3.0, 0.4, 6), false);

assert.deepEqual(
  advanceDwell({
    currentDwell: 0.4,
    dt: 0.11,
    inside: true,
    velocity: 0.1,
  }),
  {
    dwell: 0.51,
    slow: true,
    stopComplete: true,
  },
);

assert.deepEqual(
  advanceDwell({
    currentDwell: 0.4,
    dt: 0.2,
    inside: true,
    velocity: STOP_ZONE_DEFAULTS.velocityThresholdMps + 0.01,
  }),
  {
    dwell: 0,
    slow: false,
    stopComplete: false,
  },
);

near(shrinkZoneHalfWidth(1, 0.25, 0.5), 0.5);
near(shrinkZoneHalfWidth(0.3, 0.25, 0.5), 0.25);

const chosen = chooseNextZoneCenter({
  currentPosition: 0,
  worldHalfWidth: 6,
  random: () => 0.95,
});
assert.ok(chosen > 4.5);

assert.equal(sanitizeLeaderboardName('  Ada   Lovelace  '), 'Ada Lovelace');
assert.equal(sanitizeLeaderboardName(''), 'Player');
assert.equal(sanitizeLeaderboardName('abcdefghijklmnopqrstuvwxyzzz'), 'abcdefghijklmnopqrstuvwx');

assert.equal(
  validateScoreSubmission({
    name: 'Nook',
    timeMs: STOP_ZONE_DEFAULTS.minScoreTimeMs,
    stops: STOP_ZONE_DEFAULTS.winStops,
  }).ok,
  true,
);

assert.equal(
  validateScoreSubmission({
    name: 'Nook',
    timeMs: STOP_ZONE_DEFAULTS.minScoreTimeMs - 1,
    stops: STOP_ZONE_DEFAULTS.winStops,
  }).ok,
  false,
);

assert.equal(
  validateScoreSubmission({
    name: 'Nook',
    timeMs: 12000,
    stops: STOP_ZONE_DEFAULTS.winStops - 1,
  }).ok,
  false,
);

assert.deepEqual(
  selectBestScoresByUniqueName(
    [
      { name: 'nick', timeMs: 30000, createdAt: 3 },
      { name: 'Ada', timeMs: 25000, createdAt: 2 },
      { name: 'Nick', timeMs: 28000, createdAt: 4 },
      { name: 'ada ', timeMs: 26000, createdAt: 1 },
    ],
    10,
  ),
  [
    { name: 'Ada', timeMs: 25000, createdAt: 2 },
    { name: 'Nick', timeMs: 28000, createdAt: 4 },
  ],
);

console.log('Kinematics helper tests passed.');
