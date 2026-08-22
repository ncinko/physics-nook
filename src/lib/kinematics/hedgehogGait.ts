/**
 * Picks the hedgehog's pose from its motion. Kept DOM-free so the gait can be
 * reasoned about (and tested) without a sprite sheet or a canvas.
 *
 * The sheet carries three gaits, and choosing between them is itself part of
 * the lesson: the hedgehog walks when it is ambling, runs when it is quick, and
 * braces when the acceleration is pointing back against the motion and it is
 * about to turn around. Speed picks the gait; distance travelled - not elapsed
 * time - picks the frame within it, so the feet shuffle faster when the
 * hedgehog moves faster and stop dead when it stops.
 */

export type HedgehogGaitFrame =
  | 'walk1'
  | 'walk2'
  | 'walk3'
  | 'walk4'
  | 'run1'
  | 'run2'
  | 'run3'
  | 'run4'
  | 'brake1'
  | 'brake2'
  | 'brake3';

export const WALK_CYCLE: readonly HedgehogGaitFrame[] = ['walk1', 'walk2', 'walk3', 'walk4'];
export const RUN_CYCLE: readonly HedgehogGaitFrame[] = ['run1', 'run2', 'run3', 'run4'];

/**
 * The sheet carries three braking poses, but only one is used. Stepping through
 * them by speed made the two turnarounds look like different manoeuvres - one
 * reared back onto its hind legs first, the other went straight into the dig-in
 * - because each turnaround lingers in a different part of the speed range. A
 * single held pose is the same braking picture whichever way the hedgehog is
 * facing, and `brake2` is the one that reads as braking: front feet planted and
 * digging, hind end lifted clear of the ground.
 */
export const BRAKE_FRAME: HedgehogGaitFrame = 'brake2';

/** Held while stopped: the walking pose with all four feet planted. */
export const STAND_FRAME: HedgehogGaitFrame = 'walk1';

/** Below this speed the hedgehog is treated as standing still. */
export const IDLE_SPEED = 0.12;

/** At or above this speed it breaks into the running gait. */
export const RUN_SPEED = 2.2;

/**
 * A hedgehog that is slowing down but still moving quickly keeps running; the
 * brace is reserved for the moment before a turnaround, which is where the sign
 * of the acceleration is actually worth looking at.
 */
export const BRACE_SPEED = 0.9;

/** Metres covered per complete four-frame stride, per gait. */
export const WALK_STRIDE = 0.8;
export const RUN_STRIDE = 1.7;

export interface GaitInput {
  /** Cumulative path length travelled, in metres. */
  distance: number;
  /** Signed velocity in m/s: sets facing, gait, and whether the feet move. */
  velocity: number;
  /** Signed acceleration in m/s^2: a brace pose shows when it opposes velocity. */
  acceleration: number;
  /** Facing to hold onto while stopped, so the hedgehog does not snap around. */
  previousFacing?: 1 | -1;
}

export interface GaitPose {
  frame: HedgehogGaitFrame;
  facing: 1 | -1;
  /** True when the acceleration points against the motion. */
  slowing: boolean;
  /** Which gait the pose came from, for callers that want to label it. */
  gait: 'stand' | 'walk' | 'run' | 'brake';
}

export function hedgehogGait({
  distance,
  velocity,
  acceleration,
  previousFacing = 1,
}: GaitInput): GaitPose {
  const speed = Math.abs(velocity);
  const slowing = velocity * acceleration < 0 && speed > 0;

  const facing: 1 | -1 =
    velocity > IDLE_SPEED ? 1 : velocity < -IDLE_SPEED ? -1 : previousFacing;

  if (speed < IDLE_SPEED) {
    return { frame: STAND_FRAME, facing, slowing, gait: 'stand' };
  }

  if (slowing && speed < BRACE_SPEED) {
    return { frame: BRAKE_FRAME, facing, slowing, gait: 'brake' };
  }

  if (speed >= RUN_SPEED) {
    return { frame: RUN_CYCLE[strideIndex(distance, RUN_STRIDE)], facing, slowing, gait: 'run' };
  }

  return { frame: WALK_CYCLE[strideIndex(distance, WALK_STRIDE)], facing, slowing, gait: 'walk' };
}

/** Which frame of a four-frame cycle a given distance travelled lands on. */
export function strideIndex(distance: number, stride: number) {
  const phase = Math.floor((distance / stride) * 4) % 4;
  return phase < 0 ? phase + 4 : phase;
}
