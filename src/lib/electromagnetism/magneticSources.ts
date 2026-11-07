// Field configurations and 3D viewing math for the magnetic field explorer.
// Sources sit near the origin in arbitrary length units (read as meters), with
// currents of one ampere or magnetic moments of one A·m², and the field is
// sampled on a cube grid around them.

import {
  MU0,
  add3,
  loopField,
  rotateAroundX,
  solenoidField,
  straightWireField,
  type Vec3,
} from './biotSavart.ts';

export type SourceConfig = 'wire' | 'loop' | 'solenoid' | 'dipole' | 'pair';
export type PairMode = 'parallel' | 'anti';

export interface SourceParams {
  config: SourceConfig;
  /** +1 or -1: flips the current (and the field) of wire, loop and solenoid sources. */
  currentSign: 1 | -1;
  loopRadius: number;
  /** Tilt about the x axis in degrees; only loops and bar magnets use it. */
  tiltDeg: number;
  solenoidTurns: number;
  /** Center-to-center distance between the two bar magnets. */
  pairSeparation: number;
  pairMode: PairMode;
}

export const DEFAULT_SOURCE: SourceParams = {
  config: 'wire',
  currentSign: 1,
  loopRadius: 0.85,
  tiltDeg: 0,
  solenoidTurns: 10,
  pairSeparation: 1.2,
  pairMode: 'anti',
};

export const BAR_LENGTH = 1.4;
export const BAR_THICKNESS = 0.3;
export const SAMPLE_EXTENT = 1.2;
export const SOLENOID_LENGTH = 3;
export const SOLENOID_RADIUS_FACTOR = 0.75;
/** Field that maps to full strength in the display, in tesla. */
export const REFERENCE_FIELD = 1e-6;
/** Magnitude of each bar magnet's dipole moment, A·m². */
export const DIPOLE_MOMENT = 1;

export const solenoidRadius = (loopRadius: number): number => loopRadius * SOLENOID_RADIUS_FACTOR;

/** Tilt that actually applies to the chosen source; wires and solenoids ignore the slider. */
export function effectiveTilt(params: SourceParams): number {
  return params.config === 'loop' || params.config === 'dipole' || params.config === 'pair'
    ? params.tiltDeg
    : 0;
}

export interface Dipole {
  position: Vec3;
  moment: Vec3;
}

/** Field of an ideal point dipole: (mu0 / 4 pi r^3) [3 (m . r^) r^ - m]. */
export function dipoleField(point: Vec3, dipole: Dipole): Vec3 {
  const rx = point.x - dipole.position.x;
  const ry = point.y - dipole.position.y;
  const rz = point.z - dipole.position.z;
  const r2 = rx * rx + ry * ry + rz * rz + 1e-6;
  const r = Math.sqrt(r2);
  const dot = rx * dipole.moment.x + ry * dipole.moment.y + rz * dipole.moment.z;
  const coefficient = (MU0 / (4 * Math.PI)) / (r2 * r2 * r);
  return {
    x: coefficient * (3 * dot * rx - r2 * dipole.moment.x),
    y: coefficient * (3 * dot * ry - r2 * dipole.moment.y),
    z: coefficient * (3 * dot * rz - r2 * dipole.moment.z),
  };
}

/** The bar magnets of the current source: one at the origin, or two along x. */
export function barMagnetDipoles(params: SourceParams): Dipole[] {
  const tilt = (effectiveTilt(params) * Math.PI) / 180;
  const moment = rotateAroundX({ x: 0, y: 0, z: DIPOLE_MOMENT }, tilt);
  if (params.config === 'dipole') return [{ position: { x: 0, y: 0, z: 0 }, moment }];
  if (params.config !== 'pair') return [];
  const half = params.pairSeparation / 2;
  const second =
    params.pairMode === 'parallel' ? moment : { x: -moment.x, y: -moment.y, z: -moment.z };
  return [
    { position: { x: -half, y: 0, z: 0 }, moment },
    { position: { x: half, y: 0, z: 0 }, moment: second },
  ];
}

/** x positions of the bar magnet centers (empty for sources without bar magnets). */
export function barMagnetCenters(params: SourceParams): number[] {
  return barMagnetDipoles(params).map((d) => d.position.x);
}

