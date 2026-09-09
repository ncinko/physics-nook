/**
 * NGIO wire protocol: constants and packet codec.
 *
 * Pure `Uint8Array` in, plain objects out. No DOM, no device handles — the
 * transport layer moves bytes, this module decides what they mean, and
 * `ngioSession.ts` decides what to send next. That split is what lets the
 * protocol be unit tested against a recorded byte transcript in `tests/vernier`
 * with no hardware attached.
 *
 * PROVENANCE — all of this is now measured, none of it is guessed.
 *
 *   Command IDs, channel IDs, sampling modes, status codes and the parameter
 *   struct layouts are transcribed from Vernier's published NGIO SDK headers
 *   (NGIOSourceCmds.h, NGIO_lib_interface.h).
 *
 *   The framing below — lock bytes, field order, length basis, checksum rule
 *   and the counter direction — was captured from a LabQuest Mini talking to
 *   Vernier's own Graphical Analysis over WebUSB, by hooking
 *   `USBDevice.prototype.transferOut`/`transferIn`. Every claim here was
 *   verified against that transcript; the fixtures in `tests/vernier` are real
 *   frames from it.
 *
 *   An earlier version of this file guessed the framing (sync byte 0x88, body
 *   length, two's-complement checksum, ascending counter). Every one of those
 *   guesses was wrong, which is why the device answered nothing at all.
 */

/** Transcribed from NGIOSourceCmds.h. */
export const NGIO_CMD_ID = {
  GET_STATUS: 0x10,
  START_MEASUREMENTS: 0x18,
  STOP_MEASUREMENTS: 0x19,
  INIT: 0x1a,
  SET_MEASUREMENT_PERIOD: 0x1b,
  GET_MEASUREMENT_PERIOD: 0x1c,
  SET_LED_STATE: 0x1d,
  GET_LED_STATE: 0x1e,
  SET_ANALOG_INPUT: 0x21,
  GET_ANALOG_INPUT: 0x22,
  WRITE_NV_MEM: 0x26,
  READ_NV_MEM: 0x27,
  GET_SENSOR_ID: 0x28,
  SET_SAMPLING_MODE: 0x29,
  GET_SAMPLING_MODE: 0x2a,
  SET_SENSOR_CHANNEL_ENABLE_MASK: 0x2c,
  GET_SENSOR_CHANNEL_ENABLE_MASK: 0x2d,
  SET_COLLECTION_PARAMS: 0x2e,
  GET_COLLECTION_PARAMS: 0x2f,
  CLEAR_ERROR_FLAGS: 0x34,
  ENABLE_SENSOR_ID_NOTIFICATIONS: 0x35,
  DISABLE_SENSOR_ID_NOTIFICATIONS: 0x36,
} as const;

export const NGIO_CHANNEL_ID = {
  TIME: 0,
  ANALOG1: 1,
  ANALOG2: 2,
  ANALOG3: 3,
  ANALOG4: 4,
  DIGITAL1: 5,
  DIGITAL2: 6,
  BUILT_IN_TEMP: 7,
} as const;

export const NGIO_SAMPLING_MODE = {
  PERIODIC_LEVEL_SNAPSHOT: 0,
  APERIODIC_EDGE_DETECT: 1,
  PERIODIC_PULSE_COUNT: 2,
  PERIODIC_MOTION_DETECT: 3,
  PERIODIC_ROTATION_COUNTER: 4,
  PERIODIC_ROTATION_COUNTER_X4: 5,
  CUSTOM: 6,
} as const;

export const NGIO_STATUS = {
  SUCCESS: 0x00,
  NOT_READY_FOR_NEW_CMD: 0x30,
  CMD_NOT_SUPPORTED: 0x31,
  INTERNAL_ERROR1: 0x32,
  INVALID_PARAMETER: 0x36,
} as const;

export const describeNgioStatus = (status: number): string => {
  switch (status) {
    case NGIO_STATUS.SUCCESS:
      return 'success';
    case NGIO_STATUS.NOT_READY_FOR_NEW_CMD:
      return 'device not ready for a new command';
    case NGIO_STATUS.CMD_NOT_SUPPORTED:
      return 'command not supported by this device';
    case NGIO_STATUS.INTERNAL_ERROR1:
      return 'device internal error';
    case NGIO_STATUS.INVALID_PARAMETER:
      return 'invalid parameter';
    default:
      return `unknown status 0x${status.toString(16).padStart(2, '0')}`;
  }
};

/**
 * Unit of the SET_MEASUREMENT_PERIOD register. "For NGI, a tick is one
 * microsecond." — NGIOSourceCmds.h, confirmed by the capture: Graphical
 * Analysis wrote 500000 and measurement blobs then arrived every 0.500 s.
 */
export const NGIO_TICK_SECONDS = 1e-6;

/**
 * Unit of the edge timestamps inside a measurement blob — a different clock
 * from the period register, which is a trap worth stating plainly.
 *
 * Measured: consecutive blobs 0.500 s apart on the host clock carried ping
 * timestamps exactly 2,500,000 apart, giving 0.2 µs per tick (5 MHz). Using
 * the period's 1 µs here would report every distance five times too large.
 */
