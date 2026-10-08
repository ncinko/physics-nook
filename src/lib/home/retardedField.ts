// Retarded (Liénard–Wiechert) field of one moving point charge, for the landing-page
// electromagnetism miniature. The field at a point depends on where the charge was
// when the signal that now arrives left it, so changes spread outward at speed C.
//
// Screen units (px, s), charge q = +1. The planar positions are fed through the 3D
// formula, which is enough for a picture of the Coulomb field plus the radiation shell.

export const C = 160; // signal speed, px/s (about two seconds across the panel)
export const MAX_SPEED = 0.6 * C;
export const FRAME_DIAGONAL = 360; // longer than any source-to-grid-point distance in the 320x150 panel
export const HISTORY_SECONDS = FRAME_DIAGONAL / C + 0.1;

const VELOCITY_TAU = 0.08; // s, how quickly the charge's velocity follows its target
const BISECTIONS = 14;

export interface Sample {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
}

export interface ChargeBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Advance the charge toward `target` (or let it coast to rest when null). Speed never reaches C. */
export function stepCharge(
  body: ChargeBody,
  target: { x: number; y: number } | null,
  dt: number,
  bounds: Bounds,
): { body: ChargeBody; ax: number; ay: number } {
  let desiredX = 0;
  let desiredY = 0;
  if (target) {
    desiredX = (target.x - body.x) * 8;
    desiredY = (target.y - body.y) * 8;
    const speed = Math.hypot(desiredX, desiredY);
    if (speed > MAX_SPEED) {
      desiredX *= MAX_SPEED / speed;
      desiredY *= MAX_SPEED / speed;
    }
  }
  const blend = 1 - Math.exp(-dt / VELOCITY_TAU);
  const vx = body.vx + (desiredX - body.vx) * blend;
  const vy = body.vy + (desiredY - body.vy) * blend;
  const x = Math.min(bounds.maxX, Math.max(bounds.minX, body.x + vx * dt));
  const y = Math.min(bounds.maxY, Math.max(bounds.minY, body.y + vy * dt));
  return { body: { x, y, vx, vy }, ax: (vx - body.vx) / dt, ay: (vy - body.vy) / dt };
}

/** Append a sample and drop those too old to matter (keeping one older sample for interpolation). */
export function pushSample(history: Sample[], sample: Sample): void {
  history.push(sample);
  const cutoff = sample.t - HISTORY_SECONDS;
  while (history.length > 2 && history[1].t < cutoff) history.shift();
}

/** The charge's state at time t; before the record begins it is taken to be at rest. */
export function stateAt(history: Sample[], t: number): Sample {
  const first = history[0];
  if (t <= first.t) return { ...first, t, vx: 0, vy: 0, ax: 0, ay: 0 };
  const last = history[history.length - 1];
  if (t >= last.t) return last;
  let lo = 0;
  let hi = history.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (history[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = history[lo];
  const b = history[hi];
  const f = (t - a.t) / (b.t - a.t);
  const mix = (p: number, q: number) => p + (q - p) * f;
  return {
    t,
    x: mix(a.x, b.x),
    y: mix(a.y, b.y),
    vx: mix(a.vx, b.vx),
    vy: mix(a.vy, b.vy),
    ax: mix(a.ax, b.ax),
    ay: mix(a.ay, b.ay),
  };
}

/** Electric field at (px, py) at time `now`, from the charge's recorded motion. */
export function retardedField(history: Sample[], now: number, px: number, py: number): { ex: number; ey: number } {
  // Retarded time: |P - r(tr)| = C (now - tr). The left side minus the right side rises with tr.
  let lo = now - FRAME_DIAGONAL / C;
  let hi = now;
  for (let i = 0; i < BISECTIONS; i += 1) {
    const mid = 0.5 * (lo + hi);
    const s = stateAt(history, mid);
    if (Math.hypot(px - s.x, py - s.y) - C * (now - mid) > 0) hi = mid;
    else lo = mid;
  }
  const s = stateAt(history, 0.5 * (lo + hi));
  const dx = px - s.x;
  const dy = py - s.y;
  const R = Math.max(Math.hypot(dx, dy), 1);
  const nx = dx / R;
  const ny = dy / R;
  const bx = s.vx / C;
  const by = s.vy / C;
  const bdx = s.ax / C;
  const bdy = s.ay / C;
  const nb = nx * bx + ny * by;
  const kappa = 1 - nb;
  const gamma2inv = 1 - (bx * bx + by * by);

  // Velocity (Coulomb-like) term.
  const coulombScale = gamma2inv / (kappa * kappa * kappa * R * R);
  let ex = (nx - bx) * coulombScale;
  let ey = (ny - by) * coulombScale;

  // Radiation term: n x ((n - b) x bdot) = (n - b)(n . bdot) - bdot (n . (n - b)).
  const nBdot = nx * bdx + ny * bdy;
  const nMinusB = 1 - nb;
  const radScale = 1 / (C * kappa * kappa * kappa * R);
  ex += ((nx - bx) * nBdot - bdx * nMinusB) * radScale;
  ey += ((ny - by) * nBdot - bdy * nMinusB) * radScale;
  return { ex, ey };
}
