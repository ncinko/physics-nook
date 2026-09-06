// Electric field line tracing for the potential/field explorers.
//
// Field lines are a flux diagram, not a bag of independent curves: every line
// leaving a positive charge has to arrive somewhere, and each charge should
// carry a number of line ends proportional to |q|. Seeding a ring around every
// charge and tracing each seed independently breaks both promises. The same
// physical line gets drawn once forward from its source and again backward from
// its sink, so it reads as two lines that nearly but never quite coincide, and
// sinks end up with roughly twice as many ends as sources. This module traces
// from sources only, and keeps a sink-seeded line just when it arrives from
// outside the scene, so every drawn curve is one physical line.

import { COULOMB_K, coulombFieldAt, type PointCharge } from "./index.ts";

export type FieldLineEnd =
  /** Reached a charge of the opposite sign: the line terminates there. */
  | "sink"
  /** Left the padded integration domain — headed for infinity. */
  | "escaped"
  /** Ran into a null point (the saddle between like charges). */
  | "null"
  /** Hit the arc-length budget with the tail still unresolved. */
  | "budget";

export interface FieldLine {
  /** Index into `charges` of the charge this line was seeded from. */
  seedCharge: number;
  /** Index of the charge it terminated on, or null if it never reached one. */
  endCharge: number | null;
  end: FieldLineEnd;
  /** +1 if traced along E (seeded on a source), -1 if traced against it. */
  direction: 1 | -1;
  /** Arc length in canvas px, counting the parts outside the viewport. */
  length: number;
  /**
   * Visible pieces of the polyline, each a flat `[x0, y0, x1, y1, ...]` in
   * canvas coordinates. A line that leaves the frame and loops back is one
   * FieldLine with two pieces, not two lines.
   */
  segments: number[][];
}

export interface FieldLineOptions {
  width: number;
  height: number;
  /** Lines drawn for a charge whose magnitude is `referenceCharge`. */
  linesPerReferenceCharge?: number;
  referenceCharge?: number;
  /** Fewest / most lines any one charge may get, before the global cap. */
  minLinesPerCharge?: number;
  maxLinesPerCharge?: number;
  /** Cap on the total. Counts scale together so flux stays proportional to |q|. */
  maxLines?: number;
  /** Radius of the seed ring, and of the disc that captures an arriving line. */
  seedRadius?: number;
  /** r-squared softening of the field sampler; match the renderer. */
  softenSquared?: number;
  /**
   * How far past the viewport integration continues, as a fraction of the
   * longer side. Lines that bulge out of frame and return need this room; cut
   * off at the edge instead, they look like they never arrive anywhere.
   */
  margin?: number;
  /** Largest direction change accepted in one step, in degrees. */
  maxTurnDegrees?: number;
  /** Arc-length budget per line, in viewport diagonals. */
  arcBudget?: number;
}

const DEFAULTS = {
  linesPerReferenceCharge: 12,
  referenceCharge: 1e-6,
  minLinesPerCharge: 4,
  maxLinesPerCharge: 24,
  maxLines: 200,
  seedRadius: 10,
  softenSquared: 25,
  // Chosen against the capacitor preset: 1.5 lets the fringing lines complete
  // their loop outside the frame, and past that the extra tracing buys very
  // few extra source-to-sink connections.
  margin: 1.5,
  maxTurnDegrees: 7,
  arcBudget: 12,
};

/** Below this fraction of the nearby single-charge field scale, call it a null. */
const NULL_FIELD_FRACTION = 0.02;
/** Step length as a fraction of the distance to the nearest charge. */
const STEP_PER_DISTANCE = 0.3;
const MIN_STEP_PX = 0.35;
/** How fast the step may grow back after the field forces it down. */
const STEP_GROWTH = 1.5;
const MAX_STEP_HALVINGS = 6;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Liang-Barsky. Returns the clipped endpoints, or null if fully outside. */
function clipSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rect: Rect,
): [number, number, number, number] | null {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const edges: Array<[number, number]> = [
    [-dx, ax - rect.x0],
    [dx, rect.x1 - ax],
    [-dy, ay - rect.y0],
    [dy, rect.y1 - ay],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy];
}

