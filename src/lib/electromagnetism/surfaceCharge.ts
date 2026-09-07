// Surface charge is where the microscopic and macroscopic pictures of a
// conductor meet. Nothing pushes charge along a wire except the electric field
// inside the metal, and that field is produced by charge sitting on the
// conductor's own surface. Two regimes matter for the current chapter:
//
//   1. Electrostatics. Drop a conducting block into an external field and its
//      mobile electrons pile onto one face until their own field cancels the
//      applied one. The interior field decays to zero.
//   2. Steady current. Close a switch onto a battery and a resistor and the same
//      relaxation runs, but it cannot finish: the battery keeps pumping charge,
//      so the surfaces settle into a *gradient* of charge that leaves a small
//      field pointing along the wire everywhere, steering the current around
//      corners and concentrating the potential drop in the resistor.
//
// Both models here are deterministic and DOM-free; rendering lives in
// src/components/electromagnetism.

import { EPSILON_0 } from './gauss.ts';

/* -------------------------------------------------------------------------
 * 1. A conducting block in a uniform external field
 * ---------------------------------------------------------------------- */

/**
 * Dielectric relaxation time tau = eps0/sigma, the time constant with which a
 * conductor screens a field out of its own interior. Copper's sigma of about
 * 5.8e7 S/m gives tau ~ 1.5e-19 s, which is why the block picture looks
 * instantaneous.
 */
export function relaxationTime(conductivity: number): number {
  if (!(conductivity > 0)) return Infinity;
  return EPSILON_0 / conductivity;
}

export interface SlabPolarization {
  /** How far screening has run, 1 - e^(-t/tau), from 0 (bare) to 1 (complete). */
  fraction: number;
  /** Field still surviving inside the block, in the units of `externalField`. */
  internalField: number;
  /** Field the induced surface charge contributes, opposite the applied one. */
  inducedField: number;
  /** Magnitude of the induced surface charge density on each face, in C/m². */
  surfaceChargeDensity: number;
  /** Conduction current density still feeding the faces, in A/m². */
  currentDensity: number;
}

/**
 * Screening of a uniform field by a conducting slab whose faces are normal to
 * the field.
 *
 * Charge arriving at a face is the conduction current that got there, so
 * dq/dt = J = sigma_c * E_in, while the two charged faces act as a
 * parallel-plate pair and pull the interior field down to E_in = E0 - q/eps0.
 * Eliminating E_in,
 *
 *     dq/dt = (sigma_c/eps0)(eps0*E0 - q)  =>  q(t) = eps0*E0(1 - e^(-t/tau)),
 *
 * with tau = eps0/sigma_c, so the interior field decays as E0*e^(-t/tau) and
 * the faces saturate at eps0*E0.
 */
export function slabPolarization(
  externalField: number,
  elapsed: number,
  tau: number,
): SlabPolarization {
  const t = Math.max(0, elapsed);
  const fraction =
    tau > 0 && Number.isFinite(tau) ? 1 - Math.exp(-t / tau) : t > 0 ? 1 : 0;
  const internalField = externalField * (1 - fraction);
  const conductivity = tau > 0 && Number.isFinite(tau) ? EPSILON_0 / tau : Infinity;
  return {
    fraction,
    internalField,
    inducedField: externalField * fraction,
    surfaceChargeDensity: EPSILON_0 * externalField * fraction,
    currentDensity: Number.isFinite(conductivity) ? conductivity * internalField : 0,
  };
}

/* -------------------------------------------------------------------------
 * 2. A circuit loop: battery, wire, switch, resistor
 * ---------------------------------------------------------------------- */

export type LoopElementKind = 'wire' | 'battery' | 'resistor' | 'switch';

/** One stretch of the loop, laid end to end in the direction of positive `s`. */
export interface LoopElement {
  id: string;
  kind: LoopElementKind;
  /** Arc length occupied along the loop; any consistent unit will do. */
  length: number;
  /** Resistance of the whole element, in ohms. An open switch is a huge one. */
  resistance: number;
  /** EMF in volts, positive when it lifts potential in the +s direction. */
  emf?: number;
}

export interface LoopSolution {
  /** Total EMF driving the loop, in volts. */
  emf: number;
  /** Total loop resistance, in ohms. */
  resistance: number;
  /** Steady current, in amperes, positive in the +s direction. */
  current: number;
  /** Perimeter of the loop in arc units. */
  length: number;
}

export interface LoopSample {
  /** Arc position along the loop, 0 <= s < perimeter. */
  s: number;
  elementId: string;
  kind: LoopElementKind;
  /**
   * Potential in volts, referred to the loop's own mean potential. Surface
   * charge density is proportional to it in the thin-wire approximation: a
   * conductor's surface carries whatever charge holds it at the potential the
   * circuit demands there, and referring it to the mean is what leaves the loop
   * with no net charge.
   */
  potential: number;
  /** Tangential field inside the conductor, in volts per arc unit. */
  field: number;
  /** Current in amperes flowing here. */
  current: number;
}

