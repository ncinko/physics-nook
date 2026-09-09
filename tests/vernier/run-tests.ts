import assert from 'node:assert/strict';
import {
  ALL_CHANNELS,
  NGIO_CHANNEL_ID,
  NGIO_CMD_ID,
  NGIO_EDGE_TICK_SECONDS,
  NGIO_FIRST_ROLLING_COUNTER,
  NGIO_INIT_PAYLOAD,
  NGIO_LOCK,
  NGIO_SAMPLING_MODE,
  NGIO_STATUS,
  NGIO_TICK_SECONDS,
  acknowledgementStatus,
  decodeMeasurementPayload,
  encodeCommand,
  measurementPeriodTicks,
  ngioChecksum,
  nextRollingCounter,
  parseNgioPackets,
  parseSensorIdPayload,
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
  webUsbFilters,
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
assert.deepEqual(webUsbFilters(), [{ vendorId: 0x08f7 }]);

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

// A 1 m target is a 5.83 ms round trip at 20 C, which is 29150 ticks of the
// 5 MHz capture clock.
{
  const sensor = findSensor(69);
  assert.ok(sensor);
  const roundTripTicks = 2.0 / speedOfSound(20) / NGIO_EDGE_TICK_SECONDS;
  const meters = sensor.toPhysical(roundTripTicks, { airTemperatureC: 20 });
  assert.ok(Math.abs(meters - 1.0) < 1e-9, `1 m round trip should read 1 m, got ${meters}`);
}

assert.equal(isPlausibleDistance(2), true);
assert.equal(isPlausibleDistance(0.05), false, 'inside the detector dead zone');
assert.equal(isPlausibleDistance(9), false, 'beyond the detector range');
assert.equal(MOTION_DETECTOR_RANGE.minMeters, 0.15);

// --- packet codec ---------------------------------------------------------
//
// The fixtures below are real frames, captured from a LabQuest Mini talking to
// Vernier's Graphical Analysis over WebUSB. Asserting against them is what
// keeps this codec honest: the previous version of this protocol layer passed
// a full suite of self-consistent tests while being wrong in every field.

assert.equal(NGIO_TICK_SECONDS, 1e-6);
assert.equal(NGIO_EDGE_TICK_SECONDS, 0.2e-6);
assert.equal(measurementPeriodTicks(0.05), 50_000, '20 Hz is 50000 one-microsecond ticks');
assert.equal(measurementPeriodTicks(0), 1, 'period never encodes as zero ticks');

// The checksum is a plain sum of the other bytes, not a two's complement.
assert.equal(ngioChecksum([0x58, 0x05, 0xfd, 0x10]), 0x6a, 'captured GET_STATUS command');
assert.equal(ngioChecksum([0x58, 0x08, 0xfe, 0x1d, 0x00, 0x80, 0x10]), 0x0b, 'captured SET_LED');
assert.equal(ngioChecksum([0x98, 0x07, 0x01, 0x1d, 0xfe, 0x00]), 0xbb, 'captured response');

// Counters descend from 0xff.
assert.equal(NGIO_FIRST_ROLLING_COUNTER, 0xff);
assert.equal(nextRollingCounter(0x00), 0xff, 'a fresh session opens on 0xff');
assert.equal(nextRollingCounter(0xff), 0xfe);
assert.equal(nextRollingCounter(0x01), 0x00, 'and wraps at a byte');

{
  // Byte for byte against the captured GET_STATUS command.
  const packet = encodeCommand({ command: NGIO_CMD_ID.GET_STATUS, rollingCounter: 0xfd });
  assert.deepEqual(Array.from(packet), [0x58, 0x05, 0xfd, 0x6a, 0x10], toHex(packet));
  assert.equal(packet.length, 5, 'bulk packets carry no padding');
}

{
  // ... the captured channel-enable mask for DIG 1 ...
  const packet = encodeCommand({
    command: NGIO_CMD_ID.SET_SENSOR_CHANNEL_ENABLE_MASK,
    rollingCounter: 0xf6,
    params: setChannelEnableMaskParams([NGIO_CHANNEL_ID.DIGITAL1]),
  });
  assert.deepEqual(
    Array.from(packet),
    [0x58, 0x09, 0xf6, 0xa3, 0x2c, 0x20, 0x00, 0x00, 0x00],
    toHex(packet),
  );
}

{
  // ... the captured measurement period, addressed to every channel at once ...
  const packet = encodeCommand({
    command: NGIO_CMD_ID.SET_MEASUREMENT_PERIOD,
    rollingCounter: 0xf5,
    params: setMeasurementPeriodParams(ALL_CHANNELS, 0.5),
  });
  assert.deepEqual(
    Array.from(packet),
    [0x58, 0x0e, 0xf5, 0x3d, 0x1b, 0xff, 0, 0, 0, 0, 0x20, 0xa1, 0x07, 0x00],
    toHex(packet),
  );
}

{
  // ... the captured sampling mode ...
  const packet = encodeCommand({
    command: NGIO_CMD_ID.SET_SAMPLING_MODE,
    rollingCounter: 0xf0,
    params: setSamplingModeParams(
      NGIO_CHANNEL_ID.DIGITAL1,
      NGIO_SAMPLING_MODE.PERIODIC_MOTION_DETECT,
    ),
  });
  assert.deepEqual(Array.from(packet), [0x58, 0x07, 0xf0, 0x80, 0x29, 0x05, 0x03], toHex(packet));
}

{
  // ... and INIT with its fixed 20-byte payload.
  const packet = encodeCommand({
    command: NGIO_CMD_ID.INIT,
    rollingCounter: 0xff,
    params: NGIO_INIT_PAYLOAD,
  });
  assert.equal(NGIO_INIT_PAYLOAD.length, 20);
  assert.equal(packet.length, 0x19, 'captured INIT was 25 bytes');
  assert.equal(packet[1], 0x19, 'length counts the whole packet, checksum included');
  assert.equal(packet[3], 0x40, 'captured INIT checksum');
}

{
  // A command response, decoded into its measured field positions.
  const packets = parseNgioPackets(Uint8Array.from([0x98, 0x07, 0x01, 0xbb, 0x1d, 0xfe, 0x00]));
  assert.equal(packets.length, 1);
  const packet = packets[0];
  assert.ok(packet.kind === 'response');
  assert.equal(packet.command, NGIO_CMD_ID.SET_LED_STATE);
  assert.equal(packet.requestCounter, 0xfe, 'the reply echoes the command counter');
  assert.equal(acknowledgementStatus(packet.payload), NGIO_STATUS.SUCCESS);
}

{
  // GET_SENSOR_ID on DIG 1. Byte 6 is the sensor ID, not a status: an empty
  // channel and a Motion Detector differ only there.
  const empty = parseNgioPackets(
    Uint8Array.from([0x98, 0x0e, 0x04, 0xcd, 0x28, 0xfb, 0, 0, 0, 0, 0, 0, 0, 0]),
  )[0];
  assert.ok(empty && empty.kind === 'response');
  assert.equal(parseSensorIdPayload(empty.payload), 0, 'nothing plugged in');
  assert.equal(acknowledgementStatus(empty.payload), null, 'an 8-byte payload is data, not status');

  const detector = parseNgioPackets(
    Uint8Array.from([0x98, 0x0e, 0x07, 0xd0, 0x28, 0xf8, 0x02, 0, 0, 0, 0x01, 0, 0, 0]),
  )[0];
  assert.ok(detector && detector.kind === 'response');
  assert.equal(parseSensorIdPayload(detector.payload), 2, 'a Motion Detector reports ID 2');
  assert.equal(isMotionSensor(parseSensorIdPayload(detector.payload)), true);
}

{
  // The device's 8-byte length header carries no lock byte, so the scanner
  // walks past it rather than modelling it as protocol state.
  const header = [0x07, 0x00, 0x00, 0x00, 0x07, 0x48, 0x08, 0x47];
  const response = [0x98, 0x07, 0x01, 0xbb, 0x1d, 0xfe, 0x00];
  const packets = parseNgioPackets(Uint8Array.from([...header, ...response]));
  assert.equal(packets.length, 1, 'the length header is skipped, the response is found');
  assert.ok(packets[0].kind === 'response');
  assert.equal(packets[0].command, NGIO_CMD_ID.SET_LED_STATE);
}

{
  // One bulk transfer can carry several packets back to back; the capture's
  // 34-byte reads were a measurement blob followed by a command response.
  const blob = [
    0x20, 0x14, 0x01, 0x09, 0x01, 0x00, 0x00, 0x02, 0x00, 0x05, 0xe2, 0x5b, 0x52, 0x02, 0x01, 0x05,
    0x72, 0x6f, 0x52, 0x02,
  ];
  const response = [0x98, 0x07, 0x01, 0xbb, 0x1d, 0xfe, 0x00];
  const packets = parseNgioPackets(Uint8Array.from([...blob, ...response]));
  assert.equal(packets.length, 2, 'both packets are recovered from one buffer');
  assert.equal(packets[0].kind, 'measurement');
  assert.equal(packets[1].kind, 'response');
}

{
  // Garbage never resynchronises onto a false packet.
  assert.deepEqual(parseNgioPackets(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])), []);
  assert.deepEqual(parseNgioPackets(new Uint8Array(0)), []);
  // A valid frame with one byte corrupted fails the checksum and is dropped.
  assert.deepEqual(parseNgioPackets(Uint8Array.from([0x98, 0x07, 0x01, 0xbb, 0x1d, 0xfe, 0x01])), []);
}