/**
 * Clip a flat polyline to `rect`, returning the pieces that lie inside, in path
 * order — so a line that leaves the frame and re-enters stays one line made of
 * two drawable runs rather than becoming two lines.
 */
export function clipPolyline(points: readonly number[], rect: Rect): number[][] {
  const pieces: number[][] = [];
  let current: number[] = [];

  const flush = () => {
    if (current.length >= 4) pieces.push(current);
    current = [];
  };

  for (let i = 0; i + 3 < points.length; i += 2) {
    const ax = points[i];
    const ay = points[i + 1];
    const bx = points[i + 2];
    const by = points[i + 3];
    const clipped = clipSegment(ax, ay, bx, by, rect);
    if (!clipped) {
      flush();
      continue;
    }
    const [cx0, cy0, cx1, cy1] = clipped;
    // The run continues only while the clipped start still sits where the
    // previous step ended; otherwise the line went outside in between.
    const continues =
      current.length >= 2 &&
      Math.abs(current[current.length - 2] - cx0) < 1e-9 &&
      Math.abs(current[current.length - 1] - cy0) < 1e-9;
    if (!continues) {
      flush();
      current = [cx0, cy0];
    }
    current.push(cx1, cy1);
    const bInside =
      bx >= rect.x0 && bx <= rect.x1 && by >= rect.y0 && by <= rect.y1;
    if (!bInside) flush();
  }
  flush();
  return pieces;
}

export interface TraceConfig {
  charges: readonly PointCharge[];
  domain: Rect;
  seedRadius: number;
  softenSquared: number;
  /** Largest accepted turn per step, in radians. */
  maxTurn: number;
  /** Arc-length budget in px. */
  arcBudget: number;
  maxStep: number;
  maxAbsCharge: number;
}

export interface TraceResult {
  points: number[];
  end: FieldLineEnd;
  endCharge: number | null;
  length: number;
}

/**
 * Integrate one field line from (x0, y0) with RK4 on the unit field.
 *
 * Normalising the field makes the step a true arc length, so the step can be
 * chosen from geometry rather than from field strength: shrink it where the
 * curve bends hard near a charge, let it stretch out in the smooth far field.
 * The accept test is the turn angle across the step, which is what actually
 * governs how polygonal the drawn curve looks — the old fixed-step integrator
 * paid for its short steps everywhere and still had to guess at reversals.
 */
