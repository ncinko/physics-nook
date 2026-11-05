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
 * The detector's duty cycle follows what the page is doing, as the game's does.
 * A lab period is mostly waiting, setting up the next release, so it pings once
 * a second while idle (enough for a live reading and the aim check), a little
 * faster while calibrating, and at the chosen rate only while recording.
 *
 * Each retune re-zeroes the device's capture clock, so a recording cannot just
 * start counting samples when Collect is pressed: the first few could still be
 * on the old clock. Collect retunes first and waits for the retune to finish,
 * and the capture treats a clock that runs backwards as a fresh start.
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

/** Seconds between pings when nothing is being recorded or calibrated. */
const IDLE_PERIOD_SECONDS = 1;
/** Calibrating wants a settled average, not resolution. */
const CALIBRATING_PERIOD_SECONDS = 0.25;

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
  /** Collect was pressed and the detector is speeding up; recording has not begun. */
  preparing: boolean;
  recording: boolean;
  /** The run in progress, for the live graph; empty when idle. */
  live: CartSample[];
  /** Seconds recorded so far. */
  elapsed: number;
  /** Why the last recording produced nothing, or null. */
  problem: string | null;
  start: () => Promise<void>;
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
  /** True while the calibrate screen is open, which wants a faster live reading. */
  calibrating: boolean,
): CartRecorder => {
  const device = useVernierMotion();
  const calibration = useDetectorCalibration();

  const [rateHz, setRateHz] = useState<number>(DEFAULT_RATE_HZ);
  const [durationSeconds, setDurationSeconds] = useState<number>(DEFAULT_DURATION_SECONDS);
  const [preparing, setPreparing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [live, setLive] = useState<CartSample[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  const bufferRef = useRef<MotionSample[]>([]);
  const offsetRef = useRef<number | null>(null);
  const lastRawTRef = useRef(-Infinity);
  const recordingRef = useRef(false);
  const preparingRef = useRef(false);
  const wallStartRef = useRef(0);
  const scaleAtStartRef = useRef(calibration.scale);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const periodSeconds = 1 / rateHz;
  const periodRef = useRef(periodSeconds);
  periodRef.current = periodSeconds;

  /**
   * The rate the current or latest run was started at. The rate select only
   * sets the next run's rate: it must not retune a recording in progress, or
   * stamp the wrong period on it.
   */
  const [runPeriod, setRunPeriod] = useState(periodSeconds);
  const runPeriodRef = useRef(runPeriod);

  /** What the detector should be doing right now. */
  const streamPeriod =
    preparing || recording
      ? runPeriod
      : calibrating
        ? CALIBRATING_PERIOD_SECONDS
        : IDLE_PERIOD_SECONDS;
  const streamPeriodRef = useRef(streamPeriod);
  streamPeriodRef.current = streamPeriod;

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
  /** The last start or retune still on its way to the device; retunes queue behind it. */
  const inflightRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const decision = decideStream(sourceId, statusKind, streamedSourceRef.current);

    if (decision === 'forget') {
      streamedSourceRef.current = null;
      appliedPeriodRef.current = null;
      return;
    }
    if (decision === 'wait') return;

    streamedSourceRef.current = sourceId;
    appliedPeriodRef.current = streamPeriodRef.current;
    inflightRef.current = Promise.resolve(startStream(streamPeriodRef.current)).catch(() => {});
  }, [sourceId, statusKind, startStream]);

  /**
   * Retunes the open stream, resolving once the device has done it. A retune
   * costs a stop/start round trip, so asking for the rate already in force has
   * to be free.
   */
  const applyPeriod = useCallback(
    (period: number): Promise<void> => {
      if (streamedSourceRef.current === null || appliedPeriodRef.current === period) {
        return inflightRef.current;
      }
      appliedPeriodRef.current = period;
      inflightRef.current = inflightRef.current.then(() => setStreamPeriod(period)).catch(() => {});
      return inflightRef.current;
    },
    [setStreamPeriod],
  );

  // Its own effect so a status transition cannot trigger a retune.
  useEffect(() => {
    void applyPeriod(streamPeriod);
  }, [streamPeriod, sourceId, statusKind, applyPeriod]);

  // --- capture -------------------------------------------------------------

  useEffect(
    () =>
      subscribe((sample) => {
        if (!recordingRef.current) return;
        // A clock running backwards is a retune landing: whatever was captured
        // before it is on the old timeline and is thrown away.
        if (sample.t < lastRawTRef.current) {
          bufferRef.current = [];
          offsetRef.current = null;
        }
        lastRawTRef.current = sample.t;
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
      periodSeconds: runPeriodRef.current,
      distanceScale: scaleAtStartRef.current,
    });
  }, []);

  const connected = statusKind === 'ready' || statusKind === 'streaming';
  const connectedRef = useRef(connected);
  connectedRef.current = connected;
  const hasEcho = device.latest?.quality === 'ok';

  const start = useCallback(async () => {
    if (recordingRef.current || preparingRef.current) return;
    preparingRef.current = true;
    runPeriodRef.current = periodRef.current;
    setRunPeriod(periodRef.current);
    setProblem(null);
    setPreparing(true);

    // Recording only begins once the detector is running at the run's rate, so
    // no sample from the idle timeline can open the buffer.
    await applyPeriod(periodRef.current);
    preparingRef.current = false;
    if (!connectedRef.current) {
      setPreparing(false);
      return;
    }

    bufferRef.current = [];
    offsetRef.current = null;
    lastRawTRef.current = -Infinity;
    scaleAtStartRef.current = calibrationScale;
    wallStartRef.current = Date.now();
    recordingRef.current = true;
    setElapsed(0);
    setLive([]);
    setRecording(true);
    setPreparing(false);
  }, [applyPeriod, calibrationScale]);

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
    preparing,
    recording,
    live,
    elapsed,
    problem,
    start,
    stop: finish,
  };
};
