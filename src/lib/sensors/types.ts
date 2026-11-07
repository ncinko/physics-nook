/**
 * Shared shapes for the universal sensor lab. DOM-free.
 *
 * A run is column-oriented: one shared time axis and one value array per
 * channel. Every channel in a run was sampled on the same clock, so a channel
 * never carries its own times.
 */

export interface SensorChannel {
  /** Stable key within a session, e.g. "ch1". */
  id: string;
  /** Display name, e.g. "Dual-Range Force". */
  name: string;
  /** Physical unit of the values, e.g. "N". */
  unit: string;
  /** Short quantity word used in axis labels, e.g. "Force". */
  quantity: string;
}

export interface SensorRun {
  id: string;
  label: string;
  createdAt: number;
  channels: SensorChannel[];
  /** Seconds from the start of the run. */
  t: number[];
  /** values[channelIndex][sampleIndex], same length as `t`. */
  values: number[][];
}

export interface SensorSample {
  /** Seconds on the source's own clock. */
  t: number;
  /** Channel id -> value in the channel's unit. */
  channels: Record<string, number>;
}

export interface TimeRange {
  min: number;
  max: number;
}
