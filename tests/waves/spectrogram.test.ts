import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  FFT_SIZES,
  MAX_FREQUENCY_HZ,
  MIN_FREQUENCY_HZ,
  PLOT_ROWS,
  binBandwidth,
  binFrequency,
  buildFrequencyTicks,
  buildRowBinPlan,
  buildSpectrogramRamp,
  buildTimeTicks,
  byteToDecibels,
  confirmedPeaks,
  createSpectrogramHistory,
  decibelsToByte,
  estimateFundamental,
  findSpectralPeaks,
  formatFrequencyLabel,
  formatNote,
  fractionToFrequency,
  frequencyFromMidi,
  frequencyToBin,
  frequencyToFraction,
  frequencyToRow,
  niceLinearStep,
  getSpectrogramLayout,
  harmonicSeries,
  midiFromFrequency,
  noteFromFrequency,
  rampColorAt,
  renormalizeByte,
  rowToFrequency,
  sampleRow,
  stabilizePeaks,
  windowSeconds,
  type PeakTrack,
  type SpectralPeak,
} from '../../src/lib/waves/spectrogram.ts';
import { contrastRatio, relativeLuminance, type Rgb } from '../../src/components/shared/themeColors.ts';
import {
  SYNTH_EXAMPLES,
  exampleById,
  expectedPeaksAt,
  fillPinkNoise,
  fillWhiteNoise,
} from '../../src/lib/waves/spectrogramExamples.ts';
import { createRng } from '../../src/lib/shared/rng.ts';

