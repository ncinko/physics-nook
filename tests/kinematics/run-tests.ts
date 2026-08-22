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
import {
  SAMPLE_T_MAX,
  SAMPLE_T_MIN,
  accelerationOfT,
  areaUnderAcceleration,
  areaUnderVelocity,
  SAMPLE_PATH_LENGTH,
  TURN_END,
  TURN_START,
  V_CRUISE,
  V_REVERSE,
  speedTrend,
  averageRate,
  clampSampleT,
  pathLengthOfT,
  positionOfT,
  velocityOfT,
} from '../../src/lib/kinematics/sampleMotion.ts';
import { readFileSync } from 'node:fs';
import { fixed } from '../../src/utils/format.ts';
import { TAU, pointerToTime, timeToAngle, wrapTime } from '../../src/lib/kinematics/stopwatch.ts';
import {
  HEDGEHOG_CELLS,
  HEDGEHOG_CELL_H,
  HEDGEHOG_CELL_W,
  HEDGEHOG_SHEET_COLS,
  HEDGEHOG_SHEET_H,
  HEDGEHOG_SHEET_ROWS,
  HEDGEHOG_SHEET_SRC,
  HEDGEHOG_SHEET_W,
  HEDGEHOG_GUTTER,
  HEDGEHOG_STAND_FRAME,
  cellOrigin,
  type HedgehogFrameName,
} from '../../src/components/kinematics/hedgehogSheet.ts';
import {
  BRACE_SPEED,
  BRAKE_FRAME,
  IDLE_SPEED,
  RUN_CYCLE,
  RUN_SPEED,
  RUN_STRIDE,
  STAND_FRAME,
  WALK_CYCLE,
  WALK_STRIDE,
  hedgehogGait,
  strideIndex,
} from '../../src/lib/kinematics/hedgehogGait.ts';
import {
  selectBestGoalRushScoresByUniqueName,
  validateGoalRushScoreSubmission,
} from '../../src/lib/kinematics/goalRush.ts';

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

assert.equal(
  validateGoalRushScoreSubmission({
    name: 'Nook',
    score: 5,
    normalHits: 2,
    goldenHits: 1,
    durationMs: 30000,
  }).ok,
  true,
);

assert.equal(
  validateGoalRushScoreSubmission({
    name: 'Nook',
    score: 4,
    normalHits: 2,
    goldenHits: 1,
    durationMs: 30000,
  }).ok,
  false,
);

assert.deepEqual(
  selectBestGoalRushScoresByUniqueName(
    [
      { name: 'nick', score: 8, normalHits: 5, goldenHits: 1, durationMs: 32000, createdAt: 3 },
      { name: 'Ada', score: 11, normalHits: 5, goldenHits: 2, durationMs: 34000, createdAt: 2 },
      { name: 'Nick', score: 8, normalHits: 5, goldenHits: 1, durationMs: 30000, createdAt: 4 },
      { name: 'ada ', score: 9, normalHits: 6, goldenHits: 1, durationMs: 26000, createdAt: 1 },
    ],
    10,
  ),
  [
    { name: 'Ada', score: 11, normalHits: 5, goldenHits: 2, durationMs: 34000, createdAt: 2 },
    { name: 'Nick', score: 8, normalHits: 5, goldenHits: 1, durationMs: 30000, createdAt: 4 },
  ],
);


// Sample motion shared by the kinematics graph explorers: the derivative and
// area relationships the lesson page claims must actually hold.
const numericDerivative = (f: (t: number) => number, t: number, h = 1e-6) =>
  (f(t + h) - f(t - h)) / (2 * h);

const numericIntegral = (f: (t: number) => number, t1: number, t2: number, steps = 20000) => {
  const dt = (t2 - t1) / steps;
  let total = 0;
  for (let i = 0; i < steps; i += 1) {
    total += f(t1 + (i + 0.5) * dt) * dt;
  }
  return total;
};

