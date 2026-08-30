import type { ReactNode } from 'react';

interface NewtSpriteProps {
  x: number;
  y: number;
  angle?: number;
  scale?: number;
  children?: ReactNode;
}

// Newt is drawn from the same pixel-art frog the site uses as its favicon,
// cropped to the artwork's bounding box (275 x 248) so the placement maths
// below can work straight from fractions of the sprite.
const FROG_SRC = '/sprites/frog.png';
const FROG_HEIGHT = 76;
const FROG_WIDTH = (FROG_HEIGHT * 275) / 248;
const FROG_X = -FROG_WIDTH / 2;
const FROG_Y = -FROG_HEIGHT / 2;

// Collision radius: a circle inscribed in the sprite, ignoring the splayed legs.
export const NEWT_RADIUS = 30;
// Distance from Newt's centre down to the soles of his feet, so a scene can put
// a surface exactly where he stands on it.
export const NEWT_FEET_OFFSET = FROG_HEIGHT / 2;
// The mouth line -- the wide dark stroke below the two nostril dots, at 39% of
// the way down the artwork -- is where the tongue anchors in the tension demo.
export const NEWT_MOUTH_OFFSET = { x: 0, y: FROG_Y + FROG_HEIGHT * 0.387 };

export default function NewtSprite({
  x,
  y,
  angle = 0,
  scale = 1,
  children,
}: NewtSpriteProps) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
      <image
        href={FROG_SRC}
        x={FROG_X}
        y={FROG_Y}
        width={FROG_WIDTH}
        height={FROG_HEIGHT}
        preserveAspectRatio="xMidYMid meet"
      />
      {children}
    </g>
  );
}