/** True when the point lies inside a bar magnet's volume, where the dipole model is not meaningful. */
export function isInsideBar(point: Vec3, params: SourceParams): boolean {
  const centers = barMagnetCenters(params);
  if (centers.length === 0) return false;
  const tilt = (effectiveTilt(params) * Math.PI) / 180;
  const local = rotateAroundX(point, -tilt);
  const halfWidth = BAR_THICKNESS / 2;
  const halfLength = BAR_LENGTH / 2;
  return centers.some(
    (cx) =>
      Math.abs(local.x - cx) <= halfWidth &&
      Math.abs(local.y) <= halfWidth &&
      Math.abs(local.z) <= halfLength,
  );
}

/** Total field of the chosen source at a point, in tesla. */
export function sourceField(point: Vec3, params: SourceParams): Vec3 {
  const current = params.currentSign;
  switch (params.config) {
    case 'wire': {
      const b = straightWireField(point.x, point.y, current, 1e-3);
      return { x: b.x, y: b.y, z: 0 };
    }
    case 'loop':
      return loopField(point, {
        radius: params.loopRadius,
        current,
        segments: 72,
        tiltDeg: params.tiltDeg,
        center: { x: 0, y: 0, z: 0 },
      });
    case 'solenoid':
      return solenoidField(point, {
        radius: solenoidRadius(params.loopRadius),
        current,
        turns: Math.max(2, Math.floor(params.solenoidTurns)),
        length: SOLENOID_LENGTH,
        segments: 64,
      });
    default:
      return barMagnetDipoles(params).reduce(
        (sum, dipole) => add3(sum, dipoleField(point, dipole)),
        { x: 0, y: 0, z: 0 } as Vec3,
      );
  }
}

/** A cube grid of sample points around the source, skipping the origin and bar magnet interiors. */
export function fieldSamplePoints(density: number, params: SourceParams): Vec3[] {
  const n = Math.max(3, Math.floor(density));
  const values = Array.from({ length: n }, (_, i) => ((i / (n - 1)) * 2 - 1) * SAMPLE_EXTENT);
  const points: Vec3[] = [];
  for (const x of values) {
    for (const y of values) {
      for (const z of values) {
        if (Math.hypot(x, y, z) < 0.05) continue;
        const point = { x, y, z };
        if (!isInsideBar(point, params)) points.push(point);
      }
    }
  }
  return points;
}

export interface FieldSample {
  point: Vec3;
  field: Vec3;
}

export function sampleField(density: number, params: SourceParams): FieldSample[] {
  return fieldSamplePoints(density, params).map((point) => ({ point, field: sourceField(point, params) }));
}

/** Fraction of the display's full-scale field, 0 to 1. */
export function strengthFraction(magnitude: number): number {
  return Math.min(1, Math.max(0, magnitude / REFERENCE_FIELD));
}

/** Opacity for an arrow of a given strength fraction; weak arrows stay visible. */
export function strengthOpacity(fraction: number): number {
  return Math.min(1, Math.max(0.22, 0.22 + 0.78 * Math.pow(fraction, 0.65)));
}

// --- Viewing -------------------------------------------------------------

export interface View {
  yaw: number;
  pitch: number;
}

export const CAMERA_DISTANCE = 6;
export const MAX_PITCH = 1.2;

/** Rotate by yaw about the vertical axis, then pitch about the horizontal one. */
export function rotateYawPitch(v: Vec3, view: View): Vec3 {
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  const x1 = v.x * cy + v.z * sy;
  const z1 = -v.x * sy + v.z * cy;
  return { x: x1, y: v.y * cp - z1 * sp, z: v.y * sp + z1 * cp };
}

export interface Projected {
  /** Perspective-scaled position in world units, x right and y up. */
  x: number;
  y: number;
  /** Depth toward the viewer; larger is closer. */
  z: number;
  /** Perspective scale factor at this depth. */
  persp: number;
}

export function project(point: Vec3, view: View): Projected {
  const r = rotateYawPitch(point, view);
  const persp = CAMERA_DISTANCE / (CAMERA_DISTANCE - r.z);
  return { x: r.x * persp, y: r.y * persp, z: r.z, persp };
}

/** Drag distance in pixels to radians of orbit. */
export const ORBIT_SPEED = 0.005;

export function orbit(view: View, dxPixels: number, dyPixels: number): View {
  return {
    yaw: view.yaw + dxPixels * ORBIT_SPEED,
    pitch: Math.min(MAX_PITCH, Math.max(-MAX_PITCH, view.pitch + dyPixels * ORBIT_SPEED)),
  };
}