export const NGIO_EDGE_TICK_SECONDS = 0.2e-6;

export const measurementPeriodTicks = (periodSeconds: number): number =>
  Math.max(1, Math.round(periodSeconds / NGIO_TICK_SECONDS));

// --- framing (measured) ---------------------------------------------------

/**
 * Leading byte identifying what a packet is. Commands go out under
 * `COMMAND`; the device answers with `RESPONSE`, streams measurements under
 * `MEASUREMENT`, and used `RESPONSE_INIT` for the reply to INIT.
 */
export const NGIO_LOCK = {
  COMMAND: 0x58,
  RESPONSE: 0x98,
  RESPONSE_INIT: 0xb8,
  MEASUREMENT: 0x20,
} as const;

/**
 * Fixed 20-byte payload Graphical Analysis sends with INIT. Its meaning is
 * opaque, but a LabQuest Mini answers this and we have no evidence it answers
 * a bare INIT, so it is replayed verbatim.
 */
export const NGIO_INIT_PAYLOAD: readonly number[] = [
  0xa5, 0x4a, 0x06, 0x49, 0x07, 0x48, 0x08, 0x47, 0x09, 0x46, 0x0a, 0x45, 0x0b, 0x44, 0x0c, 0x43,
  0x0d, 0x42, 0x0e, 0x41,
];

/** Bytes before the command byte: lock, length, counter, checksum. */
const HEADER_LENGTH = 4;

/** A response adds the command and the echoed request counter. */
const RESPONSE_MIN_LENGTH = HEADER_LENGTH + 2;

/**
 * Plain sum of every byte except the checksum itself, mod 256.
 *
 * Note this is an ordinary sum, not the two's-complement "everything sums to
 * zero" convention used elsewhere by Vernier. Verified against every frame in
 * the capture.
 */
export const ngioChecksum = (bytes: readonly number[]): number =>
  bytes.reduce((sum, byte) => sum + byte, 0) % 256;

/** First counter value a session sends. Counters descend from here. */
export const NGIO_FIRST_ROLLING_COUNTER = 0xff;

/** Counters descend. Measured: ff, fe, fd, fc … across the whole transcript. */
export const nextRollingCounter = (counter: number): number => (counter + 255) % 256;

export interface EncodeCommandOptions {
  command: number;
  rollingCounter: number;
  params?: readonly number[];
}

/**
 * Layout: [0x58, totalLength, rollingCounter, checksum, command, ...params]
 * where `totalLength` counts the whole packet, checksum byte included.
 *
 * Nothing is padded. A bulk endpoint carries exactly the bytes handed to it,
 * and Vernier's transport asserts `bytesWritten === buffer.byteLength`.
 */
export const encodeCommand = ({
  command,
  rollingCounter,
  params = [],
}: EncodeCommandOptions): Uint8Array => {
  const totalLength = HEADER_LENGTH + 1 + params.length;

  if (totalLength > 0xff) {
    throw new Error(
      `NGIO command 0x${command.toString(16)} needs ${totalLength} bytes, over the 255-byte packet limit.`,
    );
  }

  const checksum = ngioChecksum([
    NGIO_LOCK.COMMAND,
    totalLength,
    rollingCounter,
    command,
    ...params,
  ]);

  return Uint8Array.from([
    NGIO_LOCK.COMMAND,
    totalLength,
    rollingCounter,
    checksum,
    command,
    ...params,
  ]);
};

export interface NgioResponsePacket {
  kind: 'response';
  command: number;
  /** Rolling counter of the command this answers, echoed back. */
  requestCounter: number;
  payload: Uint8Array;
}

/**
 * Status of a simple acknowledgement, or null when the reply carries data.
 *
 * There is deliberately no status field on `NgioResponsePacket`. The capture
 * shows byte 6 is the first payload byte, not a status: GET_SENSOR_ID puts the
 * sensor ID there (2 for a Motion Detector) and GET_MEASUREMENT_PERIOD puts
 * the channel there. Commands that only need to acknowledge answer with a
 * single zero byte, so a one-byte payload — and only a one-byte payload — can
 * be read as a status code.
 */
export const acknowledgementStatus = (payload: Uint8Array): number | null =>
  payload.length === 1 ? payload[0] : null;

export interface NgioMeasurementPacket {
  kind: 'measurement';
  counter: number;
  payload: Uint8Array;
}

export type NgioPacket = NgioResponsePacket | NgioMeasurementPacket;

const isResponseLock = (lock: number): boolean =>
  lock === NGIO_LOCK.RESPONSE || lock === NGIO_LOCK.RESPONSE_INIT;