{
  // A real measurement blob: ping and echo edges on DIG 1.
  const blob = Uint8Array.from([
    0x20, 0x14, 0x01, 0x09, 0x01, 0x00, 0x00, 0x02, 0x00, 0x05, 0xe2, 0x5b, 0x52, 0x02, 0x01, 0x05,
    0x72, 0x6f, 0x52, 0x02,
  ]);
  const packet = parseNgioPackets(blob)[0];
  assert.ok(packet && packet.kind === 'measurement');

  const events = decodeMeasurementPayload(packet.payload);
  assert.equal(events.length, 2, 'the declared count matches the payload exactly');
  assert.deepEqual(
    events.map((event) => event.edge),
    [0, 1],
    'edge 0 is the ping, edge 1 the echo',
  );
  assert.equal(events[0].channel, NGIO_CHANNEL_ID.DIGITAL1);
  assert.equal(events[1].ticks - events[0].ticks, 5008, 'captured round trip in ticks');

  const sensor = findSensor(2);
  assert.ok(sensor);
  const meters = sensor.toPhysical(events[1].ticks - events[0].ticks, { airTemperatureC: 20 });
  assert.ok(meters > 0.15 && meters < 0.2, `captured frame should read about 0.17 m, got ${meters}`);
}

// Parameter builders match the SDK struct layouts.
assert.deepEqual(setSamplingModeParams(NGIO_CHANNEL_ID.DIGITAL1, 3), [5, 3]);
assert.deepEqual(setChannelEnableMaskParams([NGIO_CHANNEL_ID.DIGITAL1]), [0x20, 0, 0, 0]);
assert.deepEqual(setMeasurementPeriodParams(ALL_CHANNELS, 0.5), [
  0xff, 0, 0, 0, 0, 0x20, 0xa1, 0x07, 0x00,
]);
assert.equal(parseSensorIdPayload(Uint8Array.from([69, 0, 0, 0])), 69);
assert.equal(parseSensorIdPayload(Uint8Array.from([1, 2])), 0, 'a short payload means no sensor');
assert.equal(readInt32LE(Uint8Array.from([0xff, 0xff, 0xff, 0xff])), -1);