const closeTo = (actual: number, expected: number, epsilon = 1e-6) => {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} was not close to ${expected}`);
};

const MIN = MIN_FREQUENCY_HZ;
const MAX = MAX_FREQUENCY_HZ;

// ---------------------------------------------------------------------------
// Axis mapping
// ---------------------------------------------------------------------------

test('frequency and fraction round-trip on both scales', () => {
  const samples = [27.5, 55, 110, 220, 440, 880, 1760, 3520, 7040, 14080, MAX];
  for (const scale of ['log', 'linear'] as const) {
    for (const hz of samples) {
      const fraction = frequencyToFraction(hz, MIN, MAX, scale);
      closeTo(fractionToFrequency(fraction, MIN, MAX, scale), hz, 1e-9 * hz + 1e-9);
    }
    closeTo(frequencyToFraction(MIN, MIN, MAX, scale), 0);
    closeTo(frequencyToFraction(MAX, MIN, MAX, scale), 1);
  }
});

test('the log midpoint is the geometric mean and the linear midpoint is the arithmetic mean', () => {
  closeTo(fractionToFrequency(0.5, MIN, MAX, 'log'), Math.sqrt(MIN * MAX), 1e-6);
  closeTo(fractionToFrequency(0.5, MIN, MAX, 'linear'), (MIN + MAX) / 2, 1e-6);
});

test('low frequencies sit at the bottom of the plot and high frequencies at the top', () => {
  // This pins the orientation the whole lesson teaches. If someone flips the
  // axis later, this is the test that says so.
  for (const scale of ['log', 'linear'] as const) {
    closeTo(frequencyToRow(MIN, MIN, MAX, scale, PLOT_ROWS), PLOT_ROWS - 1);
    closeTo(frequencyToRow(MAX, MIN, MAX, scale, PLOT_ROWS), 0);
    assert.ok(
      frequencyToRow(200, MIN, MAX, scale, PLOT_ROWS) > frequencyToRow(2000, MIN, MAX, scale, PLOT_ROWS),
      '200 Hz should sit below 2 kHz',
    );
  }
});

test('row and frequency round-trip', () => {
  for (const scale of ['log', 'linear'] as const) {
    for (const row of [0, 1, 90, 180, 270, PLOT_ROWS - 1]) {
      const hz = rowToFrequency(row, MIN, MAX, scale, PLOT_ROWS);
      assert.ok(Math.abs(frequencyToRow(hz, MIN, MAX, scale, PLOT_ROWS) - row) < 0.5);
    }
  }
});

// ---------------------------------------------------------------------------
// FFT plumbing
// ---------------------------------------------------------------------------

test('bin and frequency conversions are inverses, with 0 Hz at bin 0 and Nyquist at N/2', () => {
  const sampleRate = 48000;
  const fftSize = 4096;
  closeTo(binFrequency(0, sampleRate, fftSize), 0);
  closeTo(binFrequency(fftSize / 2, sampleRate, fftSize), sampleRate / 2);
  for (const hz of [27.5, 440, 1000, 12345]) {
    closeTo(binFrequency(frequencyToBin(hz, sampleRate, fftSize), sampleRate, fftSize), hz, 1e-9);
  }
  closeTo(binBandwidth(48000, 4096), 11.71875);
});

test('bin bandwidth times window duration is exactly 1 at every window size', () => {
  // The Gabor limit, asserted. Worked example 2 on the page depends on it.
  for (const sampleRate of [44100, 48000]) {
    for (const fftSize of FFT_SIZES) {
      closeTo(binBandwidth(sampleRate, fftSize) * windowSeconds(fftSize, sampleRate), 1, 1e-12);
    }
  }
  // Worked example 1's numbers, exactly.
  closeTo(binBandwidth(48000, 2048), 23.4375);
  closeTo(windowSeconds(2048, 48000), 0.0426666666, 1e-8);
});

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

test('byte and decibel conversion covers the range and clamps outside it', () => {
  closeTo(byteToDecibels(0, -90, -20), -90);
  closeTo(byteToDecibels(255, -90, -20), -20);
  assert.ok(byteToDecibels(100, -90, -20) < byteToDecibels(200, -90, -20));
  assert.equal(decibelsToByte(-200, -90, -20), 0);
  assert.equal(decibelsToByte(0, -90, -20), 255);
  for (const byte of [0, 17, 128, 200, 255]) {
    assert.ok(Math.abs(decibelsToByte(byteToDecibels(byte, -90, -20), -90, -20) - byte) <= 1);
  }
});

test('renormalizeByte is the identity when the range is unchanged and re-encodes when it moves', () => {
  assert.equal(renormalizeByte(137, -90, -20, -90, -20), 137);
  // -60 dB captured at (-100, -30) must come back as -60 dB at (-90, -20).
  const captured = decibelsToByte(-60, -100, -30);
  const moved = renormalizeByte(captured, -100, -30, -90, -20);
  closeTo(byteToDecibels(moved, -90, -20), -60, 0.3);
  // A level below the new floor saturates rather than wrapping.
  assert.equal(renormalizeByte(0, -200, -150, -90, -20), 0);
  assert.equal(renormalizeByte(255, -20, -5, -90, -20), 255);
});

// ---------------------------------------------------------------------------
// Row -> bin plan
// ---------------------------------------------------------------------------

const planOptions = {
  rows: PLOT_ROWS,
  binCount: 2048,
  sampleRate: 48000,
  fftSize: 4096,
  minHz: MIN,
  maxHz: MAX,
  scale: 'log' as const,
};

test('the row-bin plan is ordered, in range, and leaves no bin uncovered', () => {
  const plan = buildRowBinPlan(planOptions);

  for (let row = 0; row < plan.rows; row += 1) {
    assert.ok(plan.start[row] <= plan.end[row], `row ${row} has start after end`);
    assert.ok(plan.end[row] < planOptions.binCount);
    if (row > 0) {
      // Rows run top (high frequency) to bottom (low), so bins descend.
      assert.ok(plan.start[row] <= plan.start[row - 1], `row ${row} bins are not monotonic`);
    }
  }

  const covered = new Set<number>();
  for (let row = 0; row < plan.rows; row += 1) {
    for (let bin = plan.start[row]; bin <= plan.end[row]; bin += 1) covered.add(bin);
  }
  const lowest = Math.ceil(frequencyToBin(MIN, planOptions.sampleRate, planOptions.fftSize));
  const highest = Math.floor(frequencyToBin(MAX, planOptions.sampleRate, planOptions.fftSize));
  for (let bin = lowest; bin <= Math.min(highest, planOptions.binCount - 1); bin += 1) {
    assert.ok(covered.has(bin), `bin ${bin} is not drawn by any row`);
  }
});

test('a lone peak in the crowded top octave still reaches the display', () => {
  // The regression nearest-bin sampling causes: hundreds of bins share a
  // handful of rows up there, so a single strong bin has to survive pooling.
  const plan = buildRowBinPlan(planOptions);
  const data = new Uint8Array(planOptions.binCount);
  const spikeBin = frequencyToBin(12000, planOptions.sampleRate, planOptions.fftSize) | 0;
  data[spikeBin] = 255;

  let best = 0;
  for (let row = 0; row < plan.rows; row += 1) best = Math.max(best, sampleRow(data, plan, row));
  assert.equal(best, 255);
});

test('rows between two bins interpolate instead of banding', () => {
  const plan = buildRowBinPlan(planOptions);

  // Find a low row whose band contains no bin centre at all. Down at 27 Hz the
  // analyser is far coarser than the display, so several rows share one bin.
  let interpolated = -1;
  for (let row = plan.rows - 1; row >= 0; row -= 1) {
    if (plan.end[row] === plan.start[row] && plan.frac[row] > 0.1 && plan.frac[row] < 0.9) {
      interpolated = row;
      break;
    }
  }
  assert.ok(interpolated >= 0, 'expected at least one interpolated row at the bottom of a log axis');

  const bin = plan.start[interpolated];
  const data = new Uint8Array(planOptions.binCount);
  data[bin] = 0;
  data[bin + 1] = 200;

  const value = sampleRow(data, plan, interpolated);
  assert.ok(value > 0 && value < 200, `expected a value between the two bins, got ${value}`);
  closeTo(value, 200 * plan.frac[interpolated], 1e-3);
});

// ---------------------------------------------------------------------------
// Colormap
// ---------------------------------------------------------------------------

/** The real token values, read out of global.css the way tests/shared does. */
const readThemeStops = (): { theme: string; stops: Record<string, Rgb> }[] => {
  const css = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8');
  const wanted = ['--surface-plot', '--accent-blue', '--accent-red', '--text-primary'];

  return ['light', 'dark', 'paper'].map((theme) => {
    const body = css.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]+)\\}`))?.[1];
    assert.ok(body, `the ${theme} theme is missing from global.css`);
    const stops: Record<string, Rgb> = {};
    for (const name of wanted) {
      const hex = body.match(new RegExp(`${name}:\\s*#([0-9a-f]{6});`, 'i'))?.[1];
      assert.ok(hex, `${name} is not a hex color in the ${theme} theme`);
      stops[name] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as Rgb;
    }
    return { theme, stops };
  });
};

