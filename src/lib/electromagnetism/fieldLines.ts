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
//
// The other half of reading a flux diagram is spacing: a reader takes crowded
// curves to mean a strong field. Equal-angle seeding delivers that only for an
// isolated charge, whose seed ring sees the same field strength all the way
// round. Put that charge in a row of others facing a row of the opposite sign
// and the ring still fires half its lines out the back, into the field the two
// rows nearly cancel, and half into the strong field between them. So seeds are
// placed at equal increments of flux through a probe circle instead: the same
// ring for the isolated charge, and lines that follow the field everywhere else.

import {
  COULOMB_K,
  coulombFieldAt,
  fieldFromCharge,
  type PointCharge,
} from "./index.ts";

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
  // Chosen against the charged-rows preset: 1.5 lets the fringing lines complete
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

/**
 * Probe circle radius, as a multiple of the spacing of the charge's like-sign
 * neighbours. That spacing is the scale at which a row of point charges stops
 * looking like separate points and starts acting as one sheet of charge, which
 * is exactly the scale the flux profile has to see. Inside it the charge's own
 * 1/r² field swamps everything else and the profile flattens back to a ring.
 */
const PROBE_PER_NEIGHBOUR = 1.2;
/** Radius for a charge with no like-sign neighbour, in seed-ring radii. */
const PROBE_ISOLATED = 1.5;
/**
 * The probe circle stays this fraction of the way to the nearest charge of any
 * sign, in every direction — a circle, not a curve pushed out where there is
 * room. A 2D slice of a 1/r² field has no radius-independent flux (the flux a
 * wedge carries falls off as 1/r), so shares read at different radii are not
 * comparable and a curve that bulges reads as a field that fades. And reaching
 * past a neighbour samples its near field pointing outward: one enormous spike
 * that swallows every seed, which is how two like charges end up with all their
 * lines crammed into the null between them.
 */
const PROBE_CLEARANCE = 0.9;
/** Flux samples around the probe circle, per line seeded, and a floor. */
const FLUX_SAMPLES_PER_LINE = 16;
const MIN_FLUX_SAMPLES = 180;

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
 * Where a charge's seeds are counted from: the direction the rest of the scene
 * pushes this charge's own flux, which for a charge in a row is across the gap
 * and for a lone charge is nothing in particular.
 *
 * Equal shares of a flux profile are a partition of a circle, and a partition
 * has to start somewhere — shift the start and every seed moves. Two things pin
 * the choice. It has to survive any symmetry of the scene: mirror two facing
 * rows and the sources become the sinks, so a mirrored source has to quantise
 * to the partition its sink already chose, or the two ends seed different lines
 * and the same physical curve gets drawn twice. The external field is a vector of
 * the scene and mirrors with it, once the charge's own sign is divided out;
 * a fixed angle or an offset from a neighbour direction would not.
 *
 * And it has to land somewhere flux actually leaves by. Anchoring on the
 * nearest like-sign neighbour — the direction a seed would walk into the null
 * point — puts the first share on a stretch of profile that is flat zero, where
 * the partition is degenerate and picks an edge of the dead wedge by the
 * accident of which way the angles run. The external field points the other
 * way, into the strongest flux there is. For a charge with nothing around it
 * there is no external field and the anchor is 0, which is what keeps a line on
 * the axis of a dipole — the one every textbook sketch draws.
 */
export function seedAnchor(
  charges: readonly PointCharge[],
  index: number,
  softenSquared = DEFAULTS.softenSquared,
): number {
  const self = charges[index];
  let ex = 0;
  let ey = 0;
  for (let i = 0; i < charges.length; i++) {
    if (i === index) continue;
    const f = fieldFromCharge(
      charges[i].q,
      self.x - charges[i].x,
      self.y - charges[i].y,
      softenSquared,
    );
    ex += f.x;
    ey += f.y;
  }
  // Divided by this charge's own sign, so a sink anchors where its lines
  // arrive from rather than the reverse.
  const sign = Math.sign(self.q);
  if (sign === 0 || (ex === 0 && ey === 0)) return 0;
  return Math.atan2(sign * ey, sign * ex);
}

