/**
 * The NGIO handshake, as a pure state machine.
 *
 * Nothing here touches a device. `step()` takes the current state plus one
 * inbound event and returns the next state, the bytes to write, and any
 * samples that fell out. The transport hook does the writing; this module owns
 * every decision about ordering, retries, and failure.
 *
 * The reason for that shape is practical rather than architectural purity:
 * this is the layer most likely to need correction once a real LabQuest Mini
 * is on the other end of the cable. Keeping it pure means a correction is a
 * test case fed a recorded byte transcript, not a debugging session with a
 * device plugged in.
 */

import {
  DEFAULT_FRAMING,
  NGIO_CMD_ID,
  NGIO_CHANNEL_ID,
  NGIO_STATUS,
  decodeMeasurementReport,
  decodeResponse,
  describeNgioStatus,
  encodeCommand,
  getSensorIdParams,
  nextRollingCounter,
  parseSensorIdPayload,
  setChannelEnableMaskParams,
  setMeasurementPeriodParams,
  setSamplingModeParams,
  type NgioFraming,
} from './ngioPackets.ts';
import { NGIO_SAMPLING_MODE } from './ngioPackets.ts';
import { findSensor, isMotionSensor } from './sensorIds.ts';

export type SessionPhase =
  | 'idle'
  | 'init'
  | 'clear-errors'
  | 'identify-sensor'
  | 'set-sampling-mode'
  | 'enable-channel'
  | 'set-period'
  | 'starting'
  | 'streaming'
  | 'stopping'
  | 'stopped'
  | 'failed';

export interface SessionState {
  phase: SessionPhase;
  framing: NgioFraming;
  channel: number;
  periodSeconds: number;
  rollingCounter: number;
  /** Command we are waiting on a response for, or null while streaming. */
  pendingCommand: number | null;
  /** How many times the pending command has been re-sent after a busy reply. */
  retries: number;
  sensorId: number;
  sensorName: string;
  /** Count of samples emitted so far; drives the sample clock. */
  sampleCount: number;
  error: string | null;
}

export interface RawSample {
  /** Seconds since streaming started. */
  t: number;
  /** Device counts, before any unit conversion. */
  raw: number;
}

export interface StepResult {
  state: SessionState;
  /** Reports to write to the device, in order. */
  writes: Uint8Array[];
  samples: RawSample[];
}

export type SessionEvent =
  | { type: 'report'; bytes: Uint8Array }
  | { type: 'stop' }
  | { type: 'timeout' };

export interface SessionOptions {
  framing?: NgioFraming;
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
  framing: options.framing ?? DEFAULT_FRAMING,
  channel: options.channel ?? NGIO_CHANNEL_ID.DIGITAL1,
  periodSeconds: options.periodSeconds ?? DEFAULT_PERIOD_SECONDS,
  rollingCounter: 0,
  pendingCommand: null,
  retries: 0,
  sensorId: 0,
  sensorName: 'Unknown',
  sampleCount: 0,
  error: null,
});

/** Ordered list of the phases that each send exactly one command. */
const PHASE_ORDER: SessionPhase[] = [
  'init',
  'clear-errors',
  'identify-sensor',
  'set-sampling-mode',
  'enable-channel',
  'set-period',
  'starting',
];