test('the colormap is legible and never doubles back, in every theme', () => {
  for (const { theme, stops } of readThemeStops()) {
    const background = stops['--surface-plot'];
    const ramp = buildSpectrogramRamp({
      background,
      cool: stops['--accent-blue'],
      warm: stops['--accent-red'],
      ink: stops['--text-primary'],
    });

    assert.equal(ramp.length, 256 * 3, `${theme}: wrong ramp length`);
    assert.deepEqual(rampColorAt(ramp, 0), background, `${theme}: silence is not the plot surface`);

    // Louder never reads as weaker. The ramp is monotone by construction, but
    // interpolating through a hue change wobbles the contrast by a fraction of
    // a percent between adjacent entries; forcing that away costs the red end
    // of the ramp entirely, so allow the wobble and forbid a real reversal.
    const contrastAt = (byte: number) => contrastRatio(rampColorAt(ramp, byte), background);

    for (let byte = 1; byte < 256; byte += 1) {
      const here = contrastAt(byte);
      assert.ok(
        here >= contrastAt(byte - 1) * 0.99,
        `${theme}: contrast fell more than 1% at byte ${byte}`,
      );
    }
    // Over any meaningful span it has to actually climb.
    for (let byte = 16; byte < 256; byte += 1) {
      assert.ok(
        contrastAt(byte) > contrastAt(byte - 16),
        `${theme}: contrast did not climb across bytes ${byte - 16}-${byte}`,
      );
    }

    // The ramp has to travel, not just darken: the loud end must be a
    // different hue from the quiet end, or every shape looks the same.
    const mid = rampColorAt(ramp, 128);
    const hot = rampColorAt(ramp, 245);
    assert.ok(
      contrastRatio(mid, hot) > 1.4,
      `${theme}: the middle and hot ends of the ramp are barely distinguishable`,
    );

    // The hot end has to be readable against the surface it sits on.
    assert.ok(
      contrastRatio(rampColorAt(ramp, 255), background) >= 4.5,
      `${theme}: the loudest color does not clear 4.5:1`,
    );

    // Direction: ink on paper for light surfaces, light on ink for dark ones.
    const lightSurface = relativeLuminance(background) > 0.5;
    const hotLuminance = relativeLuminance(rampColorAt(ramp, 255));
    const backgroundLuminance = relativeLuminance(background);
    assert.ok(
      lightSurface ? hotLuminance < backgroundLuminance : hotLuminance > backgroundLuminance,
      `${theme}: the hot end runs the wrong way`,
    );

    // Quiet stays quiet: the bottom of the ramp must not paint a slab.
    assert.ok(
      contrastRatio(rampColorAt(ramp, 6), background) < 1.35,
      `${theme}: near-silence is too visible`,
    );
  }
});

