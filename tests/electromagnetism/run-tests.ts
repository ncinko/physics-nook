import assert from 'node:assert/strict';
import { EPSILON_0, flatFlux, field3D, gaussianSurface, measureFlux, gaussPreset, uniformBoxFlux,
  dot3, scale3, type GaussianShape, type Charge3D } from '../../src/lib/electromagnetism/gauss.ts';
import { choosePotentialLevels, traceContours, nearestContour } from '../../src/lib/electromagnetism/contours.ts';
import { allocateLineCounts, clipPolyline, computeFieldLines, probeRadius, seedAnchor,
  seedAngles, type FieldLine } from '../../src/lib/electromagnetism/fieldLines.ts';
import { buildTerrain, terrainHeight, terrainCover,
  ELEVATION_LEVELS } from '../../src/lib/electromagnetism/terrain.ts';
import { shortestTurn, orbitEye, frameHalfWidth, nearestSegment, hitScore,
  type Vector3 } from '../../src/lib/electromagnetism/landscapeView.ts';
import { landscape as modelledLandscape } from '../../src/lib/electromagnetism/terrain.ts';
import { hakone } from '../../src/lib/electromagnetism/terrainHakone.ts';
import { rainier } from '../../src/lib/electromagnetism/terrainRainier.ts';
import { TERRAIN_WIDTH, TERRAIN_DEPTH,
  type Landscape } from '../../src/lib/electromagnetism/surveyedLandscape.ts';
