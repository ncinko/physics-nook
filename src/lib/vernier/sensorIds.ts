/**
 * Vernier sensor identities and their conversion to physical units.
 *
 * An NGIO interface reports a numeric sensor ID per channel (the auto-ID
 * resistor / DDS memory on the sensor cable). That ID is what tells us a
 * Motion Detector is plugged into DIG1 rather than, say, a photogate — the two
 * are wired identically and differ only in how their samples must be read.
 *
 * Adding a future Vernier activity should mean adding an entry here plus a
 * unit conversion, and nothing in the transport or session layers.
 */

import { NGIO_CHANNEL_ID, NGIO_SAMPLING_MODE } from './ngioPackets.ts';

export type SensorKind = 'motion' | 'analog' | 'digital-count' | 'unsupported';

export interface VernierSensor {
  sensorId: number;
  name: string;
  kind: SensorKind;
  /** Physical unit of the value `toPhysical` returns. */
  unit: string;
  /** Channels this sensor is legal on. */
  channels: readonly number[];
  /** Sampling mode the interface must be put into for this sensor. */
  samplingMode: number;
  /**
   * Raw device counts to physical units. For the sonar the raw value is the
   * echo round-trip time in microseconds (NGIO ticks), so distance is half the
   * round trip times the speed of sound.
   */
  toPhysical: (raw: number, context: SensorContext) => number;
}

export interface SensorContext {
  /** Ambient air temperature in Celsius. */
  airTemperatureC: number;
}

export const DEFAULT_SENSOR_CONTEXT: SensorContext = { airTemperatureC: 20 };

/**
 * Speed of sound in dry air. The temperature term matters more than it looks:
 * between a cold and a warm room the speed shifts about 2%, which is 4 cm at
 * 2 m — bigger than the detector's own 1 mm resolution and big enough to bias
 * a graph-matching score. Exposed rather than hardcoded so an activity that
 * has a temperature probe attached can feed the real value in.
 */
export const speedOfSound = (airTemperatureC: number): number =>
  331.3 * Math.sqrt(1 + airTemperatureC / 273.15);

/**
 * Motion Detector (MD-BTD) and the older MD-DIN, which share a sensor ID
 * family. Range 0.15-6.0 m, resolution about 1 mm, 20 Hz optimum and 30 Hz
 * maximum per the sensor manual.
 */
export const MOTION_DETECTOR_SENSOR_IDS = [2, 69] as const;

export const MOTION_DETECTOR_RANGE = { minMeters: 0.15, maxMeters: 6.0 } as const;

const motionToMeters = (raw: number, context: SensorContext): number =>
  (raw * 1e-6 * speedOfSound(context.airTemperatureC)) / 2;

export const VERNIER_SENSORS: readonly VernierSensor[] = [
  {
    sensorId: 2,
    name: 'Motion Detector',
    kind: 'motion',
    unit: 'm',
    channels: [NGIO_CHANNEL_ID.DIGITAL1, NGIO_CHANNEL_ID.DIGITAL2],
    samplingMode: NGIO_SAMPLING_MODE.PERIODIC_MOTION_DETECT,
    toPhysical: motionToMeters,
  },
  {
    sensorId: 69,
    name: 'Motion Detector 2',
    kind: 'motion',
    unit: 'm',
    channels: [NGIO_CHANNEL_ID.DIGITAL1, NGIO_CHANNEL_ID.DIGITAL2],
    samplingMode: NGIO_SAMPLING_MODE.PERIODIC_MOTION_DETECT,
    toPhysical: motionToMeters,
  },
];

export const findSensor = (sensorId: number): VernierSensor | null =>
  VERNIER_SENSORS.find((sensor) => sensor.sensorId === sensorId) ?? null;

export const isMotionSensor = (sensorId: number): boolean =>
  (MOTION_DETECTOR_SENSOR_IDS as readonly number[]).includes(sensorId);

/**
 * Sensor ID 0 means "nothing plugged in" on every Vernier channel. Separating
 * it from "plugged in but unrecognised" matters for the connect panel: one is
 * a cable to plug in, the other is the wrong sensor.
 */
export const describeSensor = (sensorId: number): string => {
  if (sensorId === 0) return 'No sensor';
  const sensor = findSensor(sensorId);
  return sensor ? sensor.name : `Unrecognised sensor (ID ${sensorId})`;
};

/** Distances outside the detector's stated range are echoes, not positions. */
export const isPlausibleDistance = (meters: number): boolean =>
  Number.isFinite(meters) &&
  meters >= MOTION_DETECTOR_RANGE.minMeters &&
  meters <= MOTION_DETECTOR_RANGE.maxMeters;
