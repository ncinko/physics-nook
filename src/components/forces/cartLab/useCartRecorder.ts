/**
 * Recording a cart run off the motion detector.
 *
 * The pure protocol work is in `src/lib/vernier`; this is the browser half, laid
 * out the way `MotionMatchGame` lays out the same job: sensor context pushed on
 * calibration change, the stream opened by `decideStream` the moment a detector
 * connects, and samples captured through `device.subscribe` into refs rather than
 * through React state, because a 20 Hz stream routed through re-renders drops
 * samples under load.
 *
 * One departure from the game. The game idles the detector between rounds and
 * retunes it for each recording, which re-zeroes the device's capture clock. A
 * lab recording is started by a person watching the cart, so here the stream
 * simply runs at the chosen rate whenever a detector is connected. Starting a
 * run is then only a flag, with no retune for the first samples to race, and
 * Disconnect is what silences the detector.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CartSample } from '../../../lib/forces/cartRun';
import { fillDropouts, type MotionSample } from '../../../lib/vernier/motionStream';
import { DEFAULT_SENSOR_CONTEXT } from '../../../lib/vernier/sensorIds';
import { decideStream } from '../../../lib/vernier/streamPolicy';
import { useVernierMotion, type VernierMotionApi } from '../../hardware/useVernierMotion';
import {
  useDetectorCalibration,
  type DetectorCalibration,
} from '../../hardware/useDetectorCalibration';

/** Pings per second the lab offers. 20 Hz is the sensor manual's optimum and 30 Hz its ceiling. */
export const SAMPLE_RATES_HZ = [10, 20, 30] as const;
export const DEFAULT_RATE_HZ = 20;
export const DURATIONS_SECONDS = [3, 5, 8, 10] as const;
export const DEFAULT_DURATION_SECONDS = 5;

/** How often the live graph refreshes while recording. */
const LIVE_REFRESH_MS = 100;
/** Past the chosen duration on the wall clock, a stalled sensor still ends the run. */
const WALL_CLOCK_GRACE_SECONDS = 1.5;
/** Fewer good samples than this cannot make a velocity, let alone a line. */
const MIN_GOOD_SAMPLES = 3;

export interface FinishedRecording {
  samples: CartSample[];
  periodSeconds: number;
  distanceScale: number;
}

export interface CartRecorder {
  device: VernierMotionApi;
  calibration: DetectorCalibration;
  rateHz: number;
  setRateHz: (rate: number) => void;
  durationSeconds: number;
  setDurationSeconds: (seconds: number) => void;
  connected: boolean;
  hasEcho: boolean;
  recording: boolean;
  /** The run in progress, for the live graph; empty when idle. */
  live: CartSample[];
  /** Seconds recorded so far. */
  elapsed: number;
  /** Why the last recording produced nothing, or null. */
  problem: string | null;
  start: () => void;
  stop: () => void;
}

const toCartSamples = (samples: readonly MotionSample[]): CartSample[] =>
  samples.map((sample) => ({
    t: sample.t,
    x: sample.quality === 'ok' ? sample.distance : 0,
    ok: sample.quality === 'ok',
  }));

