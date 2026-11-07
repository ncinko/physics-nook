/**
 * Recording mechanics: taring, triggering, run assembly. DOM-free.
 *
 * Samples arrive from a source as `{t, channels}`. A recorder buffers them in a
 * plain object (not React state, since the stream can run at tens of Hz) and
 * freezes the buffer into a `SensorRun` when stopped.
 */

import type { SensorChannel, SensorRun, SensorSample } from './types.ts';

export type TriggerMode = 'immediate' | 'rising' | 'falling';

export interface TriggerConfig {
  mode: TriggerMode;
  channelId: string;
  level: number;
}

export interface RecorderOptions {
  channels: SensorChannel[];
  trigger?: TriggerConfig;
  /** Seconds of history kept before a trigger fires. */
  preTriggerSeconds?: number;
  /** Stop automatically this long after the first kept sample. Null = manual. */
  durationSeconds?: number | null;
}

export interface Recorder {
  push: (sample: SensorSample) => void;
  /** True once triggered; samples before that are only pre-trigger history. */
  triggered: () => boolean;
  /** True once `durationSeconds` has elapsed. */
  finished: () => boolean;
  count: () => number;
  /** Latest value of every channel, for live display during a run. */
  snapshot: () => SensorSample | null;
  finish: (label: string, id: string, createdAt: number) => SensorRun;
}

export const createRecorder = ({
  channels,
  trigger = { mode: 'immediate', channelId: '', level: 0 },
  preTriggerSeconds = 0,
  durationSeconds = null,
}: RecorderOptions): Recorder => {
  const samples: SensorSample[] = [];
  let fired = trigger.mode === 'immediate';
  let done = false;
  let previous: number | null = null;
  let last: SensorSample | null = null;

  const crossed = (value: number): boolean => {
    if (previous === null) return false;
    if (trigger.mode === 'rising') return previous < trigger.level && value >= trigger.level;
    if (trigger.mode === 'falling') return previous > trigger.level && value <= trigger.level;
    return true;
  };

  return {
    push: (sample) => {
      if (done) return;
      last = sample;

      if (!fired) {
        const value = sample.channels[trigger.channelId];
        const hit = Number.isFinite(value) && crossed(value);
        if (Number.isFinite(value)) previous = value;
        samples.push(sample);
        // Keep only the pre-trigger window while waiting.
        const cutoff = sample.t - preTriggerSeconds;
        while (samples.length > 1 && samples[0].t < cutoff) samples.shift();
        if (hit) fired = true;
        else return;
      } else {
        samples.push(sample);
      }

      if (durationSeconds !== null && samples.length > 0) {
        const start = samples[0].t;
        if (sample.t - start >= durationSeconds) done = true;
      }
    },
    triggered: () => fired,
    finished: () => done,
    count: () => (fired ? samples.length : 0),
    snapshot: () => last,
    finish: (label, id, createdAt) => {
      const kept = fired ? samples : [];
      const origin = kept.length > 0 ? kept[0].t : 0;
      return {
        id,
        label,
        createdAt,
        channels,
        t: kept.map((sample) => sample.t - origin),
        values: channels.map((channel) =>
          kept.map((sample) => sample.channels[channel.id] ?? NaN),
        ),
      };
    },
  };
};

/**
 * Tare offsets: subtract the average of a short burst of readings so the
 * channel reads zero. Returns the offset to subtract from future values.
 */
export const tareOffset = (readings: readonly number[]): number => {
  const finite = readings.filter(Number.isFinite);
  return finite.length === 0 ? 0 : finite.reduce((sum, value) => sum + value, 0) / finite.length;
};

/** "Run 4" after "Run 3", whatever earlier runs have since been renamed to. */
export const nextRunLabel = (runs: readonly { label: string }[]): string => {
  const numbers = runs
    .map((run) => /^Run (\d+)$/.exec(run.label))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]));
  return `Run ${numbers.length === 0 ? 1 : Math.max(...numbers) + 1}`;
};
