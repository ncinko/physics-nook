import assert from 'node:assert/strict';
import {
  add,
  cleanScalar,
  directionDegrees,
  formatScalar,
  formatVector,
  magnitude,
  scale,
  subtract,
  toDegrees,
  toRadians,
  vectorFromMagnitudeAndDirection,
} from '../../src/lib/math/vectors.ts';
import {
  isReached,
  moveIsBlocked,
  pathPositions,
  pointInRect,
  segmentIntersectsRect,
  totalDisplacement,
  voyageLevels,
  type Rect,
} from '../../src/lib/math/vectorVoyage.ts';
import {
  hopLabel,
  hopLandings,
  hopPosition,
  hopStaysOnLine,
  totalHop,
} from '../../src/lib/math/bunnyHops.ts';

const near = (actual: number, expected: number, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be near ${expected}`);
};

assert.deepEqual(add({ x: 3, y: -2 }, { x: -5, y: 7 }), { x: -2, y: 5 });
assert.deepEqual(subtract({ x: 3, y: -2 }, { x: -5, y: 7 }), { x: 8, y: -9 });
assert.deepEqual(scale({ x: 3, y: -2 }, -2), { x: -6, y: 4 });

near(magnitude({ x: 3, y: 4 }), 5);
near(toDegrees(Math.PI / 2), 90);
near(toRadians(180), Math.PI);

near(directionDegrees({ x: 1, y: 0 }), 0);
near(directionDegrees({ x: 0, y: 1 }), 90);
near(directionDegrees({ x: -1, y: 0 }), 180);
near(directionDegrees({ x: 0, y: -1 }), 270);
near(directionDegrees({ x: 0, y: 0 }), 0);

const polarVector = vectorFromMagnitudeAndDirection(5, 53.13010235415598);
near(polarVector.x, 3);
near(polarVector.y, 4);

assert.equal(cleanScalar(-0), 0);
assert.equal(cleanScalar(1e-12), 0);
assert.equal(formatScalar(-0.00000000001, 2), '0.00');
assert.equal(formatVector({ x: 1.25, y: -0.00000000001 }, 2), '<1.25, 0.00>');

console.log('Math vector helper tests passed.');

// --- Vector Voyage geometry ---

const sampleHedge: Rect = { minX: -1, maxX: 1, minY: -1, maxY: 1 };

// A segment passing straight through the box crosses it.
assert.equal(segmentIntersectsRect({ x: -3, y: 0 }, { x: 3, y: 0 }, sampleHedge), true);
// A segment that stays clear does not.
assert.equal(segmentIntersectsRect({ x: -3, y: 3 }, { x: 3, y: 3 }, sampleHedge), false);
// Grazing exactly along an edge is allowed (not counted as a crossing).
assert.equal(segmentIntersectsRect({ x: -3, y: 1 }, { x: 3, y: 1 }, sampleHedge), false);
// A segment ending inside the box still counts as a crossing.
assert.equal(segmentIntersectsRect({ x: -3, y: 0 }, { x: 0, y: 0 }, sampleHedge), true);

assert.equal(pointInRect({ x: 0, y: 0 }, sampleHedge), true);
assert.equal(pointInRect({ x: 2, y: 0 }, sampleHedge), false);

assert.deepEqual(totalDisplacement([{ x: 4, y: 3 }, { x: 4, y: -3 }]), { x: 8, y: 0 });
assert.deepEqual(
  pathPositions({ x: -4, y: 0 }, [{ x: 4, y: 3 }, { x: 4, y: -3 }]),
  [{ x: -4, y: 0 }, { x: 0, y: 3 }, { x: 4, y: 0 }],
);

assert.equal(isReached({ x: 4.1, y: -0.1 }, { x: 4, y: 0 }), true);
assert.equal(isReached({ x: 5, y: 0 }, { x: 4, y: 0 }), false);

// Every shipped level must be solvable: its bundled route clears all hedges,
// keeps start and target out of the hedges, and lands on the target.
for (const level of voyageLevels) {
  assert.ok(level.solutionMoves.length > 0, `${level.id} has a solution route`);

  for (const hedge of level.hedges) {
    assert.equal(pointInRect(level.start, hedge), false, `${level.id} start is clear`);
    assert.equal(pointInRect(level.target, hedge), false, `${level.id} target is clear`);
  }

  const positions = pathPositions(level.start, level.solutionMoves);
  for (let i = 0; i < level.solutionMoves.length; i += 1) {
    assert.equal(
      moveIsBlocked(positions[i], positions[i + 1], level.hedges),
      false,
      `${level.id} route leg ${i + 1} is unobstructed`,
    );
  }

  const finalPosition = positions[positions.length - 1];
  assert.equal(isReached(finalPosition, level.target), true, `${level.id} route reaches the flag`);
  assert.ok(
    level.solutionMoves.length >= level.par,
    `${level.id} par is not below its solution length`,
  );
}

console.log('Vector Voyage geometry tests passed.');

// --- Number-line bunny hops (1D vectors) ---

assert.deepEqual(hopLandings(0, [3, -2, 4]), [0, 3, 1, 5]);
assert.equal(totalHop([3, -2, 4]), 5);
assert.equal(hopPosition(-1, [2, 2]), 3);
assert.equal(hopLabel(3), '+3');
assert.equal(hopLabel(-2), '-2');
assert.equal(hopLabel(0), '+0');
assert.equal(hopStaysOnLine(6, 3, -8, 8), false);
assert.equal(hopStaysOnLine(6, 2, -8, 8), true);
assert.equal(hopStaysOnLine(-7, -2, -8, 8), false);

console.log('Bunny hop tests passed.');
