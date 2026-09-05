/**
 * NGIO wire protocol: constants and packet codec.
 *
 * Pure `Uint8Array` in, plain objects out. No DOM, no device handles — the
 * transport layer moves bytes, this module decides what they mean, and
 * `ngioSession.ts` decides what to send next. That split is what lets the
 * protocol be unit tested against a recorded byte transcript in `tests/vernier`
 * with no hardware attached.
 *
 * PROVENANCE — this matters when something does not work:
 *
 *   Authoritative. Command IDs, channel IDs, sampling modes, status codes, the
 *   parameter struct layouts, and "a tick is one microsecond" are transcribed
 *   from Vernier's published NGIO SDK headers (NGIOSourceCmds.h,
 *   NGIO_lib_interface.h). These are facts.
 *
 *   Hypothesis. The outer framing — sync byte, length placement, checksum
 *   convention — is NOT in the public headers; it lives inside Vernier's
 *   closed library. What is below is the conventional Vernier framing, and it
 *   is deliberately parameterised by `NgioFraming` rather than hardcoded, with
 *   `FRAMING_CANDIDATES` and `probeFramingResponse` provided so the connect
 *   panel can settle the question empirically against a real device in a few
 *   seconds instead of anyone guessing twice.
 *
 * If the handshake fails, the framing is the first thing to suspect, and the
 * diagnostics dump is the tool for it.
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

/** "For NGI, a tick is one microsecond." — NGIOSourceCmds.h */
export const NGIO_TICK_SECONDS = 1e-6;

export const measurementPeriodTicks = (periodSeconds: number): number =>
  Math.max(1, Math.round(periodSeconds / NGIO_TICK_SECONDS));

// --- framing (hypothesis; see the provenance note above) ------------------

export interface NgioFraming {
  /** Leading sync/lock byte that marks the start of a message. */
  syncByte: number;
  /**
   * HID output report ID. Vernier interfaces use a single unnumbered report,
   * which WebHID addresses as report 0.
   */
  reportId: number;
}

export const DEFAULT_FRAMING: NgioFraming = { syncByte: 0x88, reportId: 0 };

/**
 * Tried in order by the connect panel's framing probe. 0x88 is the NGIO lock
 * byte; 0x55 is the GoIO-family value and is worth a second attempt because
 * the LabQuest Mini shares a silicon lineage with that line. The report-ID
 * variants cover platforms where WebHID does not strip a leading report byte.
 */
export const FRAMING_CANDIDATES: readonly NgioFraming[] = [
  { syncByte: 0x88, reportId: 0 },
  { syncByte: 0x55, reportId: 0 },
  { syncByte: 0x88, reportId: 1 },
  { syncByte: 0x55, reportId: 1 },
];

/** Two's-complement checksum: every byte of the message sums to 0 mod 256. */
export const ngioChecksum = (bytes: readonly number[]): number =>
  (256 - (bytes.reduce((sum, byte) => sum + byte, 0) % 256)) % 256;

export const nextRollingCounter = (counter: number): number => (counter + 1) % 256;

export const NGIO_DEFAULT_REPORT_LENGTH = 64;

export interface EncodeCommandOptions {
  command: number;
  rollingCounter: number;
  params?: readonly number[];
  framing?: NgioFraming;
  /**
   * Output reports are fixed length; the device ignores trailing padding.
   * Defaults to the 64-byte full-speed HID report Vernier interfaces use.
   */
  reportLength?: number;
}

/**
 * Layout: [sync, bodyLength, command, rollingCounter, ...params, checksum]
 * where bodyLength counts everything after itself, checksum included.
 */
