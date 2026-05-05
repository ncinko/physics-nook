import assert from 'node:assert/strict';
import test from 'node:test';
import {
  constrainRopeSegments,
  createRopeNodes,
  cutRopeAtSegment,
  findNearestRopeSegment,
  getLandingScore,
  projectPointOutOfCircle,
  resolvePegCollision,
  type RopeNode,
} from '../../src/lib/oscillations/pendulumPeg.ts';

const closeTo = (actual: number, expected: number, epsilon = 1e-6) => {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} was not close to ${expected}`);
};

test('rope segment constraints pull stretched nodes back to target length', () => {
  const nodes = createRopeNodes({ x: 0, y: 0 }, { x: 200, y: 0 }, 2);
  nodes[1].x = 140;
  nodes[2].x = 260;

  for (let pass = 0; pass < 24; pass += 1) {
    constrainRopeSegments(nodes, 100, true);
  }

  closeTo(Math.hypot(nodes[1].x - nodes[0].x, nodes[1].y - nodes[0].y), 100, 0.01);
  closeTo(Math.hypot(nodes[2].x - nodes[1].x, nodes[2].y - nodes[1].y), 100, 0.01);
});

test('peg collision projects rope nodes outside the peg radius', () => {
  const projected = projectPointOutOfCircle(
    { x: 102, y: 100 },
    { x: 100, y: 100, radius: 12 },
    3,
  );

  assert.equal(projected.moved, true);
  closeTo(Math.hypot(projected.point.x - 100, projected.point.y - 100), 15);

  const nodes: RopeNode[] = [
    { x: 0, y: 0, previousX: 0, previousY: 0 },
    { x: 100, y: 100, previousX: 100, previousY: 100 },
  ];
  const movedCount = resolvePegCollision(nodes, { x: 100, y: 100, radius: 20 }, 0, true);

  assert.equal(movedCount, 1);
  closeTo(Math.hypot(nodes[1].x - 100, nodes[1].y - 100), 20);
});

test('nearest segment returns null when a cut is too far away', () => {
  const nodes = createRopeNodes({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);

  assert.deepEqual(findNearestRopeSegment(nodes, { x: 40, y: 4 }, 8), {
    index: 1,
    distance: 4,
  });
  assert.equal(findNearestRopeSegment(nodes, { x: 40, y: 40 }, 8), null);
});

test('cutting keeps the bob-side rope and preserves node velocities', () => {
  const nodes = createRopeNodes({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
  nodes[3].previousX = 68;
  nodes[3].x = 75;
  nodes[4].previousX = 91;
  nodes[4].x = 100;

  const bobSide = cutRopeAtSegment(nodes, 2);

  assert.equal(bobSide.length, 2);
  assert.equal(bobSide[0].x, 75);
  assert.equal(bobSide[0].previousX, 68);
  assert.equal(bobSide[1].x, 100);
  assert.equal(bobSide[1].previousX, 91);
});

test('landing score is absolute horizontal miss distance', () => {
  assert.equal(getLandingScore(430, 400), 30);
  assert.equal(getLandingScore(370, 400), 30);
});
