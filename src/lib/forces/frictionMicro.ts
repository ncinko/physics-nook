// Microscopic model of dry friction (the Bowden-Tabor picture), in two scales.
//
// Mesoscopic: a rough floor touches a flat block only at the tips of its
// asperities. Each touching tip yields until its flattened width supports its
// share of the load, so the total touching length is A = N / H (H is the
// hardness: load carried per unit of contact). The tips bond, and each bonded
// length resists a shear stress tau, so the most friction the interface can
// supply is tau * A = (tau / H) * N. That ratio is the friction coefficient.
//
// Microscopic: a bonded junction is a set of atomic springs. Pulling the block
// stretches each bond until it lets go; a fresh bond can only form when the next
// floor atom slides under the block atom. The block feels the sum of the
// stretched bonds.

/** Small seeded generator so a given page always draws the same surface. */
export const createRng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export interface Asperity {
  /** Horizontal position along the floor. */
  x: number;
  /** Height of the tip above the lowest valley. */
  height: number;
}

/**
 * Evenly spaced asperities whose heights follow an exponential distribution
 * (mean `lambda`), the usual statistical picture of a rough surface: tall tips
 * are rare. Heights are stratified quantiles, shuffled, so any subset of tips
 * is a fair sample and small surfaces still match the distribution.
 */
export const generateAsperities = (seed: number, count: number, span: number, lambda: number): Asperity[] => {
  const rng = createRng(seed);
  const heights = Array.from({ length: count }, (_, index) => -lambda * Math.log(1 - (index + 0.5) / count));

  for (let index = count - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [heights[index], heights[swap]] = [heights[swap], heights[index]];
  }

  const spacing = span / count;
  return heights.map((height, index) => ({ x: (index + 0.5) * spacing, height }));
};

export interface Contact {
  /** Index into the asperity array that was passed in. */
  index: number;
  /** How far the tip would poke above the block's lower surface. */
  depth: number;
  /** Flattened width of the contact: tips yield until width = 2 * slope * depth. */
  width: number;
  /** Load carried by this contact: hardness * width. */
  load: number;
}

export interface ContactSolution {
  /** Height of the block's lower surface above the valleys. */
  level: number;
  contacts: Contact[];
  /** Total touching length (the "real contact area" in this side view). */
  area: number;
}

/**
 * Lower a flat block onto the asperities until the contacts carry `load`.
 * Every tip that pokes above the block's surface by `depth` flattens to width
 * `2 * slope * depth` and carries `hardness * width`, so the load fixes the sum
 * of the depths. That sum is piecewise linear in the block height, which makes
 * the height exactly solvable by adding tips from the tallest down.
 */
export const solveContacts = (asperities: Asperity[], load: number, hardness: number, slope: number): ContactSolution => {
  const order = asperities.map((_, index) => index).sort((a, b) => asperities[b].height - asperities[a].height);
  const required = load / (2 * hardness * slope);

  if (order.length === 0 || required <= 0) {
    return { level: order.length ? asperities[order[0]].height : 0, contacts: [], area: 0 };
  }

  let heightSum = 0;
  let level = 0;
  let count = 0;

  for (let k = 1; k <= order.length; k += 1) {
    heightSum += asperities[order[k - 1]].height;
    level = (heightSum - required) / k;
    count = k;
    const nextHeight = k < order.length ? asperities[order[k]].height : -Infinity;
    if (level >= nextHeight) {
      break;
    }
  }

  const contacts = order.slice(0, count).map((index) => {
    const depth = asperities[index].height - level;
    const width = 2 * slope * depth;
    return { index, depth, width, load: hardness * width };
  });

  return { level, contacts, area: contacts.reduce((sum, contact) => sum + contact.width, 0) };
};

/** The most friction the interface can supply: shear strength times touching length. */
export const maxInterfaceFriction = (solution: ContactSolution, shearStrength: number): number =>
  shearStrength * solution.area;

// --- Atomic springs -------------------------------------------------------

export interface StickSlipBond {
  attached: boolean;
  /** Block position when this bond formed; stretch is `x - site`. */
  site: number;
  /** Stretch at which this bond lets go. */
  threshold: number;
}

export interface StickSlipParams {
  /** Typical stretch at which a bond breaks. Bond force is stiffness * stretch. */
  breakStretch: number;
  /** Spacing of floor atoms; a bond re-forms when the next one passes under. */
  latticeSpacing: number;
  /** Fractional spread of break thresholds: each is breakStretch * (1 - spread * u). */
  spread?: number;
  stiffness?: number;
}

export interface StickSlipState {
  /** How far the block has been pulled. */
  x: number;
  time: number;
  bonds: StickSlipBond[];
  rng: () => number;
}

const threshold = (params: StickSlipParams, rng: () => number) =>
  params.breakStretch * (1 - (params.spread ?? 0.4) * rng());

/** Every bond starts formed and unstretched, as when the block has been resting. */
export const createStickSlip = (seed: number, bondCount: number, params: StickSlipParams): StickSlipState => {
  const rng = createRng(seed);
  return {
    x: 0,
    time: 0,
    rng,
    bonds: Array.from({ length: bondCount }, () => ({ attached: true, site: 0, threshold: threshold(params, rng) })),
  };
};

/**
 * Pull the block by `distance`, in small enough steps that no bond can stretch
 * past its threshold unnoticed. Mutates `state`; returns the total force the
 * bonds exert on the block (resisting the pull).
 */
export const advanceStickSlip = (state: StickSlipState, distance: number, dt: number, params: StickSlipParams): number => {
  const stiffness = params.stiffness ?? 1;
  const steps = Math.max(1, Math.ceil(Math.abs(distance) / (0.25 * Math.max(params.latticeSpacing, 1e-6))));
  const stepDistance = distance / steps;

  for (let step = 0; step < steps; step += 1) {
    const before = state.x;
    state.x += stepDistance;
    const crossed = Math.floor(state.x / params.latticeSpacing) > Math.floor(before / params.latticeSpacing);
    const alignedSite = Math.floor(state.x / params.latticeSpacing) * params.latticeSpacing;

    for (const bond of state.bonds) {
      if (bond.attached && state.x - bond.site >= bond.threshold) {
        bond.attached = false;
      } else if (!bond.attached && crossed) {
        bond.attached = true;
        bond.site = alignedSite;
        bond.threshold = threshold(params, state.rng);
      }
    }
  }

  state.time += dt;
  return totalBondForce(state, params);
};

export const totalBondForce = (state: StickSlipState, params: StickSlipParams): number =>
  state.bonds.reduce((sum, bond) => sum + (bond.attached ? (params.stiffness ?? 1) * (state.x - bond.site) : 0), 0);