// ---------------------------------------------------------------------------
// Peaks
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 48000;
const FFT = 4096;

/** A spectrum with triangular peaks at the given frequencies. */
const spectrumWith = (peaks: { hz: number; level: number }[], floor = 10): Uint8Array => {
  const data = new Uint8Array(FFT / 2).fill(floor);
  for (const { hz, level } of peaks) {
    const exact = frequencyToBin(hz, SAMPLE_RATE, FFT);
    const centre = Math.round(exact);
    for (let offset = -2; offset <= 2; offset += 1) {
      const bin = centre + offset;
      if (bin < 0 || bin >= data.length) continue;
      const distance = Math.abs(bin - exact);
      const value = Math.round(level * Math.max(0, 1 - distance / 2.5));
      if (value > data[bin]) data[bin] = value;
    }
  }
  return data;
};

test('peak picking finds the peaks, beats the bin grid, and ignores the noise floor', () => {
  const data = spectrumWith([{ hz: 441.6, level: 240 }]);
  const peaks = findSpectralPeaks(data, { sampleRate: SAMPLE_RATE, fftSize: FFT });

  assert.equal(peaks.length, 1);
  const binCentre = binFrequency(Math.round(frequencyToBin(441.6, SAMPLE_RATE, FFT)), SAMPLE_RATE, FFT);
  assert.ok(
    Math.abs(peaks[0].frequencyHz - 441.6) < Math.abs(binCentre - 441.6),
    `interpolation (${peaks[0].frequencyHz}) should beat the bin centre (${binCentre})`,
  );

  assert.deepEqual(findSpectralPeaks(new Uint8Array(FFT / 2).fill(40), {
    sampleRate: SAMPLE_RATE,
    fftSize: FFT,
  }), []);
});

test('peak picking suppresses shoulders, sorts by level, and stays in bounds', () => {
  const data = spectrumWith([
    { hz: 440, level: 250 },
    { hz: 445, level: 180 },
    { hz: 1200, level: 210 },
  ]);
  const peaks = findSpectralPeaks(data, {
    sampleRate: SAMPLE_RATE,
    fftSize: FFT,
    minSeparationCents: 60,
  });

  assert.ok(peaks.every((peak, index) => index === 0 || peaks[index - 1].levelByte >= peak.levelByte));
  assert.ok(!peaks.some((peak) => Math.abs(peak.frequencyHz - 445) < 2), '445 Hz shoulder survived');

  // A peak pressed against either end of the array must not read out of bounds.
  const edges = new Uint8Array(FFT / 2).fill(5);
  edges[0] = 255;
  edges[edges.length - 1] = 255;
  assert.doesNotThrow(() => findSpectralPeaks(edges, { sampleRate: SAMPLE_RATE, fftSize: FFT }));
});

test('peak labels need two frames to appear and survive one dropout', () => {
  const peak: SpectralPeak = { bin: 38, frequencyHz: 440, levelByte: 200 };

  let tracks: PeakTrack[] = stabilizePeaks([], [peak]);
  assert.equal(confirmedPeaks(tracks).length, 0, 'a one-frame peak should not earn a label');

  tracks = stabilizePeaks(tracks, [peak]);
  assert.equal(confirmedPeaks(tracks).length, 1, 'a two-frame peak should earn a label');

  tracks = stabilizePeaks(tracks, []);
  assert.equal(confirmedPeaks(tracks).length, 1, 'one dropout should not drop a confirmed label');

  tracks = stabilizePeaks(tracks, []);
  assert.equal(confirmedPeaks(tracks).length, 0, 'two dropouts should');
});