export const useCartRecorder = (
  onFinished: (recording: FinishedRecording) => void,
): CartRecorder => {
  const device = useVernierMotion();
  const calibration = useDetectorCalibration();

  const [rateHz, setRateHz] = useState<number>(DEFAULT_RATE_HZ);
  const [durationSeconds, setDurationSeconds] = useState<number>(DEFAULT_DURATION_SECONDS);
  const [recording, setRecording] = useState(false);
  const [live, setLive] = useState<CartSample[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  const bufferRef = useRef<MotionSample[]>([]);
  const offsetRef = useRef<number | null>(null);
  const recordingRef = useRef(false);
  const wallStartRef = useRef(0);
  const scaleAtStartRef = useRef(calibration.scale);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const periodSeconds = 1 / rateHz;
  const periodRef = useRef(periodSeconds);
  periodRef.current = periodSeconds;

  // --- calibration ---------------------------------------------------------

  // Destructured because the hook's value object is rebuilt on every sample.
  const { setSensorContext, startStream, setStreamPeriod, subscribe } = device;
  const sourceId = device.sourceId;
  const statusKind = device.status.kind;
  const calibrationScale = calibration.scale;
  useEffect(() => {
    // `sourceId` is a dependency because a freshly constructed source starts at
    // the default context and has to be told again.
    setSensorContext({ ...DEFAULT_SENSOR_CONTEXT, distanceScale: calibrationScale });
  }, [calibrationScale, sourceId, setSensorContext]);

  // --- stream --------------------------------------------------------------

  /** The source a stream was last opened for, if any. */
  const streamedSourceRef = useRef<string | null>(null);
  /** What the open stream is running at, or null when none is open. */
  const appliedPeriodRef = useRef<number | null>(null);

  useEffect(() => {
    const decision = decideStream(sourceId, statusKind, streamedSourceRef.current);

    if (decision === 'forget') {
      streamedSourceRef.current = null;
      appliedPeriodRef.current = null;
      return;
    }
    if (decision === 'wait') return;

    streamedSourceRef.current = sourceId;
    appliedPeriodRef.current = periodRef.current;
    void startStream(periodRef.current);
  }, [sourceId, statusKind, startStream]);

  // Rate changes are their own effect so a status transition cannot trigger one.
  // A retune costs a stop/start round trip on the device, so asking for the rate
  // already in force has to be free.
  useEffect(() => {
    if (streamedSourceRef.current === null) return;
    if (appliedPeriodRef.current === periodSeconds) return;
    appliedPeriodRef.current = periodSeconds;
    void setStreamPeriod(periodSeconds);
  }, [periodSeconds, sourceId, statusKind, setStreamPeriod]);

  // --- capture -------------------------------------------------------------

  useEffect(
    () =>
      subscribe((sample) => {
        if (!recordingRef.current) return;
        // Timestamps stay on the device clock, rezeroed at the first sample of
        // the run. Arrival time would fold USB jitter into every velocity.
        if (offsetRef.current === null) offsetRef.current = sample.t;
        bufferRef.current.push({ ...sample, t: sample.t - offsetRef.current });
      }),
    [subscribe],
  );

  const finish = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    setLive([]);

    const captured = bufferRef.current;
    bufferRef.current = [];
    const filled = toCartSamples(fillDropouts(captured));
    if (filled.filter((sample) => sample.ok).length < MIN_GOOD_SAMPLES) {
      setProblem('No usable readings were recorded. Check that the detector can see the cart, then try again.');
      return;
    }
    setProblem(null);
    onFinishedRef.current({
      samples: filled,
      periodSeconds: periodRef.current,
      distanceScale: scaleAtStartRef.current,
    });
  }, []);

  const connected = statusKind === 'ready' || statusKind === 'streaming';
  const hasEcho = device.latest?.quality === 'ok';

  const start = useCallback(() => {
    if (recordingRef.current) return;
    bufferRef.current = [];
    offsetRef.current = null;
    scaleAtStartRef.current = calibrationScale;
    wallStartRef.current = Date.now();
    recordingRef.current = true;
    setProblem(null);
    setElapsed(0);
    setLive([]);
    setRecording(true);
  }, [calibrationScale]);

  // The recording clock: refresh the live graph, and end the run on the device
  // clock, with the wall clock as a backstop.
  useEffect(() => {
    if (!recording) return undefined;
    const timer = window.setInterval(() => {
      const captured = bufferRef.current;
      const deviceElapsed = captured.length > 0 ? captured[captured.length - 1].t : 0;
      setElapsed(Math.min(deviceElapsed, durationSeconds));
      setLive(toCartSamples(captured));

      const wallElapsed = (Date.now() - wallStartRef.current) / 1000;
      if (deviceElapsed >= durationSeconds || wallElapsed >= durationSeconds + WALL_CLOCK_GRACE_SECONDS) {
        finish();
      }
    }, LIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [recording, durationSeconds, finish]);

  // A detector that goes away mid-run ends the run with whatever it had.
  useEffect(() => {
    if (!connected) finish();
  }, [connected, finish]);

  return {
    device,
    calibration,
    rateHz,
    setRateHz,
    durationSeconds,
    setDurationSeconds,
    connected,
    hasEcho,
    recording,
    live,
    elapsed,
    problem,
    start,
    stop: finish,
  };
};
