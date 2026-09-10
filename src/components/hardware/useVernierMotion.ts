/**
 * The one place the Vernier device layer meets React.
 *
 * Same shape as `useVideoFrames`: every imperative concern — picking a source,
 * opening it, subscribing, tearing down on unmount — lives here, and callers
 * get a flat value object. The pure protocol work is in `src/lib/vernier`, so
 * this file holds nothing that needs a test and everything that needs a
 * browser.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDiagnostics } from '../../lib/vernier/diagnostics';
import type { MotionSample } from '../../lib/vernier/motionStream';
import { DEFAULT_PERIOD_SECONDS } from '../../lib/vernier/ngioSession';
import { createSimulatedSource, type SimulatedSource } from '../../lib/vernier/sources/simulatedSource';
import { createWebUsbSource } from '../../lib/vernier/sources/webUsbSource';
import type {
  MotionSource,
  MotionSourceId,
  SourceStatus,
} from '../../lib/vernier/sources/types';
import type { SensorContext } from '../../lib/vernier/sensorIds';

const IDLE_STATUS: SourceStatus = {
  kind: 'idle',
  message: 'No source selected',
  sensorName: null,
};

export interface VernierMotionApi {
  sourceId: MotionSourceId | null;
  /** True only for hardware-backed sources; gates cloud submission. */
  isRealSource: boolean;
  status: SourceStatus;
  latest: MotionSample | null;
  supportsUsb: boolean;
  simulated: SimulatedSource | null;
  selectSource: (id: MotionSourceId) => Promise<void>;
  disconnect: () => Promise<void>;
  startStream: (periodSeconds?: number) => Promise<void>;
  setStreamPeriod: (periodSeconds: number) => Promise<void>;
  stopStream: () => Promise<void>;
  /** Pushes instrument context (air temperature, distance scale) to the source. */
  setSensorContext: (context: SensorContext) => void;
  /** Registers a listener that runs on every sample, outside React state. */
  subscribe: (listener: (sample: MotionSample) => void) => () => void;
  diagnosticsText: () => string;
}

export const useVernierMotion = (): VernierMotionApi => {
  const sourceRef = useRef<MotionSource | null>(null);
  const listenersRef = useRef<((sample: MotionSample) => void)[]>([]);
  const unsubscribeRef = useRef<(() => void)[]>([]);

  const [sourceId, setSourceId] = useState<MotionSourceId | null>(null);
  const [status, setStatus] = useState<SourceStatus>(IDLE_STATUS);
  const [latest, setLatest] = useState<MotionSample | null>(null);

  // Feature detection runs once, in an effect, so the island renders the same
  // markup on the server and on first paint.
  const [support, setSupport] = useState({ usb: false });
  useEffect(() => {
    setSupport({ usb: typeof navigator !== 'undefined' && 'usb' in navigator });
  }, []);

  const simulatedRef = useRef<SimulatedSource | null>(null);

  const teardown = useCallback(async () => {
    unsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
    unsubscribeRef.current = [];

    const current = sourceRef.current;
    sourceRef.current = null;
    simulatedRef.current = null;

    if (current) {
      await current.disconnect().catch(() => {});
    }
  }, []);

  const selectSource = useCallback(
    async (id: MotionSourceId) => {
      await teardown();

      const source: MotionSource =
        id === 'simulated' ? createSimulatedSource() : createWebUsbSource();

      sourceRef.current = source;
      if (id === 'simulated') simulatedRef.current = source as SimulatedSource;
      setSourceId(id);
      setLatest(null);

      unsubscribeRef.current.push(source.onStatus(setStatus));
      unsubscribeRef.current.push(
        source.subscribe((sample) => {
          setLatest(sample);
          // Recording runs off this list rather than off React state: a 20 Hz
          // round is 280 samples, and routing each one through a re-render to
          // reach the recorder would drop samples under load.
          listenersRef.current.forEach((listener) => listener(sample));
        }),
      );

      await source.connect();
    },
    [teardown],
  );

  const disconnect = useCallback(async () => {
    await teardown();
    setSourceId(null);
    setStatus(IDLE_STATUS);
    setLatest(null);
  }, [teardown]);

  const startStream = useCallback(async (periodSeconds = DEFAULT_PERIOD_SECONDS) => {
    await sourceRef.current?.start({ periodSeconds });
  }, []);

  const setStreamPeriod = useCallback(async (periodSeconds: number) => {
    await sourceRef.current?.setPeriod(periodSeconds);
  }, []);

  const stopStream = useCallback(async () => {
    await sourceRef.current?.stop();
  }, []);

  const setSensorContext = useCallback((context: SensorContext) => {
    sourceRef.current?.setSensorContext(context);
  }, []);

  const subscribe = useCallback((listener: (sample: MotionSample) => void) => {
    listenersRef.current.push(listener);
    return () => {
      listenersRef.current = listenersRef.current.filter((entry) => entry !== listener);
    };
  }, []);

  const diagnosticsText = useCallback(() => {
    const source = sourceRef.current;
    if (!source) return 'No source connected.';
    return formatDiagnostics(source.diagnostics());
  }, []);

  // A page navigated away from must not leave a claimed USB device behind.
  useEffect(() => () => void teardown(), [teardown]);

  return useMemo(
    () => ({
      sourceId,
      isRealSource: sourceRef.current?.isReal ?? false,
      status,
      latest,
      supportsUsb: support.usb,
      simulated: simulatedRef.current,
      selectSource,
      disconnect,
      startStream,
      setStreamPeriod,
      stopStream,
      setSensorContext,
      subscribe,
      diagnosticsText,
    }),
    [
      sourceId,
      status,
      latest,
      support.usb,
      selectSource,
      disconnect,
      startStream,
      setStreamPeriod,
      stopStream,
      setSensorContext,
      subscribe,
      diagnosticsText,
    ],
  );
};
