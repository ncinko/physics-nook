/**
 * The NGIO handshake, as a pure state machine.
 *
 * Nothing here touches a device. `step()` takes the current state plus one
 * inbound event and returns the next state, the bytes to write, and any
 * samples that fell out. The transport hook does the writing; this module owns
 * every decision about ordering, retries, and failure.
 *
 * The command order mirrors what Graphical Analysis was observed doing against
 * a LabQuest Mini: INIT, identify the sensor, enable its channel, set the
 * period, set the sampling mode, start. Deviating from a sequence known to
 * work on real hardware is not worth the tidiness.
 */

import {
  ALL_CHANNELS,
  NGIO_CMD_ID,
  NGIO_CHANNEL_ID,
  NGIO_EDGE_TICK_SECONDS,
  NGIO_INIT_PAYLOAD,
  NGIO_STATUS,
  acknowledgementStatus,
  describeNgioStatus,
  encodeCommand,
  getSensorIdParams,
  nextRollingCounter,
  parseNgioPackets,
  parseSensorIdPayload,
  decodeMeasurementPayload,
  setChannelEnableMaskParams,
  setMeasurementPeriodParams,
  setSamplingModeParams,
  type NgioPacket,
} from './ngioPackets.ts';
import { NGIO_SAMPLING_MODE } from './ngioPackets.ts';
import { findSensor, isMotionSensor } from './sensorIds.ts';

export type SessionPhase =
  | 'idle'
  | 'init'
  | 'identify-sensor'
  | 'enable-channel'
  | 'set-period'
  | 'set-sampling-mode'
  | 'starting'
  | 'streaming'
  | 'retune-stop'
  | 'stopping'
  | 'stopped'
  | 'failed';

export interface SessionState {
  phase: SessionPhase;
  channel: number;
  periodSeconds: number;
  rollingCounter: number;
  /** Command we are waiting on a response for, or null while streaming. */
  pendingCommand: number | null;
  /** How many times the pending command has been re-sent after a busy reply. */
  retries: number;
  sensorId: number;
  sensorName: string;
  /** Count of samples emitted so far. */
  sampleCount: number;
  /**
   * True while a rate change walks the stop/set/start sequence, so the
   * transport can tell it apart from a fresh handshake and leave the reported
   * status alone.
   */
  retuning: boolean;
  /** Ping edge awaiting its echo, in capture-clock ticks. */
  pendingPingTicks: number | null;
  /** Timestamp of the first ping, so sample times start at zero. */
  originTicks: number | null;
  error: string | null;
}

export interface RawSample {
  /** Seconds since streaming started, from the device's own capture clock. */
  t: number;
  /** Sonar round-trip time in capture-clock ticks. */
  raw: number;
}

export interface StepResult {
  state: SessionState;
  /** Packets to write to the device, in order. */
  writes: Uint8Array[];
  samples: RawSample[];
}

export type SessionEvent =
  | { type: 'report'; bytes: Uint8Array }
  | { type: 'stop' }
  | { type: 'timeout' }
  /** Change the sample rate without tearing the session down. */
  | { type: 'set-period'; periodSeconds: number };

export interface SessionOptions {
  channel?: number;
  periodSeconds?: number;
}

/**
 * 20 Hz. The Motion Detector manual calls 20 samples/second optimum and 30 the
 * maximum, warning that faster rates misbehave in acoustically live rooms —
 * exactly the classroom or hallway this gets used in.
 */
export const DEFAULT_PERIOD_SECONDS = 0.05;

const MAX_BUSY_RETRIES = 20;

const createState = (options: SessionOptions = {}): SessionState => ({
  phase: 'idle',
  channel: options.channel ?? NGIO_CHANNEL_ID.DIGITAL1,
  periodSeconds: options.periodSeconds ?? DEFAULT_PERIOD_SECONDS,
  // The first command sent takes nextRollingCounter(0) === 0xff, which is
  // where the captured session starts.
  rollingCounter: 0,
  pendingCommand: null,
  retries: 0,
  sensorId: 0,
  sensorName: 'Unknown',
  sampleCount: 0,
  retuning: false,
  pendingPingTicks: null,
  originTicks: null,
  error: null,
});

/** Ordered list of the phases that each send exactly one command. */
const PHASE_ORDER: SessionPhase[] = [
  'init',
  'identify-sensor',
  'enable-channel',
  'set-period',
  'set-sampling-mode',
  'starting',
];