test('a peak that drifts slightly is treated as the same track', () => {
  let tracks = stabilizePeaks([], [{ bin: 38, frequencyHz: 440, levelByte: 200 }]);
  tracks = stabilizePeaks(tracks, [{ bin: 38, frequencyHz: 443, levelByte: 200 }]);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].seen, 2);
});

// ---------------------------------------------------------------------------
// Fundamental
// ---------------------------------------------------------------------------

const peaksAt = (frequencies: number[], level = 200): SpectralPeak[] =>
  frequencies.map((hz, index) => ({ bin: index, frequencyHz: hz, levelByte: level }));

test('a harmonic stack reports its fundamental with high confidence', () => {
  const estimate = estimateFundamental(peaksAt([110, 220, 330, 440]));
  assert.ok(estimate);
  closeTo(estimate.frequencyHz, 110, 0.5);
  assert.equal(estimate.supporting.length, 4);
  assert.ok(estimate.confidence > 0.9);
});

test('a missing fundamental is recovered from the spacing of the harmonics', () => {
  const estimate = estimateFundamental(peaksAt([220, 330, 440]));
  assert.ok(estimate, 'expected an estimate for a missing fundamental');
  closeTo(estimate.frequencyHz, 110, 0.5);
});

test('two unrelated tones do not produce a confident fundamental', () => {
  const estimate = estimateFundamental(peaksAt([440, 611]));
  assert.ok(estimate === null || estimate.confidence < 0.6, 'unrelated tones were read as harmonics');
});

test('a lone tone is its own fundamental, and an empty spectrum has none', () => {
  const estimate = estimateFundamental(peaksAt([440]));
  assert.ok(estimate);
  closeTo(estimate.frequencyHz, 440, 0.5);
  assert.equal(estimateFundamental([]), null);
});

test('the harmonic series stops at the top of the display', () => {
  const series = harmonicSeries(1000, 4500);
  assert.deepEqual(series, [1000, 2000, 3000, 4000]);
  assert.equal(harmonicSeries(100, 100000, 3).length, 3);
  closeTo(harmonicSeries(165, 2000)[0], 165);
});

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

test('note names and cents match equal temperament', () => {
  assert.deepEqual(noteFromFrequency(440), { name: 'A4', midi: 69, cents: 0 });
  assert.equal(noteFromFrequency(261.6256)?.name, 'C4');
  assert.equal(noteFromFrequency(466.1638)?.name, 'A#4');
  assert.equal(noteFromFrequency(220)?.name, 'A3');
  assert.equal(noteFromFrequency(27.5)?.name, 'A0');

  assert.ok((noteFromFrequency(452)?.cents ?? 0) > 0, 'sharp of A4 should be positive cents');
  assert.ok((noteFromFrequency(430)?.cents ?? 0) < 0, 'flat of A4 should be negative cents');

  assert.equal(noteFromFrequency(10), null);
  assert.equal(noteFromFrequency(0), null);
  assert.equal(noteFromFrequency(30000), null);

  closeTo(frequencyFromMidi(midiFromFrequency(1234)), 1234, 1e-9);
  assert.equal(formatNote({ name: 'A4', midi: 69, cents: 0 }), 'A4');
  assert.ok(formatNote({ name: 'A4', midi: 69, cents: 3.2 }).startsWith('A4 +3'));
});

// ---------------------------------------------------------------------------
// The whole quantitative pipeline, headless
// ---------------------------------------------------------------------------

test('a synthetic 440 Hz tone reads as A4 end to end', () => {
  const data = spectrumWith([
    { hz: 440, level: 250 },
    { hz: 880, level: 200 },
    { hz: 1320, level: 170 },
  ]);
  const raw = findSpectralPeaks(data, { sampleRate: SAMPLE_RATE, fftSize: FFT });
  const tracks = stabilizePeaks(stabilizePeaks([], raw), raw);
  const estimate = estimateFundamental(confirmedPeaks(tracks));

  assert.ok(estimate, 'the pipeline lost the fundamental');
  assert.equal(noteFromFrequency(estimate.frequencyHz)?.name, 'A4');
});

// ---------------------------------------------------------------------------
// Ticks and layout
// ---------------------------------------------------------------------------

