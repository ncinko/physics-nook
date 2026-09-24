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
 *
 * What the session looks for is a profile. The Motion Detector profile reads
 * one channel and pairs ping/echo edges into round trips; the photogate
 * profile reads DIG 1 and, if present, DIG 2, and passes the raw beam edges
 * through for `photogateTiming.ts` to interpret. A multi-channel profile runs
 * the identify and sampling-mode steps once per channel, still one command and
 * one reply at a time.
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
  type NgioEdgeEvent,
  type NgioPacket,
} from './ngioPackets.ts';
import { NGIO_SAMPLING_MODE } from './ngioPackets.ts';
import { findSensor, isMotionSensor, isPhotogateSensor } from './sensorIds.ts';

export type SessionProfileId = 'motion' | 'photogate';

interface ProfileChannel {
  channel: number;
  /** An optional channel left empty is skipped rather than failed. */
  required: boolean;
}

interface SessionProfile {
  channels: readonly ProfileChannel[];
  accepts: (sensorId: number) => boolean;
  /** 'motion' pairs ping/echo into round trips; 'edges' passes edges through. */
  decode: 'motion' | 'edges';
  fallbackName: string;
  describeMissing: (channel: number) => string;
  describeWrong: (channel: number, sensorId: number) => string;
  lookingFor: string;
  configuring: string;
}

const portName = (channel: number): string =>
  channel === NGIO_CHANNEL_ID.DIGITAL2 ? 'DIG 2' : 'DIG 1';

const nameOf = (sensorId: number): string => {
  const sensor = findSensor(sensorId);
  return sensor ? sensor.name : `an unrecognised sensor (ID ${sensorId})`;
};

const PROFILES: Record<SessionProfileId, SessionProfile> = {
  motion: {
    channels: [{ channel: NGIO_CHANNEL_ID.DIGITAL1, required: true }],
    accepts: isMotionSensor,
    decode: 'motion',
    fallbackName: 'Motion Detector',
    describeMissing: () =>
      'No sensor detected on DIG 1. Plug the Motion Detector into the DIG 1 port and reconnect.',
    describeWrong: (_channel, sensorId) =>
      `DIG 1 has ${nameOf(sensorId)} attached, not a Motion Detector.`,
    lookingFor: 'Looking for a sensor on DIG 1',
    configuring: 'Configuring the Motion Detector',
  },
  photogate: {
    // DIG 2 is optional: an empty DIG 2 means Gate B is daisy-chained into
    // Gate A, which the interface cannot see — both gates share one line.
    channels: [
      { channel: NGIO_CHANNEL_ID.DIGITAL1, required: true },
      { channel: NGIO_CHANNEL_ID.DIGITAL2, required: false },
    ],
    accepts: isPhotogateSensor,
    decode: 'edges',
    fallbackName: 'Photogate',
    describeMissing: () =>
      'No photogate detected on DIG 1. Plug Gate A into the DIG 1 port and reconnect.',
    describeWrong: (channel, sensorId) =>
      `${portName(channel)} has ${nameOf(sensorId)} attached, not a Photogate.`,
    lookingFor: 'Looking for photogates on DIG 1 and DIG 2',
    configuring: 'Configuring the photogates',
  },
};

/**
 * How the two gates reach the interface. 'two-port' is Gate A on DIG 1 and
 * Gate B on DIG 2. 'one-port' is only DIG 1 occupied, which is correct when
 * Gate B is daisy-chained into Gate A — and indistinguishable, electrically,
 * from Gate B not being connected at all.
 */
export type PhotogateWiring = 'two-port' | 'one-port';

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
  profileId: SessionProfileId;
  /** The profile's first channel; the one a single-channel profile reads. */
  channel: number;
  /** Every channel found holding an acceptable sensor, in profile order. */
  activeChannels: number[];
  /** Which profile channel `identify-sensor` is asking about. */
  identifyIndex: number;
  /** Which active channel `set-sampling-mode` is configuring. */
  modeIndex: number;
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
  /** Raw beam edges, from an 'edges' profile only. Ticks are not rebased. */
  edges: NgioEdgeEvent[];
}

export type SessionEvent =
  | { type: 'report'; bytes: Uint8Array }
  | { type: 'stop' }
  | { type: 'timeout' }
  /** Change the sample rate without tearing the session down. */
  | { type: 'set-period'; periodSeconds: number };

