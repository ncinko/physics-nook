import type { Vec3 } from './ephemeris.ts';
import {
  add,
  cross,
  normalize,
  scale,
} from './surfaceNavigation.ts';

export type CameraMode = 'space' | 'surface' | 'transition';

export interface CameraBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

export interface SpaceMoveInput {
  forward: number;
  right: number;
}

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };
const PITCH_LIMIT = Math.PI / 2 - 0.02;

export const clampCameraPitch = (pitch: number) =>
  Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));

export const getCameraBasis = (yawRadians: number, pitchRadians: number): CameraBasis => {
  const pitch = clampCameraPitch(pitchRadians);
  const cosPitch = Math.cos(pitch);
  const forward = normalize({
    x: Math.sin(yawRadians) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yawRadians) * cosPitch,
  });
  const right = normalize(cross(forward, WORLD_UP));
  const up = normalize(cross(right, forward));

  return { forward, right, up };
};

export const applySpaceTranslation = (
  position: Vec3,
  basis: CameraBasis,
  input: SpaceMoveInput,
  distance: number,
): Vec3 => {
  const forwardMove = scale(basis.forward, input.forward * distance);
  const rightMove = scale(basis.right, input.right * distance);
  return add(position, add(forwardMove, rightMove));
};

export const canUseClickForDescent = (
  mode: CameraMode,
  pointerMoved: boolean,
): boolean => mode === 'space' && !pointerMoved;
