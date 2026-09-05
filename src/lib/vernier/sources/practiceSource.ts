/**
 * A virtual walker, for playing without a motion detector attached.
 *
 * Not a shortcut: it models the two things that make the real game hard. A
 * person cannot teleport, so the walker accelerates toward where you point it
 * and is speed-capped at a brisk walk; and a sonar is noisy, so readings carry
 * a millimetre or two of jitter and occasionally drop a ping. Practising here
 * teaches the same anticipation the real detector demands.
 *
 * It is also how the game gets tested. Everything downstream — the recording
 * loop, scoring, retries, the local board — runs identically whether the
 * samples came from here or from a LabQuest Mini.
 *
 * Practice runs never reach the cloud leaderboard; `isReal` is false.
 */

import { MOTION_DETECTOR_RANGE } from '../sensorIds.ts';
import type { MotionSample } from '../motionStream.ts';
import { createEmitter, type MotionSource, type SourceStatus, type StartOptions } from './types.ts';

export interface WalkerState {
  position: number;
  velocity: number;
}

export interface WalkerOptions {
  /** Brisk walk. The targets never ask for more than 0.4 m/s. */
  maxSpeed: number;
  /** How hard the walker pulls toward the pointer, in 1/s. */
  responsiveness: number;
  /** Standard deviation of the simulated sonar noise, in metres. */
  noiseMeters: number;
  /** Probability per sample that the detector returns nothing. */
  dropoutRate: number;
}

export const DEFAULT_WALKER_OPTIONS: WalkerOptions = {
  maxSpeed: 1.2,
  responsiveness: 3.5,
  noiseMeters: 0.0015,
  dropoutRate: 0.003,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Advances the walker one tick toward `target`. Pure, so the feel of the
 * practice mode can be tuned against tests rather than by eye.
 */
export const stepWalker = (
  state: WalkerState,
  target: number,
  dt: number,
  options: WalkerOptions = DEFAULT_WALKER_OPTIONS,
): WalkerState => {
  const desired = clamp(
    (target - state.position) * options.responsiveness,
    -options.maxSpeed,
    options.maxSpeed,
  );

  // First-order approach to the desired velocity rather than a jump to it, so
  // the trace has the rounded corners a real walker produces.
  const velocity = state.velocity + (desired - state.velocity) * clamp(dt * 8, 0, 1);
  const position = clamp(
    state.position + velocity * dt,
    MOTION_DETECTOR_RANGE.minMeters,
    MOTION_DETECTOR_RANGE.maxMeters,
  );

  return { position, velocity };
};

export interface PracticeSource extends MotionSource {
  /** Where the player is pointing, in metres from the detector. */
  setTarget: (distance: number) => void;
  getTarget: () => number;
  /** Drops the walker straight onto a mark, for the pre-round setup step. */
  reset: (distance: number) => void;
}

export interface PracticeSourceOptions {
  walker?: Partial<WalkerOptions>;
  random?: () => number;
  startDistance?: number;
}

export const createPracticeSource = (options: PracticeSourceOptions = {}): PracticeSource => {
  const walkerOptions = { ...DEFAULT_WALKER_OPTIONS, ...options.walker };
  const random = options.random ?? Math.random;

  const samples = createEmitter<MotionSample>();
  const statuses = createEmitter<SourceStatus>();

  let state: WalkerState = { position: options.startDistance ?? 0.7, velocity: 0 };
  let target = state.position;
  let timer: ReturnType<typeof setInterval> | null = null;
  let elapsed = 0;
  let status: SourceStatus = {
    kind: 'idle',
    message: 'Practice mode — no detector needed',
    sensorName: 'Virtual walker',
  };

  const setStatus = (next: SourceStatus) => {
    status = next;
    statuses.emit(next);
  };

  const stopTimer = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  return {
    id: 'practice',
    label: 'Practice mode (no detector)',
    isReal: false,
    isSupported: () => true,

    connect: async () => {
      setStatus({
        kind: 'ready',
        message: 'Practice mode ready',
        sensorName: 'Virtual walker',
      });
    },

    start: async ({ periodSeconds = 0.05 }: StartOptions = {}) => {
      stopTimer();
      elapsed = 0;

      // setInterval rather than requestAnimationFrame: the sample clock should
      // follow the requested period, not the display refresh, and a background
      // tab throttling rAF to zero would silently stop a recording.
      timer = setInterval(() => {
        state = stepWalker(state, target, periodSeconds, walkerOptions);

        const dropped = random() < walkerOptions.dropoutRate;
        const noise = (random() - 0.5) * 2 * walkerOptions.noiseMeters;

        samples.emit({
          t: elapsed,
          distance: dropped ? 0 : state.position + noise,
          quality: dropped ? 'dropout' : 'ok',
        });

        elapsed += periodSeconds;
      }, periodSeconds * 1000);

      setStatus({ kind: 'streaming', message: 'Practice mode running', sensorName: 'Virtual walker' });
    },

    stop: async () => {
      stopTimer();
      setStatus({ kind: 'ready', message: 'Practice mode ready', sensorName: 'Virtual walker' });
    },

    disconnect: async () => {
      stopTimer();
      samples.clear();
      setStatus({ kind: 'idle', message: 'Practice mode stopped', sensorName: null });
      statuses.clear();
    },

    subscribe: samples.subscribe,
    onStatus: statuses.subscribe,

    setTarget: (distance: number) => {
      target = clamp(distance, MOTION_DETECTOR_RANGE.minMeters, MOTION_DETECTOR_RANGE.maxMeters);
    },
    getTarget: () => target,
    reset: (distance: number) => {
      state = { position: distance, velocity: 0 };
      target = distance;
      elapsed = 0;
    },

    diagnostics: () => ({
      sourceId: 'practice',
      sourceLabel: 'Practice mode (no detector)',
      deviceName: 'Virtual walker',
      vendorId: null,
      productId: null,
      collections: [],
      framing: null,
      phase: status.kind,
      sensorId: null,
      sensorName: 'Virtual walker',
      error: null,
      traffic: [],
      notes: ['Simulated source. Scores stay on this device and cannot be posted to the cloud board.'],
    }),
  };
};