import { advanceDrift, establishment, frontMeetingReach, relaxationTime, sampleAt, sampleLoop,
  seedDrift, slabPolarization, solveLoop, transitionSnapshot, type LoopElement,
  type LoopSample } from '../../src/lib/electromagnetism/surfaceCharge.ts';
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
  // That holds only while every rise stays clear of the sampled area's edge.
  const endpoints = new Map<string, number>();
  for (const segment of contour.segments) for (const p of segment) {
    assert.ok(p[0] > 20 && p[0] < TERRAIN_WIDTH - 20 && p[1] > 20 && p[1] < TERRAIN_DEPTH - 20,
      `contour ${contour.level} reaches the edge at ${p}`);
    const key = p.map(v => v.toFixed(6)).join(',');
    endpoints.set(key, (endpoints.get(key) ?? 0) + 1);
  }
  assert.ok([...endpoints.values()].every(count => count === 2));
}
// The steep spire and the long hill carry the same 100 m interval over very
// different ground; that contrast is the whole point of the illustration.
const contourSpacing = (x: number, z: number) => {
  const crossings: number[] = [];
  let previous = terrainHeight(x, z);
  for (let step = 1; step < 700; step++) {
    const height = terrainHeight(x + step, z);
    for (const level of ELEVATION_LEVELS) if ((previous > level) !== (height > level)) crossings.push(step);
    previous = height;
  }
  return (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
};
const spire = contourSpacing(640, 300), hill = contourSpacing(470, -420);
assert.ok(terrainHeight(640, 300) > 500, 'the spire climbs past the 500 m contour');
assert.ok(terrainHeight(470, -420) > 300, 'the hill climbs past the 300 m contour');
assert.ok(spire < 55, `the spire crowds its contours (${spire})`);
assert.ok(hill > 2.5 * spire, `the hill spreads them much wider (${hill} vs ${spire})`);
// The three landscapes are interchangeable: TopographicLandscape renders
// whichever it is handed, and switches between them at runtime.
const landscapes: Landscape[] = [modelledLandscape, hakone, rainier];
for (const landscape of landscapes) {
  for (const name of ['name', 'ELEVATION_LEVELS', 'EXAGGERATION', 'VERTICAL_SCALE', 'FOCUS_HEIGHT',
    'LIGHT_CONTOUR_MAX', 'LANDSCAPE_DESCRIPTION', 'ELEVATION_CREDIT', 'LOWEST_METRES',
    'HIGHEST_METRES', 'terrainHeight', 'slope', 'terrainCover', 'buildTerrain'] as const) {
    assert.ok(landscape[name] !== undefined, `${landscape.name} is missing ${name}`);
  }
  const built = landscape.buildTerrain();
  assert.equal(built.heights.length, built.columns * built.rows);
  assert.deepEqual(built.contours.map(c => c.level), [...landscape.ELEVATION_LEVELS]);
  // A contour interval has to be even, or "every N metres" in the caption lies.
  const levels = landscape.ELEVATION_LEVELS;
  const interval = levels[1] - levels[0];
  for (let i = 1; i < levels.length; i++) {
    assert.equal(levels[i] - levels[i - 1], interval, `${landscape.name} has an uneven interval`);
  }
  for (const contour of built.contours) {
    assert.ok(contour.segments.length > 0, `${landscape.name} has no ${contour.level} m contour`);
  }
  // Cover shares are fractions and never oversubscribe the ground.
  for (const [x, z] of [[0, 0], [-700, 400], [500, -300], [900, 700]] as const) {
    const cover = landscape.terrainCover(x, z);
    assert.deepEqual(Object.keys(cover).sort(), ['forest', 'snow', 'water']);
    let total = 0;
    for (const share of Object.values(cover)) {
      assert.ok(share >= 0 && share <= 1, `${landscape.name} cover out of range`);
      total += share;
    }
    assert.ok(total <= 1 + 1e-9, `${landscape.name} cover sums past one at ${x}, ${z}`);
  }
  // Relief lands at a readable height whichever landscape is showing: that is
  // what the per-landscape exaggeration is for, and it keeps one camera working.
  const relief = (landscape.HIGHEST_METRES - landscape.LOWEST_METRES) * landscape.VERTICAL_SCALE;
  assert.ok(relief > 480 && relief < 700, `${landscape.name} relief is ${relief} world units`);
}

// Both surveyed landscapes read their contours off the surface they draw.
for (const landscape of [hakone, rainier]) {
  const built = landscape.buildTerrain();
  let lowest = Infinity, highest = -Infinity;
  for (const metres of built.heights) { lowest = Math.min(lowest, metres); highest = Math.max(highest, metres); }
  assert.equal(lowest, landscape.LOWEST_METRES, `${landscape.name} lowest ground`);
  assert.equal(highest, landscape.HIGHEST_METRES, `${landscape.name} highest ground`);
  assert.equal(built.columns, 241);
  assert.equal(built.rows, 193);
  // Grid corners land exactly on stored cells, which pins the world-to-grid mapping.
  for (const [x, z, index] of [
    [-TERRAIN_WIDTH / 2, -TERRAIN_DEPTH / 2, 0],
    [TERRAIN_WIDTH / 2, -TERRAIN_DEPTH / 2, built.columns - 1],
    [TERRAIN_WIDTH / 2, TERRAIN_DEPTH / 2, built.heights.length - 1],
  ] as const) near(landscape.terrainHeight(x, z), built.heights[index], 1e-6);
  // Exact, not approximate: terrainHeight reads the same triangulated surface
  // the tracer cut these segments from.
  for (const contour of built.contours) {
    for (const segment of contour.segments) for (const [x, z] of segment) {
      near(landscape.terrainHeight(x - TERRAIN_WIDTH / 2, z - TERRAIN_DEPTH / 2), contour.level, 1e-9);
    }
  }
}
// Real ground runs off the edge of any window, so these contours are not all
// closed — the modelled landscape's closure check deliberately does not apply.

assert.ok(hakone.HIGHEST_METRES > 1400 && hakone.HIGHEST_METRES < 1450,
  `Kamiyama near its 1438 m, got ${hakone.HIGHEST_METRES}`);
assert.equal(hakone.LOWEST_METRES, 87, 'Hayakawa valley floor');
// Rainier's summit is 4392 m; averaging 75 m cells rounds the very point off.
assert.ok(rainier.HIGHEST_METRES > 4300 && rainier.HIGHEST_METRES <= 4392,
  `Columbia Crest near its 4392 m, got ${rainier.HIGHEST_METRES}`);
assert.ok(rainier.LOWEST_METRES > 900 && rainier.LOWEST_METRES < 1200, 'river valleys around the park');
// Rainier is genuinely far steeper than the worn caldera, so it needs less
// stretching to read. If that ever inverts, one of the two is mis-scaled.
assert.ok(rainier.EXAGGERATION < hakone.EXAGGERATION,
  'the steeper mountain should need less vertical exaggeration');

// Hakone alone carries standing water; Rainier alone carries permanent snow.
const hakoneTerrain = hakone.buildTerrain();
const lakeCells: number[] = [];
for (let row = 0; row < hakoneTerrain.rows; row++) {
  for (let column = 0; column < hakoneTerrain.columns; column++) {
    const x = column / (hakoneTerrain.columns - 1) * TERRAIN_WIDTH - TERRAIN_WIDTH / 2;
    const z = row / (hakoneTerrain.rows - 1) * TERRAIN_DEPTH - TERRAIN_DEPTH / 2;
    const cover = hakone.terrainCover(x, z, hakoneTerrain.heights[row * hakoneTerrain.columns + column]);
    assert.equal(cover.snow, 0, 'Hakone holds no permanent snow');
    lakeCells.push(cover.water > 0.5 ? 1 : 0);
  }
}
// Flat ground at the lake's height turns up all over the caldera, so the cover
// model takes the largest connected sheet. One blob, or that has regressed.
const visited = new Uint8Array(lakeCells.length);
const blobs: number[] = [];
for (let seed = 0; seed < lakeCells.length; seed++) {
  if (!lakeCells[seed] || visited[seed]) continue;
  let size = 0;
  const stack = [seed];
  visited[seed] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    size++;
    const column = i % hakoneTerrain.columns, row = (i - column) / hakoneTerrain.columns;
    const neighbours = [column > 0 ? i - 1 : -1, column < hakoneTerrain.columns - 1 ? i + 1 : -1,
      row > 0 ? i - hakoneTerrain.columns : -1,
      row < hakoneTerrain.rows - 1 ? i + hakoneTerrain.columns : -1];
    for (const j of neighbours) if (j >= 0 && lakeCells[j] && !visited[j]) { visited[j] = 1; stack.push(j); }
  }
  blobs.push(size);
}
assert.equal(blobs.length, 1, `Lake Ashi should be one sheet, found ${blobs.length}`);
// The real lake covers 6.9 km2; a 48 m grid loses a little of the narrow inlets.
near(blobs[0] * 48 * 48 / 1e6, 6.8, 0.5);
// It sits clear of every edge, which is the whole point of the wider window.
let westmost = Infinity, eastmost = -Infinity, northmost = Infinity, southmost = -Infinity;
for (let i = 0; i < lakeCells.length; i++) {
  if (!lakeCells[i]) continue;
  const column = i % hakoneTerrain.columns, row = (i - column) / hakoneTerrain.columns;
  westmost = Math.min(westmost, column); eastmost = Math.max(eastmost, column);
  northmost = Math.min(northmost, row); southmost = Math.max(southmost, row);
}
assert.ok(westmost > 0 && northmost > 0, 'the lake reaches the north or west edge');
assert.ok(eastmost < hakoneTerrain.columns - 1 && southmost < hakoneTerrain.rows - 1,
  'the lake reaches the south or east edge');