// --- session state machine ------------------------------------------------

/** Builds the response frame the device would send for a given command. */
const responseFrame = (command: number, requestCounter: number, payload: number[]): Uint8Array => {
  const length = 6 + payload.length;
  const head = [NGIO_LOCK.RESPONSE, length, 0x01, command, requestCounter, ...payload];
  return Uint8Array.from([
    NGIO_LOCK.RESPONSE,
    length,
    0x01,
    ngioChecksum(head),
    command,
    requestCounter,
    ...payload,
  ]);
};

/** Answers whatever command was just written. */
const replyTo = (written: Uint8Array, payload: number[] = [NGIO_STATUS.SUCCESS]): Uint8Array =>
  responseFrame(written[4], written[2], payload);

/** Builds a measurement blob from ping/echo edges. */
const measurementFrame = (
  events: { edge: number; channel: number; ticks: number }[],
): Uint8Array => {
  const body = [
    0x01,
    0x00,
    0x00,
    events.length,
    ...events.flatMap((event) => [
      event.edge,
      event.channel,
      event.ticks & 0xff,
      (event.ticks >>> 8) & 0xff,
      (event.ticks >>> 16) & 0xff,
      (event.ticks >>> 24) & 0xff,
    ]),
  ];
  const length = 4 + body.length;
  const head = [NGIO_LOCK.MEASUREMENT, length, 0x00, ...body];
  return Uint8Array.from([NGIO_LOCK.MEASUREMENT, length, 0x00, ngioChecksum(head), ...body]);
};