[0.5, 2, 4.4, 7, 9.5].forEach((t) => {
  near(numericDerivative(positionOfT, t), velocityOfT(t), 1e-5);
  near(numericDerivative(velocityOfT, t), accelerationOfT(t), 1e-5);
});

near(numericIntegral(accelerationOfT, 2, 9), areaUnderAcceleration(2, 9), 1e-6);
near(numericIntegral(velocityOfT, 2, 9), areaUnderVelocity(2, 9), 1e-6);

// The signed area is negative while a(t) is below the axis.
assert.ok(areaUnderAcceleration(0, 2) < 0);
assert.ok(areaUnderAcceleration(6, 10) > 0);

near(averageRate(velocityOfT, 2, 9), (velocityOfT(9) - velocityOfT(2)) / 7);

assert.equal(clampSampleT(-3), SAMPLE_T_MIN);
assert.equal(clampSampleT(42), SAMPLE_T_MAX);
assert.equal(clampSampleT(4.4), 4.4);

// The cycle has to close: the hedgehog leaves at the same velocity it arrived
// with, and with the same (zero) acceleration, so wrapping the animation shows
// no jump in speed, gait, or whether it is speeding up.
assert.equal(velocityOfT(SAMPLE_T_MIN), velocityOfT(SAMPLE_T_MAX));
assert.equal(velocityOfT(SAMPLE_T_MIN), V_CRUISE);
assert.equal(accelerationOfT(SAMPLE_T_MIN), 0);
assert.equal(accelerationOfT(SAMPLE_T_MAX), 0);
assert.equal(speedTrend(velocityOfT(0), accelerationOfT(0)), 'constant');
assert.equal(speedTrend(velocityOfT(10), accelerationOfT(10)), 'constant');

// It enters at one end of the track and leaves at the other.
near(positionOfT(SAMPLE_T_MIN), 0, 1e-12);
near(positionOfT(SAMPLE_T_MAX), 10, 1e-9);

// Acceleration is exactly zero across both constant-velocity stretches, so
// x(t) is straight and v(t) is flat there.
[0, 0.5, 1, TURN_START, TURN_END, 9, 9.5, SAMPLE_T_MAX].forEach((t) => {
  assert.equal(accelerationOfT(t), 0, `acceleration should be exactly zero at t=${t}`);
  assert.equal(velocityOfT(t), V_CRUISE, `velocity should hold at t=${t}`);
});
near(averageRate(positionOfT, 0, TURN_START), V_CRUISE, 1e-12);
near(averageRate(positionOfT, TURN_END, SAMPLE_T_MAX), V_CRUISE, 1e-9);
// Straight line: the midpoint sits exactly halfway between the endpoints.
near(positionOfT(TURN_START / 2), positionOfT(TURN_START) / 2, 1e-12);

// A full sine period of acceleration integrates to nothing, which is precisely
// why the velocity comes back to where it began.
near(areaUnderAcceleration(TURN_START, TURN_END), 0, 1e-9);

// Acceleration is continuous into and out of the turning section.
near(accelerationOfT(TURN_START + 1e-6), 0, 1e-5);
near(accelerationOfT(TURN_END - 1e-6), 0, 1e-5);

// Exactly two turnarounds: right, then left, then right again.
const signChanges: number[] = [];
let previousVelocity = velocityOfT(SAMPLE_T_MIN);
for (let t = 0.001; t <= SAMPLE_T_MAX; t += 0.001) {
  const v = velocityOfT(t);
  if (previousVelocity > 0 !== v > 0) {
    signChanges.push(t);
  }
  previousVelocity = v;
}
assert.equal(signChanges.length, 2, 'the motion should turn around exactly twice');
assert.ok(signChanges[0] > TURN_START && signChanges[1] < TURN_END);

// The leftward excursion bottoms out halfway through the turning section.
near(velocityOfT((TURN_START + TURN_END) / 2), V_REVERSE, 1e-9);
assert.ok(V_REVERSE < 0);
assert.ok(V_CRUISE > 0);