const lakeMiddle = hakone.terrainCover(-607, 340);
assert.equal(lakeMiddle.water, 1, 'open water mid-lake');
assert.equal(lakeMiddle.forest, 0);

// Rainier's summit cone is under permanent ice, its valleys are forest, and it
// has no lake for the flat-sheet rule to find.
const rainierTerrain = rainier.buildTerrain();
let snowTotal = 0, forestTotal = 0, waterTotal = 0;
for (let row = 0; row < rainierTerrain.rows; row++) {
  for (let column = 0; column < rainierTerrain.columns; column++) {
    const x = column / (rainierTerrain.columns - 1) * TERRAIN_WIDTH - TERRAIN_WIDTH / 2;
    const z = row / (rainierTerrain.rows - 1) * TERRAIN_DEPTH - TERRAIN_DEPTH / 2;
    const cover = rainier.terrainCover(x, z, rainierTerrain.heights[row * rainierTerrain.columns + column]);
    waterTotal += cover.water;
    snowTotal += cover.snow;
    forestTotal += cover.forest;
  }
}
const cells = rainierTerrain.heights.length;
assert.equal(waterTotal, 0, 'no lake was asked for on Rainier');
// The mountain's 78 km2 of glacier over this 259 km2 window is about 30% ice.
// The band is wide because the cover model is a snowline, not a glacier survey.
const iceShare = snowTotal / cells;
assert.ok(iceShare > 0.15 && iceShare < 0.4, `ice covers ${(iceShare * 100).toFixed(0)}% of the window`);
assert.ok(forestTotal / cells > 0.2, `forest covers ${(forestTotal / cells * 100).toFixed(0)}%`);
// High on the cone it is ice; down on the lowest valley floor it is forest.
assert.ok(rainier.terrainCover(0, 0).snow > 0.9, 'the summit cone should be under ice');
assert.equal(rainier.terrainCover(-TERRAIN_WIDTH / 2, -717).forest, 1, 'the valley floor is forest');

// Turning the landscape always takes the short way round.
near(shortestTurn(0, 90), 90);
near(shortestTurn(170, -170), 20, 1e-9);
near(shortestTurn(-170, 170), -20, 1e-9);
near(shortestTurn(0, 180), 180);
near(shortestTurn(45, 45), 0);