{
  const opened = startSession();
  assert.equal(opened.state.phase, 'init');
  assert.equal(opened.writes.length, 1);
  assert.equal(opened.state.periodSeconds, DEFAULT_PERIOD_SECONDS);
  assert.equal(opened.writes[0][2], NGIO_FIRST_ROLLING_COUNTER, 'first command uses 0xff');
  assert.equal(opened.writes[0][4], NGIO_CMD_ID.INIT);

  // Drive the full handshake, answering success to everything and reporting a
  // Motion Detector 2 on DIG 1.
  const seen: string[] = [opened.state.phase];
  let state: SessionState = opened.state;
  let writes = opened.writes;

  for (let guard = 0; guard < 20 && state.phase !== 'streaming'; guard += 1) {
    assert.equal(writes.length, 1, `phase ${state.phase} should write one command`);
    const payload =
      state.phase === 'identify-sensor' ? [69, 0, 0, 0, 1, 0, 0, 0] : [NGIO_STATUS.SUCCESS];
    const result = step(state, { type: 'report', bytes: replyTo(writes[0], payload) });
    state = result.state;
    writes = result.writes;
    seen.push(state.phase);
  }

  assert.equal(state.phase, 'streaming', `handshake stalled at ${state.phase}: ${state.error ?? ''}`);
  assert.deepEqual(seen, [
    'init',
    'identify-sensor',
    'enable-channel',
    'set-period',
    'set-sampling-mode',
    'starting',
    'streaming',
  ]);
  assert.equal(state.sensorId, 69);
  assert.equal(state.sensorName, 'Motion Detector 2');
  assert.match(describePhase(state), /Streaming from Motion Detector 2/);

  // Measurements arrive unsolicited, timestamped off the device's own capture
  // clock rather than off arrival time.
  const ticksFor = (meters: number) =>
    Math.round((2 * meters) / speedOfSound(20) / NGIO_EDGE_TICK_SECONDS);
  const origin = 1_000_000;
  const streamed = step(state, {
    type: 'report',
    bytes: measurementFrame([
      { edge: 0, channel: NGIO_CHANNEL_ID.DIGITAL1, ticks: origin },
      { edge: 1, channel: NGIO_CHANNEL_ID.DIGITAL1, ticks: origin + ticksFor(1.0) },
    ]),
  });

  assert.equal(streamed.samples.length, 1, 'a ping/echo pair is one sample');
  assert.equal(streamed.samples[0].t, 0, 'the first ping is time zero');
  assert.equal(streamed.samples[0].raw, ticksFor(1.0));
  assert.equal(streamed.state.sampleCount, 1);

  // A second pair, a quarter second later on the device clock.
  const later = origin + 0.25 / NGIO_EDGE_TICK_SECONDS;
  const again = step(streamed.state, {
    type: 'report',
    bytes: measurementFrame([
      { edge: 0, channel: NGIO_CHANNEL_ID.DIGITAL1, ticks: later },
      { edge: 1, channel: NGIO_CHANNEL_ID.DIGITAL1, ticks: later + ticksFor(1.1) },
    ]),
  });
  assert.ok(Math.abs(again.samples[0].t - 0.25) < 1e-9, 'sample time comes from the device clock');

  // A ping with no echo must not pair with the next ping.
  const orphan = step(again.state, {
    type: 'report',
    bytes: measurementFrame([{ edge: 0, channel: NGIO_CHANNEL_ID.DIGITAL1, ticks: later + 10_000 }]),
  });
  assert.equal(orphan.samples.length, 0, 'an unanswered ping emits nothing');

  const stopped = step(orphan.state, { type: 'stop' });
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
    bytes: replyTo(opened.writes[0], [NGIO_STATUS.NOT_READY_FOR_NEW_CMD]),
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
    bytes: replyTo(opened.writes[0], [NGIO_STATUS.CMD_NOT_SUPPORTED]),
  });
  assert.equal(rejected.state.phase, 'failed');
  assert.match(rejected.state.error ?? '', /init/);
  assert.match(rejected.state.error ?? '', /not supported/);
}

