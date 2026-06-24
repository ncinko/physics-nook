export const CHICKEN_COLS = 16;
export const CHICKEN_ROWS = 16;

export const CHICKEN_PALETTE: Record<string, string> = {
  '#': '#334155', // outline
  o: '#fef3c7', // body
  w: '#fcd34d', // wing
  c: '#ef4444', // comb
  b: '#f97316', // beak
  e: '#111827', // eye
  l: '#c2410c', // legs
};

const STAND = [
  '......cc........',
  '.....c##c.......',
  '....##oo###.....',
  '...#oooooo#.....',
  '..#ooeoooob#....',
  '..#ooooooobb#...',
  '.#ooowwwooo#....',
  '.#oowwwwooo#....',
  '..#ooooooo#.....',
  '...#ooooo#......',
  '....#####.......',
  '.....l.l........',
  '.....l.l........',
  '....ll.ll.......',
  '................',
  '................',
];

const STEP_A = [
  ...STAND.slice(0, 11),
  '....l..l........',
  '...ll..ll.......',
  '..ll....ll......',
  '................',
  '................',
];

const STEP_B = [
  ...STAND.slice(0, 11),
  '......ll........',
  '.....l..l.......',
  '....l....l......',
  '................',
  '................',
];

const HOP = [
  '.......cc.......',
  '......c##c......',
  '.....##oo###....',
  '....#oooooo#....',
  '...#ooeoooob#...',
  '...#ooooooobb#..',
  '..#ooowwwooo#...',
  '..#oowwwwooo#...',
  '...#ooooooo#....',
  '....#ooooo#.....',
  '.....#####......',
  '....ll..ll......',
  '................',
  '................',
  '................',
  '................',
];

const PECK = [
  '................',
  '......cc........',
  '.....c##c.......',
  '....##oo###.....',
  '...#oooooo#.....',
  '..#ooooooo#.....',
  '.#ooowwwob#.....',
  '.#oowwwobb#.....',
  '..#ooooooo#.....',
  '...#ooooo#......',
  '....#####.......',
  '.....l.l........',
  '.....l.l........',
  '....ll.ll.......',
  '................',
  '................',
];

export type ChickenFrameName = 'stand' | 'stepA' | 'stepB' | 'hop' | 'peck';

export const CHICKEN_FRAMES: Record<ChickenFrameName, string[]> = {
  stand: STAND,
  stepA: STEP_A,
  stepB: STEP_B,
  hop: HOP,
  peck: PECK,
};

export type ChickenPixel = { x: number; y: number; char: string; fill: string };

export const CHICKEN_FRAME_PIXELS: Record<ChickenFrameName, ChickenPixel[]> = Object.fromEntries(
  (Object.keys(CHICKEN_FRAMES) as ChickenFrameName[]).map((name) => {
    const pixels: ChickenPixel[] = [];
    CHICKEN_FRAMES[name].forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        const char = row[x];
        const fill = CHICKEN_PALETTE[char];
        if (fill) {
          pixels.push({ x, y, char, fill });
        }
      }
    });
    return [name, pixels];
  }),
) as Record<ChickenFrameName, ChickenPixel[]>;

export function ChickenSprite({
  frame = 'stand',
  cell = 3,
  palette,
}: {
  frame?: ChickenFrameName;
  cell?: number;
  palette?: Record<string, string>;
}) {
  const pixels = CHICKEN_FRAME_PIXELS[frame];
  return (
    <g shapeRendering="crispEdges">
      {pixels.map((px, i) => (
        <rect
          key={i}
          x={(px.x - CHICKEN_COLS / 2) * cell}
          y={(px.y - (CHICKEN_ROWS - 1)) * cell}
          width={cell}
          height={cell}
          fill={palette?.[px.char] ?? px.fill}
        />
      ))}
    </g>
  );
}
