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
import { metadataAction } from '../../src/lib/kinematics/videoAnalysis.ts';
import {
  buildCaptionLines,
  fitSummaryGroups,
  fitSummaryLines,
  fitSummaryNote,
  fitSummaryProblem,
  type FitSummaryInput,
  type PlotExportMeta,
} from '../../src/lib/kinematics/fitSummary.ts';
import {
  TUTORIAL_FRAME_COUNT,
  TUTORIAL_SCALE_FRAME,
  TUTORIAL_STEPS,
  TUTORIAL_STEP_FRAMES,
  TUTORIAL_TARGET_POINTS,
  clampTutorialIndex,
  isLastTutorialStep,
  type TutorialProgress,
} from '../../src/lib/kinematics/videoTutorial.ts';
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
  sampleValue,
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

// The three-point stencil is exact for a quadratic, so a synthetic
// x(t) = 1 + 2t + 3t^2 must come back with velocity 2 + 6t at every interior
// sample.
{
  const frame = requireFrame(videoCalibration());
  const times = Array.from({ length: 21 }, (_, i) => i / 30);
  const motion = (t: number) => ({ x: 1 + 2 * t + 3 * t * t, y: 0 });
  const samples = deriveSeries(videoPoints(frame, times, motion), frame, 2, 30);

  assert.equal(samples.length, 21);
  for (let i = 1; i < samples.length - 1; i += 1) {
    near(samples[i].x, motion(times[i]).x, 1e-9);
    near(samples[i].vx as number, 2 + 6 * times[i], 1e-9);
    near(samples[i].vy as number, 0, 1e-9);
  }

  // Endpoints carry no derivative at all, rather than a noisy one-sided guess.
  assert.equal(samples[0].vx, null);
  assert.equal(samples[0].sigmaVx, null);
  assert.equal(samples[samples.length - 1].vx, null);
  assert.equal(samples[samples.length - 1].sigmaVx, null);

  // Uncertainty propagation through the uniform-spacing stencils.
  const sigma = 2 * 0.005;
  const h = 1 / 30;
  near(samples[1].sigmaVx as number, (sigma * Math.SQRT2) / (2 * h), 1e-12);
  near(samples[1].sigmaX, sigma, 1e-15);
  near(samples[1].sigmaY, sigma, 1e-15);

  // Frame indices are derived, so they follow the frame rate rather than being
  // baked in when the point was marked.
  assert.equal(samples[7].frame, 7);
  assert.equal(deriveSeries(videoPoints(frame, times, motion), frame, 2, 60)[7].frame, 14);
}