/** Kirchhoff's loop rule for a single series loop: I = sum(emf) / sum(R). */
export function solveLoop(elements: readonly LoopElement[]): LoopSolution {
  let emf = 0;
  let resistance = 0;
  let length = 0;
  for (const element of elements) {
    emf += element.emf ?? 0;
    resistance += element.resistance;
    length += element.length;
  }
  return { emf, resistance, current: resistance > 0 ? emf / resistance : 0, length };
}

const perimeterOf = (elements: readonly LoopElement[]): number =>
  elements.reduce((sum, element) => sum + element.length, 0);

/**
 * The settled potential, field, and current at `count` points evenly spaced
 * around the loop.
 *
 * The potential comes from walking the loop and applying the loop rule
 * piecewise: EMF lifts it inside a battery, and every resistive element drops
 * it by I*R spread evenly along its length. Subtracting the loop's mean leaves
 * a profile with no net charge, as an isolated circuit must have.
 *
 * Nothing here needs to know whether a switch is open. An open switch is just
 * an element with an enormous resistance, which drives the current to zero and
 * moves the entire drop into its own span - and that is the physics: breaking a
 * circuit does not clear the surface charge, it rearranges it so that each
 * branch sits at the potential of the terminal it still reaches.
 */
export function sampleLoop(elements: readonly LoopElement[], count: number): LoopSample[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('sampleLoop needs a positive integer sample count.');
  }
  const { length: perimeter, current } = solveLoop(elements);
  if (!(perimeter > 0)) return [];

  const starts: number[] = [];
  let cursor = 0;
  for (const element of elements) {
    starts.push(cursor);
    cursor += element.length;
  }

  const raw: { sample: LoopSample; potential: number }[] = [];
  for (let k = 0; k < count; k++) {
    const s = ((k + 0.5) * perimeter) / count;
    let index = elements.length - 1;
    while (index > 0 && s < starts[index]) index -= 1;
    const element = elements[index];
    const local = element.length > 0 ? (s - starts[index]) / element.length : 0;

    // Walk the loop rule from s = 0 to here.
    let potential = 0;
    for (let i = 0; i < index; i++) {
      potential += (elements[i].emf ?? 0) - current * elements[i].resistance;
    }
    potential += local * ((element.emf ?? 0) - current * element.resistance);

    raw.push({
      potential,
      sample: {
        s,
        elementId: element.id,
        kind: element.kind,
        potential: 0,
        field: element.length > 0 ? (current * element.resistance) / element.length : 0,
        current,
      },
    });
  }

  const mean = raw.reduce((sum, entry) => sum + entry.potential, 0) / raw.length;
  return raw.map(({ sample, potential }) => ({ ...sample, potential: potential - mean }));
}

/**
 * How completely a point `distance` from the change has taken it up, once the
 * disturbance has spread `frontReach` along the wire.
 *
 * Throwing a switch does not change the whole loop at once. A rearrangement
 * spreads from both sides of whatever changed at close to the speed of light,
 * and only once it has passed a point does charge there begin to relax toward
 * its new value - exponentially, over the length `relaxationLength`.
 */
export function establishment(
  distance: number,
  frontReach: number,
  relaxationLength: number,
): number {
  if (!Number.isFinite(frontReach)) return 1;
  const behind = frontReach - Math.max(0, distance);
  if (behind <= 0) return 0;
  if (!(relaxationLength > 0)) return 1;
  return 1 - Math.exp(-behind / relaxationLength);
}

export interface LoopTransitionSample extends LoopSample {
  /** Arc distance to the nearer end of the element that changed. */
  distanceFromOrigin: number;
  /** How far this point has relaxed from the old state to the new one, 0 to 1. */
  established: number;
}

export interface TransitionOptions {
  /** Id of the element that changed; the fronts leave both of its ends. */
  originId: string;
  /** Arc length the fronts have covered so far. Infinity for the settled result. */
  frontReach: number;
  /** Relaxation length behind a front. Defaults to a twelfth of the loop. */
  relaxationLength?: number;
}

/**
 * A snapshot part-way through the loop's change from one settled state to
 * another - throwing a switch, in practice.
 *
 * Every point is blended from `from` toward `to` by how far the disturbance has
 * reached it, so wire ahead of the fronts still holds the old arrangement while
 * wire behind them holds the new one. The mean is removed again afterwards:
 * charge in flight has to have come from somewhere else on the loop, so the
 * total stays zero at every instant.
 */
