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
import { stripsUnder } from '../../src/lib/kinematics/areaStrips.ts';
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
  HEDGEHOG_ROLL_RADIUS,
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
  ROLL_FRAME,
  ROLL_SPEED,
  RUN_STRIDE,
  STAND_FRAME,
  rollAngle,
  WALK_CYCLE,
  WALK_STRIDE,
  hedgehogGait,
  strideIndex,
} from '../../src/lib/kinematics/hedgehogGait.ts';
import {
  selectBestGoalRushScoresByUniqueName,
  validateGoalRushScoreSubmission,
} from '../../src/lib/kinematics/goalRush.ts';
import {
  deriveSeries,
  estimateFrameRate,
  frameFromCalibration,
  frameIndexForTime,
  kinematicsFromQuadratic,
  niceTicks,
  serializeTracks,
  timeForFrameIndex,
  toPhysical,
  toPixel,
  upsertPoint,
  type Calibration,
  type CoordinateFrame,
  type TrackedPoint,
} from '../../src/lib/kinematics/videoAnalysis.ts';
import { fitPolynomial } from '../../src/lib/math/leastSquares.ts';
import { formatMeasurement } from '../../src/lib/measurement/uncertainty.ts';

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
assert.equal(cellNames.length, 12, 'four walking, four running, three braking, one curled');

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
[...WALK_CYCLE, ...RUN_CYCLE, BRAKE_FRAME, STAND_FRAME, ROLL_FRAME].forEach((name) => {
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
assert.ok(RUN_SPEED < ROLL_SPEED);

// Past a flat sprint the legs give up and the hedgehog curls into a ball. Only
// the stop-in-zones challenge gets this fast; the lesson's motion never does.
const sprinting = hedgehogGait({ distance: 3, velocity: ROLL_SPEED - 0.1, acceleration: 0 });
assert.equal(sprinting.gait, 'run');

const rolling = hedgehogGait({ distance: 3, velocity: ROLL_SPEED + 2, acceleration: 0 });
assert.equal(rolling.gait, 'roll');
assert.equal(rolling.frame, ROLL_FRAME);
assert.equal(hedgehogGait({ distance: 3, velocity: -(ROLL_SPEED + 2), acceleration: 0 }).gait, 'roll');
// Braking still wins when it is nearly stopped, whatever it was doing before.
assert.equal(hedgehogGait({ distance: 3, velocity: 0.4, acceleration: -3 }).gait, 'brake');
assert.ok(velocityOfT(SAMPLE_T_MAX) < ROLL_SPEED, 'the lesson motion never rolls');

// Rolling without slipping: one radius of travel is one radian of turn, and
// rolling back over the same ground unwinds the spin exactly.
assert.ok(HEDGEHOG_ROLL_RADIUS > 0);
near(rollAngle(0, 0.4), 0);
near(rollAngle(0.4, 0.4), 1);
near(rollAngle(2 * Math.PI * 0.4, 0.4), Math.PI * 2);
near(rollAngle(-1.2, 0.4), -3);
near(rollAngle(1.2, 0.4) + rollAngle(-1.2, 0.4), 0, 1e-12);

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


// Area strips. Whatever the strip count, a constant velocity is reproduced
// exactly - the special case the whole strip picture is built on.
const constantStrips = stripsUnder(() => 2.4, 0, 10, 7);
near(constantStrips.total, 24, 1e-12);
near(constantStrips.width, 10 / 7);
assert.equal(constantStrips.strips.length, 7);
near(constantStrips.strips[6].to, 10, 1e-12);

// Counts below one or between integers fall back to whole strips.
assert.equal(stripsUnder(velocityOfT, 0, 10, 0).strips.length, 1);
assert.equal(stripsUnder(velocityOfT, 0, 10, 3.7).strips.length, 3);

// A strip sitting under the leftward stretch of the run subtracts.
assert.equal(stripsUnder(velocityOfT, 4, 5, 1).strips[0].area < 0, true);
assert.equal(stripsUnder(velocityOfT, 4, 5, 1, { signed: false }).strips[0].area > 0, true);

// Narrower strips close on the exact displacement, which is what the interactive
// in the lesson asks the reader to watch happen.
const coarseStrips = stripsUnder(velocityOfT, SAMPLE_T_MIN, SAMPLE_T_MAX, 5);
const fineStrips = stripsUnder(velocityOfT, SAMPLE_T_MIN, SAMPLE_T_MAX, 400);
const exactDisplacement = areaUnderVelocity(SAMPLE_T_MIN, SAMPLE_T_MAX);
assert.equal(
  Math.abs(fineStrips.total - exactDisplacement) < Math.abs(coarseStrips.total - exactDisplacement),
  true,
);
near(fineStrips.total, exactDisplacement, 0.05);

// Dropping the signs turns the same strips into distance travelled, which is
// larger because the motion doubles back.
const distanceStrips = stripsUnder(velocityOfT, SAMPLE_T_MIN, SAMPLE_T_MAX, 400, { signed: false });
near(distanceStrips.total, SAMPLE_PATH_LENGTH, 0.05);
assert.equal(distanceStrips.total > fineStrips.total, true);

console.log('Kinematics helper tests passed.');

// --- Video analysis ---------------------------------------------------------

const videoCalibration = (overrides: Partial<Calibration> = {}): Calibration => ({
  // A 300 px ruler declared to be 1.5 m long: 0.005 m per pixel.
  scaleFrom: { px: 100, py: 400 },
  scaleTo: { px: 400, py: 400 },
  scaleLengthMeters: 1.5,
  origin: { px: 100, py: 400 },
  axisAngleDeg: 0,
  positionUncertaintyPx: 2,
  ...overrides,
});

const requireFrame = (calibration: Calibration): CoordinateFrame => {
  const frame = frameFromCalibration(calibration);
  if (!frame) throw new Error('calibration should produce a coordinate frame');
  return frame;
};

near(requireFrame(videoCalibration()).metersPerPixel, 0.005);
// A ruler with no length, or no declared length, is not a calibration.
assert.equal(
  frameFromCalibration(videoCalibration({ scaleTo: { px: 100, py: 400 } })),
  null,
);
assert.equal(frameFromCalibration(videoCalibration({ scaleLengthMeters: 0 })), null);

// Video y grows downward and physics y grows upward, so a point higher up the
// frame is at positive y.
{
  const frame = requireFrame(videoCalibration());
  const above = toPhysical(frame, { px: 100, py: 300 });
  near(above.x, 0);
  near(above.y, 0.5);
  const atOrigin = toPhysical(frame, { px: 100, py: 400 });
  near(atOrigin.x, 0);
  near(atOrigin.y, 0);
}

// The pixel transform round-trips at every axis angle, and it is an isometry —
// distances do not depend on how the axes are tilted, which is what justifies
// drawing one isotropic error bar per point.
for (const axisAngleDeg of [0, 30, -45, 90, 180]) {
  const frame = requireFrame(videoCalibration({ axisAngleDeg }));
  const samples = [
    { px: 100, py: 400 },
    { px: 250, py: 120 },
    { px: 620, py: 455 },
  ];
  samples.forEach((pixel) => {
    const round = toPixel(frame, toPhysical(frame, pixel));
    near(round.px, pixel.px);
    near(round.py, pixel.py);
  });
  const first = toPhysical(frame, samples[1]);
  const second = toPhysical(frame, samples[2]);
  near(
    Math.hypot(first.x - second.x, first.y - second.y),
    Math.hypot(samples[1].px - samples[2].px, samples[1].py - samples[2].py) * 0.005,
  );
}

// Tilting the axes by 90 degrees points physical +x straight up the screen.
{
  const frame = requireFrame(videoCalibration({ axisAngleDeg: 90 }));
  const above = toPhysical(frame, { px: 100, py: 300 });
  near(above.x, 0.5);
  near(above.y, 0);
}

// A point lying along a 30-degree incline has no perpendicular offset once the
// axes are tilted to match the incline.
{
  const frame = requireFrame(videoCalibration({ axisAngleDeg: 30 }));
  const alongSlope = toPhysical(frame, {
    px: 100 + 200 * Math.cos(Math.PI / 6),
    py: 400 - 200 * Math.sin(Math.PI / 6),
  });
  near(alongSlope.x, 200 * 0.005);
  near(alongSlope.y, 0, 1e-12);
}

const videoPoints = (
  frame: CoordinateFrame,
  times: readonly number[],
  motion: (t: number) => { x: number; y: number },
): TrackedPoint[] =>
  times.map((time, i) => ({
    id: i,
    time,
    exactTime: true,
    pixel: toPixel(frame, motion(time)),
  }));

// Three-point stencils are exact for a quadratic, so a synthetic
// x(t) = 1 + 2t + 3t^2 must come back with velocity 2 + 6t and acceleration 6
// at every interior sample.
{
  const frame = requireFrame(videoCalibration());
  const times = Array.from({ length: 21 }, (_, i) => i / 30);
  const motion = (t: number) => ({ x: 1 + 2 * t + 3 * t * t, y: 0 });
  const samples = deriveSeries(videoPoints(frame, times, motion), frame, 2, 30);

  assert.equal(samples.length, 21);
  for (let i = 1; i < samples.length - 1; i += 1) {
    near(samples[i].x, motion(times[i]).x, 1e-9);
    near(samples[i].vx as number, 2 + 6 * times[i], 1e-9);
    near(samples[i].ax as number, 6, 1e-8);
    near(samples[i].vy as number, 0, 1e-9);
  }

  // Endpoints carry no derivative at all, rather than a noisy one-sided guess.
  assert.equal(samples[0].vx, null);
  assert.equal(samples[0].ax, null);
  assert.equal(samples[0].sigmaVx, null);
  assert.equal(samples[samples.length - 1].vx, null);
  assert.equal(samples[samples.length - 1].ax, null);

  // Uncertainty propagation through the uniform-spacing stencils.
  const sigma = 2 * 0.005;
  const h = 1 / 30;
  near(samples[1].sigmaVx as number, (sigma * Math.SQRT2) / (2 * h), 1e-12);
  near(samples[1].sigmaAx as number, (sigma * Math.sqrt(6)) / (h * h), 1e-9);
  near(samples[1].sigmaX, sigma, 1e-15);
  near(samples[1].sigmaY, sigma, 1e-15);

  // Frame indices are derived, so they follow the frame rate rather than being
  // baked in when the point was marked.
  assert.equal(samples[7].frame, 7);
  assert.equal(deriveSeries(videoPoints(frame, times, motion), frame, 2, 60)[7].frame, 14);
}

// Isotropy: the position uncertainty is the same on both axes at any tilt.
for (const axisAngleDeg of [0, 17, -80, 135]) {
  const frame = requireFrame(videoCalibration({ axisAngleDeg }));
  const samples = deriveSeries(
    videoPoints(frame, [0, 1 / 30, 2 / 30], (t) => ({ x: t, y: 2 * t })),
    frame,
    3,
    30,
  );
  near(samples[1].sigmaX, 3 * 0.005, 1e-15);
  near(samples[1].sigmaY, 3 * 0.005, 1e-15);
}

// Unevenly spaced samples are the normal case — a skipped frame, a seek that
// lands early. The naive centred difference would report the derivative at the
// midpoint of the outer pair (t = 0.2) instead of at the sample (t = 0.1).
{
  const frame = requireFrame(videoCalibration());
  const motion = (t: number) => ({ x: 1 + 2 * t + 3 * t * t, y: 0 });
  const samples = deriveSeries(videoPoints(frame, [0, 0.1, 0.4], motion), frame, 2, 30);
  const naive = (motion(0.4).x - motion(0).x) / 0.4;
  near(samples[1].vx as number, 2 + 6 * 0.1, 1e-9);
  near(samples[1].ax as number, 6, 1e-9);
  near(naive, 2 + 6 * 0.2, 1e-12);
  assert.ok(
    Math.abs((samples[1].vx as number) - naive) > 0.1,
    'the non-uniform stencil must not collapse to the naive centred difference',
  );
}

// Frame rate estimation from measured presentation times.
{
  const evenly = (fps: number, count = 10) =>
    Array.from({ length: count }, (_, i) => i / fps);

  const thirty = estimateFrameRate(evenly(30));
  assert.equal(thirty?.fps, 30);
  assert.equal(thirty?.snapped, true);
  assert.equal(thirty?.sampleCount, 9);

  // 59.94 and 60 are 0.1% apart and not separable from a short sample; the
  // documented tie rule prefers the integer rate.
  const broadcast = estimateFrameRate(evenly(59.94));
  assert.equal(broadcast?.snapped, true);
  assert.equal(broadcast?.fps, 60);
  near(broadcast?.measuredFps as number, 59.94, 1e-9);

  // One dropped frame doubles a single gap; the median shrugs it off.
  const dropped = estimateFrameRate([0, 1 / 30, 2 / 30, 4 / 30, 5 / 30, 6 / 30]);
  assert.equal(dropped?.fps, 30);

  assert.equal(estimateFrameRate([]), null);
  assert.equal(estimateFrameRate([0.5]), null);
  // Duplicate and out-of-order timestamps are filtered rather than trusted.
  assert.equal(estimateFrameRate([1 / 30, 0, 0, 1 / 30])?.fps, 30);

  // A rate that is not standard is reported honestly instead of forced onto the
  // nearest familiar number.
  const odd = estimateFrameRate(evenly(17.3));
  assert.equal(odd?.snapped, false);
  near(odd?.fps as number, 17.3, 1e-9);
}

assert.equal(frameIndexForTime(0.0333, 30), 1);
assert.equal(frameIndexForTime(0, 30), 0);
near(timeForFrameIndex(1, 30), 1 / 30);

// The round trip the frame stepper stands on: a frame's own start time must
// always map back to that frame. Handing this function a mid-frame seek target
// instead rounds up, which makes every step advance two frames.
for (const fps of [24, 25, 29.97, 30, 59.94, 60, 120]) {
  for (let k = 0; k < 400; k += 7) {
    assert.equal(
      frameIndexForTime(timeForFrameIndex(k, fps), fps),
      k,
      `frame ${k} at ${fps} fps should round-trip`,
    );
  }
  // Documenting the trap rather than tolerating it: the midpoint does not.
  assert.equal(frameIndexForTime((3 + 0.5) / fps, fps), 4);
}

// Marking a frame twice replaces the earlier point instead of stacking a
// duplicate, and the list stays sorted by time.
{
  const first: TrackedPoint = { id: 1, time: 0, exactTime: true, pixel: { px: 10, py: 10 } };
  const second: TrackedPoint = { id: 2, time: 2 / 30, exactTime: true, pixel: { px: 20, py: 20 } };
  const remark: TrackedPoint = { id: 3, time: 2 / 30, exactTime: true, pixel: { px: 99, py: 99 } };
  const middle: TrackedPoint = { id: 4, time: 1 / 30, exactTime: true, pixel: { px: 15, py: 15 } };

  let points = upsertPoint(upsertPoint([], first, 30), second, 30);
  assert.equal(points.length, 2);
  points = upsertPoint(points, remark, 30);
  assert.equal(points.length, 2);
  assert.equal(points[1].pixel.px, 99);
  points = upsertPoint(points, middle, 30);
  assert.deepEqual(
    points.map((point) => point.id),
    [1, 4, 3],
  );
}

// Serialisation.
{
  const frame = requireFrame(videoCalibration());
  const ball = deriveSeries(
    videoPoints(frame, [0, 1 / 30, 2 / 30, 3 / 30], (t) => ({ x: t, y: 1 - 4.9 * t * t })),
    frame,
    2,
    30,
  );

  const tsv = serializeTracks([{ label: 'Ball', samples: ball }], {
    delimiter: '\t',
    columns: ['frame', 'time', 'x', 'y', 'vx'],
    layout: 'wide',
  });
  const lines = tsv.split('\n');
  assert.equal(lines.length, 5, 'header plus one row per point');
  assert.equal(tsv.endsWith('\n'), false, 'no trailing newline to paste as a blank row');
  // A single track needs no label prefix on its columns.
  assert.deepEqual(lines[0].split('\t'), ['frame', 't (s)', 'x (m)', 'y (m)', 'vx (m/s)']);
  assert.equal(lines[1].split('\t')[0], '0');
  // The endpoint velocity is blank, not a zero that would read as a measurement.
  assert.equal(lines[1].split('\t')[4], '');
  assert.equal(lines[4].split('\t')[4], '');
  assert.ok(lines[2].split('\t')[4].length > 0, 'interior rows do carry a velocity');

  // Two tracks marked on overlapping but different frames align on the shared
  // frame column, with blanks where a track has no point.
  const cart = deriveSeries(
    videoPoints(frame, [2 / 30, 3 / 30, 4 / 30], (t) => ({ x: 2 * t, y: 0 })),
    frame,
    2,
    30,
  );
  const wide = serializeTracks(
    [
      { label: 'Ball', samples: ball },
      { label: 'Cart', samples: cart },
    ],
    { delimiter: '\t', columns: ['frame', 'time', 'x'], layout: 'wide' },
  );
  const wideLines = wide.split('\n');
  assert.equal(wideLines.length, 6, 'five distinct frames plus the header');
  assert.deepEqual(wideLines[0].split('\t'), [
    'frame',
    'Ball: t (s)',
    'Ball: x (m)',
    'Cart: t (s)',
    'Cart: x (m)',
  ]);
  // Frame 0 has a ball reading and no cart reading; frame 4 is the other way up.
  assert.equal(wideLines[1].split('\t')[3], '');
  assert.equal(wideLines[5].split('\t')[1], '');
  assert.ok(wideLines[5].split('\t')[3].length > 0);

  // Student-typed labels are data, and they end up in the output. CSV quotes
  // them properly; TSV, which has no quoting mechanism, neutralises separators.
  const awkward = [{ label: 'Ball, "red"\ttwo', samples: ball.slice(0, 2) }];
  const csv = serializeTracks(awkward, {
    delimiter: ',',
    columns: ['time', 'x'],
    layout: 'long',
  });
  assert.equal(csv.split('\n')[1].startsWith('"Ball, ""red""\ttwo",'), true);
  const tabbed = serializeTracks(awkward, {
    delimiter: '\t',
    columns: ['time', 'x'],
    layout: 'long',
  });
  assert.equal(tabbed.split('\n')[1].split('\t')[0], 'Ball, "red" two');
  assert.deepEqual(tabbed.split('\n')[0].split('\t'), ['track', 't (s)', 'x (m)']);
}

// Reading a quadratic position fit as physics: the acceleration is twice the
// leading coefficient, and so is its uncertainty.
{
  const times = Array.from({ length: 12 }, (_, i) => i / 30);
  const drop = times.map((t) => ({ x: t, y: 1.2 + 0.4 * t - 4.9 * t * t, sigma: 0.01 }));
  const result = fitPolynomial(drop, 2);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  const motion = kinematicsFromQuadratic(result.fit);
  near(motion.acceleration.value, -9.8, 1e-6);
  near(motion.initialVelocity.value, 0.4, 1e-6);
  near(motion.initialPosition.value, 1.2, 1e-6);
  near(motion.acceleration.uncertainty, 2 * result.fit.uncertainties[2], 1e-15);
  assert.ok(motion.acceleration.uncertainty > 0);
  assert.equal(typeof formatMeasurement(motion.acceleration), 'string');
}

// Axis ticks land on a 1 / 2 / 5 ladder inside the requested range, and a
// degenerate range still produces an axis instead of dividing by zero.
{
  const mantissaOf = (step: number) => step / 10 ** Math.floor(Math.log10(step));
  for (const [min, max] of [
    [0, 1],
    [-0.35, 0.35],
    [0, 9800],
    [1.4, 1.9],
  ]) {
    const ticks = niceTicks(min, max);
    assert.ok(ticks.length >= 3 && ticks.length <= 12, `tick count for ${min}..${max}`);
    ticks.forEach((tick) => assert.ok(tick >= min - 1e-9 && tick <= max + 1e-9));
    const mantissa = mantissaOf(ticks[1] - ticks[0]);
    assert.ok(
      [1, 2, 5].some((allowed) => Math.abs(mantissa - allowed) < 1e-6),
      `step mantissa ${mantissa} should be 1, 2, or 5`,
    );
  }
  assert.ok(niceTicks(4, 4).length > 0);
  assert.ok(niceTicks(0, 0).length > 0);
  assert.deepEqual(niceTicks(Number.NaN, 1), []);
}

console.log('Video analysis tests passed.');
