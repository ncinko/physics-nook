/**
 * The photogate counterpart of `useVernierMotion`: picks a source, opens it,
 * and hands back beam transitions already sorted into Gate A, Gate B, or the
 * shared one-port line.
 *
 * Photogates are quiet until something passes, so the stream is started as
 * soon as the interface is claimed; there is no separate "start" for the page
 * to remember.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PhotogateWiring } from '../../lib/vernier/ngioSession';
import { createGateInterpreter, type GateTransition } from '../../lib/vernier/photogateTiming';
import {
  createSimulatedPhotogateSource,
  type SimulatedPhotogateSource,
} from '../../lib/vernier/sources/simulatedPhotogateSource';
import type {
  MotionSourceId,
  PhotogateSource,
  SourceStatus,
} from '../../lib/vernier/sources/types';
import { createWebUsbPhotogateSource } from '../../lib/vernier/sources/webUsbPhotogateSource';
import type { ConnectableDevice } from './DeviceConnectPanel';

const IDLE_STATUS: SourceStatus = { kind: 'idle', message: 'Not connected', sensorName: null };

export type Beams = Record<GateTransition['gate'], boolean>;

const CLEAR_BEAMS: Beams = { A: false, B: false, line: false };

export interface VernierPhotogatesApi extends ConnectableDevice {
  isRealSource: boolean;
  wiring: PhotogateWiring | null;
  /** True where a beam is currently cut. */
  beams: Beams;
  /** Bumped on every stream start: device time restarts, so passes in flight are void. */
  streamId: number;
  simulated: SimulatedPhotogateSource | null;
  /** Runs on every transition, outside React state. */
  subscribe: (listener: (transition: GateTransition) => void) => () => void;
}

export const useVernierPhotogates = (
  simulatedWiring: PhotogateWiring = 'two-port',
): VernierPhotogatesApi => {
  const sourceRef = useRef<PhotogateSource | null>(null);
  const listenersRef = useRef<((transition: GateTransition) => void)[]>([]);
  const unsubscribeRef = useRef<(() => void)[]>([]);
  const interpretRef = useRef<ReturnType<typeof createGateInterpreter> | null>(null);

  const [sourceId, setSourceId] = useState<MotionSourceId | null>(null);
  const [status, setStatus] = useState<SourceStatus>(IDLE_STATUS);
  const [wiring, setWiring] = useState<PhotogateWiring | null>(null);
  const [beams, setBeams] = useState<Beams>(CLEAR_BEAMS);
  const [streamId, setStreamId] = useState(0);
  const [simulated, setSimulated] = useState<SimulatedPhotogateSource | null>(null);

  const [supportsUsb, setSupportsUsb] = useState(false);
  useEffect(() => {
    setSupportsUsb(typeof navigator !== 'undefined' && 'usb' in navigator);
  }, []);

  const teardown = useCallback(async () => {
    unsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
    unsubscribeRef.current = [];
    interpretRef.current = null;

    const current = sourceRef.current;
    sourceRef.current = null;
    setSimulated(null);

    if (current) await current.disconnect().catch(() => {});
  }, []);

  const selectSource = useCallback(
    async (id: MotionSourceId) => {
      await teardown();

      const source =
        id === 'simulated'
          ? createSimulatedPhotogateSource(simulatedWiring)
          : createWebUsbPhotogateSource();
      sourceRef.current = source;
      setSourceId(id);
      setWiring(null);
      setBeams(CLEAR_BEAMS);
      if (id === 'simulated') setSimulated(source as SimulatedPhotogateSource);

      // An object, not a let: the status callback writes it and TypeScript cannot
      // see a closure's write when narrowing the read after `connect`.
      const last: { kind: SourceStatus['kind'] } = { kind: 'idle' };
      unsubscribeRef.current.push(
        source.onStatus((next) => {
          setStatus(next);
          if (next.kind === 'streaming' && last.kind !== 'streaming') {
            const detected = source.wiring();
            setWiring(detected);
            setBeams(CLEAR_BEAMS);
            interpretRef.current = detected ? createGateInterpreter(detected) : null;
            setStreamId((value) => value + 1);
          }
          last.kind = next.kind;
        }),
      );
      unsubscribeRef.current.push(
        source.subscribeEdges((edge) => {
          const interpret = interpretRef.current;
          if (!interpret) return;
          const transition = interpret(edge);
          setBeams((current) => ({ ...current, [transition.gate]: transition.blocked }));
          listenersRef.current.forEach((listener) => listener(transition));
        }),
      );

      await source.connect();
      if (sourceRef.current === source && last.kind === 'ready') await source.start();
    },
    [simulatedWiring, teardown],
  );

  const disconnect = useCallback(async () => {
    await teardown();
    setSourceId(null);
    setStatus(IDLE_STATUS);
    setWiring(null);
    setBeams(CLEAR_BEAMS);
  }, [teardown]);

  const subscribe = useCallback((listener: (transition: GateTransition) => void) => {
    listenersRef.current.push(listener);
    return () => {
      listenersRef.current = listenersRef.current.filter((entry) => entry !== listener);
    };
  }, []);

  // A page navigated away from must not leave a claimed USB device behind.
  useEffect(() => () => void teardown(), [teardown]);

  return useMemo(
    () => ({
      sourceId,
      isRealSource: sourceRef.current?.isReal ?? false,
      status,
      supportsUsb,
      wiring,
      beams,
      streamId,
      simulated,
      selectSource,
      disconnect,
      subscribe,
    }),
    [sourceId, status, supportsUsb, wiring, beams, streamId, simulated, selectSource, disconnect, subscribe],
  );
};
