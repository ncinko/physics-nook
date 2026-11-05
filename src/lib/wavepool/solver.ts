// CPU reference for the wave-pool solver. The WGSL in shaders.ts is a line-for-line
// port of `stepVelocity` / `stepHeight`; keep the two in sync. This version exists so
// the physics (wall reflection, absorber, wavelength, diffraction) can be tested in
// Node, where there is no WebGPU.
//
// Model: linearised shallow-water equations on a staggered (Arakawa C) grid, in units
// where the cell size is 1, g = 1, and the reference depth is 1, so the wave speed is
// c = sqrt(d) cells per time unit.
//
//   h_t = -div(d u) - sigma h + sources
//   u_t = -grad(h - beta lap h) - (sigma + friction) u
//
// `beta` is a surface-tension-like term: it gives w^2 = c^2 k^2 (1 + beta k^2), i.e.
// short ripples run faster than long waves, as capillary ripples do. It is stable
// explicitly; the gravity-wave sign (short waves slower) is not.

export const DEFAULT_N = 640;
export const DEFAULT_ABSORBER = 96;
export const DT = 0.5;
export const ABSORBER_TUNING = { factor: 13.8, power: 3 }; // sigma_max = factor * c / absorber width
export const MAX_SOURCES = 8;
export const MAX_BETA = 0.1;

export interface Source {
  x: number;
  y: number;
  /** Cycles per time unit. */
  freq: number;
  amp: number;
  phase: number;
  /** Half-length of a line source; 0 is a point source. */
  half: number;
  /** Orientation of the line, radians. */
  angle: number;
}

export interface SolverOptions {
  n?: number;
  absorber?: number;
  beta?: number;
  friction?: number;
}

export function sigmaAt(x: number, y: number, n: number, absorber: number): number {
  if (absorber <= 0) return 0;
  const edge = Math.min(x, y, n - x, n - y);
  const s = Math.min(1, Math.max(0, (absorber - edge) / absorber));
  return (ABSORBER_TUNING.factor / absorber) * Math.pow(s, ABSORBER_TUNING.power);
}

/** Depth on the face between two cells. Zero if either is solid. */
export function faceDepth(a: number, b: number): number {
  return a <= 0 || b <= 0 ? 0 : 0.5 * (a + b);
}

/** Distance from (px, py) to a (possibly zero-length) source segment. */
export function sourceDistance(s: Source, px: number, py: number): number {
  const dx = px - s.x;
  const dy = py - s.y;
  const ca = Math.cos(s.angle);
  const sa = Math.sin(s.angle);
  const along = dx * ca + dy * sa;
  const across = -dx * sa + dy * ca;
  const clamped = Math.min(s.half, Math.max(-s.half, along));
  return Math.hypot(along - clamped, across);
}

export const SOURCE_RADIUS = 1.5;

export function sourceWeight(s: Source, px: number, py: number): number {
  const r = sourceDistance(s, px, py);
  return Math.exp(-(r * r) / (2 * SOURCE_RADIUS * SOURCE_RADIUS));
}

export class WaveSolver {
  readonly n: number;
  readonly absorber: number;
  beta: number;
  friction: number;
  readonly h: Float32Array;
  readonly ux: Float32Array;
  readonly uy: Float32Array;
  readonly d: Float32Array;
  time = 0;

  constructor(options: SolverOptions = {}) {
    this.n = options.n ?? DEFAULT_N;
    this.absorber = options.absorber ?? DEFAULT_ABSORBER;
    this.beta = options.beta ?? 0;
    this.friction = options.friction ?? 0;
    const size = this.n * this.n;
    this.h = new Float32Array(size);
    this.ux = new Float32Array(size);
    this.uy = new Float32Array(size);
    this.d = new Float32Array(size).fill(1);
  }

  idx(i: number, j: number): number {
    return j * this.n + i;
  }

  // Height with a no-flux (Neumann) neighbour: a solid neighbour reads as the centre.
  private hs(ci: number, i: number, j: number): number {
    const n = this.n;
    if (i < 0 || j < 0 || i >= n || j >= n) return this.h[ci]!;
    const k = j * n + i;
    return this.d[k]! <= 0 ? this.h[ci]! : this.h[k]!;
  }

  private q(i: number, j: number): number {
    const n = this.n;
    const c = j * n + i;
    const hc = this.h[c]!;
    if (this.beta === 0) return hc;
    const lap =
      this.hs(c, i + 1, j) + this.hs(c, i - 1, j) + this.hs(c, i, j + 1) + this.hs(c, i, j - 1) - 4 * hc;
    return hc - this.beta * lap;
  }

