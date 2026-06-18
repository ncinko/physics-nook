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
  r: '#ef4444', // glaring red eye (killer-rabbit easter egg)
};

// Same bunny, menacing red eyes. Passed as the `palette` override to BunnySprite
// so the hidden Caerbannog defense game can reuse every frame without authoring
// duplicate "killer" pixel art.
export const KILLER_PALETTE: Record<string, string> = { ...BUNNY_PALETTE, e: '#ef4444' };

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

// Sitting bunny with red eyes: the rare "glare" the companion flashes to signal
// that clicking it now opens the hidden game.
const GLARE = SIT.map((row) => row.replace(/e/g, 'r'));

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

export type BunnyFrameName = 'sit' | 'wiggleR' | 'wiggleL' | 'hop' | 'glare';
export const BUNNY_FRAMES: Record<BunnyFrameName, string[]> = {
  sit: SIT,
  wiggleR: WIGGLE_R,
  wiggleL: WIGGLE_L,
  hop: HOP,
  glare: GLARE,
};

// `char` is kept alongside the resolved default `fill` so callers can recolor a
// frame through a palette override (e.g. KILLER_PALETTE) without re-flattening.
export type BunnyPixel = { x: number; y: number; char: string; fill: string };

// Flatten each frame to its filled pixels once, at module load.
export const BUNNY_FRAME_PIXELS: Record<BunnyFrameName, BunnyPixel[]> = Object.fromEntries(
  (Object.keys(BUNNY_FRAMES) as BunnyFrameName[]).map((name) => {
    const pixels: BunnyPixel[] = [];
    BUNNY_FRAMES[name].forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        const char = row[x];
        const fill = BUNNY_PALETTE[char];
        if (fill) {
          pixels.push({ x, y, char, fill });
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
export function BunnySprite({
  frame = 'sit',
  cell = 3,
  palette,
}: {
  frame?: BunnyFrameName;
  cell?: number;
  /** Optional palette override (e.g. KILLER_PALETTE) keyed by sprite char. */
  palette?: Record<string, string>;
}) {
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
          fill={palette?.[px.char] ?? px.fill}
        />
      ))}
    </g>
  );
}
