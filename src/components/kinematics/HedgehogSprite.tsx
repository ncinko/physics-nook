import { useId } from 'react';

import {
  HEDGEHOG_CELLS,
  HEDGEHOG_CELL_H,
  HEDGEHOG_CELL_W,
  HEDGEHOG_SHEET_H,
  HEDGEHOG_SHEET_SRC,
  HEDGEHOG_SHEET_W,
  cellOrigin,
  type HedgehogFrameName,
} from './hedgehogSheet';

export * from './hedgehogSheet';

/**
 * Shows one frame of the hedgehog sprite sheet, anchored at its feet: the local
 * origin is the bottom-centre of the cell and the body extends upward into
 * negative y, matching the bunny and chicken sprites. Callers supply their own
 * outer `translate(...) scale(dir, 1)` transform to position and flip it.
 *
 * The frame is selected the same way Hamlet's run cycle works - a clip window
 * over a single sheet, with the image stepped so the wanted cell lands in the
 * window - rather than by swapping image sources, so the browser only ever
 * loads and decodes one file.
 */
export function HedgehogSprite({
  frame = 'walk1',
  scale = 1,
}: {
  frame?: HedgehogFrameName;
  /** Whole numbers keep the pixel art on exact pixel boundaries. */
  scale?: number;
}) {
  const clipId = useId();
  const origin = cellOrigin(HEDGEHOG_CELLS[frame]);
  const w = HEDGEHOG_CELL_W * scale;
  const h = HEDGEHOG_CELL_H * scale;

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={-w / 2} y={-h} width={w} height={h} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <image
          href={HEDGEHOG_SHEET_SRC}
          x={-w / 2 - origin.x * scale}
          y={-h - origin.y * scale}
          width={HEDGEHOG_SHEET_W * scale}
          height={HEDGEHOG_SHEET_H * scale}
          preserveAspectRatio="none"
          style={{ imageRendering: 'pixelated' }}
        />
      </g>
    </g>
  );
}

/**
 * Blits one frame into a 2D canvas context, anchored at its feet like the SVG
 * component above, for the canvas-based explorers.
 *
 * `rotate` turns the whole character. By default it turns about the feet anchor,
 * which is what the position-versus-time graph's vertical rail wants: the
 * hedgehog is given a quarter turn there and climbs the rail instead of walking
 * along a floor. `pivotY` moves the centre of rotation up from the feet, which
 * is what the curled ball needs - it has to spin about its own middle rather
 * than swing around its contact point.
 *
 * Flipping still reverses which way it faces, because the flip happens in the
 * sprite's own frame after the rotation.
 */
export function drawHedgehogFrame(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  frame: HedgehogFrameName,
  {
    x,
    y,
    facing = 1,
    rotate = 0,
    pivotY = 0,
  }: { x: number; y: number; facing?: 1 | -1; rotate?: number; pivotY?: number },
) {
  const origin = cellOrigin(HEDGEHOG_CELLS[frame]);
  ctx.save();
  ctx.translate(x, y);
  if (rotate) {
    ctx.translate(0, -pivotY);
    ctx.rotate(rotate);
    ctx.translate(0, pivotY);
  }
  if (facing < 0) {
    ctx.scale(-1, 1);
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sheet,
    origin.x,
    origin.y,
    HEDGEHOG_CELL_W,
    HEDGEHOG_CELL_H,
    -HEDGEHOG_CELL_W / 2,
    -HEDGEHOG_CELL_H,
    HEDGEHOG_CELL_W,
    HEDGEHOG_CELL_H,
  );
  ctx.restore();
}
