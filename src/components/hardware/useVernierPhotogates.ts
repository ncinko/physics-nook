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
import { formatDiagnostics } from '../../lib/vernier/diagnostics';
import type { PhotogateWiring } from '../../lib/vernier/ngioSession';
import {
  createGateInterpreter,
  isPlausiblePass,
  type GateTransition,
  type Transit,
} from '../../lib/vernier/photogateTiming';
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

/**
 * The edge level a photogate reads as clear, once a real pass has proved it.
 * Polarity is a property of the hardware, not of one gate or one session, so
 * a value confirmed once holds for every later connect on this browser.
 */
const POLARITY_KEY = 'physics-nook:photogate-clear-level';

const readPolarity = (): number | undefined => {
  try {
    const stored = window.localStorage.getItem(POLARITY_KEY);
    const value = stored === null ? Number.NaN : Number(stored);
    return Number.isInteger(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

const writePolarity = (value: number) => {
  try {
    window.localStorage.setItem(POLARITY_KEY, String(value));
  } catch {
    // Without storage, every connect relearns from the start-of-stream report.
  }
};

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
  /** Remembers the polarity in use if `transit` proves it right. */
  confirmPass: (transit: Transit) => void;
  /**
   * The software version of unplugging and replugging: release the interface,
   * reconnect to it without the picker, and start a fresh session.
   */
  resetGates: () => Promise<void>;
  diagnosticsText: () => string;
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
            interpretRef.current = detected
              ? createGateInterpreter(detected, { clearValue: readPolarity() })
              : null;
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

  const resetGates = useCallback(async () => {
    const source = sourceRef.current;
    if (!source || !sourceId) return;

    // The simulator keeps its own state (a ball left in a gate), which a new
    // instance would forget; restarting its stream is its whole replug.
    if (source.id === 'simulated') {
      await source.stop();
      await source.start();
      return;
    }
    await selectSource(sourceId);
  }, [selectSource, sourceId]);

  const confirmPass = useCallback((transit: Transit) => {
    const clearValues = [...(interpretRef.current?.clearValues().values() ?? [])];
    if (!isPlausiblePass(transit) || clearValues.length === 0) return;
    if (clearValues.some((value) => value !== clearValues[0])) return;
    if (readPolarity() !== clearValues[0]) writePolarity(clearValues[0]);
  }, []);

  const subscribe = useCallback((listener: (transition: GateTransition) => void) => {
    listenersRef.current.push(listener);
    return () => {
      listenersRef.current = listenersRef.current.filter((entry) => entry !== listener);
    };
  }, []);

  const diagnosticsText = useCallback(() => {
    const source = sourceRef.current;
    if (!source) return 'No source connected.';
    const snapshot = source.diagnostics();
    const learned = [...(interpretRef.current?.clearValues() ?? [])]
      .map(([channel, value]) => `channel ${channel} clear at edge value ${value}`)
      .join('; ');
    const stored = readPolarity();
    return formatDiagnostics({
      ...snapshot,
      notes: [
        ...snapshot.notes,
        `Photogate wiring: ${wiring ?? 'unknown'}.`,
        `Clear levels this session: ${learned || 'none seen yet'}.`,
        `Confirmed clear level on this browser: ${stored ?? 'none yet'}.`,
      ],
    });
  }, [wiring]);

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
      confirmPass,
      resetGates,
      diagnosticsText,
    }),
    [
      sourceId,
      status,
      supportsUsb,
      wiring,
      beams,
      streamId,
      simulated,
      selectSource,
      disconnect,
      subscribe,
      confirmPass,
      resetGates,
      diagnosticsText,
    ],
  );
};
