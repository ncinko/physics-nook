import assert from 'node:assert/strict';
import {
  SAMPLE_ACCELERATION,
  SAMPLE_CATCH_TIME,
  SAMPLE_RELEASE_TIME,
  analyzeRun,
  cartFitFrom,
  cartFitGroups,
  cartPlotCaption,
  centralDifferenceVelocity,
  deriveRows,
  fitRunVelocity,
  nextRunId,
  nextRunLabel,
  parseStoredRuns,
  plotFileName,
  serializeResults,
  serializeRuns,
  serializeStoredRuns,
  syntheticCartRun,
  velocitySpan,
  type CartRun,
  type CartSample,
} from '../../src/lib/forces/cartRun.ts';

const near = (actual: number, expected: number, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be near ${expected}`);
};

const quadratic = (a: number, v0: number, x0: number, count: number, dt = 0.05): CartSample[] =>
  Array.from({ length: count }, (_, i) => {
    const t = i * dt;
    return { t, x: x0 + v0 * t + 0.5 * a * t * t, ok: true };
  });

const runOf = (samples: CartSample[], label = 'Run 1', id = 1): CartRun => ({
  id,
  label,
  samples,
  periodSeconds: 0.05,
  distanceScale: 1.15,
  fitRange: null,
});

// The central difference is exact for a quadratic, and the ends carry no velocity.
{
  const samples = quadratic(0.6, 0.1, 0.3, 21);
  const v = centralDifferenceVelocity(samples);
  assert.equal(v[0], null);
  assert.equal(v[v.length - 1], null);
  for (let i = 1; i < samples.length - 1; i += 1) {
    near(v[i] as number, 0.1 + 0.6 * samples[i].t, 1e-9);
  }
}

// Uneven spacing uses the real timestamps, not the sample index.
{
  const motion = (t: number) => 1 + 2 * t + 3 * t * t;
  const samples = [0, 0.1, 0.4].map((t) => ({ t, x: motion(t), ok: true }));
  near(centralDifferenceVelocity(samples)[1] as number, (motion(0.4) - motion(0)) / 0.4);
}

// A dropout blanks its own velocity and its neighbours', never a zero.
{
  const samples = quadratic(0.6, 0, 0.3, 9);
  samples[4] = { ...samples[4], ok: false };
  const v = centralDifferenceVelocity(samples);
  [3, 4, 5].forEach((i) => assert.equal(v[i], null, `velocity ${i} should be blank`));
  assert.notEqual(v[2], null);
  assert.notEqual(v[6], null);
  const rows = deriveRows(samples);
  assert.equal(rows[4].x, null);
  assert.equal(rows[4].v, null);
  // Coincident timestamps are unverifiable, not a division by zero.
  assert.deepEqual(
    centralDifferenceVelocity([
      { t: 0, x: 0, ok: true },
      { t: 0.1, x: 1, ok: true },
      { t: 0, x: 2, ok: true },
    ]),
    [null, null, null],
  );
}

// The fit recovers a and v0 from a clean quadratic position trace.
{
  const run = runOf(quadratic(0.62, 0.15, 0.3, 40));
  const analysis = analyzeRun(run);
  const fit = cartFitFrom(analysis.result);
  assert.ok(fit);
  near(fit.a.value, 0.62, 1e-9);
  near(fit.v0.value, 0.15, 1e-9);
  near(fit.rSquared, 1, 1e-9);
  // 40 samples, minus the two ends that have no velocity.
  assert.equal(fit.pointCount, 38);
  // The default window is the span of the data that has a velocity.
  near(analysis.range?.min as number, 0.05);
  near(analysis.range?.max as number, 38 * 0.05);
}

// The fit honours the window: a bounce at the end is left out when asked.
{
  const synthetic = syntheticCartRun(1, 'Run 1', 7);
  const all = analyzeRun(synthetic);
  const windowed = analyzeRun({
    ...synthetic,
    fitRange: { min: SAMPLE_RELEASE_TIME + 0.1, max: SAMPLE_CATCH_TIME - 0.1 },
  });
  const allFit = cartFitFrom(all.result);
  const windowFit = cartFitFrom(windowed.result);
  assert.ok(allFit && windowFit);
  near(windowFit.a.value, SAMPLE_ACCELERATION, 0.05);
  assert.ok(
    Math.abs(allFit.a.value - SAMPLE_ACCELERATION) > Math.abs(windowFit.a.value - SAMPLE_ACCELERATION),
    'hand contact and the bounce drag the unwindowed fit away from the true acceleration',
  );
  assert.ok(windowFit.pointCount < allFit.pointCount);
}

// With no sigmas the reported uncertainty is the scatter one, and it is a real,
// positive number for noisy data rather than the sigma = 1 placeholder.
{
  const run = syntheticCartRun(1, 'Run 1', 3);
  const range = { min: SAMPLE_RELEASE_TIME + 0.1, max: SAMPLE_CATCH_TIME - 0.1 };
  const result = fitRunVelocity(deriveRows(run.samples), range);
  assert.ok(result.ok);
  const fit = cartFitFrom(result);
  assert.ok(fit);
  assert.equal(result.fit.weighted, false);
  near(fit.a.uncertainty, result.fit.scatterUncertainties[1]);
  assert.ok(fit.a.uncertainty > 0 && fit.a.uncertainty < 0.1);
  assert.notEqual(fit.a.uncertainty, result.fit.uncertainties[1]);
}

// Too few points in the window is a failure, not a bogus line.
{
  const run = runOf(quadratic(0.6, 0, 0.3, 20));
  const result = fitRunVelocity(deriveRows(run.samples), { min: 0.1, max: 0.1 });
  assert.equal(result.ok, false);
  assert.equal(cartFitFrom(result), null);
  assert.deepEqual(cartFitGroups(result), []);
  assert.equal(velocitySpan([]), null);
}

// Same seed, same run; a different seed is a different run.
{
  const a = syntheticCartRun(1, 'A', 5);
  const b = syntheticCartRun(2, 'B', 5);
  const c = syntheticCartRun(3, 'C', 6);
  assert.deepEqual(a.samples, b.samples);
  assert.notDeepEqual(a.samples, c.samples);
}

// Spreadsheet export.
{
  const one = runOf(quadratic(0.6, 0, 0.3, 4));
  const two = runOf(quadratic(0.5, 0, 0.3, 6), 'Run 2', 2);

  const single = serializeRuns([one], { delimiter: '\t', layout: 'wide' });
  const singleLines = single.split('\n');
  assert.equal(single.endsWith('\n'), false, 'no trailing newline to paste as a blank row');
  assert.deepEqual(singleLines[0].split('\t'), ['t (s)', 'x (m)', 'v (m/s)']);
  assert.equal(singleLines.length, 5, 'header plus one row per sample');
  // Ends have no velocity: blank, not zero.
  assert.equal(singleLines[1].split('\t')[2], '');
  assert.equal(singleLines[4].split('\t')[2], '');
  assert.ok(singleLines[2].split('\t')[2].length > 0);

  const wide = serializeRuns([one, two], { delimiter: '\t', layout: 'wide' });
  const wideLines = wide.split('\n');
  assert.deepEqual(wideLines[0].split('\t').slice(0, 3), ['Run 1: t (s)', 'Run 1: x (m)', 'Run 1: v (m/s)']);
  assert.equal(wideLines.length, 7, 'the longer run sets the height');
  // The shorter run runs out and leaves blank cells, not zeros.
  assert.deepEqual(wideLines[6].split('\t').slice(0, 3), ['', '', '']);

  const long = serializeRuns([one, two], { delimiter: ',', layout: 'long' });
  const longLines = long.split('\n');
  assert.equal(longLines[0], 'run,t (s),x (m),v (m/s)');
  assert.equal(longLines.length, 1 + 4 + 6);
  assert.equal(longLines[1].split(',')[0], 'Run 1');

  // A label with a comma is quoted in CSV and flattened in TSV.
  const odd = runOf(quadratic(0.6, 0, 0.3, 3), 'C1, "fast"');
  assert.ok(serializeRuns([odd], { delimiter: ',', layout: 'long' }).includes('"C1, ""fast"""'));
  assert.equal(serializeRuns([], { delimiter: '\t', layout: 'wide' }), '');
}

// Results table: one row per run, blanks where a fit failed.
{
  const good = runOf(quadratic(0.62, 0.15, 0.3, 40), 'C1');
  const bad = runOf(quadratic(0.62, 0.15, 0.3, 2), 'C2', 2);
  const lines = serializeResults([good, bad], '\t').split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0].split('\t')[0], 'run');
  const goodCells = lines[1].split('\t');
  assert.equal(goodCells[0], 'C1');
  near(Number(goodCells[1]), 0.62, 1e-3);
  assert.equal(goodCells[7], '38');
  const badCells = lines[2].split('\t');
  assert.equal(badCells[0], 'C2');
  assert.deepEqual(badCells.slice(1), ['', '', '', '', '', '', '']);
}

// Captions carry the fit, and say so when it is a subset of the run.
{
  const run = runOf(quadratic(0.62, 0.15, 0.3, 40), 'C 1/a');
  const velocity = cartPlotCaption(run, analyzeRun(run), 'velocity');
  assert.equal(velocity.title, 'Cart Lab — C 1/a');
  assert.ok(velocity.captionLines[0].includes('20 Hz'));
  assert.ok(velocity.captionLines[0].includes('1.150'));
  assert.ok(velocity.captionLines.some((line) => line.includes('a (slope) = 0.6')));

  const position = cartPlotCaption(run, analyzeRun(run), 'position');
  assert.equal(position.captionLines.length, 1, 'no window line until the student picks one');
  const narrowed = { ...run, fitRange: { min: 0.5, max: 1.5 } };
  assert.equal(cartPlotCaption(narrowed, analyzeRun(narrowed), 'position').captionLines.length, 2);

  assert.equal(plotFileName(run, 'velocity'), 'C-1-a-velocity-fit.png');
  assert.equal(plotFileName(run, 'position'), 'C-1-a-position.png');
  assert.equal(plotFileName(runOf([], '***'), 'position'), 'run-position.png');
}

// Labels and ids keep counting past renames and deletions.
{
  const runs = [runOf([], 'Run 1', 1), runOf([], 'C2', 4), runOf([], 'Run 3', 2)];
  assert.equal(nextRunLabel(runs), 'Run 4');
  assert.equal(nextRunLabel([]), 'Run 1');
  assert.equal(nextRunId(runs), 5);
  assert.equal(nextRunId([]), 1);
}

// Runs survive a round trip through storage, and garbage does not break loading.
{
  const runs = [
    { ...syntheticCartRun(1, 'Run 1', 2), fitRange: { min: 0.7, max: 2.2 } },
    runOf(quadratic(0.5, 0, 0.3, 5), 'Run 2', 2),
  ];
  assert.deepEqual(parseStoredRuns(serializeStoredRuns(runs)), runs);
  assert.deepEqual(parseStoredRuns(null), []);
  assert.deepEqual(parseStoredRuns('not json'), []);
  assert.deepEqual(parseStoredRuns('{"a":1}'), []);
  assert.deepEqual(parseStoredRuns('[1, null, {"id": 3}]'), []);
}

console.log('Cart run tests passed.');