const commandForPhase = (
  phase: SessionPhase,
  state: SessionState,
): { command: number; params: readonly number[] } | null => {
  switch (phase) {
    case 'init':
      return { command: NGIO_CMD_ID.INIT, params: NGIO_INIT_PAYLOAD };
    case 'identify-sensor':
      return { command: NGIO_CMD_ID.GET_SENSOR_ID, params: getSensorIdParams(state.channel) };
    case 'enable-channel':
      return {
        command: NGIO_CMD_ID.SET_SENSOR_CHANNEL_ENABLE_MASK,
        params: setChannelEnableMaskParams([state.channel]),
      };
    case 'set-period':
      return {
        command: NGIO_CMD_ID.SET_MEASUREMENT_PERIOD,
        params: setMeasurementPeriodParams(ALL_CHANNELS, state.periodSeconds),
      };
    case 'set-sampling-mode': {
      const sensor = findSensor(state.sensorId);
      const mode = sensor ? sensor.samplingMode : NGIO_SAMPLING_MODE.PERIODIC_MOTION_DETECT;
      return {
        command: NGIO_CMD_ID.SET_SAMPLING_MODE,
        params: setSamplingModeParams(state.channel, mode),
      };
    }
    case 'starting':
      return { command: NGIO_CMD_ID.START_MEASUREMENTS, params: [] };
    case 'retune-stop':
    case 'stopping':
      return { command: NGIO_CMD_ID.STOP_MEASUREMENTS, params: [] };
    default:
      return null;
  }
};

/** Builds the write for `phase` and advances the rolling counter. */
const enterPhase = (state: SessionState, phase: SessionPhase): StepResult => {
  const outgoing = commandForPhase(phase, state);

  if (!outgoing) {
    return { state: { ...state, phase, pendingCommand: null, retries: 0 }, writes: [], samples: [] };
  }

  const rollingCounter = nextRollingCounter(state.rollingCounter);

  return {
    state: {
      ...state,
      phase,
      rollingCounter,
      pendingCommand: outgoing.command,
      retries: 0,
    },
    writes: [
      encodeCommand({
        command: outgoing.command,
        rollingCounter,
        params: outgoing.params,
      }),
    ],
    samples: [],
  };
};

const fail = (state: SessionState, error: string): StepResult => ({
  state: { ...state, phase: 'failed', pendingCommand: null, error },
  writes: [],
  samples: [],
});

/** Re-sends the current phase's command after a "not ready" reply. */
const retryPhase = (state: SessionState): StepResult => {
  if (state.retries >= MAX_BUSY_RETRIES) {
    return fail(state, 'Device stayed busy through repeated retries.');
  }
  const retried = enterPhase(state, state.phase);
  return { ...retried, state: { ...retried.state, retries: state.retries + 1 } };
};

/** Opens a session: returns the initial state and the first command to write. */
export const startSession = (options: SessionOptions = {}): StepResult =>
  enterPhase(createState(options), 'init');

const nextPhaseAfter = (phase: SessionPhase): SessionPhase => {
  // A retune rejoins the ordered tail: period, sampling mode, start. Re-sending
  // the sampling mode costs one round trip and keeps the restart identical to
  // the sequence Graphical Analysis was observed using.
  if (phase === 'retune-stop') return 'set-period';

  const index = PHASE_ORDER.indexOf(phase);
  if (index === -1 || index === PHASE_ORDER.length - 1) return 'streaming';
  return PHASE_ORDER[index + 1];
};

/**
 * Turns the sonar's ping/echo edge pairs into round-trip samples.
 *
 * The detector reports edge 0 when the pulse leaves and edge 1 when it comes
 * back. A ping with no echo — nothing in range — leaves the pending ping to be
 * replaced by the next one rather than pairing across samples, which would
 * invent a reading from two different pulses.
 */
const consumeMeasurement = (state: SessionState, packet: NgioPacket): StepResult => {
  if (packet.kind !== 'measurement') return { state, writes: [], samples: [] };

  const samples: RawSample[] = [];
  let current = state;

  for (const event of decodeMeasurementPayload(packet.payload)) {
    if (event.channel !== current.channel) continue;

    if (event.edge === 0) {
      current = { ...current, pendingPingTicks: event.ticks };
      continue;
    }

    if (event.edge === 1 && current.pendingPingTicks !== null) {
      const ping = current.pendingPingTicks;
      const origin = current.originTicks ?? ping;
      samples.push({
        t: (ping - origin) * NGIO_EDGE_TICK_SECONDS,
        raw: event.ticks - ping,
      });
      current = {
        ...current,
        originTicks: origin,
        pendingPingTicks: null,
        sampleCount: current.sampleCount + 1,
      };
    }
  }

  return { state: current, writes: [], samples };
};

