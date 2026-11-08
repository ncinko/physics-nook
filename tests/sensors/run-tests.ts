import assert from 'node:assert/strict';
import {
  derivative,
  findPeaks,
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
import { boundsOf, withBound, zoomRange } from '../../src/lib/sensors/axis.ts';
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

// --- derivative / smooth / peaks -------------------------------------------
{
  const t = [0, 1, 2, 3];
  const y = [0, 2, 4, 6];
  derivative(t, y).forEach((value) => near(value, 2));
  near(smooth([0, 3, 0], 3)[1], 1);

  const pt = [0, 1, 2, 3, 4, 5, 6];
  const py = [0, 5, 0, 0.1, 0, 4, 0];
  const peaks = findPeaks(pt, py, 1);
  assert.deepEqual(peaks.map((p) => p.t), [1, 5]);
  assert.equal(findPeaks(pt, py, 10).length, 0);
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
}

console.log('Sensor lab library tests passed.');
