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
  | 'brake3'
  | 'roll';

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

/**
 * Past a flat sprint the legs stop being any use and the hedgehog curls up and
 * rolls. Only the stop-in-zones challenge ever gets here - the lesson's sample
 * motion tops out well below it - but that game reaches double figures easily.
 */
export const ROLL_FRAME: HedgehogGaitFrame = 'roll';
export const ROLL_SPEED = 10;

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
  gait: 'stand' | 'walk' | 'run' | 'brake' | 'roll';
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

  if (speed >= ROLL_SPEED) {
    return { frame: ROLL_FRAME, facing, slowing, gait: 'roll' };
  }

  if (speed >= RUN_SPEED) {
    return { frame: RUN_CYCLE[strideIndex(distance, RUN_STRIDE)], facing, slowing, gait: 'run' };
  }

  return { frame: WALK_CYCLE[strideIndex(distance, WALK_STRIDE)], facing, slowing, gait: 'walk' };
}

/**
 * The 2D field draws the hedgehog from above, from its own sheet. Seen from
 * above there is no braking pose and nothing to curl into - just standing,
 * walking, and running - and no side to face, so the sprite is turned to point
 * along its velocity instead of mirrored.
 */
export type TopdownGaitFrame =
  | 'idle1'
  | 'idle2'
  | 'idle3'
  | 'walk1'
  | 'walk2'
  | 'walk3'
  | 'walk4'
  | 'run1'
  | 'run2'
  | 'run3'
  | 'run4';

export const TOPDOWN_STAND_FRAME: TopdownGaitFrame = 'idle1';
export const TOPDOWN_WALK_CYCLE: readonly TopdownGaitFrame[] = ['walk1', 'walk2', 'walk3', 'walk4'];
export const TOPDOWN_RUN_CYCLE: readonly TopdownGaitFrame[] = ['run1', 'run2', 'run3', 'run4'];

/**
 * The figure eight's speed swings between about 2.5 m/s at its tips and 3.6 m/s
 * at the crossing, all of it above the 1D pages' RUN_SPEED. Splitting the gait
 * inside that range lets the hedgehog walk round the tips and run through the
 * middle, so the change of speed shows up in its legs as well as its arrow.
 */
export const TOPDOWN_RUN_SPEED = 3;

/** Metres covered per complete four-frame stride, per gait, on the field. */
export const TOPDOWN_WALK_STRIDE = 0.8;
export const TOPDOWN_RUN_STRIDE = 1;

export function hedgehogTopdownGait(distance: number, speed: number) {
  if (speed < IDLE_SPEED) {
    return { frame: TOPDOWN_STAND_FRAME, gait: 'stand' as const };
  }
  if (speed >= TOPDOWN_RUN_SPEED) {
    return { frame: TOPDOWN_RUN_CYCLE[strideIndex(distance, TOPDOWN_RUN_STRIDE)], gait: 'run' as const };
  }
  return { frame: TOPDOWN_WALK_CYCLE[strideIndex(distance, TOPDOWN_WALK_STRIDE)], gait: 'walk' as const };
}

/**
 * Turn, in radians, that points the top-down sprite's nose along a 2D velocity
 * (vx, vy in the usual y-up convention). The sprite is drawn nose-down on the
 * screen and screen y points down, so this is the angle to hand straight to an
 * SVG `rotate()`: positive is clockwise. While stopped it holds the heading it
 * had, so it does not snap back to facing down.
 */
export function hedgehogTopdownHeading(vx: number, vy: number, previous = 0) {
  if (Math.hypot(vx, vy) < IDLE_SPEED) {
    return previous;
  }
  return Math.atan2(-vx, -vy);
}

/** Which frame of a four-frame cycle a given distance travelled lands on. */
export function strideIndex(distance: number, stride: number) {
  const phase = Math.floor((distance / stride) * 4) % 4;
  return phase < 0 ? phase + 4 : phase;
}

/**
 * How far the ball has turned, in radians, for rolling without slipping.
 *
 * Driven by signed displacement rather than by distance travelled: roll forward
 * and back over the same ground and the ball must come back to the orientation
 * it started in, which a monotonic path length could never do.
 */
export const rollAngle = (displacement: number, radiusMetres: number) =>
  displacement / radiusMetres;