export function traceFieldLine(
  x0: number,
  y0: number,
  direction: 1 | -1,
  cfg: TraceConfig,
): TraceResult {
  const { charges, domain, seedRadius, softenSquared, maxAbsCharge } = cfg;
  const points: number[] = [x0, y0];
  let x = x0;
  let y = y0;
  let length = 0;
  let step = cfg.maxStep;

  const unitAt = (px: number, py: number): [number, number, number] => {
    const f = coulombFieldAt(charges, px, py, softenSquared);
    const mag = Math.hypot(f.x, f.y);
    if (mag === 0) return [0, 0, 0];
    return [(f.x / mag) * direction, (f.y / mag) * direction, mag];
  };

  const nearestDistance = (px: number, py: number) => {
    let best = Infinity;
    for (let i = 0; i < charges.length; i++) {
      const d = Math.hypot(px - charges[i].x, py - charges[i].y);
      if (d < best) best = d;
    }
    return best;
  };

  const cosMaxTurn = Math.cos(cfg.maxTurn);

  for (;;) {
    const near = nearestDistance(x, y);
    const [ux, uy, mag] = unitAt(x, y);
    if (mag === 0) return { points, end: "null", endCharge: null, length };

    // A null point is where the superposition cancels: the field there is tiny
    // next to what the nearby charge would produce on its own.
    const localScale = (COULOMB_K * maxAbsCharge) / (near * near + softenSquared);
    if (mag < NULL_FIELD_FRACTION * localScale) {
      return { points, end: "null", endCharge: null, length };
    }

    // Capping the step at a fraction of the distance to the *nearest* charge
    // also guarantees a step can never jump clean over a capture disc.
    const ceiling = Math.min(
      cfg.maxStep,
      Math.max(MIN_STEP_PX, STEP_PER_DISTANCE * near),
    );
    let h = Math.min(ceiling, step * STEP_GROWTH);
    let nx = x;
    let ny = y;

    for (let attempt = 0; ; attempt++) {
      const [k2x, k2y] = unitAt(x + 0.5 * h * ux, y + 0.5 * h * uy);
      const [k3x, k3y] = unitAt(x + 0.5 * h * k2x, y + 0.5 * h * k2y);
      const [k4x, k4y] = unitAt(x + h * k3x, y + h * k3y);
      nx = x + (h / 6) * (ux + 2 * k2x + 2 * k3x + k4x);
      ny = y + (h / 6) * (uy + 2 * k2y + 2 * k3y + k4y);
      const [vx, vy] = unitAt(nx, ny);
      const turnOk = ux * vx + uy * vy >= cosMaxTurn;
      if (turnOk || h <= MIN_STEP_PX || attempt >= MAX_STEP_HALVINGS) break;
      h *= 0.5;
    }

    const moved = Math.hypot(nx - x, ny - y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || moved === 0) {
      return { points, end: "null", endCharge: null, length };
    }

    x = nx;
    y = ny;
    step = h;
    length += moved;
    points.push(x, y);

    // Only a charge that is a sink for this travel direction may end the line.
    // The old code stopped at whatever charge came within 10 px, so a forward
    // line grazing another positive charge died there, pointing the wrong way.
    for (let i = 0; i < charges.length; i++) {
      const c = charges[i];
      if (c.q * direction >= 0) continue;
      if (Math.hypot(x - c.x, y - c.y) <= seedRadius) {
        return { points, end: "sink", endCharge: i, length };
      }
    }

    if (x < domain.x0 || x > domain.x1 || y < domain.y0 || y > domain.y1) {
      return { points, end: "escaped", endCharge: null, length };
    }
    if (length > cfg.arcBudget) {
      return { points, end: "budget", endCharge: null, length };
    }
  }
}

/**
 * How many lines each charge gets. Counts stay proportional to |q| so the drawn
 * density still reads as flux, and the global cap scales every charge together
 * rather than starving whichever charges happen to sit last in the array.
 */
export function allocateLineCounts(
  charges: readonly PointCharge[],
  options: Pick<
    FieldLineOptions,
    | "linesPerReferenceCharge"
    | "referenceCharge"
    | "minLinesPerCharge"
    | "maxLinesPerCharge"
    | "maxLines"
  > = {},
): number[] {
  const perRef = options.linesPerReferenceCharge ?? DEFAULTS.linesPerReferenceCharge;
  const ref = options.referenceCharge ?? DEFAULTS.referenceCharge;
  const min = options.minLinesPerCharge ?? DEFAULTS.minLinesPerCharge;
  const max = options.maxLinesPerCharge ?? DEFAULTS.maxLinesPerCharge;
  const budget = options.maxLines ?? DEFAULTS.maxLines;

  const raw = charges.map((c) =>
    c.q === 0
      ? 0
      : Math.min(max, Math.max(min, Math.round((perRef * Math.abs(c.q)) / ref))),
  );
  const total = raw.reduce((sum, n) => sum + n, 0);
  if (total <= budget) return raw;

  const scale = budget / total;
  return raw.map((n) => (n === 0 ? 0 : Math.max(2, Math.round(n * scale))));
}

