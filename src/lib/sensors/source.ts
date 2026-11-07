/**
 * The adapter every sensor-lab data source implements. DOM-free.
 *
 * The lab never learns whether samples come from a LabQuest or from the
 * simulated source: both deliver `SensorSample`s on the channels they report.
 * A hardware source announces its channels after the interface has identified
 * what is plugged in, so `subscribeChannels` fires once per (re)detection.
 */

import { createEmitter } from '../vernier/sources/types.ts';
import type { SensorChannel, SensorSample } from './types.ts';

export type SensorSourceId = 'simulated' | 'webusb';

export type SensorStatusKind = 'unsupported' | 'idle' | 'connecting' | 'ready' | 'streaming' | 'error';

export interface SensorSourceStatus {
  kind: SensorStatusKind;
  message: string;
}

export interface SensorSource {
  readonly id: SensorSourceId;
  readonly label: string;
  readonly isReal: boolean;
  channels: () => SensorChannel[];
  connect: () => Promise<void>;
  start: (periodSeconds: number) => Promise<void>;
  stop: () => Promise<void>;
  disconnect: () => Promise<void>;
  subscribe: (listener: (sample: SensorSample) => void) => () => void;
  subscribeChannels: (listener: (channels: SensorChannel[]) => void) => () => void;
  onStatus: (listener: (status: SensorSourceStatus) => void) => () => void;
}

export { createEmitter };