// The orbit camera pitches and spins but never rolls: up stays perpendicular to
// the view direction and keeps its horizontal bearing aligned with the eye.
for (const elevation of [12, 34, 60, 89, 90]) {
  for (const azimuth of [-175, -90, 0, 37, 120, 180]) {
    const eye = orbitEye(elevation, azimuth, 3000, 180);
    const view = eye.target.map((v, i) => v - eye.position[i]);
    const dot = view.reduce((total, v, i) => total + v * eye.up[i], 0);
    near(dot, 0, 1e-9);
    near(Math.hypot(...eye.up), 1, 1e-9);
    // The eye is the orbit radius from the point it looks at, whatever the turn.
    near(Math.hypot(...view), 3000, 1e-9);
  }
}
// At bearing zero the eye sits due south and level with the old fixed camera.
const facing = orbitEye(34, 0, 3000, 180);
near(facing.position[0], 0, 1e-9);
near(facing.position[2], 3000 * Math.cos(34 * Math.PI / 180), 1e-9);

// Turning the map swings its corners wide, and the frame has to hold them. The
// box the Hakone landscape sits in must stay inside the frame at every angle a
// drag can reach, while the fixed views keep the framing they were tuned with.
const FRAME_HALF_WIDTH = 1280, FRAME_MARGIN = 1.04, FRAME_ASPECT = 2 / 3;
// The component measures the box from the lowest ground, not from zero.
let floorHeight = Infinity, ceiling = -Infinity;
for (const metres of hakoneTerrain.heights) {
  floorHeight = Math.min(floorHeight, metres * hakone.VERTICAL_SCALE);
  ceiling = Math.max(ceiling, metres * hakone.VERTICAL_SCALE);
}
const corners: Vector3[] = [];
for (const x of [-TERRAIN_WIDTH / 2, TERRAIN_WIDTH / 2]) for (const y of [floorHeight, ceiling]) {
  for (const z of [-TERRAIN_DEPTH / 2, TERRAIN_DEPTH / 2]) corners.push([x, y, z]);
}
const framing = (elevation: number, azimuth: number) => {
  const eye = orbitEye(elevation, azimuth, 3000,
    hakone.FOCUS_HEIGHT * (1 - (elevation - 34) / 56));
  return {
    needed: frameHalfWidth(corners, eye, FRAME_ASPECT),
    applied: Math.max(FRAME_HALF_WIDTH, FRAME_MARGIN * frameHalfWidth(corners, eye, FRAME_ASPECT)),
  };
};
for (let elevation = 12; elevation <= 90; elevation += 3) {
  for (let azimuth = -180; azimuth < 180; azimuth += 5) {
    const { needed, applied } = framing(elevation, azimuth);
    assert.ok(Number.isFinite(needed) && needed > 0, `frame width came out ${needed}`);
    assert.ok(applied >= needed, `landscape clips at elevation ${elevation}, bearing ${azimuth}`);
  }
}
// The two fixed views keep the frame they were composed with.
assert.ok(framing(34, 0).applied < FRAME_HALF_WIDTH * 1.02, 'the default view is framed as before');
assert.equal(framing(90, 0).applied, FRAME_HALF_WIDTH, 'the overhead map is framed as before');
// A quarter turn genuinely needs more room than face-on, which is the point.
assert.ok(framing(34, 45).needed > framing(34, 0).needed * 1.2, 'a diagonal view is wider');

// Reading a contour off the screen: three segments, one of them a degenerate
// point, laid out so the answers can be worked out by hand.
const drawn = new Float32Array([
  0, 0, 0.5, 100, 0, 0.5,      // a horizontal segment at y = 0
  0, 50, 0.1, 0, 50, 0.1,      // a zero-length segment at (0, 50)
  40, 80, 0.9, 60, 100, 0.9,   // a diagonal
]);
const onLine = nearestSegment(drawn, 0, 6, 30, 4, 9)!;
near(onLine.x, 30); near(onLine.y, 0); near(onLine.distance, 4); near(onLine.depth, 0.5);
// Past the end of a segment the nearest point is its endpoint, not its infinite line.
const pastEnd = nearestSegment(drawn, 0, 6, 106, 0, 9)!;
near(pastEnd.x, 100); near(pastEnd.distance, 6);
assert.equal(nearestSegment(drawn, 0, 6, 130, 0, 9), null, 'beyond the probe radius');
// A zero-length segment still answers, rather than dividing by its own length.
const degenerate = nearestSegment(drawn, 2, 2, 3, 54, 9)!;
near(degenerate.x, 0); near(degenerate.y, 50); near(degenerate.distance, 5);
assert.ok(Number.isFinite(degenerate.depth));
// Points come in pairs, so an odd trailing point is not joined to the next one.
assert.equal(nearestSegment(drawn, 1, 1, 100, 0, 9), null, 'a lone point is no segment');