/**
 * Angle offset for a charge's seed ring. A seed fired straight at a like-sign
 * neighbour walks into the null point between them and draws as a stub, so the
 * ring is rotated to straddle that direction instead of landing on it. With no
 * like-sign neighbour the phase stays 0, which puts a line on the axis of a
 * dipole — the one every textbook sketch draws.
 */
export function seedPhase(
  charges: readonly PointCharge[],
  index: number,
  count: number,
): number {
  const self = charges[index];
  let best = Infinity;
  let angle: number | null = null;
  for (let i = 0; i < charges.length; i++) {
    if (i === index) continue;
    const other = charges[i];
    if (Math.sign(other.q) !== Math.sign(self.q)) continue;
    const d = Math.hypot(other.x - self.x, other.y - self.y);
    if (d < best) {
      best = d;
      angle = Math.atan2(other.y - self.y, other.x - self.x);
    }
  }
  return angle === null ? 0 : angle + Math.PI / count;
}

/** Trace the field lines for a scene, ready to stroke in canvas coordinates. */
export function computeFieldLines(
  charges: readonly PointCharge[],
  options: FieldLineOptions,
): FieldLine[] {
  const { width, height } = options;
  if (width <= 0 || height <= 0) return [];
  if (!charges.some((c) => c.q !== 0)) return [];

  const seedRadius = options.seedRadius ?? DEFAULTS.seedRadius;
  const softenSquared = options.softenSquared ?? DEFAULTS.softenSquared;
  const margin = (options.margin ?? DEFAULTS.margin) * Math.max(width, height);
  const diagonal = Math.hypot(width, height);
  const counts = allocateLineCounts(charges, options);
  const maxAbsCharge = charges.reduce((m, c) => Math.max(m, Math.abs(c.q)), 0);

  const cfg: TraceConfig = {
    charges,
    domain: { x0: -margin, y0: -margin, x1: width + margin, y1: height + margin },
    seedRadius,
    softenSquared,
    maxTurn: ((options.maxTurnDegrees ?? DEFAULTS.maxTurnDegrees) * Math.PI) / 180,
    arcBudget: (options.arcBudget ?? DEFAULTS.arcBudget) * diagonal,
    maxStep: Math.max(2, Math.min(width, height) / 40),
    maxAbsCharge,
  };
  const viewport: Rect = { x0: 0, y0: 0, x1: width, y1: height };

  const lines: FieldLine[] = [];
  const emit = (seedCharge: number, direction: 1 | -1, result: TraceResult) => {
    const segments = clipPolyline(result.points, viewport);
    if (!segments.length) return;
    lines.push({
      seedCharge,
      endCharge: result.endCharge,
      end: result.end,
      direction,
      length: result.length,
      segments,
    });
  };

  const seed = (index: number, direction: 1 | -1): TraceResult[] => {
    const n = counts[index];
    if (n <= 0) return [];
    const phase = seedPhase(charges, index, n);
    const out: TraceResult[] = [];
    for (let j = 0; j < n; j++) {
      const theta = phase + (2 * Math.PI * j) / n;
      out.push(
        traceFieldLine(
          charges[index].x + seedRadius * Math.cos(theta),
          charges[index].y + seedRadius * Math.sin(theta),
          direction,
          cfg,
        ),
      );
    }
    return out;
  };

  // Sources: every line leaving a positive charge is drawn.
  for (let i = 0; i < charges.length; i++) {
    if (charges[i].q <= 0) continue;
    for (const result of seed(i, 1)) emit(i, 1, result);
  }

  // Sinks: a line traced back from a negative charge to a positive one is the
  // same physical line the source pass already drew, so only the ones arriving
  // from outside the scene are kept. That is what keeps the ends-per-charge
  // count even instead of doubling at every sink.
  for (let i = 0; i < charges.length; i++) {
    if (charges[i].q >= 0) continue;
    for (const result of seed(i, -1)) {
      if (result.end === "sink" || result.end === "budget") continue;
      emit(i, -1, result);
    }
  }

  return lines;
}