export function transitionSnapshot(
  elements: readonly LoopElement[],
  from: readonly LoopSample[],
  to: readonly LoopSample[],
  options: TransitionOptions,
): LoopTransitionSample[] {
  if (from.length !== to.length) {
    throw new Error('transitionSnapshot needs both profiles sampled the same way.');
  }
  const perimeter = perimeterOf(elements);
  if (!(perimeter > 0) || to.length === 0) return [];

  let originStart = -1;
  let originLength = 0;
  let cursor = 0;
  for (const element of elements) {
    if (element.id === options.originId) {
      originStart = cursor;
      originLength = element.length;
    }
    cursor += element.length;
  }
  if (originStart < 0) {
    throw new Error(`transitionSnapshot found no element with id "${options.originId}".`);
  }

  const forward = (a: number, b: number) => (b - a + perimeter) % perimeter;
  const originEnd = originStart + originLength;
  const relaxationLength = options.relaxationLength ?? perimeter / 12;

  const blended = to.map((sample, index) => {
    const previous = from[index];
    // Inside the element that changed there is nothing to wait for.
    const distanceFromOrigin =
      forward(originStart, sample.s) <= originLength
        ? 0
        : Math.min(forward(originEnd, sample.s), forward(sample.s, originStart));
    const reached = establishment(distanceFromOrigin, options.frontReach, relaxationLength);
    const mix = (before: number, after: number) => before + (after - before) * reached;
    return {
      ...sample,
      potential: mix(previous.potential, sample.potential),
      field: mix(previous.field, sample.field),
      current: mix(previous.current, sample.current),
      distanceFromOrigin,
      established: reached,
    };
  });

  const mean = blended.reduce((sum, sample) => sum + sample.potential, 0) / blended.length;
  return blended.map((sample) => ({ ...sample, potential: sample.potential - mean }));
}

/**
 * Arc length each front must cover before the two meet on the far side of the
 * loop - the point past which the whole circuit has heard about the change.
 */
export function frontMeetingReach(elements: readonly LoopElement[], originId: string): number {
  const origin = elements.find((element) => element.id === originId);
  return Math.max(0, (perimeterOf(elements) - (origin ? origin.length : 0)) / 2);
}

/* -------------------------------------------------------------------------
 * 3. The carriers themselves
 * ---------------------------------------------------------------------- */

/**
 * The sample covering arc position `s`, for a profile laid out by `sampleLoop`:
 * `count` cells of equal width, each sampled at its own midpoint.
 */
export function sampleAt(
  samples: readonly LoopSample[],
  s: number,
  perimeter: number,
): LoopSample | undefined {
  if (samples.length === 0 || !(perimeter > 0)) return undefined;
  const t = ((s % perimeter) + perimeter) % perimeter;
  const index = Math.min(samples.length - 1, Math.floor((t / perimeter) * samples.length));
  return samples[index];
}

export interface DriftOptions {
  /** Perimeter of the loop, in the same arc units as the positions. */
  perimeter: number;
  /** Current at which a carrier moves at `speed`, in amperes. */
  referenceCurrent: number;
  /** Drift speed at `referenceCurrent`, in arc units per second. */
  speed: number;
  /** Cap on |I| / referenceCurrent, so a near short circuit stays watchable. */
  maxFactor?: number;
}

export interface DriftState {
  positions: number[];
  /** Signed arc units per second, negative wherever the conventional current is positive. */
  velocities: number[];
}

/** Carriers spread evenly around the loop, which is what uniform density means here. */
export function seedDrift(count: number, perimeter: number): number[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('seedDrift needs a positive integer carrier count.');
  }
  return Array.from({ length: count }, (_, index) => ((index + 0.5) * perimeter) / count);
}

/**
 * Move every carrier on by one frame.
 *
 * Two things are worth reading off the result. The carriers are negative, so
 * they creep the *opposite* way round the loop from the conventional current;
 * and each one takes its speed from the current at its own position, which
 * during a transient is whatever the fronts have established there so far. A
 * carrier therefore sits still until the news of the switch reaches it, however
 * long the wire is - the drift is slow, the signal that starts it is not.
 */
export function advanceDrift(
  positions: readonly number[],
  samples: readonly LoopSample[],
  dt: number,
  options: DriftOptions,
): DriftState {
  const { perimeter, referenceCurrent, speed } = options;
  const maxFactor = options.maxFactor ?? Infinity;
  const step = Math.max(0, dt);
  const next: number[] = [];
  const velocities: number[] = [];

  for (const position of positions) {
    const sample = sampleAt(samples, position, perimeter);
    const ratio =
      sample && referenceCurrent !== 0 ? sample.current / referenceCurrent : 0;
    const clamped = Math.max(-maxFactor, Math.min(maxFactor, ratio));
    const velocity = -clamped * speed;
    const moved = position + velocity * step;
    next.push(perimeter > 0 ? ((moved % perimeter) + perimeter) % perimeter : moved);
    velocities.push(velocity);
  }

  return { positions: next, velocities };
}