test('log-axis ticks stay in range, keep their spacing, and mark the decades', () => {
  const ticks = buildFrequencyTicks({ minHz: MIN, maxHz: MAX, scale: 'log', rows: PLOT_ROWS });

  assert.ok(ticks.length > 6);
  for (let i = 0; i < ticks.length; i += 1) {
    assert.ok(ticks[i].hz >= MIN && ticks[i].hz <= MAX, `${ticks[i].hz} is outside the axis`);
    if (i > 0) {
      assert.ok(ticks[i].row < ticks[i - 1].row, 'ticks should climb the plot');
      assert.ok(Math.abs(ticks[i].row - ticks[i - 1].row) >= 22, 'ticks are too close to read');
    }
  }
  for (const decade of [100, 1000, 10000]) {
    const tick = ticks.find((candidate) => candidate.hz === decade);
    assert.ok(tick, `${decade} Hz is missing`);
    assert.equal(tick.emphasis, 'major');
  }
});

test('linear-axis ticks use a round step', () => {
  const ticks = buildFrequencyTicks({ minHz: MIN, maxHz: MAX, scale: 'linear', rows: PLOT_ROWS });
  assert.ok(ticks.length > 3);

  const step = ticks[1].hz - ticks[0].hz;
  const magnitude = 10 ** Math.floor(Math.log10(step));
  assert.ok(
    [1, 2, 2.5, 5, 10].some((nice) => Math.abs(step / magnitude - nice) < 1e-9),
    `${step} is not a 1/2/2.5/5 step`,
  );
  // Every tick is a whole number of steps, so the labels read cleanly.
  for (const tick of ticks) {
    closeTo(tick.hz / step, Math.round(tick.hz / step), 1e-9);
  }

  closeTo(niceLinearStep(1000, 10), 100);
  closeTo(niceLinearStep(16716, 8), 2500);
});

test('frequency labels switch to kilohertz above a thousand', () => {
  assert.equal(formatFrequencyLabel(440), '440');
  assert.equal(formatFrequencyLabel(1000), '1k');
  assert.equal(formatFrequencyLabel(2500), '2.5k');
  assert.equal(formatFrequencyLabel(16000), '16k');
  // Rounding to whole thousands up here would mislabel a real linear-axis tick.
  assert.equal(formatFrequencyLabel(12500), '12.5k');
  assert.equal(formatFrequencyLabel(7500), '7.5k');
});

test('every tick label names the frequency it actually sits at', () => {
  for (const scale of ['log', 'linear'] as const) {
    for (const tick of buildFrequencyTicks({ minHz: MIN, maxHz: MAX, scale, rows: PLOT_ROWS })) {
      const label = tick.label.endsWith('k')
        ? Number(tick.label.slice(0, -1)) * 1000
        : Number(tick.label);
      // Within half of the label's own precision.
      const tolerance = tick.label.endsWith('k') ? 50 : 0.5;
      assert.ok(
        Math.abs(label - tick.hz) <= tolerance,
        `${scale}: "${tick.label}" is not ${tick.hz} Hz`,
      );
    }
  }
});

test('time ticks run backwards from now', () => {
  const ticks = buildTimeTicks({ columns: 480, hopSeconds: 1 / 60 });
  assert.equal(ticks[0].label, 'now');
  assert.equal(ticks[0].column, 479);
  assert.equal(ticks[1].label, '-1 s');
  for (let i = 1; i < ticks.length; i += 1) {
    assert.ok(ticks[i].column < ticks[i - 1].column);
    assert.ok(ticks[i].column >= 0);
  }
});

