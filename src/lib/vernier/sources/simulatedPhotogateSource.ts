/**
 * A virtual pair of photogates, for developing and testing without hardware.
 *
 * It emits the same raw edges a LabQuest does — channel, edge byte, 5 MHz
 * capture ticks — so everything downstream, from the beam tracker to the
 * trials table, runs identically on either. One-port wiring is modelled
 * honestly: the two beams share one line, so if the ball is wide enough to
 * cut both at once the line only blocks once, exactly as the real chain does.
 *
 * Hidden from readers (the page shows it only under `?sim`). A lab about
 * measuring a real ball has nothing to teach with a pretend one.
 */

import { NGIO_CHANNEL_ID, NGIO_EDGE_TICK_SECONDS, type NgioEdgeEvent } from '../ngioPackets.ts';
import type { PhotogateWiring } from '../ngioSession.ts';
import { createEmitter, type PhotogateSource, type SourceStatus } from './types.ts';

export interface SimulatedRoll {
  speed: number;
  spacingMeters: number;
  diameterMeters: number;
  /** Standard-ish spread of each edge's timing, in seconds. */
  jitterSeconds?: number;
}

export interface SimulatedPhotogateSource extends PhotogateSource {
  roll: (roll: SimulatedRoll) => void;
  /**
   * Leaves something sitting in a gate's beam, or takes it out. A gate held at
   * the start of a stream is reported blocked, as hardware does — which is how
   * the "connected with the ball in Gate A" fault is reproduced.
   */
  setHeld: (channel: number, blocked: boolean) => void;
  isHeld: (channel: number) => boolean;
}

/** Values the fake edge byte takes. Arbitrary: the beam tracker learns them. */
const BLOCKED = 1;
const CLEAR = 0;

interface Interval {
  from: number;
  to: number;
}

/**
 * The edges one roll produces, as offsets in seconds from the first. Pure, so
 * the tests can check the one-port merge without timers.
 */
export const rollEdges = (
  roll: SimulatedRoll,
  wiring: PhotogateWiring,
  random: () => number = Math.random,
): { channel: number; edge: number; at: number }[] => {
  const jitter = () => (random() - 0.5) * 2 * (roll.jitterSeconds ?? 0);
  const blockTime = roll.diameterMeters / roll.speed;
  const bStart = roll.spacingMeters / roll.speed;

  const a: Interval = { from: 0, to: blockTime + jitter() };
  const b: Interval = { from: bStart + jitter(), to: bStart + blockTime + jitter() };

  if (wiring === 'two-port') {
    return [
      { channel: NGIO_CHANNEL_ID.DIGITAL1, edge: BLOCKED, at: a.from },
      { channel: NGIO_CHANNEL_ID.DIGITAL1, edge: CLEAR, at: a.to },
      { channel: NGIO_CHANNEL_ID.DIGITAL2, edge: BLOCKED, at: b.from },
      { channel: NGIO_CHANNEL_ID.DIGITAL2, edge: CLEAR, at: b.to },
    ].sort((left, right) => left.at - right.at);
  }

  // One line, blocked while either beam is.
  const intervals = b.from <= a.to ? [{ from: a.from, to: b.to }] : [a, b];
  return intervals.flatMap((interval) => [
    { channel: NGIO_CHANNEL_ID.DIGITAL1, edge: BLOCKED, at: interval.from },
    { channel: NGIO_CHANNEL_ID.DIGITAL1, edge: CLEAR, at: interval.to },
  ]);
};

/**
 * The state report a LabQuest sends for each gate when measurements start:
 * one edge per channel at its current level, before anything has passed.
 */
export const initialStateEdges = (
  wiring: PhotogateWiring,
  held: ReadonlySet<number> = new Set(),
): NgioEdgeEvent[] =>
  (wiring === 'two-port'
    ? [NGIO_CHANNEL_ID.DIGITAL1, NGIO_CHANNEL_ID.DIGITAL2]
    : [NGIO_CHANNEL_ID.DIGITAL1]
  ).map((channel) => ({ channel, edge: held.has(channel) ? BLOCKED : CLEAR, ticks: 0 }));

export const createSimulatedPhotogateSource = (
  wiring: PhotogateWiring = 'two-port',
  random: () => number = Math.random,
): SimulatedPhotogateSource => {
  const edges = createEmitter<NgioEdgeEvent>();
  const statuses = createEmitter<SourceStatus>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const held = new Set<number>();
  let started = 0;
  let streaming = false;
  let status: SourceStatus = { kind: 'idle', message: 'Simulated photogates', sensorName: null };

  const setStatus = (next: SourceStatus) => {
    status = next;
    statuses.emit(next);
  };

  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers.clear();
  };

  const readyMessage =
    wiring === 'two-port'
      ? 'Simulated photogates on DIG 1 and DIG 2'
      : 'Simulated photogate on DIG 1 (Gate B daisy-chained)';

  return {
    id: 'simulated',
    label: 'Simulated photogates',
    isReal: false,
    isSupported: () => true,

    connect: async () => {
      setStatus({ kind: 'ready', message: 'Simulated interface ready', sensorName: null });
    },

    start: async () => {
      started = Date.now();
      streaming = true;
      setStatus({ kind: 'streaming', message: readyMessage, sensorName: 'Photogate' });
      initialStateEdges(wiring, held).forEach(edges.emit);
    },

    stop: async () => {
      streaming = false;
      clearTimers();
      setStatus({ kind: 'ready', message: 'Stopped', sensorName: 'Photogate' });
    },

    disconnect: async () => {
      streaming = false;
      clearTimers();
      edges.clear();
      setStatus({ kind: 'idle', message: 'Disconnected', sensorName: null });
      statuses.clear();
    },

    roll: (roll) => {
      if (!streaming) return;
      const origin = (Date.now() - started) / 1000;
      rollEdges(roll, wiring, random).forEach(({ channel, edge, at }) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          const ticks = Math.round((origin + at) / NGIO_EDGE_TICK_SECONDS) >>> 0;
          edges.emit({ channel, edge, ticks });
        }, at * 1000);
        timers.add(timer);
      });
    },

    setHeld: (channel, blocked) => {
      if (held.has(channel) === blocked) return;
      if (blocked) held.add(channel);
      else held.delete(channel);
      if (!streaming) return;
      const ticks = Math.round((Date.now() - started) / 1000 / NGIO_EDGE_TICK_SECONDS) >>> 0;
      edges.emit({ channel, edge: blocked ? BLOCKED : CLEAR, ticks });
    },
    isHeld: (channel) => held.has(channel),

    subscribeEdges: edges.subscribe,
    wiring: () => (streaming ? wiring : null),
    onStatus: statuses.subscribe,

    diagnostics: () => ({
      sourceId: 'simulated',
      sourceLabel: 'Simulated photogates',
      deviceName: 'Virtual photogates',
      vendorId: null,
      productId: null,
      phase: status.kind,
      sensorId: null,
      sensorName: 'Photogate',
      error: null,
      traffic: [],
      notes: [`Simulated ${wiring} wiring.`],
    }),
  };
};
