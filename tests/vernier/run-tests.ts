import assert from 'node:assert/strict';
import {
  DEFAULT_FRAMING,
  FRAMING_CANDIDATES,
  NGIO_CHANNEL_ID,
  NGIO_CMD_ID,
  NGIO_SAMPLING_MODE,
  NGIO_STATUS,
  NGIO_TICK_SECONDS,
  decodeMeasurementReport,
  decodeResponse,
  encodeCommand,
  getSensorIdParams,
  measurementPeriodTicks,
  ngioChecksum,
  nextRollingCounter,
  parseSensorIdPayload,
  probeFramingResponse,
  readInt32LE,
  setChannelEnableMaskParams,
  setMeasurementPeriodParams,
  setSamplingModeParams,
  toHex,
} from '../../src/lib/vernier/ngioPackets.ts';
import {
  DEFAULT_PERIOD_SECONDS,
  describePhase,
  startSession,
  step,
  type SessionState,
} from '../../src/lib/vernier/ngioSession.ts';
import {
  MAX_PLAUSIBLE_SPEED,
  conditionSample,
  fillDropouts,
  jitterRms,
  lastGoodSample,
  resample,
  slidingVelocity,
  trimToWindow,
  velocityAt,
  type MotionSample,
} from '../../src/lib/vernier/motionStream.ts';
import {
  MOTION_DETECTOR_RANGE,
  describeSensor,
  findSensor,
  isMotionSensor,
  isPlausibleDistance,
  speedOfSound,
} from '../../src/lib/vernier/sensorIds.ts';
import {
  VERNIER_VENDOR_ID,
  describeVernierDevice,
  findVernierDevice,
  isSupportedVernierDevice,
  webHidFilters,
} from '../../src/lib/vernier/deviceIds.ts';
import { fitPolynomial } from '../../src/lib/math/leastSquares.ts';

// --- device identity ------------------------------------------------------

assert.equal(VERNIER_VENDOR_ID, 0x08f7);
assert.equal(findVernierDevice(0x0008)?.name, 'LabQuest Mini');
assert.equal(findVernierDevice(0x0008)?.family, 'ngio');
assert.equal(isSupportedVernierDevice(0x08f7, 0x0008), true, 'LabQuest Mini must be supported');
assert.equal(isSupportedVernierDevice(0x08f7, 0x0004), false, 'Go!Motion speaks GoIO, not NGIO');
assert.equal(
  isSupportedVernierDevice(0x08f7, 0x0017),
  false,
  'a bootloader mode cannot collect data',
);
assert.equal(isSupportedVernierDevice(0x1234, 0x0008), false, 'vendor ID must match');
assert.match(describeVernierDevice(0x08f7, 0x9999), /Unknown Vernier device \(0x9999\)/);
assert.deepEqual(webHidFilters(), [{ vendorId: 0x08f7 }]);

// --- sensor identity and unit conversion ----------------------------------

assert.equal(isMotionSensor(2), true);
assert.equal(isMotionSensor(69), true);
assert.equal(isMotionSensor(13), false);
assert.equal(describeSensor(0), 'No sensor');
assert.match(describeSensor(999), /Unrecognised sensor \(ID 999\)/);
assert.equal(findSensor(69)?.samplingMode, NGIO_SAMPLING_MODE.PERIODIC_MOTION_DETECT);

// Speed of sound at 20 C is about 343 m/s; the temperature term is real.
assert.ok(Math.abs(speedOfSound(20) - 343.2) < 0.5, 'speed of sound at 20 C');
assert.ok(speedOfSound(30) > speedOfSound(10), 'warmer air carries sound faster');

// A 1 m target is a 5.83 ms round trip at 20 C.
{
  const sensor = findSensor(69);
  assert.ok(sensor);
  const roundTripMicroseconds = (2 * 1.0 * 1e6) / speedOfSound(20);
  const meters = sensor.toPhysical(roundTripMicroseconds, { airTemperatureC: 20 });
  assert.ok(Math.abs(meters - 1.0) < 1e-6, `1 m round trip should read 1 m, got ${meters}`);
}

assert.equal(isPlausibleDistance(2), true);
assert.equal(isPlausibleDistance(0.05), false, 'inside the detector dead zone');
assert.equal(isPlausibleDistance(9), false, 'beyond the detector range');
assert.equal(MOTION_DETECTOR_RANGE.minMeters, 0.15);

// --- packet codec ---------------------------------------------------------