const commandForPhase = (
  phase: SessionPhase,
  state: SessionState,
): { command: number; params: number[] } | null => {
  switch (phase) {
    case 'init':
      return { command: NGIO_CMD_ID.INIT, params: [] };
    case 'clear-errors':
      return { command: NGIO_CMD_ID.CLEAR_ERROR_FLAGS, params: [] };
    case 'identify-sensor':
      return { command: NGIO_CMD_ID.GET_SENSOR_ID, params: getSensorIdParams(state.channel) };
    case 'set-sampling-mode': {
      const sensor = findSensor(state.sensorId);
      const mode = sensor ? sensor.samplingMode : NGIO_SAMPLING_MODE.PERIODIC_MOTION_DETECT;
      return {
        command: NGIO_CMD_ID.SET_SAMPLING_MODE,
        params: setSamplingModeParams(state.channel, mode),
      };
    }
    case 'enable-channel':
      return {
        command: NGIO_CMD_ID.SET_SENSOR_CHANNEL_ENABLE_MASK,
        params: setChannelEnableMaskParams([state.channel]),
      };
    case 'set-period':
      return {
        command: NGIO_CMD_ID.SET_MEASUREMENT_PERIOD,
        params: setMeasurementPeriodParams(state.channel, state.periodSeconds),
      };
    case 'starting':
      return { command: NGIO_CMD_ID.START_MEASUREMENTS, params: [] };
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
        framing: state.framing,
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
  const index = PHASE_ORDER.indexOf(phase);
  if (index === -1 || index === PHASE_ORDER.length - 1) return 'streaming';
  return PHASE_ORDER[index + 1];
};

export const step = (state: SessionState, event: SessionEvent): StepResult => {
  if (event.type === 'stop') {
    if (state.phase === 'stopped' || state.phase === 'failed' || state.phase === 'idle') {
      return { state, writes: [], samples: [] };
    }
    return enterPhase(state, 'stopping');
  }

  if (event.type === 'timeout') {
    if (state.phase === 'streaming') {
      // Silence while streaming is a stalled sensor, not a protocol error.
      return fail(state, 'The interface stopped sending measurements.');
    }
    return fail(state, `No response to the ${state.phase} command. Check the framing hypothesis.`);
  }

  if (state.phase === 'streaming') {
    const report = decodeMeasurementReport(event.bytes, state.framing);
    if (!report || report.channel !== state.channel) {
      return { state, writes: [], samples: [] };
    }

    // Timestamps come from the sample index times the requested period, not
    // from report arrival time. The device samples on its own clock; USB
    // delivery jitters by milliseconds and would smear every derivative taken
    // downstream.
    const samples = report.values.map((raw, index) => ({
      t: (state.sampleCount + index) * state.periodSeconds,
      raw,
    }));

    return {
      state: { ...state, sampleCount: state.sampleCount + samples.length },
      writes: [],
      samples,
    };
  }

  const decoded = decodeResponse(event.bytes, state.framing);

  if (!decoded.ok) {
    // Malformed traffic during the handshake is normal noise from a device
    // still flushing an earlier session; only a timeout is fatal.
    return { state, writes: [], samples: [] };
  }

  if (state.pendingCommand !== null && decoded.command !== state.pendingCommand) {
    return { state, writes: [], samples: [] };
  }

  if (decoded.status === NGIO_STATUS.NOT_READY_FOR_NEW_CMD) {
    return retryPhase(state);
  }

  if (decoded.status !== NGIO_STATUS.SUCCESS) {
    return fail(
      state,
      `The interface rejected the ${state.phase} command: ${describeNgioStatus(decoded.status)}.`,
    );
  }

  if (state.phase === 'stopping') {
    return { state: { ...state, phase: 'stopped', pendingCommand: null }, writes: [], samples: [] };
  }

  if (state.phase === 'identify-sensor') {
    const sensorId = parseSensorIdPayload(decoded.payload);

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
      state: { ...state, phase: 'streaming', pendingCommand: null, retries: 0, sampleCount: 0 },
      writes: [],
      samples: [],
    };
  }

  return enterPhase(state, nextPhase);
};

/** One-line status for the connect panel. */
export const describePhase = (state: SessionState): string => {
  switch (state.phase) {
    case 'idle':
      return 'Not connected';
    case 'init':
    case 'clear-errors':
      return 'Waking the interface';
    case 'identify-sensor':
      return 'Looking for a sensor on DIG 1';
    case 'set-sampling-mode':
    case 'enable-channel':
    case 'set-period':
      return 'Configuring the Motion Detector';
    case 'starting':
      return 'Starting measurements';
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