/**
 * Pulls every well-formed packet out of one inbound buffer.
 *
 * Scanning rather than assuming one packet per read, for two measured reasons.
 * A single bulk transfer can carry several packets back to back — the 34-byte
 * reads in the capture are a 20-byte measurement blob immediately followed by
 * a 14-byte command response. And the device precedes each payload with an
 * 8-byte length header (`<uint32 LE length> 07 48 08 47`) delivered as its own
 * transfer; rather than track that as protocol state, the scanner simply finds
 * no valid lock byte and checksum there and skips it.
 *
 * Validation is lock byte + plausible length + checksum, which is strong
 * enough that skipping a byte and retrying cannot resynchronise onto garbage.
 */
export const parseNgioPackets = (buffer: Uint8Array): NgioPacket[] => {
  const packets: NgioPacket[] = [];
  let offset = 0;

  while (offset + HEADER_LENGTH <= buffer.length) {
    const lock = buffer[offset];
    const length = buffer[offset + 1];
    const response = isResponseLock(lock);
    const measurement = lock === NGIO_LOCK.MEASUREMENT;
    const minimum = response ? RESPONSE_MIN_LENGTH : HEADER_LENGTH;

    if ((!response && !measurement) || length < minimum || offset + length > buffer.length) {
      offset += 1;
      continue;
    }

    const frame = buffer.subarray(offset, offset + length);
    const expected = ngioChecksum([...frame.subarray(0, 3), ...frame.subarray(4)]);

    if (expected !== frame[3]) {
      offset += 1;
      continue;
    }

    if (response) {
      packets.push({
        kind: 'response',
        command: frame[4],
        requestCounter: frame[5],
        payload: frame.subarray(6),
      });
    } else {
      packets.push({ kind: 'measurement', counter: frame[2], payload: frame.subarray(HEADER_LENGTH) });
    }

    offset += length;
  }

  return packets;
};

// --- parameter builders (layouts from NGIOSourceCmds.h) -------------------

const uint32LE = (value: number): number[] => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 24) & 0xff,
];

export const readUint32LE = (bytes: Uint8Array, offset = 0): number =>
  (bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)) >>>
  0;

export const readInt32LE = (bytes: Uint8Array, offset = 0): number => readUint32LE(bytes, offset) | 0;

/**
 * NGIOSetMeasurementPeriodParams: channel, 4-byte run ID, 4-byte period.
 *
 * Graphical Analysis addresses this to channel 0xff — every channel at once —
 * rather than to the sensor's own channel, so we do the same.
 */
export const ALL_CHANNELS = 0xff;

export const setMeasurementPeriodParams = (
  channel: number,
  periodSeconds: number,
  dataRunId = 0,
): number[] => [
  channel & 0xff,
  ...uint32LE(dataRunId),
  ...uint32LE(measurementPeriodTicks(periodSeconds)),
];

/** NGIOGetSensorIdParams: a single channel byte. */
export const getSensorIdParams = (channel: number): number[] => [channel & 0xff];

/** NGIOSetSamplingModeParams: channel then mode. */
export const setSamplingModeParams = (channel: number, samplingMode: number): number[] => [
  channel & 0xff,
  samplingMode & 0xff,
];

/** NGIOSetSensorChannelEnableMaskParams: a 4-byte little-endian bitmask. */
export const setChannelEnableMaskParams = (channels: readonly number[]): number[] =>
  uint32LE(channels.reduce((mask, channel) => mask | (1 << channel), 0));

/**
 * Parses NGIOGetSensorIdCmdResponsePayload. The measured reply carries two
 * little-endian uint32s — the sensor ID and a presence flag — and the ID is
 * the first. A Motion Detector on DIG1 reports 2.
 */
export const parseSensorIdPayload = (payload: Uint8Array): number =>
  payload.length >= 4 ? readUint32LE(payload) : 0;

/**
 * One timestamped edge from a measurement blob.
 *
 * In PERIODIC_MOTION_DETECT the sonar reports two edges per sample: `edge` 0
 * is the outgoing ping and 1 the returning echo, both on the sensor's channel.
 * The round trip is the difference of their timestamps.
 */
export interface NgioEdgeEvent {
  edge: number;
  channel: number;
  /** Capture-clock ticks; see `NGIO_EDGE_TICK_SECONDS`. */
  ticks: number;
}

/**
 * Decodes a measurement blob payload.
 *
 * Layout: [flag, 0, 0, count, ...count × [edge, channel, uint32 LE ticks]].
 * Measured against `01 00 00 02 | 00 05 e2 5b 52 02 | 01 05 72 6f 52 02`,
 * whose declared count of 2 exactly consumes the payload.
 */
export const decodeMeasurementPayload = (payload: Uint8Array): NgioEdgeEvent[] => {
  if (payload.length < HEADER_LENGTH) return [];

  const count = payload[3];
  const events: NgioEdgeEvent[] = [];

  for (let index = 0; index < count; index += 1) {
    const offset = HEADER_LENGTH + index * 6;
    if (offset + 6 > payload.length) break;
    events.push({
      edge: payload[offset],
      channel: payload[offset + 1],
      ticks: readUint32LE(payload, offset + 2),
    });
  }

  return events;
};

export const toHex = (bytes: Uint8Array | readonly number[]): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(' ');