assert.equal(NGIO_TICK_SECONDS, 1e-6);
assert.equal(measurementPeriodTicks(0.05), 50_000, '20 Hz is 50000 one-microsecond ticks');
assert.equal(measurementPeriodTicks(0), 1, 'period never encodes as zero ticks');

assert.equal(ngioChecksum([0x88, 0x03, 0x10]), (256 - 0x9b) % 256);
assert.equal(
  ([0x88, 0x03, 0x10, ngioChecksum([0x88, 0x03, 0x10])] as number[]).reduce((a, b) => a + b, 0) %
    256,
  0,
  'checksummed message sums to zero mod 256',
);
assert.equal(ngioChecksum([0x00]), 0, 'an all-zero message needs no correction');

assert.equal(nextRollingCounter(255), 0, 'rolling counter wraps at a byte');

{
  const report = encodeCommand({ command: NGIO_CMD_ID.INIT, rollingCounter: 7 });
  assert.equal(report.length, 64, 'output reports are fixed length');
  assert.equal(report[0], DEFAULT_FRAMING.syncByte);
  assert.equal(report[1], 3, 'body length counts command, counter and checksum');
  assert.equal(report[2], NGIO_CMD_ID.INIT);
  assert.equal(report[3], 7);
  assert.equal(report.slice(0, 5).reduce((a, b) => a + b, 0) % 256, 0);
  assert.equal(report[10], 0, 'unused report bytes are zero padding');
}

{
  // Round trip: encode a command, hand the same bytes back as a response.
  const params = getSensorIdParams(NGIO_CHANNEL_ID.DIGITAL1);
  const report = encodeCommand({
    command: NGIO_CMD_ID.GET_SENSOR_ID,
    rollingCounter: 1,
    params,
  });
  const decoded = decodeResponse(report);
  assert.ok(decoded.ok, `expected a decodable message, got ${toHex(report.slice(0, 8))}`);
  assert.equal(decoded.command, NGIO_CMD_ID.GET_SENSOR_ID);
  assert.equal(decoded.rollingCounter, 1);
  assert.equal(decoded.status, NGIO_CHANNEL_ID.DIGITAL1, 'first param byte lands in the status slot');
}

// Rejections, one per failure mode.
assert.equal(decodeResponse(new Uint8Array(0)).ok, false);
assert.equal((decodeResponse(new Uint8Array(0)) as { reason: string }).reason, 'empty');
assert.equal(
  (decodeResponse(Uint8Array.from([0x11, 0x22, 0x33, 0x44, 0x55])) as { reason: string }).reason,
  'bad-sync',
);
assert.equal(
  (decodeResponse(Uint8Array.from([0x88, 0x40, 0x10, 0x01])) as { reason: string }).reason,
  'truncated',
);
assert.equal(
  (decodeResponse(Uint8Array.from([0x88, 0x03, 0x10, 0x01, 0x00])) as { reason: string }).reason,
  'bad-checksum',
);

{
  // A leading report ID byte must not break decoding.
  const report = encodeCommand({ command: NGIO_CMD_ID.GET_STATUS, rollingCounter: 3 });
  const withReportId = Uint8Array.from([0x00, ...report]);
  assert.equal(decodeResponse(withReportId).ok, true, 'leading report ID is tolerated');
}

// The framing probe must accept the right candidate and reject the others.
{
  const report = encodeCommand({
    command: NGIO_CMD_ID.GET_STATUS,
    rollingCounter: 0,
    framing: { syncByte: 0x55, reportId: 0 },
  });
  assert.equal(probeFramingResponse(report, { syncByte: 0x55, reportId: 0 }), true);
  assert.equal(probeFramingResponse(report, { syncByte: 0x88, reportId: 0 }), false);
  assert.ok(FRAMING_CANDIDATES.length >= 2, 'more than one framing hypothesis is on offer');
}

// Parameter builders match the SDK struct layouts.
assert.deepEqual(setSamplingModeParams(NGIO_CHANNEL_ID.DIGITAL1, 3), [5, 3]);
assert.deepEqual(
  setMeasurementPeriodParams(NGIO_CHANNEL_ID.DIGITAL1, 0.05),
  [5, 0, 0, 0, 0, 0x50, 0xc3, 0x00, 0x00],
  '50000 ticks little-endian after a zero run ID',
);
assert.deepEqual(
  setChannelEnableMaskParams([NGIO_CHANNEL_ID.DIGITAL1]),
  [0x20, 0, 0, 0],
  'DIGITAL1 is bit 5',
);
assert.equal(parseSensorIdPayload(Uint8Array.from([69, 0, 0, 0])), 69);
assert.equal(parseSensorIdPayload(Uint8Array.from([1, 2])), 0, 'a short payload means no sensor');
assert.equal(readInt32LE(Uint8Array.from([0xff, 0xff, 0xff, 0xff])), -1);