// Speed trend is about speed, not velocity.
assert.equal(speedTrend(2, 0), 'constant');
assert.equal(speedTrend(-0.8, 0), 'constant');
assert.equal(speedTrend(2, 1), 'speeding-up');
assert.equal(speedTrend(-2, -1), 'speeding-up', 'leftward and getting faster is speeding up');
assert.equal(speedTrend(2, -1), 'slowing-down');
assert.equal(speedTrend(-2, 1), 'slowing-down');
assert.equal(speedTrend(0, -1), 'speeding-up', 'from rest, any acceleration speeds it up');


// Hedgehog sprite sheet. The art lives in a PNG, so what can be checked here is
// that the code's picture of the sheet matches the file on disk and that every
// pose the gait can ask for actually has a cell.
const sheetPath = new URL(`../../public${HEDGEHOG_SHEET_SRC}`, import.meta.url);
const sheetBytes = readFileSync(sheetPath);
assert.equal(sheetBytes.subarray(1, 4).toString('ascii'), 'PNG', 'sprite sheet should be a PNG');
// PNG IHDR puts width and height at byte 16 and 20, big-endian.
assert.equal(sheetBytes.readUInt32BE(16), HEDGEHOG_SHEET_W, 'sheet width should match the metadata');
assert.equal(sheetBytes.readUInt32BE(20), HEDGEHOG_SHEET_H, 'sheet height should match the metadata');
// The gutter is what stops one cell's feet bleeding into the cell above it, so
// the sheet has to be big enough to actually contain it.
assert.ok(HEDGEHOG_GUTTER >= 1);
assert.equal(
  HEDGEHOG_SHEET_W,
  HEDGEHOG_GUTTER + HEDGEHOG_SHEET_COLS * (HEDGEHOG_CELL_W + HEDGEHOG_GUTTER),
);
assert.equal(
  HEDGEHOG_SHEET_H,
  HEDGEHOG_GUTTER + HEDGEHOG_SHEET_ROWS * (HEDGEHOG_CELL_H + HEDGEHOG_GUTTER),
);

const cellNames = Object.keys(HEDGEHOG_CELLS) as HedgehogFrameName[];
assert.equal(cellNames.length, 11, 'four walking, four running, three braking');

const occupied = new Set<string>();
cellNames.forEach((name) => {
  const cell = HEDGEHOG_CELLS[name];
  assert.ok(cell.col >= 0 && cell.col < HEDGEHOG_SHEET_COLS, `${name} column is off the sheet`);
  assert.ok(cell.row >= 0 && cell.row < HEDGEHOG_SHEET_ROWS, `${name} row is off the sheet`);
  const key = `${cell.col},${cell.row}`;
  assert.ok(!occupied.has(key), `two frames share cell ${key}`);
  occupied.add(key);

  // Every cell, gutter included, has to sit inside the image.
  const origin = cellOrigin(cell);
  assert.ok(origin.x >= HEDGEHOG_GUTTER && origin.y >= HEDGEHOG_GUTTER);
  assert.ok(
    origin.x + HEDGEHOG_CELL_W + HEDGEHOG_GUTTER <= HEDGEHOG_SHEET_W,
    `${name} runs past the right edge`,
  );
  assert.ok(
    origin.y + HEDGEHOG_CELL_H + HEDGEHOG_GUTTER <= HEDGEHOG_SHEET_H,
    `${name} runs past the bottom edge`,
  );
});

