import type { Vec3 } from './ephemeris.ts';
import {
  add,
  cross,
  normalize,
  rotateAroundAxis,
  scale,
} from './surfaceNavigation.ts';

export type CameraMode = 'space' | 'surface' | 'transition';
export type AstronomyScaleMode = 'compact' | 'true';
export type SurfaceBodyId = 'earth' | 'moon' | 'binaryMoon' | null;
export type SunRenderMode = 'finite-scene' | 'infinite-space' | 'surface-proxy';

export interface CameraBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

export interface SpaceMoveInput {
  forward: number;
  right: number;
  up?: number;
}

export interface SpaceLookState {
  yaw: number;
  pitch: number;
  roll: number;
}

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };
const PITCH_LIMIT = Math.PI / 2 - 0.02;

export const clampCameraPitch = (pitch: number) =>
  Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));

export const getCameraBasis = (
  yawRadians: number,
  pitchRadians: number,
  rollRadians = 0,
): CameraBasis => {
  const pitch = clampCameraPitch(pitchRadians);
  const cosPitch = Math.cos(pitch);
  const forward = normalize({
    x: Math.sin(yawRadians) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yawRadians) * cosPitch,
  });
  const unrolledRight = normalize(cross(forward, WORLD_UP));
  const unrolledUp = normalize(cross(unrolledRight, forward));
  const right = normalize(rotateAroundAxis(unrolledRight, forward, rollRadians));
  const up = normalize(rotateAroundAxis(unrolledUp, forward, rollRadians));

  return { forward, right, up };
};

export const applySpaceLookDrag = (
  state: SpaceLookState,
  deltaX: number,
  deltaY: number,
  sensitivity: number,
): SpaceLookState => {
  const cosRoll = Math.cos(state.roll);
  const sinRoll = Math.sin(state.roll);
  const yawDelta = (deltaX * cosRoll - deltaY * sinRoll) * sensitivity;
  const pitchDelta = (-deltaX * sinRoll - deltaY * cosRoll) * sensitivity;

  return {
    yaw: state.yaw + yawDelta,
    pitch: clampCameraPitch(state.pitch + pitchDelta),
    roll: state.roll,
  };
};

export const applySpaceRoll = (
  state: SpaceLookState,
  deltaRadians: number,
): SpaceLookState => ({
  ...state,
  roll: state.roll + deltaRadians,
});

export const applySpaceTranslation = (
  position: Vec3,
  basis: CameraBasis,
  input: SpaceMoveInput,
  distance: number,
): Vec3 => {
  const forwardMove = scale(basis.forward, input.forward * distance);
  const rightMove = scale(basis.right, input.right * distance);
  const upMove = scale(basis.up, (input.up ?? 0) * distance);
  return add(position, add(add(forwardMove, rightMove), upMove));
};

export const canUseClickForDescent = (
  mode: CameraMode,
  pointerMoved: boolean,
): boolean => mode === 'space' && !pointerMoved;

export const getSunRenderMode = (
  scaleMode: AstronomyScaleMode,
  mode: CameraMode,
  surfaceBody: SurfaceBodyId = null,
): SunRenderMode => {
  if (scaleMode === 'true' && mode === 'space') return 'infinite-space';
  if (scaleMode === 'true' && mode === 'surface' && (surfaceBody === 'earth' || surfaceBody === 'moon')) {
    return 'surface-proxy';
  }
  return 'finite-scene';
};