// Ranking: a closer line wins; within a pixel of each other the nearer one to
// the eye wins, which is the one drawn in front of the hillside.
assert.ok(hitScore({ x: 0, y: 0, distance: 2, depth: 0.9 })
  < hitScore({ x: 0, y: 0, distance: 5, depth: -0.9 }), 'a clearly closer line wins');
assert.ok(hitScore({ x: 0, y: 0, distance: 3.1, depth: -0.5 })
  < hitScore({ x: 0, y: 0, distance: 2.9, depth: 0.5 }), 'a near-tie goes to the nearer line');

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

// Seeds are counted from the direction the rest of the scene pushes the
// charge's flux, an anchor that mirrors with the scene and never lands in a
// stretch of profile the field has already been clipped out of.
{
  const pair: PointCharge[] = [
    { x: 0, y: 0, q: 1e-6 },
    { x: 100, y: 0, q: 1e-6 },
  ];
  // Pushed away from a like-sign neighbour, drawn towards an opposite one.
  near(Math.abs(seedAnchor(pair, 0)), Math.PI);
  near(seedAnchor([...pair.slice(0, 1), { x: 100, y: 0, q: -1e-6 }], 0), 0);
  // A sink divides its own sign out, so it anchors on the source that feeds it
  // — the mirror image of that source's own anchor, not its opposite.
  near(seedAnchor([{ x: 0, y: 0, q: -1e-6 }, { x: 100, y: 0, q: 1e-6 }], 0), 0);
  near(Math.abs(seedAnchor([{ x: 0, y: 0, q: 1e-6 }, { x: 100, y: 0, q: -1e-6 }], 1)), Math.PI);
  // Nothing around it: the anchor is 0, keeping a line on a dipole axis.
  near(seedAnchor([{ x: 0, y: 0, q: 1e-6 }], 0), 0);

  // The dead wedge towards a like-sign neighbour is clipped out of the profile,
  // so seeds step over it — further off than the fixed half-step this replaced.
  for (const theta of seedAngles(pair, 0, 12)) {
    const offNeighbour = Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta)));
    assert.ok(offNeighbour >= Math.PI / 12,
      `no seed is fired at a like-sign neighbour (got ${(offNeighbour * 180) / Math.PI}°)`);
  }
}

// Seeds carry equal flux rather than equal angle, so a charge sends more of
// them where more of its field goes — the density a reader is asked to trust.
{
  const seedRadius = 10;
  const lone: PointCharge[] = [{ x: 0, y: 0, q: 1e-6 }];
  // An isolated charge sees the same field all the way round its probe circle,
  // so the partition has to come back out as the even ring it replaces.
  seedAngles(lone, 0, 12, { seedRadius }).forEach((theta, j) => {
    near(theta, (2 * Math.PI * j) / 12, 1e-9);
  });
  // ... and it has no neighbour spacing to read, so it probes close in.
  near(probeRadius(lone, 0, seedRadius), seedRadius * 1.5);

  // A dipole is far enough apart that its probe circles stay isotropic too: the
  // textbook picture, including the line straight down the axis.
  const dipolePair: PointCharge[] = [
    { x: 0.35 * W, y: 0.5 * H, q: 1e-6 },
    { x: 0.65 * W, y: 0.5 * H, q: -1e-6 },
  ];
  seedAngles(dipolePair, 0, 12, { seedRadius }).forEach((theta, j) => {
    near(theta, (2 * Math.PI * j) / 12, 0.01);
  });

  // A charge in a row is the case the profile exists for. Half its seeds
  // pointed into the weak field behind the row when they were spaced by angle.
  const row: PointCharge[] = [
    ...Array.from({ length: 7 }, (_, i) => ({ x: 0.4 * W, y: ((i + 1) / 8) * H, q: 1e-6 })),
    ...Array.from({ length: 7 }, (_, i) => ({ x: 0.6 * W, y: ((i + 1) / 8) * H, q: -1e-6 })),
  ];
  // The probe circle reads the row's spacing, staying clear of the neighbour
  // it would otherwise sample the far side of.
  assert.ok(probeRadius(row, 3, seedRadius) < H / 8, 'the probe clears the next charge along');
  assert.ok(probeRadius(row, 3, seedRadius) > seedRadius * 1.5, 'and reads out past the core');
  const intoGap = seedAngles(row, 3, 12, { seedRadius }).filter((t) => Math.cos(t) > 0).length;
  assert.ok(intoGap > 6, `a charge in a row aims most of its seeds into the gap (got ${intoGap}/12)`);
  // Its mirror image in the far row has to aim the same seeds back, angle for
  // angle, or the two ends of one physical line seed different curves and the
  // line gets drawn twice.
  const wrap = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const sorted = (a: number[]) => a.map(wrap).sort((x, y) => x - y);
  const mirrored = sorted(seedAngles(row, 3, 12, { seedRadius }).map((t) => Math.PI - t));
  sorted(seedAngles(row, 10, 12, { seedRadius })).forEach((theta, j) => {
    near(theta, mirrored[j], 1e-6);
  });
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
  chargedRows: [
    ...Array.from({ length: 7 }, (_, i) => ({ x: 0.4 * W, y: ((i + 1) / 8) * H, q: 1e-6 })),
    ...Array.from({ length: 7 }, (_, i) => ({ x: 0.6 * W, y: ((i + 1) / 8) * H, q: -1e-6 })),
  ],
  likeCharges: [
    { x: 0.35 * W, y: 0.5 * H, q: 1e-6 },
    { x: 0.65 * W, y: 0.5 * H, q: 1e-6 },
  ],
  // The field explorer lays its scenes out differently from the potential
  // explorer — wider dipole, wider gap, five charges a row — and both call this
  // module, so both geometries are held to the same promises.
  wideDipole: [
    { x: 0.3 * W, y: 0.5 * H, q: 1e-6 },
    { x: 0.7 * W, y: 0.5 * H, q: -1e-6 },
  ],
  wideChargedRows: [
    ...Array.from({ length: 5 }, (_, i) => ({ x: 0.2 * W, y: ((i + 1) / 6) * H, q: 1e-6 })),
    ...Array.from({ length: 5 }, (_, i) => ({ x: 0.8 * W, y: ((i + 1) / 6) * H, q: -1e-6 })),
  ],
};

