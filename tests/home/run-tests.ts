import assert from 'node:assert/strict';
import test from 'node:test';

import { C, MAX_SPEED, pushSample, retardedField, stepCharge, type Sample } from '../../src/lib/home/retardedField.ts';
import { MAX_ECCENTRICITY, eccentricityFromFocusX, orbitPoint, semiMajorAxis } from '../../src/lib/home/orbit.ts';
import { BALL_RADIUS, BOWL_W, isAtRest, stepBall, surfaceY, type BallState } from '../../src/lib/home/ballBowl.ts';

test('orbit: perihelion and aphelion lie on the major axis', () => {
  const peri = orbitPoint(0, 0.5, 100, 160, 75);
  const aph = orbitPoint(Math.PI, 0.5, 100, 160, 75);
  assert.ok(Math.abs(peri.x - 260) < 1e-9 && Math.abs(peri.y - 75) < 1e-9);
  assert.ok(Math.abs(aph.x - 60) < 1e-9);
});

test('orbit: planet is closer to the Sun at perihelion than aphelion', () => {
  const sunX = 160 + 100 * 0.6;
  const peri = Math.abs(orbitPoint(0, 0.6, 100, 160, 75).x - sunX);
  const aph = Math.abs(orbitPoint(Math.PI, 0.6, 100, 160, 75).x - sunX);
  assert.ok(peri < aph);
});

test('orbit: focus drag maps to clamped eccentricity and round-trips', () => {
  assert.equal(eccentricityFromFocusX(160, 160, 64), 0);
  assert.equal(eccentricityFromFocusX(200, 160, 64), 0);
  assert.equal(eccentricityFromFocusX(-500, 160, 64), MAX_ECCENTRICITY);
  const e = 0.5;
  const a = semiMajorAxis(e, 64);
  assert.ok(Math.abs(eccentricityFromFocusX(160 - a * e, 160, 64) - e) < 1e-9);
});

const run = (start: BallState, seconds: number, onStep?: (b: BallState) => void) => {
  let b = start;
  for (let t = 0; t < seconds; t += 1 / 60) {
    b = stepBall(b, 1 / 60);
    onStep?.(b);
  }
  return b;
};

test('ball: dropped in the ramp it bounces lower than it fell, then rests at the bottom', () => {
  const start: BallState = { x: 160, y: 20, vx: 0, vy: 0, angle: 0 };
  const floor = surfaceY(160) - BALL_RADIUS;
  let minY = Infinity;
  let bounced = false;
  let landed = false;
  const end = run(start, 12, (b) => {
    if (b.y >= floor - 0.5) landed = true;
    else if (landed && b.y < floor - 3) {
      bounced = true;
      minY = Math.min(minY, b.y);
    }
  });
  assert.ok(bounced, 'ball bounces');
  assert.ok(minY > start.y, 'rebounds lower than the drop height');
  assert.ok(isAtRest(end));
  assert.ok(Math.abs(end.x - 160) < 2);
});

test('ball: stays inside the frame and above the ramp, and never gains energy', () => {
  const start: BallState = { x: 20, y: 40, vx: 150, vy: -200, angle: 0 };
  const energy = (b: BallState) => 0.5 * (b.vx * b.vx + b.vy * b.vy) + 420 * (150 - b.y);
  const e0 = energy(start);
  run(start, 8, (b) => {
    assert.ok(b.x >= BALL_RADIUS - 1e-6 && b.x <= BOWL_W - BALL_RADIUS + 1e-6);
    assert.ok(b.y <= surfaceY(b.x) + 1, 'not under the ramp');
    assert.ok(energy(b) <= e0 * 1.02, 'energy does not grow');
  });
});

test('ball: released on a slope it rolls toward the bottom', () => {
  const end = run({ x: 40, y: surfaceY(40) - BALL_RADIUS, vx: 0, vy: 0, angle: 0 }, 1);
  assert.ok(end.x > 40);
});


test('ball: a stationary ball partway up a slope is not at rest, but one at the bottom is', () => {
  const x = 60;
  assert.ok(!isAtRest({ x, y: surfaceY(x) - BALL_RADIUS, vx: 0, vy: 0, angle: 0 }));
  assert.ok(isAtRest({ x: 160, y: surfaceY(160) - BALL_RADIUS, vx: 0, vy: 0, angle: 0 }));
});

test('ball: released from the side it swings through the bottom and back up before settling', () => {
  let b: BallState = { x: 30, y: surfaceY(30) - BALL_RADIUS, vx: 0, vy: 0, angle: 0 };
  let crossings = 0;
  let side = Math.sign(b.x - 160);
  let settledAt = Infinity;
  for (let t = 0; t < 40; t += 1 / 60) {
    b = stepBall(b, 1 / 60);
    const s = Math.sign(b.x - 160);
    if (s !== 0 && s !== side) {
      crossings += 1;
      side = s;
    }
    if (isAtRest(b)) {
      settledAt = t;
      break;
    }
  }
  assert.ok(crossings >= 3, `crossed the bottom ${crossings} times`);
  assert.ok(settledAt < 30, 'settles in finite time');
  assert.ok(Math.abs(b.x - 160) < 3);
});

const rest = (x: number, y: number, t: number): Sample => ({ t, x, y, vx: 0, vy: 0, ax: 0, ay: 0 });

test('retarded field: a static charge gives the Coulomb field 1/R^2, pointing away', () => {
  const history = [rest(50, 75, 0), rest(50, 75, 5)];
  const { ex, ey } = retardedField(history, 5, 150, 75);
  assert.ok(Math.abs(ex - 1 / 100 ** 2) < 1e-9);
  assert.ok(Math.abs(ey) < 1e-12);
});

test('retarded field: a sudden move is felt only after the signal arrives', () => {
  // Charge sits at (50,75) until t=1, then at (50,25) afterwards (a quick hop).
  const history: Sample[] = [rest(50, 75, 0), rest(50, 75, 1), rest(50, 25, 1.001), rest(50, 25, 4)];
  const P = { x: 210, y: 75 }; // 160 px from the old position: signal takes ~1 s
  const early = retardedField(history, 1.5, P.x, P.y); // before arrival: still points away from the old spot
  assert.ok(Math.abs(early.ey) < 1e-4 && early.ex > 0);
  const late = retardedField(history, 3, P.x, P.y); // well after: points away from the new spot (which is above, so toward +y on screen)
  assert.ok(late.ey > 1e-5, 'now points away from the new position (positive y)');
});

test('charge body: speed is capped below the signal speed and it comes to rest when released', () => {
  const bounds = { minX: 0, maxX: 320, minY: 0, maxY: 150 };
  let body = { x: 20, y: 75, vx: 0, vy: 0 };
  let top = 0;
  for (let i = 0; i < 120; i += 1) {
    body = stepCharge(body, { x: 300, y: 75 }, 1 / 60, bounds).body;
    top = Math.max(top, Math.hypot(body.vx, body.vy));
  }
  assert.ok(top <= MAX_SPEED + 1e-6 && MAX_SPEED < C);
  for (let i = 0; i < 120; i += 1) body = stepCharge(body, null, 1 / 60, bounds).body;
  assert.ok(Math.hypot(body.vx, body.vy) < 1);
});

test('history keeps only what the retardation window needs', () => {
  const history: Sample[] = [rest(0, 0, 0)];
  for (let i = 1; i <= 600; i += 1) pushSample(history, rest(0, 0, i / 60));
  assert.ok(history.length < 200);
});