/**
 * Radius of the circle whose flux profile decides where a charge's seeds go.
 *
 * Exported so the choice can be checked directly: it is the one number that
 * decides whether the profile sees a lone charge or a row of them.
 */
export function probeRadius(
  charges: readonly PointCharge[],
  index: number,
  seedRadius: number,
): number {
  const self = charges[index];
  let nearestLike = Infinity;
  let nearestAny = Infinity;
  for (let i = 0; i < charges.length; i++) {
    if (i === index || charges[i].q === 0) continue;
    const d = Math.hypot(charges[i].x - self.x, charges[i].y - self.y);
    if (d === 0) continue;
    if (d < nearestAny) nearestAny = d;
    if (Math.sign(charges[i].q) === Math.sign(self.q) && d < nearestLike) {
      nearestLike = d;
    }
  }
  const wanted = Number.isFinite(nearestLike)
    ? Math.max(PROBE_PER_NEIGHBOUR * nearestLike, seedRadius * PROBE_ISOLATED)
    : seedRadius * PROBE_ISOLATED;
  return Math.min(wanted, PROBE_CLEARANCE * nearestAny);
}

/**
 * Where to start a charge's lines: `count` angles carrying equal flux each.
 *
 * The profile is the outward component of the net field around the probe
 * circle, clipped at zero — an angle the field points back through is one no
 * line leaves by, and a seed fired there would only walk into a null point.
 * Partitioning that profile into equal shares is the flux-tube rule the whole
 * diagram is read by, applied at the one place a line's fate is still ours to
 * choose. An isolated charge has a flat profile and so keeps the even ring
 * this replaces, anchor and all; a charge in a row sends most of its share
 * into the gap, because that is where most of its flux goes.
 */
export function seedAngles(
  charges: readonly PointCharge[],
  index: number,
  count: number,
  options: { seedRadius?: number; softenSquared?: number } = {},
): number[] {
  if (count <= 0) return [];
  const seedRadius = options.seedRadius ?? DEFAULTS.seedRadius;
  const softenSquared = options.softenSquared ?? DEFAULTS.softenSquared;
  const anchor = seedAnchor(charges, index, softenSquared);
  const uniform = () =>
    Array.from({ length: count }, (_, j) => anchor + (2 * Math.PI * j) / count);

  const self = charges[index];
  const radius = probeRadius(charges, index, seedRadius);
  if (!(radius > 0)) return uniform();

  const sign = Math.sign(self.q);
  const samples = Math.max(MIN_FLUX_SAMPLES, count * FLUX_SAMPLES_PER_LINE);
  const flux = new Float64Array(samples);
  const cumulative = new Float64Array(samples + 1);
  for (let m = 0; m < samples; m++) {
    // Sampled at the bin's midpoint, not its edge. A mirror of the scene maps
    // midpoints to midpoints but left edges to right ones, and a source and the
    // sink mirroring it have to quantise their profiles to the same partition
    // or the same physical line gets seeded from both ends and drawn twice.
    const theta = anchor + (2 * Math.PI * (m + 0.5)) / samples;
    const nx = Math.cos(theta);
    const ny = Math.sin(theta);
    const f = coulombFieldAt(
      charges,
      self.x + radius * nx,
      self.y + radius * ny,
      softenSquared,
    );
    const outward = sign * (f.x * nx + f.y * ny);
    flux[m] = outward > 0 ? outward : 0;
    cumulative[m + 1] = cumulative[m] + flux[m];
  }

  const total = cumulative[samples];
  if (!(total > 0)) return uniform();

  // Invert the cumulative profile. With a flat profile every share falls
  // exactly on `anchor + 2πj/count`, so the isolated charge is untouched.
  const angles: number[] = [];
  let bin = 0;
  for (let j = 0; j < count; j++) {
    const target = (j / count) * total;
    while (bin < samples - 1 && cumulative[bin + 1] <= target) bin++;
    const share = flux[bin];
    const within = share > 0 ? (target - cumulative[bin]) / share : 0;
    angles.push(anchor + (2 * Math.PI * (bin + within)) / samples);
  }
  return angles;
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
    const out: TraceResult[] = [];
    for (const theta of seedAngles(charges, index, n, { seedRadius, softenSquared })) {
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
