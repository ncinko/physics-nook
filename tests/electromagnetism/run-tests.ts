import assert from 'node:assert/strict';
import { EPSILON_0, flatFlux, field3D, gaussianSurface, measureFlux, gaussPreset, uniformBoxFlux,
  dot3, scale3, type GaussianShape, type Charge3D } from '../../src/lib/electromagnetism/gauss.ts';
import { choosePotentialLevels, traceContours, nearestContour } from '../../src/lib/electromagnetism/contours.ts';
import { allocateLineCounts, clipPolyline, computeFieldLines, seedPhase,
  type FieldLine } from '../../src/lib/electromagnetism/fieldLines.ts';
import { buildTerrain, terrainHeight, terrainCover, ELEVATION_LEVELS } from '../../src/lib/electromagnetism/terrain.ts';
import {
  COULOMB_K,
  coulombFieldAt,
  conductivity,
  driftVelocity,
  fieldMagnitude,
  parallelResistance,
  pointPotential,
  potentialAt,
  seriesResistance,
  type PointCharge,
} from '../../src/lib/electromagnetism/index.ts';

const near = (actual: number, expected: number, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be near ${expected}`);
};

// Field of a point charge scales linearly with q and as 1/r².
near(fieldMagnitude(2e-6, 0.5), 2 * fieldMagnitude(1e-6, 0.5));
near(fieldMagnitude(1e-6, 0.25), 4 * fieldMagnitude(1e-6, 0.5));
near(fieldMagnitude(2e-6, 0.5), (COULOMB_K * 2e-6) / 0.25);

// Potential of a point charge: V = kQ/r, sign tracks the charge.
near(pointPotential(3e-6, 0.25), (COULOMB_K * 3e-6) / 0.25);
assert.ok(pointPotential(-1e-6, 0.5) < 0, 'negative charge gives negative potential');

// Superposition: two equal like charges placed symmetrically about a midpoint
// produce a net field that cancels at the midpoint.
const likeCharges: PointCharge[] = [
  { x: -10, y: 0, q: 1e-6 },
  { x: 10, y: 0, q: 1e-6 },
];
const midField = coulombFieldAt(likeCharges, 0, 0, 0);
near(midField.x, 0);
near(midField.y, 0);

// A dipole (+q, -q) has zero potential on the perpendicular bisector midpoint.
const dipole: PointCharge[] = [
  { x: -10, y: 0, q: 1e-6 },
  { x: 10, y: 0, q: -1e-6 },
];
near(potentialAt(dipole, 0, 0, 0), 0);

// Drude drift opposes the field and matches v_d = -eEτ/mₑ.
const vd = driftVelocity(1.0, 2.5e-14);
assert.ok(vd < 0, 'electron drift is opposite a positive field');
near(vd, -(1.602e-19 * 1.0 * 2.5e-14) / 9.109e-31, 1e-12);

// Conductivity is positive and grows with the collision time τ.
assert.ok(conductivity(8.5e28, 2.5e-14) > 0);
assert.ok(conductivity(8.5e28, 5e-14) > conductivity(8.5e28, 2.5e-14));

// Series and parallel resistance identities.
near(seriesResistance([30, 60]), 90);
near(parallelResistance([30, 60]), 20);
near(parallelResistance([10, 10, 10]), 10 / 3, 1e-9);

// Linear, signed voltage intervals are robust to charge singularities.
for (const sign of [-1, 1]) {
  const values = Array.from({ length: 1000 }, (_, i) => sign * i);
  values.push(sign * 1e12, NaN, Infinity);
  const { step, levels } = choosePotentialLevels(values);
  assert.ok(levels.length > 2 && levels.length <= 15);
  assert.ok(step < 1000, 'one extreme value must not set the interval');
  for (let i = 1; i < levels.length; i++) near(levels[i] - levels[i - 1], step);
  assert.ok(levels.every(v => v * sign >= 0));
}
assert.deepEqual(choosePotentialLevels([0, 0, NaN]).levels, []);
assert.deepEqual(choosePotentialLevels([50, 50, 50]).levels, []);
assert.deepEqual(choosePotentialLevels([]).levels, []);
const signed = choosePotentialLevels(Array.from({ length: 1001 }, (_, i) => i - 500));
assert.ok(signed.levels.includes(0));
assert.equal(signed.levels[0], -signed.levels.at(-1)!);
const mobileLevels = choosePotentialLevels(Array.from({ length: 1001 }, (_, i) => i - 500), 4);
assert.ok(mobileLevels.levels.length <= 9);
assert.ok(mobileLevels.step >= signed.step);

// Hover picks only real line segments and chooses the closest of nearby levels.
const hoverLines = [
  { level: -100, segments: [[[0, 0], [20, 0]]] },
  { level: 0, segments: [[[0, 10], [20, 10]]] },
  { level: 100, segments: [[[30, 0], [40, 0]]] },
] as const;
const hoverContours = hoverLines.map(c => ({ level: c.level, segments: [...c.segments] }));
assert.equal(nearestContour(hoverContours, 10, 2)?.level, -100);
assert.equal(nearestContour(hoverContours, 10, 8)?.level, 0);
assert.equal(nearestContour(hoverContours, 42, 0)?.level, 100);
assert.equal(nearestContour(hoverContours, 25, 0, 3), null, 'do not hit a gap between segments');
assert.equal(nearestContour(hoverContours, 10, 30), null);
assert.equal(nearestContour([], 10, 0), null);
assert.deepEqual(nearestContour(hoverContours, 10, 2)?.point, [10, 0]);

// A linear field has straight, correctly positioned contours, even at vertices.
const ramp = Array.from({ length: 25 }, (_, i) => (i % 5) + 2 * Math.floor(i / 5));
for (const contour of traceContours(ramp, 5, 5, 4, 4, [2, 4, 6])) {
  assert.ok(contour.segments.length > 0);
  for (const segment of contour.segments) for (const [x, y] of segment) near(x + 2 * y, contour.level);
}
assert.equal(traceContours([NaN, 1, 0, 1], 2, 2, 1, 1, [0.5])[0].segments.length, 0);
assert.equal(traceContours([0, 0, 0, 0], 2, 2, 1, 1, [0])[0].segments.length, 0);
assert.throws(() => traceContours([1], 1, 1, 1, 1, [0]));
assert.equal(traceContours([1, -1, -1, 1], 2, 2, 1, 1, [0])[0].segments.length, 2);

// Monopole contours follow r = kq/V; dipole's zero contour is the bisector.
const n = 101, span = 400;
const sampled = (fn: (x: number, y: number) => number) => Array.from({ length: n * n }, (_, i) =>
  fn((i % n) * span / (n - 1) - 200, Math.floor(i / n) * span / (n - 1) - 200));
for (const contour of traceContours(sampled((x, y) => 9000 / Math.sqrt(x * x + y * y + 25)), n, n, span, span, [100, 150, 200])) {
  for (const segment of contour.segments) for (const [x, y] of segment) {
    near(Math.hypot(x - 200, y - 200), Math.sqrt((9000 / contour.level) ** 2 - 25), 0.2);
  }
}
const zero = traceContours(sampled((x, y) => 9000 / Math.hypot(x + 60, y, 5) - 9000 / Math.hypot(x - 60, y, 5)), n, n, span, span, [0])[0];
assert.ok(zero.segments.length > 0);
for (const segment of zero.segments) for (const [x] of segment) near(x, 200);

// Every terrain contour lies on the same height field as the 3D mesh.
const terrain = buildTerrain();
assert.ok(terrainHeight(-75, -65) > 600, 'broad summit above the last contour');
assert.ok(terrainCover(-75, -65).snow > 0.95, 'summit remains snow-covered');
assert.ok(terrainCover(900, 700).forest > 0.95, 'forest at the foot of the mountain');
assert.deepEqual(terrain.contours.map(c => c.level), ELEVATION_LEVELS);
for (const contour of terrain.contours) {
  assert.ok(contour.segments.length > 0);
  for (const segment of contour.segments) for (const [x, z] of segment) {
    near(terrainHeight(x - 1000, z - 800), contour.level, 1);
  }
  // All contours are closed: every endpoint connects to one other segment.
  const endpoints = new Map<string, number>();
  for (const segment of contour.segments) for (const p of segment) {
    const key = p.map(v => v.toFixed(6)).join(',');
    endpoints.set(key, (endpoints.get(key) ?? 0) + 1);
  }
  assert.ok([...endpoints.values()].every(count => count === 2));
}
// Flux through a flat patch: area, angle and normal orientation all matter.
near(flatFlux(100, 2, 0), 200);
near(flatFlux(100, 2, 90), 0);
near(flatFlux(100, 2, 180), -200);
near(flatFlux(100, 2, 60), 100);
near(flatFlux(100, 4, 30), 2 * flatFlux(100, 2, 30));
for (const field of [[100, 0, 0], [30, -70, 40], [0, 0, 0]] as const) {
  const faces = uniformBoxFlux(field);
  near(faces.reduce((sum, f) => sum + f.flux, 0), 0);
  near(faces[0].flux, -faces[1].flux);
  near(faces[2].flux, -faces[3].flux);
}
const unitCharge = gaussPreset('centered');
const fieldAtOne = field3D(unitCharge, [1, 0, 0]);
near(fieldAtOne[0], 1e-9 / (4 * Math.PI * EPSILON_0));
near(fieldAtOne[1], 0);
near(field3D(unitCharge, [2, 0, 0])[0], fieldAtOne[0] / 4);
assert.throws(() => gaussianSurface('sphere', 0));
assert.throws(() => gaussianSurface('sphere', NaN));
for (const shape of ['sphere', 'ellipsoid', 'box'] as GaussianShape[]) {
  for (const radius of [0.9, 1.2, 1.7]) {
    const mesh = gaussianSurface(shape, radius);
    assert.ok(mesh.every(t => t.area > 0 && dot3(t.center, t.normal) > 0), 'all normals point out');
    for (const axis of [0, 1, 2]) near(mesh.reduce((sum, t) => sum + t.normal[axis] * t.area, 0), 0, 1e-11);
    for (const preset of ['centered', 'off-center', 'external', 'dipole']) {
      const result = measureFlux(mesh, gaussPreset(preset));
      assert.equal(result.onBoundary, false);
      near(result.flux!, result.enclosedCharge! / EPSILON_0, 1e-8);
      if (preset === 'external' || preset === 'dipole') near(result.flux!, 0, 1e-8);
      else near(result.enclosedCharge!, 1e-9, 1e-20);
    }
    const negative = measureFlux(mesh, [{ id: 1, position: [0.1, -0.2, 0.1], q: -2e-9 }]);
    near(negative.flux!, -2e-9 / EPSILON_0, 1e-8);
    const empty = measureFlux(mesh, []);
    near(empty.flux!, 0);
  }
}
const boundary = measureFlux(gaussianSurface('sphere', 1.2), [{ id: 1, position: [1.2, 0, 0], q: 1e-9 }]);
assert.equal(boundary.onBoundary, true);
assert.equal(boundary.flux, null, 'never report a misleading flux at a point-charge singularity');
assert.equal(boundary.enclosedCharge, null);
// A separate midpoint quadrature converges to the solid-angle integral.
const fineSurface = gaussianSurface('sphere', 1.2, 80);
const midpointFlux = fineSurface.reduce((sum, t) => sum + dot3(field3D(unitCharge, t.center), scale3(t.normal, t.area)), 0);
near(midpointFlux / (1e-9 / EPSILON_0), 1, 0.002);
const mixed: Charge3D[] = [{ id: 1, position: [0.2, 0.1, 0.15], q: 3e-9 },
  { id: 2, position: [-0.3, 0.1, -0.15], q: -1e-9 }, { id: 3, position: [3, 2, -2], q: 5e-9 }];
near(measureFlux(gaussianSurface('box', 1), mixed).flux!, 2e-9 / EPSILON_0, 1e-8);
// --- Field lines -----------------------------------------------------------
const W = 760;
const H = 456;

// Clipping keeps a line that leaves the frame and returns as one line with two
// drawable runs, rather than two lines or one line with a false shortcut.
{
  const rect = { x0: 0, y0: 0, x1: 100, y1: 100 };
  assert.equal(clipPolyline([10, 10, 20, 20, 30, 30], rect).length, 1);
  const outAndBack = clipPolyline([10, 50, 90, 50, 140, 50, 90, 20, 10, 20], rect);
  assert.equal(outAndBack.length, 2, 'an excursion outside the frame splits the drawn run');
  near(outAndBack[0][outAndBack[0].length - 2], 100);
  near(outAndBack[1][0], 100);
  assert.equal(clipPolyline([200, 200, 300, 300], rect).length, 0);
}

// Line counts track |q| so the drawn density still reads as flux, and the
// global budget scales every charge together instead of starving the tail.
{
  const mixed: PointCharge[] = [
    { x: 0, y: 0, q: 1e-6 },
    { x: 1, y: 0, q: -2e-6 },
    { x: 2, y: 0, q: 0 },
  ];
  assert.deepEqual(allocateLineCounts(mixed), [12, 24, 0]);
  const squeezed = allocateLineCounts(mixed, { maxLines: 18 });
  assert.equal(squeezed[2], 0);
  assert.ok(squeezed[0] + squeezed[1] <= 18, 'the budget is respected');
  assert.ok(squeezed[1] > squeezed[0], 'the bigger charge keeps the bigger share');
  const many = allocateLineCounts(
    Array.from({ length: 14 }, (_, i) => ({ x: i, y: 0, q: 1e-6 })),
    { maxLines: 70 },
  );
  assert.ok(many.every((n) => n === many[0] && n > 0), 'no charge is starved by array order');
}

// A seed ring is rotated off a like-sign neighbour, which a line fired straight
// at would only follow into the null point between them.
{
  const pair: PointCharge[] = [
    { x: 0, y: 0, q: 1e-6 },
    { x: 100, y: 0, q: 1e-6 },
  ];
  near(seedPhase(pair, 0, 12), Math.PI / 12);
  near(seedPhase([{ x: 0, y: 0, q: 1e-6 }], 0, 12), 0);
  // No like-sign neighbour: the phase stays 0, keeping a line on a dipole axis.
  near(seedPhase([...pair.slice(0, 1), { x: 100, y: 0, q: -1e-6 }], 0, 12), 0);
}

/** Line ends touching each charge — what a reader counts around a dot. */
const endsPerCharge = (charges: PointCharge[], lines: FieldLine[]): number[] => {
  const ends = charges.map(() => 0);
  for (const line of lines) {
    ends[line.seedCharge] += 1;
    if (line.endCharge !== null) ends[line.endCharge] += 1;
  }
  return ends;
};

const presets: Record<string, PointCharge[]> = {
  monopole: [{ x: 0.5 * W, y: 0.5 * H, q: 1e-6 }],
  dipole: [
    { x: 0.35 * W, y: 0.5 * H, q: 1e-6 },
    { x: 0.65 * W, y: 0.5 * H, q: -1e-6 },
  ],
  capacitor: [
    ...Array.from({ length: 7 }, (_, i) => ({ x: 0.4 * W, y: ((i + 1) / 8) * H, q: 1e-6 })),
    ...Array.from({ length: 7 }, (_, i) => ({ x: 0.6 * W, y: ((i + 1) / 8) * H, q: -1e-6 })),
  ],
  likeCharges: [
    { x: 0.35 * W, y: 0.5 * H, q: 1e-6 },
    { x: 0.65 * W, y: 0.5 * H, q: 1e-6 },
  ],
};

for (const [name, charges] of Object.entries(presets)) {
  const lines = computeFieldLines(charges, { width: W, height: H });

  // The regression this module exists for: seeding every charge and tracing
  // each seed independently drew the same line twice and left sinks carrying
  // roughly double the ends of sources. Every charge should show the same
  // twelve, monopole and capacitor alike.
  assert.deepEqual(
    endsPerCharge(charges, lines),
    charges.map(() => 12),
    `${name}: every charge carries one line end per unit of flux`,
  );

  for (const line of lines) {
    assert.ok(line.segments.length > 0, `${name}: a drawn line has something to draw`);
    assert.ok(line.length > 0, `${name}: a drawn line has length`);
    // A line only ever ends on a charge that is a sink for its direction; the
    // old tracer stopped at whatever charge came within 10 px, so forward lines
    // died on positive charges and pointed the wrong way.
    if (line.endCharge !== null) {
      assert.equal(line.end, 'sink');
      assert.ok(
        charges[line.endCharge].q * line.direction < 0,
        `${name}: a line terminates only on a charge of the opposite sign`,
      );
    }
    for (const points of line.segments) {
      for (let i = 0; i < points.length; i += 2) {
        assert.ok(
          points[i] >= -1e-6 && points[i] <= W + 1e-6 &&
            points[i + 1] >= -1e-6 && points[i + 1] <= H + 1e-6,
          `${name}: drawn points stay inside the frame`,
        );
      }
    }
  }
}

{
  // Two like charges have no sink at all, so nothing may terminate on a charge.
  const lines = computeFieldLines(presets.likeCharges, { width: W, height: H });
  assert.ok(lines.every((l) => l.endCharge === null), 'like charges never capture a line');

  // Balanced dipole: no net flux escapes, so every line that actually reaches a
  // charge was traced from the source. A back-traced line survives only when it
  // came in from outside the frame, where its loop closes out of sight.
  const dipoleLines = computeFieldLines(presets.dipole, { width: W, height: H });
  assert.equal(dipoleLines.filter((l) => l.direction === 1).length, 12);
  assert.ok(
    dipoleLines.every((l) => l.direction === 1 || l.end === 'escaped'),
    'a back-traced line that reaches a source would duplicate one already drawn',
  );

  // Net negative charge does pull lines in from outside the scene, and those
  // are the only back-traced lines worth drawing.
  const twoSinks = computeFieldLines(
    [
      { x: 0.35 * W, y: 0.5 * H, q: 1e-6 },
      { x: 0.65 * W, y: 0.35 * H, q: -1e-6 },
      { x: 0.65 * W, y: 0.65 * H, q: -1e-6 },
    ],
    { width: W, height: H },
  );
  const incoming = twoSinks.filter((l) => l.direction === -1);
  assert.ok(incoming.length > 0, 'excess negative charge draws lines in from infinity');
  assert.ok(incoming.every((l) => l.end === 'escaped' || l.end === 'null'));
}

assert.deepEqual(computeFieldLines([], { width: W, height: H }), []);
assert.deepEqual(computeFieldLines([{ x: 1, y: 1, q: 0 }], { width: W, height: H }), []);
assert.deepEqual(computeFieldLines(presets.dipole, { width: 0, height: H }), []);

console.log('electromagnetism tests passed');
