// Orbit camera over the pool. Ground is the plane z = 0 in cell units (x, y), z is up.
// The WGSL fragment shader casts rays with exactly this basis, and pointer picking on
// the CPU uses `pickGround`, so what you click is what you see.

export interface PoolView {
  yaw: number;
  pitch: number;
  distance: number;
  targetX: number;
  targetY: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const TAN_HALF_FOV = 0.6;
export const MIN_PITCH = 0.18;
export const MAX_PITCH = Math.PI / 2 - 0.001;
export const MIN_DISTANCE = 60;

export function orbitEye(view: PoolView): Vec3 {
  const cp = Math.cos(view.pitch);
  return {
    x: view.targetX + view.distance * cp * Math.cos(view.yaw),
    y: view.targetY + view.distance * cp * Math.sin(view.yaw),
    z: view.distance * Math.sin(view.pitch),
  };
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

export interface CameraBasis {
  eye: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

export function cameraBasis(view: PoolView): CameraBasis {
  const eye = orbitEye(view);
  const forward = norm(sub({ x: view.targetX, y: view.targetY, z: 0 }, eye));
  // Looking straight down, `forward x z` degenerates; yaw keeps a stable screen-up there.
  const right = norm(cross(forward, { x: 0, y: 0, z: 1 }));
  const up = cross(right, forward);
  return { eye, forward, right, up };
}

/** Ground point under a normalised-device-coordinate position, or null if it hits the sky. */
export function pickGround(
  view: PoolView,
  ndcX: number,
  ndcY: number,
  aspect: number,
): { x: number; y: number } | null {
  const { eye, forward, right, up } = cameraBasis(view);
  const dir = {
    x: forward.x + right.x * ndcX * aspect * TAN_HALF_FOV + up.x * ndcY * TAN_HALF_FOV,
    y: forward.y + right.y * ndcX * aspect * TAN_HALF_FOV + up.y * ndcY * TAN_HALF_FOV,
    z: forward.z + right.z * ndcX * aspect * TAN_HALF_FOV + up.z * ndcY * TAN_HALF_FOV,
  };
  if (dir.z >= -1e-6) return null;
  const s = -eye.z / dir.z;
  return { x: eye.x + dir.x * s, y: eye.y + dir.y * s };
}

/** Keep the orbit target inside the interior so the absorbing margin can never be centred. */
export function clampTarget(x: number, y: number, n: number, absorber: number): { x: number; y: number } {
  const lo = absorber;
  const hi = n - absorber;
  return { x: Math.min(hi, Math.max(lo, x)), y: Math.min(hi, Math.max(lo, y)) };
}

export function maxDistance(n: number, absorber: number): number {
  return (n - 2 * absorber) * 1.4;
}
