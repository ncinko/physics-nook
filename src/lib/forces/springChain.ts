import { stableSubsteps } from './stiffness.ts';

// A row of blocks modelled as a chain of point masses joined by springs: a
// soft-body picture of "solid". Inside a block the springs can push or pull;
// where two blocks touch, the contact spring can only push. The chain is
// integrated in its own centre-of-mass frame, so the rigid acceleration is
// removed from the motion and only the squeezing remains.

export interface SpringChainParams {
  blocks: number;
  nodesPerBlock: number;
  /** Mass of one block, kg. */
  blockMass: number;
  /** Spring constant inside a block, N per unit of node spacing. */
  stiffness: number;
  /** Spring constant where blocks touch. */
  contactStiffness: number;
  /** Damping ratio of the springs themselves (how quickly a squeeze rings out). */
  springDamping: number;
  /** Damping ratio of the lowest stretching mode; drag against the centre of mass. */
  bodyDamping: number;
}

export interface SpringChainState {
  params: SpringChainParams;
  /** Node displacement from its rest position, in node spacings, in the centre-of-mass frame. */
  u: number[];
  v: number[];
  time: number;
  /** Acceleration of the whole chain along the push, m/s², from the last step. */
  acceleration: number;
  /** Centre-of-mass velocity and travel, accumulated for display only. */
  cmVelocity: number;
  cmPosition: number;
}

export const DEFAULT_SPRING_CHAIN: SpringChainParams = {
  blocks: 3,
  nodesPerBlock: 8,
  blockMass: 10,
  stiffness: 400,
  contactStiffness: 400,
  springDamping: 0.1,
  bodyDamping: 0.4,
};

export const chainNodeCount = (params: SpringChainParams) => params.blocks * params.nodesPerBlock;
export const chainNodeMass = (params: SpringChainParams) => params.blockMass / params.nodesPerBlock;
export const chainTotalMass = (params: SpringChainParams) => params.blocks * params.blockMass;

export const createSpringChain = (overrides: Partial<SpringChainParams> = {}): SpringChainState => {
  const params = { ...DEFAULT_SPRING_CHAIN, ...overrides };
  const count = chainNodeCount(params);
  return {
    params,
    u: new Array<number>(count).fill(0),
    v: new Array<number>(count).fill(0),
    time: 0,
    acceleration: 0,
    cmVelocity: 0,
    cmPosition: 0,
  };
};

/** Spring `j` joins node `j` to node `j + 1`; it is a contact spring on a block boundary. */
export const isContactSpring = (params: SpringChainParams, spring: number) => (spring + 1) % params.nodesPerBlock === 0;

const fillSpringForces = (state: SpringChainState, out: number[]) => {
  const { params, u, v } = state;
  const mass = chainNodeMass(params);
  for (let j = 0; j < u.length - 1; j += 1) {
    const contact = isContactSpring(params, j);
    const k = contact ? params.contactStiffness : params.stiffness;
    const compression = u[j] - u[j + 1];
    const rate = v[j] - v[j + 1];
    const force = k * compression + 2 * params.springDamping * Math.sqrt(k * mass) * rate;
    out[j] = contact ? (compression > 0 ? Math.max(0, force) : 0) : force;
  }
};

/** Push (positive) or pull (negative) carried by each spring, N. Length is nodes - 1. */
export const springForces = (state: SpringChainState): number[] => {
  const out = new Array<number>(Math.max(0, state.u.length - 1)).fill(0);
  fillSpringForces(state, out);
  return out;
};

/** Advance by `dt` seconds with a constant `force` on the first node. */
export const advanceSpringChain = (state: SpringChainState, force: number, dt: number) => {
  const { params, u, v } = state;
  const count = u.length;
  const mass = chainNodeMass(params);
  const total = chainTotalMass(params);
  const stiffest = Math.max(params.stiffness, params.contactStiffness);
  const steps = stableSubsteps(4 * stiffest, mass, dt, 0.2, 400);
  const h = dt / steps;
  const rigid = force / total;
  // Drag against the centre of mass, tuned to the slowest stretching mode.
  const lowestOmega = Math.sqrt(params.stiffness / mass) * 2 * Math.sin(Math.PI / (2 * count));
  const drag = 2 * params.bodyDamping * mass * lowestOmega;
  const springs = new Array<number>(count - 1).fill(0);

  for (let step = 0; step < steps; step += 1) {
    fillSpringForces(state, springs);
    for (let i = 0; i < count; i += 1) {
      const left = i === 0 ? force : springs[i - 1];
      const right = i === count - 1 ? 0 : springs[i];
      // Subtracting the rigid acceleration keeps the centre of mass fixed in this frame.
      const acceleration = (left - right - drag * v[i]) / mass - rigid;
      v[i] += acceleration * h;
    }
    for (let i = 0; i < count; i += 1) {
      u[i] += v[i] * h;
    }
  }

  state.acceleration = rigid;
  state.cmPosition += state.cmVelocity * dt + 0.5 * rigid * dt * dt;
  state.cmVelocity += rigid * dt;
  state.time += dt;
};

/** Acceleration of the whole stack: a = F / M. */
export const chainAcceleration = (force: number, totalMass: number) => force / totalMass;

/**
 * Force across a cut once the squeeze has settled: the mass ahead of the cut
 * times the common acceleration, F * (mass ahead) / (total mass).
 */
export const steadyCutForce = (force: number, massAhead: number, totalMass: number) =>
  (force * massAhead) / totalMass;

/** Settled force in every spring: the mass ahead of spring `j` times `a`. */
export const steadySpringForces = (params: SpringChainParams, force: number): number[] => {
  const count = chainNodeCount(params);
  const mass = chainNodeMass(params);
  const total = chainTotalMass(params);
  return Array.from({ length: count - 1 }, (_, j) => steadyCutForce(force, (count - 1 - j) * mass, total));
};