// --- session state machine ------------------------------------------------

/** Builds the reply the device would send for the command just written. */
const replyTo = (
  written: Uint8Array,
  status = NGIO_STATUS.SUCCESS,
  payload: number[] = [],
): Uint8Array => {
  const decoded = decodeResponse(written);
  assert.ok(decoded.ok, 'test helper needs a decodable command');
  return encodeCommand({
    command: decoded.command,
    rollingCounter: decoded.rollingCounter,
    params: [status, ...payload],
  });
};

{
  const opened = startSession();
  assert.equal(opened.state.phase, 'init');
  assert.equal(opened.writes.length, 1);
  assert.equal(opened.state.periodSeconds, DEFAULT_PERIOD_SECONDS);
  assert.equal(decodeResponse(opened.writes[0]).ok && true, true);

  // Drive the full handshake, answering success to everything and reporting a
  // Motion Detector 2 on DIG 1.
  const seen: string[] = [opened.state.phase];
  let state: SessionState = opened.state;
  let writes = opened.writes;

  for (let guard = 0; guard < 20 && state.phase !== 'streaming'; guard += 1) {
    assert.equal(writes.length, 1, `phase ${state.phase} should write one command`);
    const payload = state.phase === 'identify-sensor' ? [69, 0, 0, 0] : [];
    const result = step(state, { type: 'report', bytes: replyTo(writes[0], NGIO_STATUS.SUCCESS, payload) });
    state = result.state;
    writes = result.writes;
    seen.push(state.phase);
  }

  assert.equal(state.phase, 'streaming', `handshake stalled at ${state.phase}: ${state.error ?? ''}`);
  assert.deepEqual(seen, [
    'init',
    'clear-errors',
    'identify-sensor',
    'set-sampling-mode',
    'enable-channel',
    'set-period',
    'starting',
    'streaming',
  ]);
  assert.equal(state.sensorId, 69);
  assert.equal(state.sensorName, 'Motion Detector 2');
  assert.match(describePhase(state), /Streaming from Motion Detector 2/);

  // Measurements arrive unsolicited, timestamped off the device clock rather
  // than off arrival time.
  const rawFor = (meters: number) => Math.round((2 * meters * 1e6) / speedOfSound(20));
  const measurement = encodeCommand({
    command: NGIO_CMD_ID.GET_STATUS,
    rollingCounter: 0,
    params: [
      NGIO_STATUS.SUCCESS,
      NGIO_CHANNEL_ID.DIGITAL1,
      2,
      ...[rawFor(1.0), rawFor(1.1)].flatMap((raw) => [
        raw & 0xff,
        (raw >>> 8) & 0xff,
        (raw >>> 16) & 0xff,
        (raw >>> 24) & 0xff,
      ]),
    ],
  });

  const streamed = step(state, { type: 'report', bytes: measurement });
  assert.equal(streamed.samples.length, 2, 'both values in the report become samples');
  assert.equal(streamed.samples[0].t, 0);
  assert.ok(
    Math.abs(streamed.samples[1].t - DEFAULT_PERIOD_SECONDS) < 1e-9,
    'sample clock advances by exactly one period',
  );
  assert.equal(streamed.state.sampleCount, 2);

  const stopped = step(streamed.state, { type: 'stop' });
  assert.equal(stopped.state.phase, 'stopping');
  assert.equal(stopped.writes.length, 1);
  const confirmed = step(stopped.state, { type: 'report', bytes: replyTo(stopped.writes[0]) });
  assert.equal(confirmed.state.phase, 'stopped');
}

{
  // A busy device is retried, not failed.
  const opened = startSession();
  const busy = step(opened.state, {
    type: 'report',
    bytes: replyTo(opened.writes[0], NGIO_STATUS.NOT_READY_FOR_NEW_CMD),
  });
  assert.equal(busy.state.phase, 'init', 'stays on the same phase');
  assert.equal(busy.state.retries, 1);
  assert.equal(busy.writes.length, 1, 'and re-sends the command');
}