test('the layout keeps the plot inside the viewBox and grows its type when compact', () => {
  for (const width of [320, 480, 700, 1200]) {
    const layout = getSpectrogramLayout(width);
    const [, , viewWidth, viewHeight] = layout.viewBox.split(' ').map(Number);
    assert.ok(layout.plot.x >= 0 && layout.plot.y >= 0);
    assert.ok(layout.plot.x + layout.plot.w <= viewWidth);
    assert.ok(layout.plot.y + layout.plot.h <= viewHeight);
    closeTo(layout.plot.w / layout.plot.h, getSpectrogramLayout(1200).plot.w / getSpectrogramLayout(1200).plot.h);
  }

  const narrow = getSpectrogramLayout(360);
  const wide = getSpectrogramLayout(900);
  assert.equal(narrow.compact, true);
  assert.equal(wide.compact, false);
  assert.ok(narrow.fontSize > wide.fontSize, 'compact labels have to be bigger, not smaller');
  assert.equal(narrow.showLegendGutter, false);
  assert.equal(wide.showLegendGutter, true);
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

test('the history ring keeps the newest columns and wraps without tearing', () => {
  const columns = 8;
  const binCount = 4;
  const history = createSpectrogramHistory(columns, binCount);
  assert.equal(history.length, 0);

  for (let i = 0; i < columns + 7; i += 1) {
    history.push(new Uint8Array([i, i, i, i]), i * 0.1, -90 - i, -20);
  }

  assert.equal(history.length, columns, 'the ring should stop growing at its capacity');
  // 15 pushes into an 8-slot ring: the oldest retained is the 8th (index 7).
  assert.equal(history.frameAt(0)[0], 7);
  assert.equal(history.frameAt(columns - 1)[0], columns + 6);
  closeTo(history.timeAt(0), 0.7, 1e-9);
  assert.equal(history.rangeAt(0).minDb, -97);
  assert.equal(history.rangeAt(columns - 1).minDb, -90 - (columns + 6));

  for (let i = 1; i < history.length; i += 1) {
    assert.ok(history.timeAt(i) > history.timeAt(i - 1), 'timestamps must increase');
  }

  history.clear();
  assert.equal(history.length, 0);
});

// ---------------------------------------------------------------------------
// Example sounds
// ---------------------------------------------------------------------------

test('every example has a distinct id, a label, and a duration', () => {
  const ids = new Set(SYNTH_EXAMPLES.map((example) => example.id));
  assert.equal(ids.size, SYNTH_EXAMPLES.length);
  for (const example of SYNTH_EXAMPLES) {
    assert.ok(example.label.length > 0, `${example.id} needs a label`);
    assert.ok(example.durationSeconds > 0);
    assert.equal(exampleById(example.id), example);
  }
  assert.equal(exampleById('nope'), undefined);
});

test('the sweep is geometric and the sawtooth is a harmonic series', () => {
  const sweep = exampleById('log-sweep');
  assert.ok(sweep);
  closeTo(expectedPeaksAt(sweep, 0)[0], 80, 1e-9);
  closeTo(expectedPeaksAt(sweep, sweep.durationSeconds)[0], 8000, 1e-6);
  closeTo(expectedPeaksAt(sweep, sweep.durationSeconds / 2)[0], Math.sqrt(80 * 8000), 1e-6);

  const saw = exampleById('sawtooth-stack');
  assert.ok(saw);
  const partials = expectedPeaksAt(saw, 0);
  assert.equal(partials.length, 12);
  partials.forEach((hz, index) => closeTo(hz, 110 * (index + 1), 1e-9));

  assert.deepEqual(expectedPeaksAt(exampleById('white-noise')!, 1), []);
  closeTo(expectedPeaksAt(exampleById('siren')!, 0)[0], 800, 1e-9);
});

const energy = (samples: Float32Array): number =>
  samples.reduce((sum, value) => sum + value * value, 0);

/** Successive differences are a crude high-pass, enough to see spectral tilt. */
const highFrequencyShare = (samples: Float32Array): number => {
  let differences = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const delta = samples[i] - samples[i - 1];
    differences += delta * delta;
  }
  return differences / energy(samples);
};

test('pink noise is bounded and tilted toward low frequencies', () => {
  const white = new Float32Array(8192);
  const pink = new Float32Array(8192);
  fillWhiteNoise(white, createRng(1234).next);
  fillPinkNoise(pink, createRng(1234).next);

  for (const samples of [white, pink]) {
    assert.ok(samples.every((value) => value >= -1 && value <= 1), 'samples escaped [-1, 1]');
    assert.ok(energy(samples) > 0, 'the generator produced silence');
  }

  assert.ok(
    highFrequencyShare(pink) < highFrequencyShare(white),
    'pink noise should carry less high-frequency energy than white',
  );
});

test('the noise generators are deterministic for a given seed', () => {
  const a = new Float32Array(64);
  const b = new Float32Array(64);
  fillPinkNoise(a, createRng(7).next);
  fillPinkNoise(b, createRng(7).next);
  assert.deepEqual(Array.from(a), Array.from(b));
});