export const encodeCommand = ({
  command,
  rollingCounter,
  params = [],
  framing = DEFAULT_FRAMING,
  reportLength = NGIO_DEFAULT_REPORT_LENGTH,
}: EncodeCommandOptions): Uint8Array => {
  const bodyLength = params.length + 3; // command + counter + params + checksum
  const head = [framing.syncByte, bodyLength, command, rollingCounter, ...params];
  const packet = [...head, ngioChecksum(head)];

  if (packet.length > reportLength) {
    throw new Error(
      `NGIO command 0x${command.toString(16)} needs ${packet.length} bytes, over the ${reportLength}-byte report.`,
    );
  }

  const report = new Uint8Array(reportLength);
  report.set(packet);
  return report;
};

export type NgioResponse =
  | {
      ok: true;
      command: number;
      rollingCounter: number;
      status: number;
      payload: Uint8Array;
    }
  | { ok: false; reason: 'empty' | 'bad-sync' | 'truncated' | 'bad-checksum'; bytes: Uint8Array };

/**
 * Decodes one response message. Tolerates the trailing zero padding every HID
 * input report carries, and tolerates a leading report ID byte, because
 * whether WebHID strips that varies by platform.
 */
export const decodeResponse = (
  raw: Uint8Array,
  framing: NgioFraming = DEFAULT_FRAMING,
): NgioResponse => {
  const bytes =
    raw.length > 1 && raw[0] !== framing.syncByte && raw[1] === framing.syncByte
      ? raw.subarray(1)
      : raw;

  if (bytes.length === 0) {
    return { ok: false, reason: 'empty', bytes: raw };
  }

  if (bytes[0] !== framing.syncByte) {
    return { ok: false, reason: 'bad-sync', bytes: raw };
  }

  const bodyLength = bytes[1];
  const total = bodyLength + 2;

  if (bodyLength < 3 || bytes.length < total) {
    return { ok: false, reason: 'truncated', bytes: raw };
  }

  const message = Array.from(bytes.subarray(0, total));

  if (message.reduce((sum, byte) => sum + byte, 0) % 256 !== 0) {
    return { ok: false, reason: 'bad-checksum', bytes: raw };
  }

  return {
    ok: true,
    command: bytes[2],
    rollingCounter: bytes[3],
    status: bytes[4],
    // Byte 4 is the status; the last byte of the message is the checksum.
    payload: bytes.subarray(5, total - 1),
  };
};

/**
 * True when `raw` looks like a well-formed NGIO response under `framing`. The
 * connect panel sends GET_STATUS under each candidate framing and keeps the
 * one this accepts, which turns "which sync byte?" from a guess into a
 * measurement.
 */
export const probeFramingResponse = (raw: Uint8Array, framing: NgioFraming): boolean =>
  decodeResponse(raw, framing).ok;

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

/** NGIOSetMeasurementPeriodParams: channel, 4-byte run ID, 4-byte period. */
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

/** Parses NGIOGetSensorIdCmdResponsePayload. */
export const parseSensorIdPayload = (payload: Uint8Array): number =>
  payload.length >= 4 ? readUint32LE(payload) : 0;

/**
 * Real-time measurement reports arrive unsolicited once START_MEASUREMENTS is
 * accepted, rather than as a reply to anything. They carry a channel byte, a
 * count, then that many little-endian int32 raw values — for the sonar, echo
 * round-trip times in microseconds.
 */
export interface NgioMeasurementReport {
  channel: number;
  values: number[];
}

export const decodeMeasurementReport = (
  raw: Uint8Array,
  framing: NgioFraming = DEFAULT_FRAMING,
): NgioMeasurementReport | null => {
  const decoded = decodeResponse(raw, framing);
  if (!decoded.ok || decoded.command !== NGIO_CMD_ID.GET_STATUS) {
    return null;
  }

  const { payload } = decoded;
  if (payload.length < 2) return null;

  const channel = payload[0];
  const count = payload[1];
  const values: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const offset = 2 + index * 4;
    if (offset + 4 > payload.length) break;
    values.push(readInt32LE(payload, offset));
  }

  return values.length > 0 ? { channel, values } : null;
};

export const toHex = (bytes: Uint8Array | readonly number[]): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(' ');