// Acceleration is deliberately not derived point by point: the second
// difference of hand-clicked positions is mostly click noise, and a column of it
// invites students to read that noise instead of fitting the positions.
{
  const frame = requireFrame(videoCalibration());
  const samples = deriveSeries(
    videoPoints(frame, [0, 1 / 30, 2 / 30], (t) => ({ x: t * t, y: 0 })),
    frame,
    2,
    30,
  );
  assert.equal('ax' in samples[1], false, 'no per-point acceleration is exposed');
  assert.equal('ay' in samples[1], false);
  assert.equal(sampleValue(samples[1], 'x') !== null, true);
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

  // The "raw" checkbox appends frame, px and py after the physics, and the
  // export has to honour that rather than hoisting frame to the front. It stays
  // one shared column — it is what aligns several objects onto a row — but it
  // sits where the caller put it.
  {
    const NEWLINE = String.fromCharCode(10);
    const TAB = String.fromCharCode(9);
    const trailing = serializeTracks([{ label: 'Ball', samples: ball }], {
      delimiter: ',',
      columns: ['time', 'x', 'y', 'px', 'py', 'frame'],
      layout: 'wide',
    });
    assert.deepEqual(trailing.split(NEWLINE)[0].split(','), [
      't (s)',
      'x (m)',
      'y (m)',
      'px (px)',
      'py (px)',
      'frame',
    ]);
    // The frame number is still the real index, just in the last column now.
    assert.equal(trailing.split(NEWLINE)[1].split(',').at(-1), '0');
    assert.equal(trailing.split(NEWLINE)[2].split(',').at(-1), '1');

    // Two objects still align on that one trailing column.
    const pair = serializeTracks(
      [
        { label: 'Ball', samples: ball },
        { label: 'Cart', samples: cart },
      ],
      { delimiter: '	', columns: ['time', 'x', 'frame'], layout: 'wide' },
    );
    assert.deepEqual(pair.split(NEWLINE)[0].split(TAB), [
      'Ball: t (s)',
      'Ball: x (m)',
      'Cart: t (s)',
      'Cart: x (m)',
      'frame',
    ]);
    assert.equal(pair.split(NEWLINE).length, 6, 'five distinct frames plus the header');

    // Leading frame is unchanged: it leads only when asked for first.
    const leading = serializeTracks([{ label: 'Ball', samples: ball }], {
      delimiter: ',',
      columns: ['frame', 'time', 'x'],
      layout: 'wide',
    });
    assert.deepEqual(leading.split(NEWLINE)[0].split(','), ['frame', 't (s)', 'x (m)']);

    // The long layout has no shared column at all, so order is simply kept.
    const long = serializeTracks([{ label: 'Ball', samples: ball }], {
      delimiter: ',',
      columns: ['time', 'x', 'px', 'py', 'frame'],
      layout: 'long',
    });
    assert.deepEqual(long.split(NEWLINE)[0].split(','), [
      'track',
      't (s)',
      'x (m)',
      'px (px)',
      'py (px)',
      'frame',
    ]);
  }

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

// --- Guided tutorial script ---------------------------------------------

// The state the lab is in the moment the sample clip finishes loading.
const freshTutorialProgress = (): TutorialProgress => ({
  mode: 'calibrate',
  scaleMoved: false,
  scaleLengthMeters: 1,
  originMoved: false,
  pointCount: 0,
  plotY: ['y'],
  fitModel: 'none',
  fitQuantity: 'y',
});

// The script only holds together if no step is already satisfied when the tour
// starts. A step whose condition is true on arrival auto-advances past itself,
// and the student sees a card flash by rather than an instruction — so this is
// the invariant worth guarding, not the prose.
{
  const fresh = freshTutorialProgress();
  TUTORIAL_STEPS.forEach((step) => {
    assert.equal(
      step.isComplete?.(fresh) ?? false,
      false,
      `step "${step.id}" is already complete before the student does anything`,
    );
  });
}

// Every step is a usable card: unique id, a title, and something to read.
{
  const ids = TUTORIAL_STEPS.map((step) => step.id);
  assert.equal(new Set(ids).size, ids.length, 'tutorial step ids must be unique');
  TUTORIAL_STEPS.forEach((step) => {
    // A title is optional — most steps let the body speak for itself — but a
    // title made only of whitespace would render an empty heading.
    assert.equal(step.title, step.title.trim(), `step "${step.id}" has a padded title`);
    assert.ok(step.body.length > 0, `step "${step.id}" needs body copy`);
    step.body.forEach((paragraph) => assert.ok(paragraph.trim().length > 0));
  });
}

// Seeks stay inside the clip, so a step can never park the tour on a frame that
// does not exist.
{
  TUTORIAL_STEPS.forEach((step) => {
    if (step.seekToFrame === undefined) return;
    assert.ok(
      step.seekToFrame >= 0 && step.seekToFrame < TUTORIAL_FRAME_COUNT,
      `step "${step.id}" seeks outside the clip`,
    );
  });
  assert.ok(TUTORIAL_SCALE_FRAME >= 0 && TUTORIAL_SCALE_FRAME < TUTORIAL_FRAME_COUNT);
}

// Each waiting step does finish once the student has done the thing it asks
// for, so the tour cannot dead-end on a condition nothing can satisfy.
{
  const done: TutorialProgress = {
    mode: 'mark',
    scaleMoved: true,
    scaleLengthMeters: 2,
    originMoved: true,
    pointCount: TUTORIAL_TARGET_POINTS,
    plotY: ['x'],
    fitModel: 'quadratic',
    fitQuantity: 'x',
  };
  const satisfiable = TUTORIAL_STEPS.filter((step) => step.isComplete);
  assert.ok(satisfiable.length >= 5, 'the tour should be mostly do-it-yourself');
  satisfiable.forEach((step) => {
    // `mode` is the one field a single end state cannot hold for every step at
    // once, so those are checked against their own mode.
    const progress =
      step.id === 'origin-mode' ? { ...done, mode: 'origin' as const } : done;
    assert.equal(step.isComplete!(progress), true, `step "${step.id}" can never complete`);
  });
}

// Order matters more than any individual step: marking before there is a scale
// or an origin produces a table of numbers that all have to be thrown away.
{
  const indexOf = (id: string) => TUTORIAL_STEPS.findIndex((step) => step.id === id);
  const marking = indexOf('mark-points');
  assert.ok(indexOf('scale-drag') < marking, 'the scale must be set before marking');
  assert.ok(indexOf('scale-length') < marking, 'the ruler length must be set before marking');
  assert.ok(indexOf('origin-click') < marking, 'the origin must be placed before marking');
  assert.ok(indexOf('frame-rate') < marking, 'the frame rate must be settled before marking');
  assert.ok(indexOf('fit') > marking, 'there is nothing to fit before marking');

  const markStep = TUTORIAL_STEPS[marking];
  assert.equal(markStep.setMode, 'mark');
  assert.equal(markStep.setStepFrames, TUTORIAL_STEP_FRAMES);
  // Skipping ahead with Next must still leave the lab in the state the step
  // describes, which is why the mode is applied on entry rather than assumed.
  assert.equal(TUTORIAL_STEPS[indexOf('scale-drag')].setMode, 'calibrate');
  assert.equal(TUTORIAL_STEPS[indexOf('origin-click')].setMode, 'origin');
}

// The live counter under the marking step reads as progress, not as a target.
{
  const markStep = TUTORIAL_STEPS.find((step) => step.id === 'mark-points')!;
  const status = markStep.status!({ ...freshTutorialProgress(), pointCount: 3 });
  assert.ok(status !== null && status.includes('3') && status.includes(String(TUTORIAL_TARGET_POINTS)));
}

// Index arithmetic survives the coach advancing from a timer around an exit.
{
  assert.equal(clampTutorialIndex(-4), 0);
  assert.equal(clampTutorialIndex(0), 0);
  assert.equal(clampTutorialIndex(TUTORIAL_STEPS.length + 10), TUTORIAL_STEPS.length - 1);
  assert.equal(isLastTutorialStep(TUTORIAL_STEPS.length - 1), true);
  assert.equal(isLastTutorialStep(0), false);
}

// Every control a step points at is really marked in the components. A renamed
// or dropped `data-tour` leaves the tour dimming the screen around nothing.
{
  const sources = [
    'src/components/kinematics/VideoAnalysisLab.tsx',
    'src/components/kinematics/videoAnalysis/ModeControls.tsx',
    'src/components/kinematics/videoAnalysis/TransportBar.tsx',
    'src/components/kinematics/videoAnalysis/VideoStage.tsx',
  ]
    .map((path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'))
    .join(' ');

  const anchors = new Set(
    TUTORIAL_STEPS.map((step) => step.anchor).filter((anchor): anchor is string => anchor !== null),
  );
  assert.ok(anchors.size > 0);
  anchors.forEach((anchor) => {
    // The mode buttons build their attribute from the mode name, so they are
    // matched against the template rather than a literal.
    const found = anchor.startsWith('mode-') && anchor !== 'mode-row'
      ? sources.includes('data-tour={`mode-${entry.value}`}')
      : sources.includes(`data-tour="${anchor}"`);
    assert.ok(found, `no data-tour="${anchor}" in the lab components`);
  });
}

// --- Fit summary and saved-plot caption ---------------------------------

// Constant acceleration, sampled exactly, so the coefficients are known: this
// is x = 1 + 2t + 3t², giving a = 2 x 3 = 6.
const summaryFit = () =>
  fitPolynomial(
    [0, 1, 2, 3, 4, 5].map((x) => ({ x, y: 1 + 2 * x + 3 * x * x, sigma: 0.01 })),
    2,
  );

const summaryInput = (overrides: Partial<FitSummaryInput> = {}): FitSummaryInput => ({
  result: summaryFit(),
  model: 'quadratic',
  xQuantity: 'time',
  yQuantity: 'x',
  seriesLabel: 'Object A',
  ...overrides,
});

// A quadratic against time reads back as motion, and the acceleration shown is
// twice the leading coefficient — the same doubling the panel promises.
{
  const groups = fitSummaryGroups(summaryInput());
  const labels = groups.map((group) => group.label);
  assert.ok(labels.some((label) => label.includes('Object A')));
  assert.ok(labels.includes('Read as motion'));
  assert.ok(labels.includes('Goodness of fit'));

  const motion = groups.find((group) => group.label === 'Read as motion')!;
  const acceleration = motion.values.find((value) => value.label === 'a = 2A')!;
  assert.equal(acceleration.unit, 'm/s²');
  assert.ok(acceleration.value.startsWith('6'), `expected a near 6, got ${acceleration.value}`);
  assert.equal(fitSummaryProblem(summaryInput()), null);
}

// Plotting something that is not a position against time still fits, but must
// not be dressed up as kinematics.
{
  const groups = fitSummaryGroups(summaryInput({ yQuantity: 'speed' }));
  assert.ok(!groups.some((group) => group.label === 'Read as motion'));
}

// A line through velocity against time is the other honest route to `a`.
{
  const linear = fitPolynomial(
    [0, 1, 2, 3].map((x) => ({ x, y: 4 + 1.5 * x, sigma: 0.01 })),
    1,
  );
  const groups = fitSummaryGroups(
    summaryInput({ result: linear, model: 'linear', yQuantity: 'vx' }),
  );
  const motion = groups.find((group) => group.label === 'Read as motion')!;
  assert.ok(motion.values.some((value) => value.label === 'a = slope' && value.unit === 'm/s²'));
}

// Nothing selected is not an error, and a failed fit is reported as one.
{
  assert.ok(fitSummaryProblem(summaryInput({ model: 'none', result: null }))?.length);
  assert.deepEqual(fitSummaryGroups(summaryInput({ model: 'none', result: null })), []);
  const tooFew = fitPolynomial([{ x: 0, y: 0 }], 2);
  const problem = fitSummaryProblem(summaryInput({ result: tooFew }));
  assert.ok(problem !== null && problem.includes('at least 3'));
  assert.equal(fitSummaryNote(tooFew), null);
}

// One line per group, each naming its values — the form the caption uses.
{
  const lines = fitSummaryLines(fitSummaryGroups(summaryInput()));
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes('A (t² term) ='));
  assert.ok(lines.some((line) => line.includes('a = 2A =') && line.includes('m/s²')));
}

const exportMeta = (overrides: Partial<PlotExportMeta> = {}): PlotExportMeta => ({
  clipName: 'caltrain-tutorial.mp4',
  xLabel: 'time (s)',
  yLabel: 'x (m)',
  seriesLabels: ['x'],
  pointCount: 10,
  fps: 30,
  metersPerPixel: 0.00966,
  fitRange: null,
  fitRangeIsSubset: false,
  ...overrides,
});

// A saved plot has to stand on its own in a lab report, so its caption carries
// the scale and the frame rate: without those the axes cannot be checked.
{
  const lines = buildCaptionLines(exportMeta(), summaryInput());
  const joined = lines.join(' | ');
  assert.ok(lines[0].includes('x (m) against time (s)'));
  assert.ok(joined.includes('10 points'));
  assert.ok(joined.includes('30.00 fps'));
  assert.ok(joined.includes('m/px'));
  // The caption repeats exactly what the panel says, rather than recomputing it.
  fitSummaryLines(fitSummaryGroups(summaryInput())).forEach((line) => {
    assert.ok(lines.includes(line), `caption is missing the panel line: ${line}`);
  });

  // The goodness-of-fit number belongs in a figure someone pastes into a report.
  // The paragraph coaching them about weighting does not — that stays on screen,
  // next to the controls it is talking about.
  assert.ok(joined.includes('χ² per d.o.f.'), 'caption should keep the chi-square value');
  const note = fitSummaryNote(summaryFit())!;
  assert.ok(note.includes('uncertainty slider'));
  lines.forEach((line) => {
    assert.ok(
      !note.includes(line),
      `caption should not carry the fit note, but has: ${line}`,
    );
  });
}

// Singular/plural, an unset scale, and no fit all have to read properly.
{
  const lines = buildCaptionLines(
    exportMeta({ pointCount: 1, metersPerPixel: null }),
    summaryInput({ model: 'none', result: null }),
  );
  const joined = lines.join(' | ');
  assert.ok(joined.includes('1 point') && !joined.includes('1 points'));
  assert.ok(!joined.includes('m/px'));
  assert.ok(joined.includes('No fit applied.'));
}

// A narrowed fit range is stated, because it changes what the numbers mean.
{
  const withRange = buildCaptionLines(
    exportMeta({ fitRange: { min: 0, max: 3 }, fitRangeIsSubset: true }),
    summaryInput(),
  );
  assert.ok(withRange.some((line) => line.startsWith('Fitted over time (s) from')));
  const wholeRange = buildCaptionLines(
    exportMeta({ fitRange: { min: 0, max: 5 } }),
    summaryInput(),
  );
  assert.ok(!wholeRange.some((line) => line.startsWith('Fitted over')));
}

// --- Video metadata arriving twice ---------------------------------------

// Regression: a student marking a short .mov had the clip start playing under
// them on about the tenth click. `loadedmetadata` and `durationchange` share a
// handler, and QuickTime containers commonly revise their duration once
// decoding reaches a part of the file the browser had not parsed — which a seek
// deep into a short clip is exactly what provokes. The handler ended by
// measuring the frame rate, and measuring a frame rate means playing the clip.
{
  // First word about a usable clip: adopt it and measure the frame rate.
  assert.equal(metadataAction(4.5, false), 'initialise');

  // The same news again, now that the clip is in use, must never re-probe.
  assert.equal(metadataAction(4.5, true), 'update');
  assert.equal(metadataAction(4.4, true), 'update');

  // No usable duration yet: provoke one by seeking past the end.
  assert.equal(metadataAction(Number.POSITIVE_INFINITY, false), 'await-duration');
  assert.equal(metadataAction(Number.NaN, false), 'await-duration');
  assert.equal(metadataAction(0, false), 'await-duration');

  // The same nonsense once the clip is running would seek a student to 1e9.
  assert.equal(metadataAction(Number.POSITIVE_INFINITY, true), 'ignore');
  assert.equal(metadataAction(Number.NaN, true), 'ignore');
  assert.equal(metadataAction(0, true), 'ignore');

  // Only the very first report may trigger a probe, however many arrive.
  const durations = [Number.POSITIVE_INFINITY, 4.5, 4.5, 4.51, Number.NaN, 4.51];
  let initialised = false;
  const probes = durations.filter((duration) => {
    const action = metadataAction(duration, initialised);
    if (action === 'initialise') initialised = true;
    return action === 'initialise';
  });
  assert.equal(probes.length, 1, 'the frame rate must be probed exactly once per clip');
}

console.log('Video analysis tests passed.');

// --- Motion Match: targets, scoring, and submission validation -------------
{
  const {
    DROPOUT_DISTANCE,
    GRID_POINTS,
    MAX_TOTAL_SCORE,

    MOTION_GAME_DEFAULTS,
    MOTION_GRAPHS,
    ROUND_SECONDS,
    SUBMISSION_PERIOD_SECONDS,
    TOLERANCES,
    attemptFeedback,
    findGraph,
    fromMotionSamples,
    impliedPosition,
    motionGameTotal,
    normalizeMotionGameScoreRow,
    sampleScore,
    scoreAttempt,
    selectBestMotionGameScoresByUniqueName,
    targetAt,
    targetSeries,
    toMotionSamples,
    validateMotionGameScoreSubmission,
  } = await import('../../src/lib/kinematics/motionGame.ts');

  // --- the targets have to be walkable in about two metres ---------------
  //
  // This is the constraint the whole game rests on. If a target strays below
  // the detector dead zone or asks for a sprint, no amount of good scoring
  // makes it matchable.
  const REACH_MIN = 0.5;
  const REACH_MAX = 2.5;
  const WALKABLE_SPEED = 0.45;

  MOTION_GRAPHS.forEach((graph) => {
    assert.equal(graph.durationSeconds, ROUND_SECONDS, `${graph.id} runs the standard round`);

    let minPosition = Infinity;
    let maxPosition = -Infinity;

    for (let t = 0; t <= graph.durationSeconds; t += 0.02) {
      const position = impliedPosition(graph, t);
      minPosition = Math.min(minPosition, position);
      maxPosition = Math.max(maxPosition, position);

      const after = Math.min(t + 0.05, graph.durationSeconds);
      const before = Math.max(t - 0.05, 0);
      const speed = Math.abs(
        (impliedPosition(graph, after) - impliedPosition(graph, before)) / (after - before),
      );
      assert.ok(
        speed <= WALKABLE_SPEED,
        `${graph.id} demands ${speed.toFixed(2)} m/s at t=${t.toFixed(2)} - faster than a walk`,
      );
    }

    assert.ok(minPosition >= REACH_MIN, `${graph.id} comes within ${minPosition.toFixed(2)} m`);
    assert.ok(maxPosition <= REACH_MAX, `${graph.id} reaches out to ${maxPosition.toFixed(2)} m`);
    assert.ok(
      maxPosition - minPosition <= 2,
      `${graph.id} spans ${(maxPosition - minPosition).toFixed(2)} m, over the two-metre budget`,
    );
  });

  // Two position graphs then a velocity graph, in that order.
  assert.deepEqual(
    MOTION_GRAPHS.map((graph) => graph.quantity),
    ['position', 'position', 'velocity'],
  );

  // A hold segment must restate the running value, or targetAt jumps.
  MOTION_GRAPHS.forEach((graph) => {
    let previous = graph.startValue;
    graph.segments.forEach((segment) => {
      if (segment.ease === 'hold') {
        assert.ok(
          Math.abs(segment.value - previous) < 1e-9,
          `${graph.id} holds at ${segment.value} after ${previous}`,
        );
      }
      previous = segment.value;
    });
  });

  // targetAt is continuous: no step bigger than the local slope allows.
  MOTION_GRAPHS.forEach((graph) => {
    for (let t = 0; t < graph.durationSeconds; t += 0.01) {
      const jump = Math.abs(targetAt(graph, t + 0.01) - targetAt(graph, t));
      assert.ok(jump < 0.05, `${graph.id} jumps ${jump.toFixed(3)} at t=${t.toFixed(2)}`);
    }
  });

  // Endpoints and a hand-checked interior value on the linear graph.
  const linear = findGraph('position-linear');
  assert.ok(linear);
  assert.equal(targetAt(linear, 0), 0.7);
  assert.equal(targetAt(linear, 2), 0.7, 'still standing at 2 s');
  assert.ok(Math.abs(targetAt(linear, 5) - 1.4) < 1e-9, 'halfway through the outbound ramp');
  assert.ok(Math.abs(targetAt(linear, 7) - 2.1) < 1e-9);
  assert.equal(targetAt(linear, 100), 0.9, 'past the end holds the final value');

  // The velocity target integrates back to where it started.
  const velocityGraph = findGraph('velocity-steps');
  assert.ok(velocityGraph);
  assert.ok(
    Math.abs(impliedPosition(velocityGraph, ROUND_SECONDS) - velocityGraph.startMeters) < 0.02,
    'the velocity round must end where it began',
  );
  assert.ok(Math.abs(impliedPosition(velocityGraph, 6) - 2.0) < 0.02, 'turnaround near 2.0 m');

  assert.equal(targetSeries(linear).length, GRID_POINTS);
  assert.equal(GRID_POINTS, 141, '14 s at 10 Hz, inclusive of both ends');

  // --- the scoring taper --------------------------------------------------
  assert.equal(sampleScore(0, 0.06, 0.4), 1, 'dead on');
  assert.equal(sampleScore(0.06, 0.06, 0.4), 1, 'the deadband edge still scores full');
  assert.equal(sampleScore(0.4, 0.06, 0.4), 0);
  assert.equal(sampleScore(5, 0.06, 0.4), 0);
  assert.equal(sampleScore(Number.NaN, 0.06, 0.4), 0);
  assert.ok(Math.abs(sampleScore(0.23, 0.06, 0.4) - 0.5) < 1e-9, 'midpoint scores a half');
  assert.ok(sampleScore(0.1, 0.06, 0.4) > sampleScore(0.2, 0.06, 0.4), 'monotonically decreasing');

  // --- scoring whole attempts --------------------------------------------
  const traceFor = (graph, offset = 0, noise = 0) => {
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648 - 0.5;
    };
    const count = Math.floor(graph.durationSeconds / SUBMISSION_PERIOD_SECONDS) + 1;
    return Array.from({ length: count }, (_, index) => {
      const t = index * SUBMISSION_PERIOD_SECONDS;
      return {
        t,
        distance: impliedPosition(graph, t) + offset + noise * random(),
        quality: 'ok',
      };
    });
  };

  MOTION_GRAPHS.forEach((graph) => {
    assert.equal(
      scoreAttempt(graph, traceFor(graph)),
      100,
      `${graph.id}: walking the target exactly must score 100`,
    );
  });

  MOTION_GRAPHS.forEach((graph) => {
    if (graph.quantity !== 'position') return;
    assert.equal(
      scoreAttempt(graph, traceFor(graph, 1.5)),
      0,
      `${graph.id}: standing 1.5 m off target must score 0`,
    );
  });

  // A small offset costs marks without wiping the score out.
  const nudged = scoreAttempt(linear, traceFor(linear, 0.15));
  assert.ok(nudged > 0 && nudged < 100, `a 15 cm bias should be partial credit, got ${nudged}`);
  assert.ok(
    scoreAttempt(linear, traceFor(linear, 0.1)) > scoreAttempt(linear, traceFor(linear, 0.2)),
    'closer scores higher',
  );

  // Realistic sensor noise inside the deadband must not cost anything.
  assert.equal(
    scoreAttempt(linear, traceFor(linear, 0, 0.004)),
    100,
    'millimetre sonar noise stays inside the deadband',
  );

  // A short recording loses the marks it never earned.
  assert.equal(
    scoreAttempt(linear, traceFor(linear).slice(0, 10)),
    Math.round((100 * 10) / GRID_POINTS),
    'scoring runs on the full grid, not on whatever was submitted',
  );
  assert.equal(scoreAttempt(linear, []), 0);

  // Dropouts score zero rather than being skipped over.
  const halfDropped = traceFor(linear).map((sample, index) =>
    index % 2 === 0 ? sample : { ...sample, quality: 'dropout' },
  );
  const droppedScore = scoreAttempt(linear, halfDropped);
  assert.ok(
    droppedScore > 40 && droppedScore < 60,
    `half dropouts should roughly halve the score, got ${droppedScore}`,
  );

  assert.equal(motionGameTotal([100, 100, 100]), MAX_TOTAL_SCORE);
  assert.equal(MAX_TOTAL_SCORE, 300);

  // --- feedback -----------------------------------------------------------
  assert.match(attemptFeedback(linear, traceFor(linear)), /Well centred/);
  assert.match(attemptFeedback(linear, traceFor(linear, 0.5)), /too far from the detector/);
  assert.match(attemptFeedback(linear, traceFor(linear, -0.5)), /too close to the detector/);
  assert.match(
    attemptFeedback(
      linear,
      traceFor(linear).map((sample) => ({ ...sample, quality: 'dropout' })),
    ),
    /lost you/,
  );

  // --- submission validation ---------------------------------------------
  const quantise = (samples) =>
    samples.map((sample) => ({
      ...sample,
      distance: Math.round(sample.distance * 1000) / 1000,
    }));

  const buildSubmission = (overrides = {}) => {
    const attempts = MOTION_GRAPHS.map((graph) => ({
      graph: graph.id,
      retried: false,
      samples: fromMotionSamples(quantise(traceFor(graph, 0, 0.004))),
    }));
    const score = motionGameTotal(
      MOTION_GRAPHS.map((graph, index) =>
        scoreAttempt(graph, toMotionSamples(attempts[index].samples)),
      ),
    );
    return { name: 'Ada', score, retriesUsed: 0, attempts, ...overrides };
  };

  const good = validateMotionGameScoreSubmission(buildSubmission());
  assert.equal(good.ok, true, `a real-looking run must validate: ${good.errors.join('; ')}`);
  assert.equal(good.score, good.graphScores.reduce((a, b) => a + b, 0));
  assert.equal(good.name, 'Ada');
  assert.equal(good.graphScores.length, 3);

  // The submitted score is compared, never trusted.
  assert.equal(
    validateMotionGameScoreSubmission(buildSubmission({ score: good.score - 1 })).ok,
    false,
    'a mismatched score must be rejected',
  );
  assert.equal(
    validateMotionGameScoreSubmission(buildSubmission({ score: 9999 })).ok,
    false,
    'a score past the maximum is rejected',
  );
  assert.equal(validateMotionGameScoreSubmission(buildSubmission({ score: 12.5 })).ok, false);

  // Structure.
  assert.equal(validateMotionGameScoreSubmission(buildSubmission({ attempts: [] })).ok, false);
  assert.equal(
    validateMotionGameScoreSubmission(
      buildSubmission({ attempts: buildSubmission().attempts.slice(0, 2) }),
    ).ok,
    false,
  );
  {
    const swapped = buildSubmission();
    swapped.attempts = [swapped.attempts[1], swapped.attempts[0], swapped.attempts[2]];
    const result = validateMotionGameScoreSubmission(swapped);
    assert.equal(result.ok, false, 'attempts must be in graph order');
    assert.ok(result.errors.some((error) => /wrong graph/.test(error)));
  }
  {
    const short = buildSubmission();
    short.attempts[0].samples = short.attempts[0].samples.slice(0, 50);
    const result = validateMotionGameScoreSubmission(short);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => /exactly 141 samples/.test(error)));
  }
  {
    const offGrid = buildSubmission();
    offGrid.attempts[0].samples = offGrid.attempts[0].samples.map(([t, d]) => [t + 3, d]);
    assert.equal(
      validateMotionGameScoreSubmission(offGrid).ok,
      false,
      'timestamps must sit on the grid',
    );
  }
  {
    const outOfRange = buildSubmission();
    outOfRange.attempts[0].samples[40] = [4.0, 12];
    assert.equal(
      validateMotionGameScoreSubmission(outOfRange).ok,
      false,
      '12 m is past the detector',
    );
  }
  {
    const teleport = buildSubmission();
    teleport.attempts[0].samples[40] = [4.0, 0.2];
    teleport.attempts[0].samples[41] = [4.1, 2.4];
    const result = validateMotionGameScoreSubmission(teleport);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => /faster than a person can walk/.test(error)));
  }
  {
    // A synthesised trace that respects the physical bounds DOES validate.
    // Asserted rather than left implicit: the board is protected by the
    // single-use run token and by recomputing the score, not by detecting
    // fabrication. See the note in motionGame.ts about why the jitter check
    // was dropped. If someone later adds a "looks fake" heuristic, this
    // assertion is the one that should make them think twice.
    const synthetic = buildSubmission();
    synthetic.attempts = MOTION_GRAPHS.map((graph) => ({
      graph: graph.id,
      retried: false,
      samples: fromMotionSamples(traceFor(graph)),
    }));
    synthetic.score = motionGameTotal(
      MOTION_GRAPHS.map((graph, index) =>
        scoreAttempt(graph, toMotionSamples(synthetic.attempts[index].samples)),
      ),
    );
    assert.equal(validateMotionGameScoreSubmission(synthetic).ok, true);
  }
  {
    // Mostly-dropout runs cannot be posted.
    const empty = buildSubmission();
    empty.attempts[0].samples = empty.attempts[0].samples.map(([t]) => [t, DROPOUT_DISTANCE]);
    const result = validateMotionGameScoreSubmission(empty);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => /too few usable readings/.test(error)));
  }

  // Retries.
  assert.equal(validateMotionGameScoreSubmission(buildSubmission({ retriesUsed: 3 })).ok, true);
  assert.equal(validateMotionGameScoreSubmission(buildSubmission({ retriesUsed: 4 })).ok, false);
  assert.equal(validateMotionGameScoreSubmission(buildSubmission({ retriesUsed: -1 })).ok, false);
  assert.equal(MOTION_GAME_DEFAULTS.maxRetries, 3, 'one retry per graph');

  // Names are masked on the way in and rejected outright.
  const blocked = validateMotionGameScoreSubmission(buildSubmission({ name: 'n1gger' }));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.name, 'Player');

  assert.ok(TOLERANCES.position.full < TOLERANCES.position.zero);

  // --- row normalisation and ranking -------------------------------------
  const row = normalizeMotionGameScoreRow({
    id: 7,
    name: '  Ada  ',
    score: 271,
    graph1_score: 95,
    graph2_score: 88,
    graph3_score: 88,
    retries_used: 1,
    created_at: 1234,
  });
  assert.equal(row.id, '7');
  assert.equal(row.name, 'Ada');
  assert.equal(row.graph2Score, 88);
  assert.equal(row.retriesUsed, 1);

  const base = { graph1Score: 0, graph2Score: 0, graph3Score: 0 };
  const ranked = selectBestMotionGameScoresByUniqueName([
    { name: 'Ada', score: 250, ...base, retriesUsed: 0, createdAt: 3 },
    { name: 'ada', score: 280, ...base, retriesUsed: 2, createdAt: 4 },
    { name: 'Bo', score: 280, ...base, retriesUsed: 0, createdAt: 5 },
  ]);
  assert.equal(ranked.length, 2, 'one row per player');
  assert.equal(ranked[0].name, 'Bo', 'a tie breaks toward fewer retries');
  assert.equal(ranked[1].score, 280, 'and each player keeps their best run');
}

console.log('Motion Match tests passed.');