{
  // A reply to a different command does not advance the handshake. The device
  // volunteers sensor-ID notifications while streaming.
  const opened = startSession();
  const stray = step(opened.state, {
    type: 'report',
    bytes: responseFrame(NGIO_CMD_ID.GET_SENSOR_ID, 0x10, [2, 0, 0, 0, 1, 0, 0, 0]),
  });
  assert.equal(stray.state.phase, 'init', 'an unrelated reply is ignored');
  assert.equal(stray.writes.length, 0);
}

{
  // No sensor, and the wrong sensor, produce distinguishable guidance.
  const opened = startSession();
  const identified = step(opened.state, {
    type: 'report',
    bytes: replyTo(opened.writes[0]),
  });
  assert.equal(identified.state.phase, 'identify-sensor');

  const empty = step(identified.state, {
    type: 'report',
    bytes: replyTo(identified.writes[0], [0, 0, 0, 0, 0, 0, 0, 0]),
  });
  assert.equal(empty.state.phase, 'failed');
  assert.match(empty.state.error ?? '', /DIG 1/);

  const wrong = step(identified.state, {
    type: 'report',
    bytes: replyTo(identified.writes[0], [13, 0, 0, 0, 1, 0, 0, 0]),
  });
  assert.equal(wrong.state.phase, 'failed');
  assert.match(wrong.state.error ?? '', /not a Motion Detector/);
}

{
  // Silence during the handshake names the step that stalled.
  const opened = startSession();
  const timedOut = step(opened.state, { type: 'timeout' });
  assert.equal(timedOut.state.phase, 'failed');
  assert.match(timedOut.state.error ?? '', /init/);
}

{
  // Garbage mid-handshake is ignored rather than fatal.
  const opened = startSession();
  const noise = step(opened.state, { type: 'report', bytes: Uint8Array.from([1, 2, 3, 4]) });
  assert.equal(noise.state.phase, 'init', 'noise does not derail the handshake');
  assert.equal(noise.writes.length, 0);
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
