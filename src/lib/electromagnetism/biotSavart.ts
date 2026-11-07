// Magnetic fields of steady currents, built from the Biot-Savart law.
// All quantities are SI (meters, amperes, tesla) in a right-handed frame:
// x to the right, y up, z out of the page.

/** Vacuum permeability in T·m/A. */
export const MU0 = 4 * Math.PI * 1e-7;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const length3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/** Rotate a vector about the x axis by `angle` radians (counterclockwise looking down +x). */
export const rotateAroundX = (v: Vec3, angle: number): Vec3 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
};

/** Format a field in tesla with a sensible prefix: T, mT, µT or nT. */
export function formatTesla(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1) return `${value.toFixed(3)} T`;
  if (abs >= 1e-3) return `${(value * 1e3).toFixed(2)} mT`;
  if (abs >= 1e-6) return `${(value * 1e6).toFixed(2)} µT`;
  return `${(value * 1e9).toFixed(1)} nT`;
}

/** Magnitude of the field a distance r from a long straight wire: B = mu0*I / (2*pi*r). */
export function wireFieldMagnitude(current: number, r: number): number {
  if (r <= 0) return Infinity;
  return (MU0 * Math.abs(current)) / (2 * Math.PI * r);
}

export interface PlanarField {
  x: number;
  y: number;
}

/**
 * Field in the plane perpendicular to a long wire along z, at displacement
 * (dx, dy) from the wire. Positive current is out of the page, and the field
 * circulates counterclockwise around it (right-hand rule). Inside `minDistance`
 * the magnitude is held at its value there, so the field stays finite on the wire.
 */
export function straightWireField(
  dx: number,
  dy: number,
  current: number,
  minDistance = 1e-3,
): PlanarField {
  const r = Math.hypot(dx, dy);
  if (r === 0) return { x: 0, y: 0 };
  const effective = Math.max(r, minDistance);
  const magnitude = (MU0 * current) / (2 * Math.PI * effective);
  return { x: (-dy / r) * magnitude, y: (dx / r) * magnitude };
}

export interface LoopParams {
  /** Loop radius in meters. */
  radius: number;
  /** Current in amperes. Positive is counterclockwise seen from +z, so the moment points along +z. */
  current: number;
  /** Straight segments used to approximate the ring. */
  segments: number;
  /** Tilt of the loop's axis from z about the x axis, in degrees. */
  tiltDeg: number;
  center: Vec3;
}

/**
 * Floor on the distance used in Biot-Savart sums, as a fraction of the loop
 * radius, so a sample that lands on the wire stays finite at any loop size.
 */
const MIN_DISTANCE_FRACTION = 0.06;

/**
 * Field of a circular current loop by summing the Biot-Savart contribution of
 * short straight segments: dB = (mu0 I / 4 pi) dl x r / r^3.
 */
export function loopField(point: Vec3, loop: LoopParams): Vec3 {
  const tilt = (loop.tiltDeg * Math.PI) / 180;
  const local = rotateAroundX(sub3(point, loop.center), -tilt);
  const prefactor = (MU0 * loop.current) / (4 * Math.PI);
  const dPhi = (2 * Math.PI) / loop.segments;
  const minDistance = MIN_DISTANCE_FRACTION * loop.radius;
  let total: Vec3 = { x: 0, y: 0, z: 0 };

  for (let i = 0; i < loop.segments; i++) {
    // Evaluate each segment at its mid-angle with a tangent element of arc length R*dPhi.
    const phi = (i + 0.5) * dPhi;
    const mid: Vec3 = { x: loop.radius * Math.cos(phi), y: loop.radius * Math.sin(phi), z: 0 };
    const dl: Vec3 = {
      x: -Math.sin(phi) * loop.radius * dPhi,
      y: Math.cos(phi) * loop.radius * dPhi,
      z: 0,
    };
    const r = sub3(local, mid);
    const distance = Math.max(length3(r), minDistance);
    const c = cross3(dl, r);
    const scale = prefactor / (distance * distance * distance);
    total = { x: total.x + c.x * scale, y: total.y + c.y * scale, z: total.z + c.z * scale };
  }

  return rotateAroundX(total, tilt);
}

export interface SolenoidParams {
  radius: number;
  current: number;
  turns: number;
  /** Total length along z, centered on the origin. */
  length: number;
  segments: number;
}

/** z positions of the turns of a solenoid, evenly spaced and centered on the origin. */
export function solenoidTurnPositions(turns: number, length: number): number[] {
  const spacing = length / turns;
  return Array.from({ length: turns }, (_, i) => -length / 2 + (i + 0.5) * spacing);
}

/** Field of a solenoid modeled as a stack of identical circular loops. */
export function solenoidField(point: Vec3, solenoid: SolenoidParams): Vec3 {
  let total: Vec3 = { x: 0, y: 0, z: 0 };
  for (const z of solenoidTurnPositions(solenoid.turns, solenoid.length)) {
    total = add3(
      total,
      loopField(point, {
        radius: solenoid.radius,
        current: solenoid.current,
        segments: solenoid.segments,
        tiltDeg: 0,
        center: { x: 0, y: 0, z },
      }),
    );
  }
  return total;
}

/** Interior field of an ideal (infinitely long) solenoid: B = mu0 * n * I. */
export function idealSolenoidField(turnsPerMeter: number, current: number): number {
  return MU0 * turnsPerMeter * current;
}

/** Field on the axis of a circular loop, at distance z from its center. */
export function loopAxisField(radius: number, current: number, z: number): number {
  return (MU0 * current * radius * radius) / (2 * Math.pow(radius * radius + z * z, 1.5));
}
