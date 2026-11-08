import assert from 'node:assert/strict';
import {
  computeFit,
  fitProportional,
  sampleFit,
  derivative,
  fitSeries,
  integrate,
  seriesStats,
  smooth,
} from '../../src/lib/sensors/analysis.ts';
import { createRecorder, nextRunLabel, tareOffset } from '../../src/lib/sensors/recording.ts';
import { serializeSensorRuns } from '../../src/lib/sensors/export.ts';
import { cell } from '../../src/lib/sensors/delimited.ts';
import {
  BUMP_PEAK_N,
  BUMP_PERIOD_S,
  BUMP_WIDTH_S,
  simulatedSignal,
} from '../../src/lib/sensors/simulatedSource.ts';
import { boundsOf, clampWindow, withBound, zoomRange } from '../../src/lib/sensors/axis.ts';
import { nearestPoint, placeLabels } from '../../src/lib/sensors/hover.ts';
import type { SensorChannel } from '../../src/lib/sensors/types.ts';

const near = (a: number, b: number, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

const force: SensorChannel = { id: 'ch1', name: 'Force', unit: 'N', quantity: 'Force' };

// --- stats / integral -------------------------------------------------------
{
  const t = [0, 1, 2, 3, 4];
  const y = [0, 2, 4, 2, 0];
  const stats = seriesStats(t, y)!;
  assert.equal(stats.max, 4);
  assert.equal(stats.tMax, 2);
  assert.equal(stats.min, 0);
  near(stats.mean, 1.6);
  near(integrate(t, y)!, 8); // triangle: base 4, height 4 -> 8
  near(integrate(t, y, { min: 0, max: 2 })!, 4);
  assert.equal(integrate([0], [1]), null);
  assert.equal(seriesStats([], []), null);
  // Non-finite samples are ignored, not propagated.
  near(seriesStats([0, 1, 2], [1, NaN, 3])!.mean, 2);
}

// --- derivative / smooth -------------------------------------------
{
  const t = [0, 1, 2, 3];
  const y = [0, 2, 4, 6];
  derivative(t, y).forEach((value) => near(value, 2));
  near(smooth([0, 3, 0], 3)[1], 1);

}

// --- fit --------------------------------------------------------------------
{
  const t = [0, 1, 2, 3, 4];
  const y = t.map((x) => 3 * x + 1);
  const result = fitSeries(t, y, 1);
  assert.ok(result.ok);
  if (result.ok) {
    near(result.fit.coefficients[1], 3, 1e-9);
    near(result.fit.coefficients[0], 1, 1e-9);
  }
  const windowed = fitSeries(t, y, 1, { min: 1, max: 3 });
  assert.ok(windowed.ok && windowed.fit.pointCount === 3);
}

// --- recorder ---------------------------------------------------------------
{
  const rec = createRecorder({ channels: [force] });
  [0, 0.1, 0.2].forEach((time, i) => rec.push({ t: 10 + time, channels: { ch1: i } }));
  const run = rec.finish('Run 1', 'a', 0);
  // Time is rebased to the first kept sample.
  near(run.t[0], 0);
  near(run.t[2], 0.2);
  assert.deepEqual(run.values[0], [0, 1, 2]);
}
{
  // Rising trigger with pre-trigger history.
  const rec = createRecorder({
    channels: [force],
    trigger: { mode: 'rising', channelId: 'ch1', level: 5 },
    preTriggerSeconds: 0.25,
  });
  const feed = [0, 0, 0, 0, 0, 0, 6, 7, 8];
  feed.forEach((value, i) => rec.push({ t: i * 0.1, channels: { ch1: value } }));
  assert.ok(rec.triggered());
  const run = rec.finish('Run 1', 'a', 0);
  // Trigger at t=0.6; keep samples from t>=0.35 -> 0.4,0.5,0.6,0.7,0.8.
  assert.equal(run.t.length, 5);
  assert.deepEqual(run.values[0], [0, 0, 6, 7, 8]);
}
{
  // Never triggered -> empty run, not a run of pre-trigger noise.
  const rec = createRecorder({
    channels: [force],
    trigger: { mode: 'falling', channelId: 'ch1', level: -5 },
  });
  [0, 1, 2].forEach((v, i) => rec.push({ t: i, channels: { ch1: v } }));
  assert.equal(rec.finish('r', 'a', 0).t.length, 0);
  assert.equal(rec.count(), 0);
}
{
  // Duration stops the recorder.
  const rec = createRecorder({ channels: [force], durationSeconds: 1 });
  for (let i = 0; i <= 20; i += 1) rec.push({ t: i * 0.1, channels: { ch1: i } });
  assert.ok(rec.finished());
  assert.ok(rec.finish('r', 'a', 0).t.length <= 12);
}
near(tareOffset([1, 2, 3, NaN]), 2);
assert.equal(tareOffset([]), 0);
assert.equal(nextRunLabel([]), 'Run 1');
assert.equal(nextRunLabel([{ label: 'Run 3' }, { label: 'trial' }]), 'Run 4');

// --- export -----------------------------------------------------------------
{
  const run = {
    id: 'a',
    label: 'Run 1',
    createdAt: 0,
    channels: [force],
    t: [0, 0.5],
    values: [[1, 2]],
  };
  assert.equal(
    serializeSensorRuns([run], { delimiter: ',', layout: 'wide' }),
    't (s),Force (N)\n0.0000,1.0000\n0.5000,2.0000',
  );
  assert.equal(
    serializeSensorRuns([run], { delimiter: '\t', layout: 'long' }),
    'run\tt (s)\tForce (N)\nRun 1\t0.0000\t1.0000\nRun 1\t0.5000\t2.0000',
  );
  assert.equal(serializeSensorRuns([], { delimiter: ',', layout: 'wide' }), '');
  // Two runs of different length pad the shorter one.
  const short = { ...run, id: 'b', label: 'Run 2', t: [0], values: [[9]] };
  const wide = serializeSensorRuns([run, short], { delimiter: ',', layout: 'wide' }).split('\n');
  assert.equal(wide[0], 'Run 1: t (s),Run 1: Force (N),Run 2: t (s),Run 2: Force (N)');
  assert.equal(wide[2], '0.5000,2.0000,,');
}
assert.equal(cell('a,"b"', ','), '"a,""b"""');
assert.equal(cell('a\tb', '\t'), 'a b');

// --- simulated signal -------------------------------------------------------
near(simulatedSignal(BUMP_WIDTH_S / 2).force, BUMP_PEAK_N, 1e-9);
near(simulatedSignal(BUMP_WIDTH_S + 0.1).force, 0);
near(simulatedSignal(BUMP_PERIOD_S + BUMP_WIDTH_S / 2).force, BUMP_PEAK_N, 1e-9);

// --- axis ranges ------------------------------------------------------------
{
  const b = boundsOf([0, 10, NaN])!;
  near(b.min, -0.6);
  near(b.max, 10.6);
  assert.equal(boundsOf([]), null);
  const flat = boundsOf([2, 2])!;
  assert.ok(flat.max > flat.min);
  const z = zoomRange({ min: 0, max: 10 }, 0.5);
  near(z.min, 2.5);
  near(z.max, 7.5);
  const out = zoomRange({ min: 0, max: 10 }, 2);
  near(out.min, -5);
  near(out.max, 15);
  assert.deepEqual(withBound({ min: 0, max: 10 }, 'max', '5'), { min: 0, max: 5 });
  assert.equal(withBound({ min: 0, max: 10 }, 'max', '-1'), null);
  assert.equal(withBound({ min: 0, max: 10 }, 'min', 'abc'), null);
  // The analysis window starts on the zoomed view, limited to the run.
  assert.deepEqual(clampWindow({ min: 1, max: 3 }, { min: 0, max: 10 }), { min: 1, max: 3 });
  assert.deepEqual(clampWindow({ min: -2, max: 12 }, { min: 0, max: 10 }), { min: 0, max: 10 });
  assert.equal(clampWindow({ min: 20, max: 30 }, { min: 0, max: 10 }), null);
}

// --- functional fits --------------------------------------------------------
{
  const t = [0, 1, 2, 3, 4];
  const prop = fitProportional(t, t.map((x) => 2.5 * x))!;
  near(prop.k, 2.5);
  near(prop.rSquared, 1);
  // Window excludes the outlier at t = 4.
  const noisy = [0, 2, 4, 6, 100];
  near(fitProportional(t, noisy, { min: 0, max: 3 })!.k, 2);
  assert.equal(fitProportional([0], [1]), null);
  assert.equal(fitProportional([0, 0], [1, 2]), null);

  const lin = computeFit('linear', t, t.map((x) => 3 * x - 1), null, { x: 't', y: 'F' })!;
  assert.equal(lin.equation, 'F = 3·t − 1');
  near(lin.predict(10), 29, 1e-9);
  const quad = computeFit('quadratic', t, t.map((x) => x * x), null)!;
  near(quad.coefficients[2], 1, 1e-9);
  assert.match(quad.equation, /^y = 1·t² /);
  assert.equal(computeFit('none', t, t, null), null);
  assert.equal(computeFit('quadratic', [0, 1], [0, 1], null), null);
  const curve = sampleFit(lin, { min: 0, max: 4 }, 5);
  assert.equal(curve.length, 5);
  near(curve[4].y, 11, 1e-9);
}

// --- hover hit test ---------------------------------------------------------
{
  const scale = { x: (v: number) => v * 100, y: (v: number) => v * 10 };
  const pts = [
    { seriesKey: 'a', seriesLabel: 'A', x: 1, y: 1 },
    { seriesKey: 'a', seriesLabel: 'A', x: 2, y: 1 },
  ];
  assert.equal(nearestPoint(pts, 190, 12, scale)!.x, 2);
  assert.equal(nearestPoint(pts, 105, 5, scale)!.x, 1);
  // Beyond the pixel radius there is no hover.
  assert.equal(nearestPoint(pts, 150, 10, scale, 20), null);
  assert.equal(nearestPoint([], 0, 0, scale), null);
}

// --- smart label placement --------------------------------------------------
{
  const bounds = { x: 0, y: 0, width: 400, height: 300 };
  const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const inBounds = (b: { x: number; y: number; width: number; height: number }) =>
    b.x >= 0 && b.y >= 0 && b.x + b.width <= 400 && b.y + b.height <= 300;

  // Two nearby points: the second label must not sit on the first.
  const two = placeLabels(
    [
      { cx: 200, cy: 150, width: 120, height: 20 },
      { cx: 210, cy: 152, width: 120, height: 20 },
    ],
    bounds,
  );
  assert.ok(!overlap(two[0], two[1]));
  assert.ok(two.every(inBounds));

  // A point in the top-right corner gets a label that stays inside the plot.
  const corner = placeLabels([{ cx: 395, cy: 5, width: 120, height: 20 }], bounds)[0];
  assert.ok(inBounds(corner));

  // Several close points all find separate spots.
  const crowd = placeLabels(
    [0, 1, 2, 3].map((i) => ({ cx: 200 + i * 4, cy: 150 + i * 3, width: 110, height: 20 })),
    bounds,
  );
  for (let i = 0; i < crowd.length; i += 1) {
    for (let j = i + 1; j < crowd.length; j += 1) assert.ok(!overlap(crowd[i], crowd[j]), `${i} vs ${j}`);
  }

  // A label avoids an occupied box (another point marker).
  const marker = { x: 212, y: 120, width: 16, height: 16 };
  const avoid = placeLabels([{ cx: 200, cy: 150, width: 120, height: 20 }], bounds, [marker])[0];
  assert.ok(!overlap(avoid, marker));
}

console.log('Sensor lab library tests passed.');