{
  // A real error status fails with a message that names the phase.
  const opened = startSession();
  const rejected = step(opened.state, {
    type: 'report',
    bytes: replyTo(opened.writes[0], NGIO_STATUS.CMD_NOT_SUPPORTED),
  });
  assert.equal(rejected.state.phase, 'failed');
  assert.match(rejected.state.error ?? '', /init/);
  assert.match(rejected.state.error ?? '', /not supported/);
}

{
  // No sensor, and the wrong sensor, produce distinguishable guidance.
  const opened = startSession();
  let state = opened.state;
  let writes = opened.writes;
  for (let guard = 0; guard < 4 && state.phase !== 'identify-sensor'; guard += 1) {
    const result = step(state, { type: 'report', bytes: replyTo(writes[0]) });
    state = result.state;
    writes = result.writes;
  }
  assert.equal(state.phase, 'identify-sensor');

  const empty = step(state, {
    type: 'report',
    bytes: replyTo(writes[0], NGIO_STATUS.SUCCESS, [0, 0, 0, 0]),
  });
  assert.equal(empty.state.phase, 'failed');
  assert.match(empty.state.error ?? '', /DIG 1/);

  const wrong = step(state, {
    type: 'report',
    bytes: replyTo(writes[0], NGIO_STATUS.SUCCESS, [13, 0, 0, 0]),
  });
  assert.equal(wrong.state.phase, 'failed');
  assert.match(wrong.state.error ?? '', /not a Motion Detector/);
}

{
  // Silence during the handshake points at the framing hypothesis.
  const opened = startSession();
  const timedOut = step(opened.state, { type: 'timeout' });
  assert.equal(timedOut.state.phase, 'failed');
  assert.match(timedOut.state.error ?? '', /framing/);
}

{
  // Garbage mid-handshake is ignored rather than fatal.
  const opened = startSession();
  const noise = step(opened.state, { type: 'report', bytes: Uint8Array.from([1, 2, 3, 4]) });
  assert.equal(noise.state.phase, 'init', 'noise does not derail the handshake');
  assert.equal(noise.writes.length, 0);
}

{
  const measurement = decodeMeasurementReport(
    encodeCommand({
      command: NGIO_CMD_ID.GET_SENSOR_ID,
      rollingCounter: 0,
      params: [NGIO_STATUS.SUCCESS, NGIO_CHANNEL_ID.DIGITAL1, 1, 1, 0, 0, 0],
    }),
  );
  assert.equal(measurement, null, 'only status reports carry measurements');
}

// --- stream conditioning --------------------------------------------------

assert.equal(conditionSample(null, { t: 0, distance: 1.2 }).quality, 'ok');
assert.equal(conditionSample(null, { t: 0, distance: 0.05 }).quality, 'dropout', 'below range');
assert.equal(conditionSample(null, { t: 0, distance: 7 }).quality, 'dropout', 'above range');
assert.equal(
  conditionSample({ t: 0, distance: 1.0, quality: 'ok' }, { t: 0.05, distance: 1.05 }).quality,
  'ok',
  '1 m/s is a walk',
);
assert.equal(
  conditionSample({ t: 0, distance: 1.0, quality: 'ok' }, { t: 0.05, distance: 1.6 }).quality,
  'dropout',
  '12 m/s is an echo',
);
assert.equal(
  conditionSample({ t: 0.05, distance: 1.0, quality: 'ok' }, { t: 0.05, distance: 1.01 }).quality,
  'dropout',
  'a repeated timestamp is unverifiable',
);
assert.ok(MAX_PLAUSIBLE_SPEED > 1 && MAX_PLAUSIBLE_SPEED < 10);

{
  const samples: MotionSample[] = [
    { t: 0, distance: 1.0, quality: 'ok' },
    { t: 0.05, distance: 0, quality: 'dropout' },
    { t: 0.1, distance: 0, quality: 'dropout' },
    { t: 0.15, distance: 1.3, quality: 'ok' },
  ];
  const filled = fillDropouts(samples);
  assert.equal(filled[1].quality, 'ok', 'a 0.15 s gap is bridged');
  assert.ok(Math.abs(filled[1].distance - 1.1) < 1e-9);
  assert.ok(Math.abs(filled[2].distance - 1.2) < 1e-9);
  assert.equal(lastGoodSample(filled)?.distance, 1.3);
}