const consumeResponse = (state: SessionState, packet: NgioPacket): StepResult => {
  if (packet.kind !== 'response') return { state, writes: [], samples: [] };

  // A streaming session still exchanges commands — the capture shows
  // Graphical Analysis polling GET_SENSOR_ID throughout a run, and we change
  // the sample rate mid-stream. None of those replies may touch the phase or
  // the sample clock, which resetting `originTicks` here would silently do.
  if (state.phase === 'streaming') {
    return { state, writes: [], samples: [] };
  }

  // Ignore anything that is not the reply we are waiting on. The device also
  // volunteers sensor-ID notifications, which would otherwise advance the
  // handshake a step early.
  if (state.pendingCommand !== null && packet.command !== state.pendingCommand) {
    return { state, writes: [], samples: [] };
  }

  // Only a one-byte payload is a status code; a query's reply is data.
  const status = acknowledgementStatus(packet.payload);

  if (status === NGIO_STATUS.NOT_READY_FOR_NEW_CMD) {
    return retryPhase(state);
  }

  if (status !== null && status !== NGIO_STATUS.SUCCESS) {
    return fail(
      state,
      `The interface rejected the ${state.phase} command: ${describeNgioStatus(status)}.`,
    );
  }

  if (state.phase === 'stopping') {
    return { state: { ...state, phase: 'stopped', pendingCommand: null }, writes: [], samples: [] };
  }

  if (state.phase === 'identify-sensor') {
    const sensorId = parseSensorIdPayload(packet.payload);

    if (sensorId === 0) {
      return fail(
        state,
        'No sensor detected on DIG 1. Plug the Motion Detector into the DIG 1 port and reconnect.',
      );
    }

    if (!isMotionSensor(sensorId)) {
      const sensor = findSensor(sensorId);
      return fail(
        state,
        `DIG 1 has ${sensor ? sensor.name : `an unrecognised sensor (ID ${sensorId})`} attached, not a Motion Detector.`,
      );
    }

    const identified: SessionState = {
      ...state,
      sensorId,
      sensorName: findSensor(sensorId)?.name ?? 'Motion Detector',
    };

    return enterPhase(identified, nextPhaseAfter(state.phase));
  }

  const nextPhase = nextPhaseAfter(state.phase);

  if (nextPhase === 'streaming') {
    return {
      state: {
        ...state,
        phase: 'streaming',
        pendingCommand: null,
        retries: 0,
        sampleCount: 0,
        retuning: false,
        pendingPingTicks: null,
        originTicks: null,
      },
      writes: [],
      samples: [],
    };
  }

  return enterPhase(state, nextPhase);
};

export const step = (state: SessionState, event: SessionEvent): StepResult => {
  if (event.type === 'stop') {
    if (state.phase === 'stopped' || state.phase === 'failed' || state.phase === 'idle') {
      return { state, writes: [], samples: [] };
    }
    // A stop that lands mid-retune abandons it; what follows is a stop, not a
    // rate change that will come back.
    return enterPhase({ ...state, retuning: false }, 'stopping');
  }

  if (event.type === 'set-period') {
    const periodSeconds = event.periodSeconds;
    const retuned: SessionState = { ...state, periodSeconds };

    // The period register is latched at START_MEASUREMENTS. Writing it under a
    // running stream is acknowledged and then ignored, which is why the
    // detector used to ping at whatever rate the session opened with for the
    // rest of its life — the symptom being an audible click that never
    // changed, and a velocity graph built from a fraction of the samples it
    // asked for. So a rate change stops measurements, sets the period, and
    // starts again.
    if (state.phase === 'streaming' || state.retuning) {
      return enterPhase({ ...retuned, retuning: true }, 'retune-stop');
    }

    // Mid-handshake there is nothing to retune; the new period is simply what
    // this session's own 'set-period' step will ask for.
    return { state: retuned, writes: [], samples: [] };
  }

  if (event.type === 'timeout') {
    if (state.phase === 'streaming') {
      // Silence while streaming is a stalled sensor, not a protocol error.
      return fail(state, 'The interface stopped sending measurements.');
    }
    return fail(state, `No response to the ${state.phase} command.`);
  }

  // One bulk transfer can carry several packets, and the device's 8-byte
  // length headers are skipped by the parser rather than modelled here.
  const packets = parseNgioPackets(event.bytes);

  let current = state;
  const writes: Uint8Array[] = [];
  const samples: RawSample[] = [];

  for (const packet of packets) {
    if (current.phase === 'failed') break;

    const result =
      packet.kind === 'measurement'
        ? current.phase === 'streaming'
          ? consumeMeasurement(current, packet)
          : { state: current, writes: [], samples: [] }
        : consumeResponse(current, packet);

    current = result.state;
    writes.push(...result.writes);
    samples.push(...result.samples);
  }

  return { state: current, writes, samples };
};

/** One-line status for the connect panel. */
export const describePhase = (state: SessionState): string => {
  switch (state.phase) {
    case 'idle':
      return 'Not connected';
    case 'init':
      return 'Waking the interface';
    case 'identify-sensor':
      return 'Looking for a sensor on DIG 1';
    case 'enable-channel':
    case 'set-period':
    case 'set-sampling-mode':
      return 'Configuring the Motion Detector';
    case 'starting':
      return 'Starting measurements';
    case 'retune-stop':
      return 'Changing the sample rate';
    case 'streaming':
      return `Streaming from ${state.sensorName}`;
    case 'stopping':
      return 'Stopping measurements';
    case 'stopped':
      return 'Stopped';
    case 'failed':
      return state.error ?? 'Connection failed';
  }
};
