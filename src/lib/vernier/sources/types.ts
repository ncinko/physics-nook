/**
 * The adapter every motion source implements.
 *
 * The point of the interface is that the game never learns which one it got.
 * A LabQuest Mini over WebUSB and the keyboard-driven simulated walker both
 * deliver the same `MotionSample` stream, so adding a future Vernier activity
 * means writing a source and a sensor definition, not touching the game.
 */

import type { MotionSample } from '../motionStream.ts';
import type { DiagnosticsSnapshot } from '../diagnostics.ts';
import type { SensorContext } from '../sensorIds.ts';

export type MotionSourceId = 'webusb' | 'simulated';

export type SourceStatusKind =
  | 'unsupported'
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'streaming'
  | 'error';

export interface SourceStatus {
  kind: SourceStatusKind;
  message: string;
  sensorName: string | null;
}

export interface StartOptions {
  periodSeconds?: number;
}

export interface MotionSource {
  readonly id: MotionSourceId;
  readonly label: string;
  /**
   * True for sources backed by real hardware. The leaderboard checks this: a
   * simulated run is a full game but it never reaches the cloud board, because
   * a board mixing mouse runs with walking runs would rank the wrong thing.
   *
   * Not the only gate. Practice mode runs on real hardware and is equally
   * unpostable, for a different reason: it never mints a server run token.
   */
  readonly isReal: boolean;
  /** False when the browser lacks the API this source needs. */
  isSupported: () => boolean;
  /** Must be called from a user gesture — WebUSB requires it. */
  connect: () => Promise<void>;
  start: (options?: StartOptions) => Promise<void>;
  /**
   * Retunes the sample rate on a running stream. Separate from `start` so the
   * game can idle the detector at one ping a second between rounds without
   * tearing the session down and re-running the whole handshake.
   */
  setPeriod: (periodSeconds: number) => Promise<void>;
  stop: () => Promise<void>;
  disconnect: () => Promise<void>;
  /**
   * Instrument context — air temperature, and the one-point distance scale the
   * calibrate screen sets. Synchronous on purpose: correcting a reading is
   * arithmetic on the next sample, not a device round trip, so it must not cost
   * a stream restart (which would re-zero the device's capture clock).
   */
  setSensorContext: (context: SensorContext) => void;
  subscribe: (listener: (sample: MotionSample) => void) => () => void;
  onStatus: (listener: (status: SourceStatus) => void) => () => void;
  diagnostics: () => DiagnosticsSnapshot;
}

/** Minimal listener bookkeeping shared by every source. */
export const createEmitter = <T>() => {
  let listeners: ((value: T) => void)[] = [];

  return {
    subscribe: (listener: (value: T) => void) => {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((entry) => entry !== listener);
      };
    },
    emit: (value: T) => {
      listeners.forEach((listener) => listener(value));
    },
    clear: () => {
      listeners = [];
    },
  };
};
