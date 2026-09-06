export type Vector3 = readonly [number, number, number];
export interface Charge3D { id: number; position: Vector3; q: number }
export type GaussianShape = 'sphere' | 'ellipsoid' | 'box';
export interface SurfaceTriangle {
  vertices: readonly [Vector3, Vector3, Vector3];
  center: Vector3;
  normal: Vector3;
  area: number;
}
export const EPSILON_0 = 8.8541878128e-12;
const K = 1 / (4 * Math.PI * EPSILON_0);
export const add3 = (a: Vector3, b: Vector3): Vector3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a: Vector3, b: Vector3): Vector3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a: Vector3, s: number): Vector3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot3 = (a: Vector3, b: Vector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: Vector3, b: Vector3): Vector3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length3 = (a: Vector3) => Math.hypot(...a);

export function flatFlux(field: number, area: number, angleDegrees: number) {
  const flux = field * area * Math.cos(angleDegrees * Math.PI / 180);
  return Math.abs(flux) < 1e-10 ? 0 : flux;
}

export function field3D(charges: readonly Charge3D[], point: Vector3): Vector3 {
  let field: Vector3 = [0, 0, 0];
  for (const charge of charges) {
    const d = sub3(point, charge.position), r = length3(d);
    if (r === 0) return [NaN, NaN, NaN];
    field = add3(field, scale3(d, K * charge.q / r ** 3));
  }
  return field;
}

/** Closed convex triangle mesh, centered at the origin, with outward normals. */
export function gaussianSurface(shape: GaussianShape, radius: number, resolution = 24): SurfaceTriangle[] {
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isInteger(resolution) || resolution < 8) {
    throw new Error('A surface needs a positive radius and an integer resolution of at least 8.');
  }
  const result: SurfaceTriangle[] = [];
  const triangle = (a: Vector3, b: Vector3, c: Vector3) => {
    const center = scale3(add3(add3(a, b), c), 1 / 3);
    let normal = cross3(sub3(b, a), sub3(c, a));
    const twiceArea = length3(normal);
    if (twiceArea < 1e-12) return;
    if (dot3(normal, center) < 0) { [b, c] = [c, b]; normal = scale3(normal, -1); }
    result.push({ vertices: [a, b, c], center, normal: scale3(normal, 1 / twiceArea), area: twiceArea / 2 });
  };
  if (shape === 'box') {
    const n = Math.max(2, Math.round(resolution / 4));
    for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
      const point = (u: number, v: number): Vector3 => {
        const p = [0, 0, 0]; p[axis] = sign * radius;
        p[(axis + 1) % 3] = radius * (2 * u / n - 1);
        p[(axis + 2) % 3] = radius * (2 * v / n - 1);
        return p as unknown as Vector3;
      };
      for (let u = 0; u < n; u++) for (let v = 0; v < n; v++) {
        const a = point(u, v), b = point(u + 1, v), c = point(u + 1, v + 1), d = point(u, v + 1);
        triangle(a, b, c); triangle(a, c, d);
      }
    }
  } else {
    const rows = Math.round(resolution / 2);
    const axes = shape === 'ellipsoid' ? [1.25, 0.8, 1] : [1, 1, 1];
    const point = (u: number, v: number): Vector3 => {
      const phi = u / resolution * 2 * Math.PI, theta = v / rows * Math.PI;
      return [radius * axes[0] * Math.sin(theta) * Math.cos(phi),
        radius * axes[1] * Math.cos(theta), radius * axes[2] * Math.sin(theta) * Math.sin(phi)];
    };
    for (let u = 0; u < resolution; u++) for (let v = 0; v < rows; v++) {
      const a = point(u, v), b = point(u + 1, v), c = point(u + 1, v + 1), d = point(u, v + 1);
      triangle(a, b, c); triangle(a, c, d);
    }
  }
  return result;
}

/** Coulomb flux integrated over an individual triangle using its signed solid
 * angle. This evaluates the surface integral directly, without substituting
 * enclosed charge into Gauss' law. No field softening alters the flux. */
export function triangleFlux(triangle: SurfaceTriangle, charge: Charge3D) {
  const [a, b, c] = triangle.vertices.map(v => sub3(v, charge.position));
  const ra = length3(a), rb = length3(b), rc = length3(c);
  const numerator = dot3(a, cross3(b, c));
  const denominator = ra * rb * rc + dot3(a, b) * rc + dot3(b, c) * ra + dot3(c, a) * rb;
  return K * charge.q * 2 * Math.atan2(numerator, denominator);
}

export function measureFlux(surface: readonly SurfaceTriangle[], charges: readonly Charge3D[]) {
  // Independent geometric enclosure test, also detecting the singular boundary.
  const distances = charges.map(charge => Math.max(...surface.map(t => dot3(sub3(charge.position, t.center), t.normal))));
  const onBoundary = distances.some(d => Math.abs(d) < 0.035);
  const enclosedCharge = onBoundary ? null : charges.reduce((sum, c, i) => sum + (distances[i] < 0 ? c.q : 0), 0);
  const patches = surface.map(t => {
    const field = field3D(charges, t.center);
    return { field, density: dot3(field, t.normal),
      flux: onBoundary ? 0 : charges.reduce((sum, c) => sum + triangleFlux(t, c), 0) };
  });
  return { onBoundary, enclosedCharge, patches,
    flux: onBoundary ? null : patches.reduce((sum, p) => sum + p.flux, 0) };
}

export const BOX_FACES: { name: string; normal: Vector3 }[] = [
  { name: 'Left (−x)', normal: [-1, 0, 0] }, { name: 'Right (+x)', normal: [1, 0, 0] },
  { name: 'Bottom (−y)', normal: [0, -1, 0] }, { name: 'Top (+y)', normal: [0, 1, 0] },
  { name: 'Back (−z)', normal: [0, 0, -1] }, { name: 'Front (+z)', normal: [0, 0, 1] },
];

export function uniformBoxFlux(field: Vector3, side = 2) {
  return BOX_FACES.map(face => ({ ...face, flux: dot3(field, face.normal) * side ** 2 }));
}

export function gaussPreset(name: string): Charge3D[] {
  if (name === 'off-center') return [{ id: 1, position: [0.55, 0.25, 0], q: 1e-9 }];
  if (name === 'external') return [{ id: 1, position: [2.2, 0, 0], q: 1e-9 }];
  if (name === 'dipole') return [{ id: 1, position: [-0.5, 0, 0], q: 1e-9 }, { id: 2, position: [0.5, 0, 0], q: -1e-9 }];
  return [{ id: 1, position: [0, 0, 0], q: 1e-9 }];
}

export function formatFlux(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) < 1e-7) return '0';
  return Number(value.toPrecision(3)).toLocaleString('en-US');
}
