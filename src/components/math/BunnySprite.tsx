// Shared pixel-art bunny used by the background companion and the vector-page
// interactives so every bunny on the page is the same sprite.

export const BUNNY_COLS = 16;
export const BUNNY_ROWS = 16;

export const BUNNY_PALETTE: Record<string, string> = {
  '#': '#334155', // outline (slate)
  o: '#ffffff', // body
  p: '#f9a8d4', // inner ear (pink)
  e: '#1f2937', // eye
  n: '#fb7185', // nose (rose)
};

// Front-facing sitting bunny: ears up, two feet. Used while paused / grounded.
const SIT = [
  '....###..###....',
  '....#p#..#p#....',
  '....#p#..#p#....',
  '....#o#..#o#....',
  '...##o####o##...',
  '..#oooooooooo#..',
  '.#oooooooooooo#.',
  '.#ooeooooooeoo#.',
  '.#oooooooooooo#.',
  '.#ooooonnooooo#.',
  '.#oooooooooooo#.',
  '..#oooooooooo#..',
  '..#oooooooooo#..',
  '..#oooo##oooo#..',
  '...####..####...',
  '................',
];

// Sitting bunny with ears flopped right / left — alternated for a wiggle.
const WIGGLE_R = ['.....###..###...', '.....#p#..#p#...', ...SIT.slice(2)];
const WIGGLE_L = ['...###..###.....', '...#p#..#p#.....', ...SIT.slice(2)];

// Side-on leaping bunny (authored facing right; flip horizontally for left).
const HOP = [
  '........#####...',
  '........#p#p#...',
  '........#p#p#...',
  '......#oooooo#..',
  '....#ooooooooo#.',
  '..#ooooooooeoo#.',
  '.#oooooooooonn#.',
  '.#oooooooooooo#.',
  '.#oooooooooooo#.',
  '.#oooooooooooo#.',
  '..#oooooooooo#..',
  '..#oooooooooo#..',
  '...#oo#..#oo#...',
  '...#oo#..#oo#...',
  '...####..####...',
  '................',
];

export type BunnyFrameName = 'sit' | 'wiggleR' | 'wiggleL' | 'hop';
export const BUNNY_FRAMES: Record<BunnyFrameName, string[]> = {
  sit: SIT,
  wiggleR: WIGGLE_R,
  wiggleL: WIGGLE_L,
  hop: HOP,
};

export type BunnyPixel = { x: number; y: number; fill: string };

// Flatten each frame to its filled pixels once, at module load.
export const BUNNY_FRAME_PIXELS: Record<BunnyFrameName, BunnyPixel[]> = Object.fromEntries(
  (Object.keys(BUNNY_FRAMES) as BunnyFrameName[]).map((name) => {
    const pixels: BunnyPixel[] = [];
    BUNNY_FRAMES[name].forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        const fill = BUNNY_PALETTE[row[x]];
        if (fill) {
          pixels.push({ x, y, fill });
        }
      }
    });
    return [name, pixels];
  }),
) as Record<BunnyFrameName, BunnyPixel[]>;

/**
 * Renders the bunny as an SVG `<g>` anchored at its feet (local origin is the
 * bottom-center of the sprite, with the body extending upward into negative y),
 * matching the convention used by the existing interactives. Callers position
 * and flip it with their own outer `translate(...) scale(dir, 1)` transform.
 */
export function BunnySprite({ frame = 'sit', cell = 3 }: { frame?: BunnyFrameName; cell?: number }) {
  const pixels = BUNNY_FRAME_PIXELS[frame];
  return (
    <g shapeRendering="crispEdges">
      {pixels.map((px, i) => (
        <rect
          key={i}
          x={(px.x - BUNNY_COLS / 2) * cell}
          y={(px.y - (BUNNY_ROWS - 1)) * cell}
          width={cell}
          height={cell}
          fill={px.fill}
        />
      ))}
    </g>
  );
}
