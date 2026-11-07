// Ampere's law on a flat picture: long straight currents perpendicular to the
// page and a drawn path whose line integral of B is estimated step by step.
// Positions are in meters with y up; positive current is out of the page.

import { MU0, straightWireField } from './biotSavart.ts';

export interface CurrentWire {
  id: number;
  x: number;
  y: number;
  /** Signed current in amperes; positive is out of the page. */
  current: number;
}

export interface PathPoint {
  x: number;
  y: number;
}

/** Distance inside which a wire's field is held constant, in meters. */
export const WIRE_CORE = 0.06;

/** Net field at (x, y) from all the wires, by superposition. */
export function fieldAt(wires: readonly CurrentWire[], x: number, y: number) {
  let bx = 0;
  let by = 0;
  for (const wire of wires) {
    const b = straightWireField(x - wire.x, y - wire.y, wire.current, WIRE_CORE);
    bx += b.x;
    by += b.y;
  }
  return { x: bx, y: by };
}

export interface PathStep {
  start: PathPoint;
  end: PathPoint;
  mid: PathPoint;
  /** Field at the midpoint. */
  bx: number;
  by: number;
  /** B · dl for this step, in T·m. */
  bDotDl: number;
  /** Running total through this step. */
  cumulative: number;
}

/**
 * Close a drawn path when its end lands within `tolerance` of its start, so a
 * loop the reader meant to close is integrated as closed.
 */
export function closePath(points: readonly PathPoint[], tolerance: number): PathPoint[] {
  if (points.length < 3) return [...points];
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.hypot(last.x - first.x, last.y - first.y) <= tolerance) {
    return [...points, { x: first.x, y: first.y }];
  }
  return [...points];
}

/** True when the path returns to its starting point. */
export function isClosedPath(points: readonly PathPoint[]): boolean {
  if (points.length < 4) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(last.x - first.x, last.y - first.y) < 1e-9;
}

/**
 * Split the path into short straight steps and evaluate B · dl at each step's
 * midpoint. The running sum after the final step estimates the line integral.
 */
export function buildPathSteps(
  points: readonly PathPoint[],
  wires: readonly CurrentWire[],
  stepLength: number,
): PathStep[] {
  const steps: PathStep[] = [];
  let cumulative = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const count = Math.max(1, Math.round(length / stepLength));

    for (let k = 0; k < count; k++) {
      const start = { x: a.x + (dx * k) / count, y: a.y + (dy * k) / count };
      const end = { x: a.x + (dx * (k + 1)) / count, y: a.y + (dy * (k + 1)) / count };
      const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      const field = fieldAt(wires, mid.x, mid.y);
      const bDotDl = field.x * (end.x - start.x) + field.y * (end.y - start.y);
      cumulative += bDotDl;
      steps.push({ start, end, mid, bx: field.x, by: field.y, bDotDl, cumulative });
    }
  }

  return steps;
}

/** The line integral of B along the path, in T·m. */
export function lineIntegral(
  points: readonly PathPoint[],
  wires: readonly CurrentWire[],
  stepLength: number,
): number {
  const steps = buildPathSteps(points, wires, stepLength);
  return steps.length === 0 ? 0 : steps[steps.length - 1].cumulative;
}

/**
 * How many times a closed path winds counterclockwise around a point. A simple
 * loop gives +1 (counterclockwise), -1 (clockwise), or 0 (point outside).
 */
export function windingNumber(path: readonly PathPoint[], x: number, y: number): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const ax = path[i].x - x;
    const ay = path[i].y - y;
    const bx = path[i + 1].x - x;
    const by = path[i + 1].y - y;
    total += Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  }
  return Math.round(total / (2 * Math.PI));
}

/**
 * Net current threaded through a closed path, counted along the direction the
 * path was drawn: a counterclockwise loop counts out-of-page current as positive.
 */
export function enclosedCurrent(path: readonly PathPoint[], wires: readonly CurrentWire[]): number {
  return wires.reduce((sum, wire) => sum + wire.current * windingNumber(path, wire.x, wire.y), 0);
}

/** Ampere's law prediction for a closed path: mu0 times the enclosed current. */
export function ampereRightSide(path: readonly PathPoint[], wires: readonly CurrentWire[]): number {
  return MU0 * enclosedCurrent(path, wires);
}

/** Format a line integral in T·m with a sensible prefix. */
export function formatLineIntegral(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs < 5e-13) return '0 T·m';
  if (abs >= 1) return `${value.toPrecision(3)} T·m`;
  if (abs >= 1e-3) return `${(value * 1e3).toFixed(3)} mT·m`;
  if (abs >= 1e-6) return `${(value * 1e6).toFixed(3)} µT·m`;
  return `${(value * 1e9).toFixed(3)} nT·m`;
}
