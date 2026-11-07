/**
 * A made-up LabQuest for trying the lab without hardware. DOM-free apart from
 * timers.
 *
 * Two channels are reported, shaped like what a student would meet:
 *   - Force: a quiet baseline with a half-sine bump (a cart bumping the sensor)
 *     every three seconds.
 *   - Position: a slow sinusoid, like a hand moving a cart back and forth.
 * Timers drive it rather than requestAnimationFrame so it keeps running in a
 * background tab, as a real stream would.
 */

import {
  createEmitter,
  type SensorSource,
  type SensorSourceStatus,
} from './source.ts';
import type { SensorChannel, SensorSample } from './types.ts';

export const SIMULATED_CHANNELS: SensorChannel[] = [
  { id: 'sim-force', name: 'Simulated Force', unit: 'N', quantity: 'Force' },
  { id: 'sim-position', name: 'Simulated Position', unit: 'm', quantity: 'Position' },
];

export const BUMP_PERIOD_S = 3;
export const BUMP_WIDTH_S = 0.3;
export const BUMP_PEAK_N = 8;

/** Deterministic part of the signal, separate from noise so tests can pin it. */
export const simulatedSignal = (t: number): { force: number; position: number } => {
  const phase = t % BUMP_PERIOD_S;
  const force =
    phase < BUMP_WIDTH_S ? BUMP_PEAK_N * Math.sin((Math.PI * phase) / BUMP_WIDTH_S) : 0;
  return { force, position: 1 + 0.5 * Math.sin(2 * Math.PI * 0.4 * t) };
};

export const createSimulatedSource = (): SensorSource => {
  const samples = createEmitter<SensorSample>();
  const statuses = createEmitter<SensorSourceStatus>();
  const channelEvents = createEmitter<SensorChannel[]>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let connected = false;

  const clear = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  return {
    id: 'simulated',
    label: 'Simulated sensors',
    isReal: false,
    channels: () => (connected ? SIMULATED_CHANNELS : []),

    connect: async () => {
      connected = true;
      statuses.emit({ kind: 'ready', message: 'Simulated force and position sensors' });
      channelEvents.emit(SIMULATED_CHANNELS);
    },

    start: async (periodSeconds) => {
      clear();
      const origin = performance.now();
      timer = setInterval(
        () => {
          const t = (performance.now() - origin) / 1000;
          const { force, position } = simulatedSignal(t);
          samples.emit({
            t,
            channels: {
              'sim-force': force + (Math.random() - 0.5) * 0.06,
              'sim-position': position + (Math.random() - 0.5) * 0.004,
            },
          });
        },
        Math.max(5, periodSeconds * 1000),
      );
      statuses.emit({ kind: 'streaming', message: 'Streaming simulated data' });
    },

    stop: async () => {
      clear();
      if (connected) statuses.emit({ kind: 'ready', message: 'Stopped' });
    },

    disconnect: async () => {
      clear();
      connected = false;
      statuses.emit({ kind: 'idle', message: 'Disconnected' });
    },

    subscribe: samples.subscribe,
    subscribeChannels: channelEvents.subscribe,
    onStatus: statuses.subscribe,
  };
};
