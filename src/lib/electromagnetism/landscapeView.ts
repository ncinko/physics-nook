/** Camera and pointer geometry for the draggable topographic landscape. Kept
 * out of the component so the parts that are easy to get subtly wrong — the
 * orbit basis and the contour hit test — can be checked directly. */

export type Vector3 = readonly [number, number, number];

/** Shortest signed turn from one bearing to another, in degrees. */
export function shortestTurn(from: number, to: number): number {
  const turn = (to - from) % 360;
  return turn > 180 ? turn - 360 : turn < -180 ? turn + 360 : turn;
}

/** Where the eye sits for a given elevation above the horizontal and bearing
 * around the vertical, and which way is up on screen from there. The up vector
 * is the view direction pitched a quarter turn toward the sky, which leaves it
 * perpendicular to the view: the camera pitches and spins but never rolls. */
export function orbitEye(elevation: number, azimuth: number, radius: number, focus: number) {
  const pitch = elevation * Math.PI / 180, bearing = azimuth * Math.PI / 180;
  const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch);
  const cosBearing = Math.cos(bearing), sinBearing = Math.sin(bearing);
  return {
    position: [radius * cosPitch * sinBearing, focus + radius * sinPitch,
      radius * cosPitch * cosBearing] as Vector3,
    up: [-sinPitch * sinBearing, cosPitch, -sinPitch * cosBearing] as Vector3,
    target: [0, focus, 0] as Vector3,
  };
}

/** The half-width an orthographic frame of the given aspect (height / width)
 * needs for every one of `points` to fall inside it, seen from `eye`. Spinning
 * a rectangular map swings its corners wide — at the diagonal it is a third
 * broader than face-on — so a frame sized for the fixed views would cut them
 * off partway through a drag. */
export function frameHalfWidth(points: readonly Vector3[],
  eye: ReturnType<typeof orbitEye>, aspect: number): number {
  // The camera's own axes: back along the view, right across it, up on screen.
  const back = normalise(subtract(eye.position, eye.target));
  const right = normalise(cross(eye.up, back));
  const up = cross(back, right);
  let halfWidth = 0, halfHeight = 0;
  for (const point of points) {
    const offset = subtract(point, eye.position);
    halfWidth = Math.max(halfWidth, Math.abs(dot(offset, right)));
    halfHeight = Math.max(halfHeight, Math.abs(dot(offset, up)));
  }
  return Math.max(halfWidth, halfHeight / aspect);
}

const subtract = (a: Vector3, b: Vector3): Vector3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vector3, b: Vector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector3, b: Vector3): Vector3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalise = (a: Vector3): Vector3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

export interface SegmentHit { x: number; y: number; depth: number; distance: number }

/** The closest point to (px, py) on one contour's projected line segments, or
 * null if none comes within `radius` pixels.
 *
 * `screen` holds x, y and depth per point for every contour on the map;
 * `start` is this contour's first point and `count` how many it has. The
 * points are independent pairs, matching the LineSegments buffer they came
 * from — consecutive pairs are not joined end to end. */
export function nearestSegment(screen: ArrayLike<number>, start: number, count: number,
  px: number, py: number, radius: number): SegmentHit | null {
  let best: SegmentHit | null = null;
  for (let i = 0; i + 1 < count; i += 2) {
    const a = (start + i) * 3, b = a + 3;
    const ax = screen[a], ay = screen[a + 1];
    const dx = screen[b] - ax, dy = screen[b + 1] - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared
      ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
    const x = ax + t * dx, y = ay + t * dy;
    const distance = Math.hypot(px - x, py - y);
    if (distance > radius || (best && distance >= best.distance)) continue;
    best = { x, y, distance, depth: screen[a + 2] + (screen[b + 2] - screen[a + 2]) * t };
  }
  return best;
}

/** Rank one contour's hit against the best so far. Whole pixels of miss come
 * first, so a near-tie is settled by nearness to the eye instead — which picks
 * the contour drawn in front of the hillside over the one hidden behind it. */
export function hitScore(hit: SegmentHit): number {
  return Math.round(hit.distance) * 4 + hit.depth;
}