// No two cells may touch: a gutter of at least one pixel has to separate every
// pair, or a sprite's feet end up sampled into its neighbour.
cellNames.forEach((a) => {
  cellNames.forEach((b) => {
    if (a === b) return;
    const oa = cellOrigin(HEDGEHOG_CELLS[a]);
    const ob = cellOrigin(HEDGEHOG_CELLS[b]);
    const gapX = Math.max(oa.x - (ob.x + HEDGEHOG_CELL_W), ob.x - (oa.x + HEDGEHOG_CELL_W));
    const gapY = Math.max(oa.y - (ob.y + HEDGEHOG_CELL_H), ob.y - (oa.y + HEDGEHOG_CELL_H));
    assert.ok(
      gapX >= HEDGEHOG_GUTTER || gapY >= HEDGEHOG_GUTTER,
      `${a} and ${b} are not separated by a gutter`,
    );
  });
});

// The gait module names its frames independently of the sheet; they must agree.
[...WALK_CYCLE, ...RUN_CYCLE, BRAKE_FRAME, STAND_FRAME].forEach((name) => {
  assert.ok(name in HEDGEHOG_CELLS, `gait frame ${name} has no cell on the sheet`);
});
assert.equal(STAND_FRAME, HEDGEHOG_STAND_FRAME);

// Stride phase advances with distance and wraps cleanly.
assert.equal(strideIndex(0, WALK_STRIDE), 0);
assert.equal(strideIndex(WALK_STRIDE / 4, WALK_STRIDE), 1);
assert.equal(strideIndex(WALK_STRIDE / 2, WALK_STRIDE), 2);
assert.equal(strideIndex(WALK_STRIDE, WALK_STRIDE), 0);
assert.equal(strideIndex(WALK_STRIDE * 3, WALK_STRIDE), 0);

// A running hedgehog covers more ground per stride, so at one fixed distance the
// two gaits sit at different points in their cycles.
assert.ok(RUN_STRIDE > WALK_STRIDE);

// Standing still: feet stop, and the last facing is kept rather than snapping.
const parked = hedgehogGait({
  distance: 4,
  velocity: 0,
  acceleration: 0.5,
  previousFacing: -1,
});
assert.equal(parked.frame, STAND_FRAME);
assert.equal(parked.gait, 'stand');
assert.equal(parked.facing, -1);

// Facing follows the sign of the velocity once it is clearly moving.
assert.equal(hedgehogGait({ distance: 0, velocity: 2, acceleration: 0 }).facing, 1);
assert.equal(hedgehogGait({ distance: 0, velocity: -2, acceleration: 0 }).facing, -1);

// Speed picks the gait: an amble walks, a dash runs.
const ambling = hedgehogGait({ distance: 0, velocity: 0.8, acceleration: 0 });
assert.equal(ambling.gait, 'walk');
assert.ok(WALK_CYCLE.includes(ambling.frame));

const dashing = hedgehogGait({ distance: 0, velocity: RUN_SPEED + 0.5, acceleration: 0 });
assert.equal(dashing.gait, 'run');
assert.ok(RUN_CYCLE.includes(dashing.frame));

// Slowing down at speed keeps running; slowing near the turnaround braces.
const fastAndSlowing = hedgehogGait({ distance: 0, velocity: 3, acceleration: -1.6 });
assert.ok(fastAndSlowing.slowing);
assert.equal(fastAndSlowing.gait, 'run');

const aboutToTurn = hedgehogGait({ distance: 0, velocity: 0.4, acceleration: -1.6 });
assert.equal(aboutToTurn.gait, 'brake');
assert.equal(aboutToTurn.frame, BRAKE_FRAME);
assert.ok(aboutToTurn.slowing);

// Speeding up never braces, however slow it is going.
const creepingUp = hedgehogGait({ distance: 0, velocity: 0.4, acceleration: 1.6 });
assert.equal(creepingUp.slowing, false);
assert.notEqual(creepingUp.gait, 'brake');

