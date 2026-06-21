// Pure, DOM-free energy bookkeeping for the inline "pick up and drop" explorer
// (EnergyDropExplorer). Kept deterministic and testable; the React island owns
// rendering, dragging, and the animation loop.

/** Standard gravitational field strength near Earth's surface (m/s^2). */
export const G = 9.8;

/** Kinetic energy of a mass moving at a given speed: K = 1/2 m v^2 (joules). */
export const kineticEnergy = (mass: number, speed: number): number =>
  0.5 * mass * speed * speed;

/**
 * Gravitational potential energy relative to the chosen zero height:
 * U = m g h (joules). `height` is measured upward from the reference level.
 */
export const potentialEnergy = (mass: number, height: number, g: number = G): number =>
  mass * g * height;

export interface MechanicalEnergyInput {
  mass: number;
  height: number;
  speed: number;
  g?: number;
}

/** Total mechanical energy K + U (joules). */
export const mechanicalEnergy = ({ mass, height, speed, g = G }: MechanicalEnergyInput): number =>
  kineticEnergy(mass, speed) + potentialEnergy(mass, height, g);

/**
 * Speed of an object that was released from rest at `dropHeight` by the time it
 * falls to `height`, from energy conservation: 1/2 v^2 = g (dropHeight - height).
 * Returns 0 at or above the release height.
 */
export const speedAfterFall = (dropHeight: number, height: number, g: number = G): number =>
  Math.sqrt(Math.max(0, 2 * g * (dropHeight - height)));

export interface DropState {
  /** Height above the ground reference (m). */
  height: number;
  /** Vertical velocity, positive up (m/s). */
  velocity: number;
}

export interface FallConfig {
  g?: number;
  /** Height the object was released from; the lossless bounce returns to it. */
  releaseHeight: number;
}

/**
 * Advance a free-falling object by one step under gravity, with a lossless
 * (perfectly elastic) bounce at the ground so total mechanical energy is
 * conserved. The bounce speed is set from energy conservation rather than the
 * integrated velocity, keeping the motion exactly periodic between the ground
 * and the release height regardless of step size.
 */
export const stepFall = (state: DropState, dt: number, config: FallConfig): DropState => {
  const g = config.g ?? G;
  const release = config.releaseHeight;

  let velocity = state.velocity - g * dt;
  let height = state.height + velocity * dt;

  if (height <= 0) {
    height = 0;
    velocity = Math.sqrt(2 * g * Math.max(0, release));
  } else if (height >= release && velocity > 0) {
    height = release;
    velocity = 0;
  }

  return { height, velocity };
};