  stepVelocity(dt = DT): void {
    const { n, absorber, d, ux, uy, friction } = this;
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const c = j * n + i;
        // x-face between (i, j) and (i + 1, j)
        if (i < n - 1) {
          const df = faceDepth(d[c]!, d[c + 1]!);
          if (df === 0) {
            ux[c] = 0;
          } else {
            const sg = sigmaAt(i + 1, j + 0.5, n, absorber);
            const damp = 0.5 * dt * (sg + friction);
            const grad = this.q(i + 1, j) - this.q(i, j);
            ux[c] = ((1 - damp) * ux[c]! - dt * grad) / (1 + damp);
          }
        } else {
          ux[c] = 0;
        }
        // y-face between (i, j) and (i, j + 1)
        if (j < n - 1) {
          const df = faceDepth(d[c]!, d[c + n]!);
          if (df === 0) {
            uy[c] = 0;
          } else {
            const sg = sigmaAt(i + 0.5, j + 1, n, absorber);
            const damp = 0.5 * dt * (sg + friction);
            const grad = this.q(i, j + 1) - this.q(i, j);
            uy[c] = ((1 - damp) * uy[c]! - dt * grad) / (1 + damp);
          }
        } else {
          uy[c] = 0;
        }
      }
    }
  }

  stepHeight(sources: readonly Source[], dt = DT): void {
    const { n, absorber, d, ux, uy, h } = this;
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const c = j * n + i;
        if (d[c]! <= 0) {
          h[c] = 0;
          continue;
        }
        const fxE = i < n - 1 ? faceDepth(d[c]!, d[c + 1]!) * ux[c]! : 0;
        const fxW = i > 0 ? faceDepth(d[c - 1]!, d[c]!) * ux[c - 1]! : 0;
        const fyN = j < n - 1 ? faceDepth(d[c]!, d[c + n]!) * uy[c]! : 0;
        const fyS = j > 0 ? faceDepth(d[c - n]!, d[c]!) * uy[c - n]! : 0;
        const div = fxE - fxW + fyN - fyS;
        let inject = 0;
        for (const s of sources) {
          inject += s.amp * Math.sin(2 * Math.PI * s.freq * this.time + s.phase) * sourceWeight(s, i + 0.5, j + 0.5);
        }
        const damp = 0.5 * dt * sigmaAt(i + 0.5, j + 0.5, n, absorber);
        h[c] = ((1 - damp) * h[c]! - dt * div + dt * inject) / (1 + damp);
      }
    }
    this.time += dt;
  }

  step(sources: readonly Source[] = [], dt = DT): void {
    this.stepVelocity(dt);
    this.stepHeight(sources, dt);
  }

  /** One-shot Gaussian bump (a dropped pebble). */
  addBump(x: number, y: number, amp: number, radius: number): void {
    const { n } = this;
    const r = Math.ceil(radius * 3);
    for (let j = Math.max(0, Math.floor(y) - r); j <= Math.min(n - 1, Math.floor(y) + r); j += 1) {
      for (let i = Math.max(0, Math.floor(x) - r); i <= Math.min(n - 1, Math.floor(x) + r); i += 1) {
        const c = j * n + i;
        if (this.d[c]! <= 0) continue;
        const r2 = (i + 0.5 - x) ** 2 + (j + 0.5 - y) ** 2;
        this.h[c] = this.h[c]! + amp * Math.exp(-r2 / (2 * radius * radius));
      }
    }
  }

  /** Discrete energy density sum: 0.5 * (h^2 + d u^2). Not exactly conserved, but bounded. */
  energy(): number {
    let e = 0;
    const { n, h, ux, uy, d } = this;
    for (let c = 0; c < n * n; c += 1) {
      e += 0.5 * (h[c]! * h[c]! + d[c]! * (ux[c]! * ux[c]! + uy[c]! * uy[c]!));
    }
    return e;
  }
}

/** Wave speed in cells per time unit for a given depth. */
export function waveSpeed(depth: number): number {
  return Math.sqrt(Math.max(depth, 0));
}

/** Wavelength in cells. Includes the beta (capillary-like) correction. */
export function wavelength(freq: number, depth = 1, beta = 0): number {
  const c = waveSpeed(depth);
  const w = 2 * Math.PI * freq;
  if (beta === 0) return c / freq;
  // Solve w^2 = c^2 k^2 (1 + beta k^2) for k.
  const a = c * c * beta;
  const b = c * c;
  const k2 = (-b + Math.sqrt(b * b + 4 * a * w * w)) / (2 * a);
  return (2 * Math.PI) / Math.sqrt(k2);
}
