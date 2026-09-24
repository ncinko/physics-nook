/**
 * A Motion Detector on a LabQuest, over WebUSB.
 *
 * The device work — claiming the interface, the read loop, the watchdog, and
 * silencing the detector on the way out — is `ngioUsbTransport.ts`. What is
 * left here is turning ping/echo round trips into conditioned distances.
 */

import { conditionSample, type MotionSample } from '../motionStream.ts';
import { DEFAULT_SENSOR_CONTEXT, findSensor, type SensorContext } from '../sensorIds.ts';
import { createNgioUsbTransport } from './ngioUsbTransport.ts';
import { createEmitter, type MotionSource, type StartOptions } from './types.ts';

export const createWebUsbSource = (): MotionSource => {
  const samples = createEmitter<MotionSample>();
  let lastGood: MotionSample | null = null;
  /**
   * The instrument context every raw tick is converted through. Mutable so the
   * calibrate screen can change the scale mid-session; the next sample picks it
   * up and no stream is disturbed.
   */
  let sensorContext: SensorContext = DEFAULT_SENSOR_CONTEXT;

  const transport = createNgioUsbTransport({
    profile: 'motion',
    streamingWatchdog: true,
    sourceLabel: 'LabQuest over USB (WebUSB)',
    // A restart re-zeroes the device's capture clock, so the last accepted
    // sample is from a different timeline. Carrying it across would make the
    // first reading of the new rate a dropout on a negative dt.
    onStreamStart: () => {
      lastGood = null;
    },
    onStreaming: (result, session) => {
      const sensor = findSensor(session.sensorId);
      result.samples.forEach((raw) => {
        // The one place raw ticks become metres, and therefore the one place
        // the calibration scale is applied. Everything downstream — the
        // plausibility gate below, the recorded buffer, derived velocity,
        // scoring, the submitted samples — sees corrected metres for free.
        const distance = sensor ? sensor.toPhysical(raw.raw, sensorContext) : Number.NaN;
        const sample = conditionSample(lastGood, { t: raw.t, distance });
        if (sample.quality === 'ok') lastGood = sample;
        samples.emit(sample);
      });
    },
  });

  return {
    id: 'webusb',
    label: 'LabQuest over USB',
    isReal: true,
    isSupported: transport.isSupported,
    connect: transport.connect,

    start: async (options: StartOptions = {}) => {
      lastGood = null;
      await transport.start(options);
    },

    setPeriod: transport.setPeriod,
    stop: transport.stop,

    disconnect: async () => {
      await transport.disconnect();
      lastGood = null;
      samples.clear();
    },

    setSensorContext: (next: SensorContext) => {
      sensorContext = next;
    },

    subscribe: samples.subscribe,
    onStatus: transport.onStatus,
    diagnostics: transport.diagnostics,
  };
};
