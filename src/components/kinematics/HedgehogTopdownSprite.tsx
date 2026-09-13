import { useId } from 'react';

import {
  HEDGEHOG_TOPDOWN_CELL,
  HEDGEHOG_TOPDOWN_CELLS,
  HEDGEHOG_TOPDOWN_SHEET_H,
  HEDGEHOG_TOPDOWN_SHEET_SRC,
  HEDGEHOG_TOPDOWN_SHEET_W,
  topdownCellOrigin,
  type HedgehogTopdownFrameName,
} from './hedgehogTopdownSheet';

/**
 * Shows one frame of the top-down hedgehog sheet, centred on the local origin
 * with its nose pointing down the screen. Callers supply their own outer
 * `translate(...) rotate(...)` to place it and point it along its heading.
 *
 * Like HedgehogSprite, the frame is a clip window over the single sheet image.
 */
export function HedgehogTopdownSprite({
  frame = 'idle1',
  scale = 1,
}: {
  frame?: HedgehogTopdownFrameName;
  scale?: number;
}) {
  const clipId = useId();
  const origin = topdownCellOrigin(HEDGEHOG_TOPDOWN_CELLS[frame]);
  const size = HEDGEHOG_TOPDOWN_CELL * scale;

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={-size / 2} y={-size / 2} width={size} height={size} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <image
          href={HEDGEHOG_TOPDOWN_SHEET_SRC}
          x={-size / 2 - origin.x * scale}
          y={-size / 2 - origin.y * scale}
          width={HEDGEHOG_TOPDOWN_SHEET_W * scale}
          height={HEDGEHOG_TOPDOWN_SHEET_H * scale}
          preserveAspectRatio="none"
          style={{ imageRendering: 'pixelated' }}
        />
      </g>
    </g>
  );
}