// One held brace pose, so braking looks identical whichever way it faces.
const brakingRight = hedgehogGait({ distance: 0, velocity: 0.4, acceleration: -1.6 });
const brakingLeft = hedgehogGait({ distance: 0, velocity: -0.4, acceleration: 1.6 });
assert.equal(brakingRight.frame, brakingLeft.frame);
assert.equal(brakingRight.facing, 1);
assert.equal(brakingLeft.facing, -1);
// ...and it does not change as the hedgehog winds down to a stop.
[0.8, 0.5, 0.25, 0.13].forEach((speed) => {
  assert.equal(hedgehogGait({ distance: 0, velocity: speed, acceleration: -1.6 }).frame, BRAKE_FRAME);
});

assert.ok(IDLE_SPEED < BRACE_SPEED);
assert.ok(BRACE_SPEED < RUN_SPEED);

// Path length is distance, not displacement: monotonic, and larger than the net
// displacement across the stretch where the sample motion doubles back.
let previousPath = -1;
for (let t = 0; t <= SAMPLE_T_MAX; t += 0.25) {
  const value = pathLengthOfT(t);
  assert.ok(value >= previousPath, `path length should not decrease at t=${t}`);
  previousPath = value;
}
near(pathLengthOfT(SAMPLE_T_MIN), 0);

// Across the opening cruise the motion never reverses, so distance equals the
// magnitude of the displacement.
near(pathLengthOfT(TURN_START), Math.abs(positionOfT(TURN_START) - positionOfT(0)), 1e-3);

// Over the whole cycle it doubles back, so the ground covered exceeds the ten
// metres of net displacement.
near(pathLengthOfT(SAMPLE_T_MAX), SAMPLE_PATH_LENGTH, 1e-9);

// Over the full run it reverses once, so distance exceeds displacement.
assert.ok(
  pathLengthOfT(SAMPLE_T_MAX) >
    Math.abs(positionOfT(SAMPLE_T_MAX) - positionOfT(SAMPLE_T_MIN)) + 1,
);

// Readouts across these widgets format signed quantities, and several of them
// pass through zero: the acceleration at the top of the turn, the velocity at a
// turnaround. None of them may render as "-0.00".
assert.equal(fixed(-1e-16), '0.00');
assert.equal(fixed(-0.0001), '0.00');
assert.equal(fixed(-0), '0.00');
assert.equal(fixed(0), '0.00');
assert.equal(fixed(-0.006), '-0.01');
assert.equal(fixed(2.4), '2.40');
assert.equal(fixed(-1.605), '-1.60');
assert.equal(fixed(-0.04, 1), '0.0');
assert.equal(accelerationOfT((TURN_START + TURN_END) / 2) <= 0, true);
assert.equal(fixed(accelerationOfT((TURN_START + TURN_END) / 2)), '0.00');

// Stopwatch dial. The hand sweeps once across the whole run, clockwise from
// twelve o'clock, and the dial wraps rather than clamps because the motion it
// scrubs is a closed cycle.
near(timeToAngle(0, 10), 0);
near(timeToAngle(2.5, 10), TAU / 4);
near(timeToAngle(5, 10), Math.PI);
near(timeToAngle(10, 10), TAU);

// Pointer offsets are screen coordinates, so y grows downward.
near(pointerToTime(0, -50, 10), 0, 1e-9); // straight up
near(pointerToTime(50, 0, 10), 2.5, 1e-9); // right
near(pointerToTime(0, 50, 10), 5, 1e-9); // straight down
near(pointerToTime(-50, 0, 10), 7.5, 1e-9); // left
// Distance from the centre does not matter, only direction.
near(pointerToTime(7, 0, 10), pointerToTime(140, 0, 10), 1e-12);

// Stepping off either end comes back round rather than sticking.
near(wrapTime(10.1, 10), 0.1, 1e-9);
near(wrapTime(-0.1, 10), 9.9, 1e-9);
near(wrapTime(0, 10), 0);
near(wrapTime(9.9, 10), 9.9, 1e-9);
// Wrapping lands on a matching velocity, which is what makes the seam invisible.
near(velocityOfT(wrapTime(-0.0001, 10)), velocityOfT(0), 1e-3);

console.log('Kinematics helper tests passed.');