export interface SessionOptions {
  profile?: SessionProfileId;
  periodSeconds?: number;
}

/**
 * 20 Hz. The Motion Detector manual calls 20 samples/second optimum and 30 the
 * maximum, warning that faster rates misbehave in acoustically live rooms —
 * exactly the classroom or hallway this gets used in.
 */
export const DEFAULT_PERIOD_SECONDS = 0.05;

const MAX_BUSY_RETRIES = 20;

const createState = (options: SessionOptions = {}): SessionState => {
  const profileId = options.profile ?? 'motion';
  return {
    phase: 'idle',
    profileId,
    channel: PROFILES[profileId].channels[0].channel,
    activeChannels: [],
    identifyIndex: 0,
    modeIndex: 0,
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
  };
};

const profileOf = (state: SessionState): SessionProfile => PROFILES[state.profileId];

const nothing = (state: SessionState): StepResult => ({
  state,
  writes: [],
  samples: [],
  edges: [],
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
      return {
        command: NGIO_CMD_ID.GET_SENSOR_ID,
        params: getSensorIdParams(profileOf(state).channels[state.identifyIndex].channel),
      };
    case 'enable-channel':
      return {
        command: NGIO_CMD_ID.SET_SENSOR_CHANNEL_ENABLE_MASK,
        params: setChannelEnableMaskParams(state.activeChannels),
      };
    case 'set-period':
      return {
        command: NGIO_CMD_ID.SET_MEASUREMENT_PERIOD,
        params: setMeasurementPeriodParams(ALL_CHANNELS, state.periodSeconds),
      };
    case 'set-sampling-mode': {
      const sensor = findSensor(state.sensorId);
      const fallback =
        profileOf(state).decode === 'edges'
          ? NGIO_SAMPLING_MODE.APERIODIC_EDGE_DETECT
          : NGIO_SAMPLING_MODE.PERIODIC_MOTION_DETECT;
      const mode = sensor ? sensor.samplingMode : fallback;
      const channel = state.activeChannels[state.modeIndex] ?? state.channel;
      return {
        command: NGIO_CMD_ID.SET_SAMPLING_MODE,
        params: setSamplingModeParams(channel, mode),
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
    return nothing({ ...state, phase, pendingCommand: null, retries: 0 });
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
    edges: [],
  };
};

/**
 * Moves to a different phase. Its per-channel counters start over, so a retune
 * that re-sends the sampling modes configures every channel again.
 */
const advanceTo = (state: SessionState, phase: SessionPhase): StepResult =>
  enterPhase({ ...state, identifyIndex: 0, modeIndex: 0 }, phase);

const fail = (state: SessionState, error: string): StepResult =>
  nothing({ ...state, phase: 'failed', pendingCommand: null, error });

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
 * Photogate edges carry no pairing to do: each is the beam being cut or
 * restored on one channel. Which is which, and which gate, is decided in
 * `photogateTiming.ts`, where it can be tested without a session.
 */
const consumeEdges = (state: SessionState, payload: Uint8Array): StepResult => {
  const edges = decodeMeasurementPayload(payload).filter((event) =>
    state.activeChannels.includes(event.channel),
  );
  return {
    state: edges.length > 0 ? { ...state, sampleCount: state.sampleCount + edges.length } : state,
    writes: [],
    samples: [],
    edges,
  };
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
  if (packet.kind !== 'measurement') return nothing(state);
  if (profileOf(state).decode === 'edges') return consumeEdges(state, packet.payload);

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

  return { state: current, writes: [], samples, edges: [] };
};

const consumeResponse = (state: SessionState, packet: NgioPacket): StepResult => {
  if (packet.kind !== 'response') return nothing(state);

  // A streaming session still exchanges commands — the capture shows
  // Graphical Analysis polling GET_SENSOR_ID throughout a run, and we change
  // the sample rate mid-stream. None of those replies may touch the phase or
  // the sample clock, which resetting `originTicks` here would silently do.
  if (state.phase === 'streaming') {
    return nothing(state);
  }

  // Ignore anything that is not the reply we are waiting on. The device also
  // volunteers sensor-ID notifications, which would otherwise advance the
  // handshake a step early.
  if (state.pendingCommand !== null && packet.command !== state.pendingCommand) {
    return nothing(state);
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
    return nothing({ ...state, phase: 'stopped', pendingCommand: null });
  }

  if (state.phase === 'identify-sensor') {
    const profile = profileOf(state);
    const { channel, required } = profile.channels[state.identifyIndex];
    const sensorId = parseSensorIdPayload(packet.payload);

    if (sensorId === 0 && required) {
      return fail(state, profile.describeMissing(channel));
    }

    if (sensorId !== 0 && !profile.accepts(sensorId)) {
      return fail(state, profile.describeWrong(channel, sensorId));
    }

    const identified: SessionState =
      sensorId === 0
        ? state
        : {
            ...state,
            activeChannels: [...state.activeChannels, channel],
            // The first sensor found names the session.
            ...(state.activeChannels.length === 0
              ? { sensorId, sensorName: findSensor(sensorId)?.name ?? profile.fallbackName }
              : {}),
          };

    if (state.identifyIndex + 1 < profile.channels.length) {
      return enterPhase(
        { ...identified, identifyIndex: state.identifyIndex + 1 },
        'identify-sensor',
      );
    }

    return advanceTo(identified, nextPhaseAfter(state.phase));
  }

  // One sampling-mode command per active channel, each waiting on its reply.
  if (state.phase === 'set-sampling-mode' && state.modeIndex + 1 < state.activeChannels.length) {
    return enterPhase({ ...state, modeIndex: state.modeIndex + 1 }, 'set-sampling-mode');
  }

  const nextPhase = nextPhaseAfter(state.phase);

  if (nextPhase === 'streaming') {
    return nothing({
      ...state,
      phase: 'streaming',
      pendingCommand: null,
      retries: 0,
      sampleCount: 0,
      retuning: false,
      pendingPingTicks: null,
      originTicks: null,
    });
  }

  return advanceTo(state, nextPhase);
};

export const step = (state: SessionState, event: SessionEvent): StepResult => {
  if (event.type === 'stop') {
    if (state.phase === 'stopped' || state.phase === 'failed' || state.phase === 'idle') {
      return nothing(state);
    }
    // A stop that lands mid-retune abandons it; what follows is a stop, not a
    // rate change that will come back.
    return advanceTo({ ...state, retuning: false }, 'stopping');
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
      return advanceTo({ ...retuned, retuning: true }, 'retune-stop');
    }

    // Mid-handshake there is nothing to retune; the new period is simply what
    // this session's own 'set-period' step will ask for.
    return nothing(retuned);
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
  const edges: NgioEdgeEvent[] = [];

  for (const packet of packets) {
    if (current.phase === 'failed') break;

    const result =
      packet.kind === 'measurement'
        ? current.phase === 'streaming'
          ? consumeMeasurement(current, packet)
          : nothing(current)
        : consumeResponse(current, packet);

    current = result.state;
    writes.push(...result.writes);
    samples.push(...result.samples);
    edges.push(...result.edges);
  }

  return { state: current, writes, samples, edges };
};

/** Null until a photogate session has identified what is plugged in. */
export const photogateWiring = (state: SessionState): PhotogateWiring | null => {
  if (state.profileId !== 'photogate' || state.activeChannels.length === 0) return null;
  return state.activeChannels.includes(NGIO_CHANNEL_ID.DIGITAL2) ? 'two-port' : 'one-port';
};

/** One-line status for the connect panel. */
export const describePhase = (state: SessionState): string => {
  switch (state.phase) {
    case 'idle':
      return 'Not connected';
    case 'init':
      return 'Waking the interface';
    case 'identify-sensor':
      return profileOf(state).lookingFor;
    case 'enable-channel':
    case 'set-period':
    case 'set-sampling-mode':
      return profileOf(state).configuring;
    case 'starting':
      return 'Starting measurements';
    case 'retune-stop':
      return 'Changing the sample rate';
    case 'streaming': {
      const wiring = photogateWiring(state);
      if (wiring === 'two-port') return 'Photogates ready on DIG 1 and DIG 2';
      if (wiring === 'one-port') return 'Photogate ready on DIG 1 (Gate B daisy-chained)';
      return `Streaming from ${state.sensorName}`;
    }
    case 'stopping':
      return 'Stopping measurements';
    case 'stopped':
      return 'Stopped';
    case 'failed':
      return state.error ?? 'Connection failed';
  }
};