{
  // A gap wider than the limit stays a hole.
  const samples: MotionSample[] = [
    { t: 0, distance: 1.0, quality: 'ok' },
    ...Array.from({ length: 10 }, (_, index) => ({
      t: 0.05 * (index + 1),
      distance: 0,
      quality: 'dropout' as const,
    })),
    { t: 0.55, distance: 1.3, quality: 'ok' },
  ];
  const filled = fillDropouts(samples);
  assert.equal(filled[3].quality, 'dropout', 'a 0.55 s gap is not invented');
}

{
  // Leading and trailing dropouts have nothing to interpolate from.
  const filled = fillDropouts([
    { t: 0, distance: 0, quality: 'dropout' },
    { t: 0.05, distance: 1.0, quality: 'ok' },
    { t: 0.1, distance: 0, quality: 'dropout' },
  ]);
  assert.equal(filled[0].quality, 'dropout');
  assert.equal(filled[2].quality, 'dropout');
}

{
  // Sliding velocity must agree with a direct least-squares slope, and must
  // recover a known constant speed.
  const samples: MotionSample[] = Array.from({ length: 41 }, (_, index) => {
    const t = index * 0.05;
    return { t, distance: 0.7 + 0.35 * t, quality: 'ok' as const };
  });

  const velocities = slidingVelocity(samples);
  const middle = velocities[20];
  assert.ok(middle !== null && Math.abs(middle - 0.35) < 1e-9, `expected 0.35 m/s, got ${middle}`);

  const window = samples.filter((sample) => Math.abs(sample.t - 1.0) <= 0.25);
  const direct = fitPolynomial(
    window.map((sample) => ({ x: sample.t, y: sample.distance })),
    1,
  );
  assert.ok(direct.ok);
  assert.ok(
    Math.abs((velocityAt(samples, 1.0) ?? 0) - direct.fit.coefficients[1]) < 1e-12,
    'slidingVelocity is fitPolynomial degree 1 over the window',
  );
}

assert.equal(
  velocityAt([{ t: 0, distance: 1, quality: 'ok' }], 0),
  null,
  'too few points is a blank, not a zero',
);

{
  // Velocity ignores dropouts rather than reading them as a jump to zero.
  const samples: MotionSample[] = [
    { t: 0.8, distance: 1.0, quality: 'ok' },
    { t: 0.85, distance: 0, quality: 'dropout' },
    { t: 0.9, distance: 1.05, quality: 'ok' },
    { t: 0.95, distance: 1.075, quality: 'ok' },
    { t: 1.0, distance: 1.1, quality: 'ok' },
    { t: 1.05, distance: 1.125, quality: 'ok' },
  ];
  const v = velocityAt(samples, 0.95);
  assert.ok(v !== null && v > 0.3 && v < 0.7, `dropout should not drag velocity, got ${v}`);
}

{
  const trimmed = trimToWindow(
    Array.from({ length: 100 }, (_, index) => ({
      t: index * 0.05,
      distance: 1,
      quality: 'ok' as const,
    })),
    4.95,
    1,
  );
  assert.equal(trimmed.length, 21, 'a 1 s window at 20 Hz keeps 21 samples');
}

{
  // Resampling lands on the grid and interpolates between neighbours.
  const grid = resample(
    [
      { t: 0, distance: 1.0, quality: 'ok' },
      { t: 0.2, distance: 1.2, quality: 'ok' },
      { t: 0.4, distance: 1.4, quality: 'ok' },
    ],
    0.1,
    0.4,
  );
  assert.equal(grid.length, 5);
  assert.ok(Math.abs(grid[1].distance - 1.1) < 1e-9);
  assert.ok(Math.abs(grid[3].distance - 1.3) < 1e-9);

  const empty = resample([], 0.1, 0.4);
  assert.equal(empty.length, 5);
  assert.ok(
    empty.every((sample) => sample.quality === 'dropout'),
    'no data resamples to all dropouts, never to zeros that look like readings',
  );
}

{
  // Jitter: measured data has it, an analytic curve does not.
  const analytic: MotionSample[] = Array.from({ length: 50 }, (_, index) => ({
    t: index * 0.05,
    distance: 0.7 + 0.35 * index * 0.05,
    quality: 'ok' as const,
  }));
  assert.ok(jitterRms(analytic) < 1e-12, 'a straight line has no high-frequency content');

  const quantised: MotionSample[] = analytic.map((sample) => ({
    ...sample,
    distance: Math.round(sample.distance * 1000) / 1000,
  }));
  assert.ok(
    jitterRms(quantised) > 1e-5,
    `millimetre quantisation alone clears the forgery floor (${jitterRms(quantised)})`,
  );
}

console.log('vernier device layer tests passed');