for (const [name, charges] of Object.entries(presets)) {
  const lines = computeFieldLines(charges, { width: W, height: H });

  // The regression this module exists for: seeding every charge and tracing
  // each seed independently drew the same line twice and left sinks carrying
  // roughly double the ends of sources. Every charge should show the same
  // twelve, a lone charge and a row of them alike.
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

{
  // A conducting block screens an applied field out of its own interior with
  // the dielectric relaxation time tau = eps0/sigma.
  const tau = relaxationTime(5.8e7);
  near(tau, EPSILON_0 / 5.8e7);
  assert.equal(relaxationTime(0), Infinity);
  assert.equal(relaxationTime(-1), Infinity);

  const start = slabPolarization(100, 0, tau);
  near(start.fraction, 0);
  near(start.internalField, 100);
  near(start.surfaceChargeDensity, 0);

  for (const multiple of [0.25, 1, 3, 12]) {
    const state = slabPolarization(100, multiple * tau, tau);
    near(state.internalField, 100 * Math.exp(-multiple), 1e-9);
    near(state.inducedField + state.internalField, 100, 1e-9);
    // Charge on the faces is exactly the field that has gone missing inside.
    near(EPSILON_0 * state.internalField + state.surfaceChargeDensity, EPSILON_0 * 100, 1e-18);
  }
  assert.ok(slabPolarization(100, 40 * tau, tau).internalField < 1e-15, 'screening finishes');

  // Charge only ever arrives, and the current feeding it dies with the field.
  const early = slabPolarization(100, 0.5 * tau, tau);
  const late = slabPolarization(100, 2 * tau, tau);
  assert.ok(late.surfaceChargeDensity > early.surfaceChargeDensity);
  assert.ok(late.currentDensity < early.currentDensity);
  // Time before the field was applied is not a way to un-polarise the block.
  near(slabPolarization(100, -5, tau).fraction, 0);
}

{
  // Battery, wire, switch, resistor. Arc length runs 0-100 wire, 100-140
  // battery, 140-240 wire, 240-260 switch, 260-320 resistor.
  const loop = (switchResistance: number): LoopElement[] => [
    { id: 'lower', kind: 'wire', length: 100, resistance: 0.25 },
    { id: 'battery', kind: 'battery', length: 40, resistance: 0.2, emf: 6 },
    { id: 'upper', kind: 'wire', length: 100, resistance: 0.25 },
    { id: 'gate', kind: 'switch', length: 20, resistance: switchResistance },
    { id: 'resistor', kind: 'resistor', length: 60, resistance: 5 },
  ];
  const closed = loop(0);
  const open = loop(1e9);

  const solved = solveLoop(closed);
  near(solved.length, 320);
  near(solved.resistance, 5.7);
  near(solved.current, 6 / 5.7);

  const flowing = sampleLoop(closed, 320);
  assert.equal(flowing.length, 320);
  // An isolated loop carries no net charge, so the profile has zero mean.
  near(flowing.reduce((sum, s) => sum + s.potential, 0) / flowing.length, 0, 1e-12);

  const nearest = (list: readonly LoopSample[], s: number) =>
    list.reduce((best, sample) => (Math.abs(sample.s - s) < Math.abs(best.s - s) ? sample : best));

  // Potential peaks just past the positive terminal and bottoms out just before
  // the negative one, separated by the emf less the internal drop.
  near(nearest(flowing, 141).potential - nearest(flowing, 99).potential, 6 - solved.current * 0.2, 0.05);
  // Positive charge on the run out to the resistor, negative on the way back.
  assert.ok(nearest(flowing, 200).potential > 0);
  assert.ok(nearest(flowing, 50).potential < 0);

  // Each element drops I*R, so its internal field is that drop over its length:
  // the short resistor needs a far stronger field than the long wire.
  const inResistor = flowing.filter((s) => s.kind === 'resistor');
  const inWire = flowing.filter((s) => s.kind === 'wire');
  near(inResistor[0].field, (solved.current * 5) / 60, 1e-12);
  near(inWire[0].field, (solved.current * 0.25) / 100, 1e-12);
  assert.ok(inResistor[0].field > 30 * inWire[0].field);

  // Opening the switch does not clear the surface charge. It stops the current,
  // makes each branch an equipotential, and moves the whole drop into the gap.
  const idle = sampleLoop(open, 320);
  assert.ok(solveLoop(open).current < 1e-8, 'an open switch carries no useful current');
  assert.ok(
    Math.abs(nearest(idle, 200).potential - nearest(idle, 180).potential) < 1e-6,
    'a branch of an open circuit is an equipotential',
  );
  near(nearest(idle, 239).potential - nearest(idle, 261).potential, 6, 0.1);
  assert.ok(Math.max(...idle.map((s) => Math.abs(s.potential))) > 2.9, 'the branches still carry charge');
  assert.ok(idle.filter((s) => s.kind === 'wire').every((s) => Math.abs(s.field) < 1e-9));

  // Throwing the switch starts a change at the gap and nowhere else.
  near(frontMeetingReach(closed, 'gate'), 150);
  const opts = (frontReach: number) => ({ originId: 'gate', frontReach, relaxationLength: 25 });

  const done = transitionSnapshot(closed, idle, flowing, opts(Infinity));
  done.forEach((s, i) => near(s.potential, flowing[i].potential, 1e-9));
  const untouched = transitionSnapshot(closed, idle, flowing, opts(0));
  untouched.forEach((s, i) => near(s.potential, idle[i].potential, 1e-9));

  const partial = transitionSnapshot(closed, idle, flowing, opts(40));
  near(partial.reduce((sum, s) => sum + s.potential, 0) / partial.length, 0, 1e-12);
  assert.ok(partial.some((s) => s.established === 0), 'a front 40 in has not crossed a loop of 320');
  assert.ok(
    partial.every((s) => s.distanceFromOrigin < 40 || s.established === 0),
    'nothing ahead of the front has begun to move',
  );
  // Ahead of the front the old arrangement stands, up to the shared re-centring
  // that keeps the loop neutral.
  const shift = partial[0].potential - idle[0].potential;
  partial.forEach((s, i) => {
    if (s.established === 0) near(s.potential, idle[i].potential + shift, 1e-9);
  });
  // The switch's own span never has to wait, so it leads the rest of the loop.
  const leader = Math.max(...partial.map((s) => s.established));
  assert.ok(partial.filter((s) => s.kind === 'switch').every((s) => s.established === leader));

  // Current builds as the fronts advance, and stops at the steady value.
  const flow = (reach: number) =>
    Math.max(...transitionSnapshot(closed, idle, flowing, opts(reach)).map((s) => s.current));
  assert.ok(flow(40) < flow(120));
  assert.ok(flow(120) < flow(300));
  near(flow(Infinity), solved.current, 1e-12);

  // Opening again runs the same machinery the other way.
  const opening = transitionSnapshot(open, flowing, idle, opts(60));
  near(opening.reduce((sum, s) => sum + s.potential, 0) / opening.length, 0, 1e-12);
  assert.ok(
    Math.max(...opening.filter((s) => s.established === 0).map((s) => Math.abs(s.current))) > 1,
    'wire the fronts have not reached is still carrying the old current',
  );

  assert.throws(() => sampleLoop(closed, 0));
  assert.throws(() => sampleLoop(closed, 2.5));
  assert.deepEqual(sampleLoop([], 10), []);
  assert.throws(() => transitionSnapshot(closed, idle, flowing.slice(1), opts(10)));
  assert.throws(() => transitionSnapshot(closed, idle, flowing, { originId: 'nope', frontReach: 10 }));

  near(establishment(10, 5, 3), 0);
  near(establishment(0, Infinity, 3), 1);
  assert.ok(establishment(2, 10, 3) > establishment(6, 10, 3));

  // The profile is not symmetric about the axis. Referring the potential to the
  // loop mean puts that mean nearer the longer, low-resistance stretch, so one
  // half of the profile runs further from it than the other - past a full half
  // of the emf, in fact, which is what the figure's plot has to leave room for
  // if it is not to flatten the tall side off.
  const unit = (s: LoopSample) => s.potential / 3;
  const openHigh = Math.max(...idle.map(unit));
  const openLow = Math.min(...idle.map(unit));
  assert.ok(openHigh > 1.1, 'the far side of an open loop passes a half-emf unit');
  assert.ok(Math.abs(openLow) < openHigh, 'and it does so asymmetrically');
  assert.ok(Math.max(...flowing.map(unit)) < 1.5 && Math.min(...flowing.map(unit)) > -1.5,
    'but one and a half units is room enough for either state');

  // Carriers start evenly spread, which is what uniform carrier density means.
  const seeded = seedDrift(8, 320);
  assert.equal(seeded.length, 8);
  near(seeded[0], 20);
  seeded.slice(1).forEach((s, i) => near(s - seeded[i], 40));
  assert.throws(() => seedDrift(0, 320));
  assert.throws(() => seedDrift(2.5, 320));

  // sampleAt picks the cell holding s, and wraps the way arc length does.
  assert.equal(sampleAt(flowing, 0.4, 320), flowing[0]);
  assert.equal(sampleAt(flowing, 319.9, 320), flowing[319]);
  assert.equal(sampleAt(flowing, -0.5, 320), flowing[319]);
  assert.equal(sampleAt(flowing, 320.5, 320), flowing[0]);
  assert.equal(sampleAt([], 10, 320), undefined);

  const drift = (positions: readonly number[], profile: readonly LoopSample[], dt: number) =>
    advanceDrift(positions, profile, dt, {
      perimeter: 320,
      referenceCurrent: solved.current,
      speed: 40,
      maxFactor: 2.5,
    });

  // Negative carriers run against the conventional current, at the reference
  // speed when the loop carries the reference current.
  const steady = drift([100], flowing, 1);
  near(steady.velocities[0], -40, 1e-9);
  near(steady.positions[0], 60, 1e-9);
  // And they wrap rather than running off the end of the loop.
  near(drift([10], flowing, 1).positions[0], 290, 1e-9);

  // An open switch leaves them where they stand.
  const stopped = drift([100], idle, 1);
  assert.ok(Math.abs(stopped.velocities[0]) < 1e-6, 'no current, no drift');
  near(stopped.positions[0], 100, 1e-6);

  // Mid-transient the loop shows both at once: a carrier behind the front has
  // been set moving while one the front has not reached is still at rest.
  const spreading = transitionSnapshot(closed, idle, flowing, opts(40));
  const behind = spreading.find((s) => s.established > 0.5 && s.kind === 'wire');
  const ahead = spreading.find((s) => s.established === 0);
  assert.ok(behind && ahead, 'a 40-unit front leaves wire on both sides of it');
  const mixed = drift([behind!.s, ahead!.s], spreading, 1);
  assert.ok(Math.abs(mixed.velocities[0]) > 1, 'the carrier behind the front is moving');
  assert.ok(Math.abs(mixed.velocities[1]) < 1e-6, 'the carrier ahead of it has heard nothing');

  // A loop stiff enough to draw twenty amps is capped rather than allowed to blur.
  const stiff = sampleLoop([
    { id: 'lower', kind: 'wire', length: 160, resistance: 0.1 },
    { id: 'battery', kind: 'battery', length: 40, resistance: 0.1, emf: 6 },
    { id: 'upper', kind: 'wire', length: 120, resistance: 0.1 },
  ], 320);
  near(stiff[0].current, 20);
  near(drift([100], stiff, 1).velocities[0], -40 * 2.5, 1e-9);
  // A frame of no elapsed time moves nobody.
  near(drift([100], flowing, 0).positions[0], 100, 1e-12);
  near(drift([100], flowing, -1).positions[0], 100, 1e-12);
}

console.log('electromagnetism tests passed');
