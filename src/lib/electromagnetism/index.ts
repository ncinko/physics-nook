// Pure, DOM-free electromagnetism model logic.
// Rendering and controls live in src/components/electromagnetism; this module
// owns the deterministic physics so it can be unit tested in tests/electromagnetism.

export interface Vec2 {
  x: number;
  y: number;
}

/** A point charge positioned in screen/world space. `q` is in coulombs. */
export interface PointCharge {
  x: number;
  y: number;
  q: number;
}

/** Coulomb's constant in N·m²/C². The legacy site used 9e9; kept for parity. */
export const COULOMB_K = 9e9;

/** Elementary charge magnitude (C) and electron mass (kg) for the Drude model. */
export const ELEMENTARY_CHARGE = 1.602e-19;
export const ELECTRON_MASS = 9.109e-31;

/**
 * Electric field contribution of a single charge at a displacement (dx, dy)
 * pointing from the charge to the field point.
 *
 * `softenSquared` adds a constant to r² to tame the 1/r² singularity near the
 * core (the field sims pass a few px²); pass 0 for the exact physics.
 */
export function fieldFromCharge(
  q: number,
  dx: number,
  dy: number,
  softenSquared = 0,
): Vec2 {
  const r2 = dx * dx + dy * dy + softenSquared;
  if (r2 === 0) {
    return { x: 0, y: 0 };
  }
  const r = Math.sqrt(r2);
  const eMag = (COULOMB_K * q) / r2;
  return { x: eMag * (dx / r), y: eMag * (dy / r) };
}

/** Net electric field at (x, y) from a set of charges (superposition principle). */
export function coulombFieldAt(
  charges: readonly PointCharge[],
  x: number,
  y: number,
  softenSquared = 25,
): Vec2 {
  let ex = 0;
  let ey = 0;
  for (const c of charges) {
    const contribution = fieldFromCharge(c.q, x - c.x, y - c.y, softenSquared);
    ex += contribution.x;
    ey += contribution.y;
  }
  return { x: ex, y: ey };
}

/** Field magnitude of a single point charge a distance r away: k|q|/r². */
export function fieldMagnitude(q: number, r: number): number {
  if (r <= 0) return Infinity;
  return (COULOMB_K * Math.abs(q)) / (r * r);
}

/** Electric potential of a single point charge a distance r away: kQ/r. */
export function pointPotential(q: number, r: number): number {
  if (r <= 0) return Infinity;
  return (COULOMB_K * q) / r;
}

/**
 * Net electric potential at (x, y) from a set of charges. Points closer than
 * `minDistance` to a charge are skipped to avoid the 1/r singularity.
 */
export function potentialAt(
  charges: readonly PointCharge[],
  x: number,
  y: number,
  minDistance = 5,
): number {
  let v = 0;
  for (const c of charges) {
    const dx = x - c.x;
    const dy = y - c.y;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r < minDistance) continue;
    v += (COULOMB_K * c.q) / r;
  }
  return v;
}

/**
 * Drude drift velocity of conduction electrons in a field E (V/m):
 * v_d = -eEτ/mₑ. Negative because electrons drift opposite the field.
 */
export function driftVelocity(
  field: number,
  tau: number,
  charge = ELEMENTARY_CHARGE,
  mass = ELECTRON_MASS,
): number {
  return -(charge * field * tau) / mass;
}

/** Drude conductivity σ = n e² τ / mₑ for carrier density n (per m³). */
export function conductivity(
  carrierDensity: number,
  tau: number,
  charge = ELEMENTARY_CHARGE,
  mass = ELECTRON_MASS,
): number {
  return (carrierDensity * charge * charge * tau) / mass;
}

/** Equivalent resistance of resistors in series: R = ΣRᵢ. */
export function seriesResistance(resistances: readonly number[]): number {
  return resistances.reduce((sum, r) => sum + r, 0);
}

/** Equivalent resistance of resistors in parallel: 1/R = Σ(1/Rᵢ). */
export function parallelResistance(resistances: readonly number[]): number {
  if (resistances.length === 0) return Infinity;
  const inverseSum = resistances.reduce((sum, r) => sum + 1 / r, 0);
  return inverseSum === 0 ? Infinity : 1 / inverseSum;
}
