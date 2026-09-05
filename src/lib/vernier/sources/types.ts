/**
 * The adapter every motion source implements.
 *
 * The point of the interface is that the game never learns which one it got.
 * A LabQuest Mini over WebHID, the same interface over WebUSB, and the
 * keyboard-driven practice walker all deliver the same `MotionSample` stream,
 * so adding a future Vernier activity means writing a source and a sensor
 * definition, not touching the game.
 */

import type { MotionSample } from '../motionStream.ts';
import type { DiagnosticsSnapshot } from '../diagnostics.ts';

export type MotionSourceId = 'webhid' | 'webusb' | 'practice';

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
   * practice run is a full game but it never reaches the cloud board, because
   * a board mixing mouse runs with walking runs would rank the wrong thing.
   */
  readonly isReal: boolean;
  /** False when the browser lacks the API this source needs. */
  isSupported: () => boolean;
  /** Must be called from a user gesture — both WebHID and WebUSB require it. */
  connect: () => Promise<void>;
  start: (options?: StartOptions) => Promise<void>;
  stop: () => Promise<void>;
  disconnect: () => Promise<void>;
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
