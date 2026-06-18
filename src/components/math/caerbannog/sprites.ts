// Extra pixel-art sprites for the hidden Caerbannog defense game, authored in
// the same 1-char-per-cell style as BunnySprite so everything on screen matches.
// (Killer rabbits reuse BunnySprite itself with KILLER_PALETTE; explosions are
// drawn procedurally in the component.)

export interface PixelSprite {
  cols: number;
  rows: number;
  pixels: Array<{ x: number; y: number; fill: string }>;
}

const buildSprite = (rows: string[], palette: Record<string, string>): PixelSprite => {
  const pixels: PixelSprite['pixels'] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const fill = palette[row[x]];
      if (fill) {
        pixels.push({ x, y, fill });
      }
    }
  });
  return { cols: rows[0]?.length ?? 0, rows: rows.length, pixels };
};

// The Holy Hand Grenade of Antioch: gold body, silver cross, lit fuse.
const GRENADE = [
  '...f....',
  '..fk....',
  '..###...',
  '.#ooo#..',
  '#ooxoo#.',
  '#oxxxo#.',
  '#ooxoo#.',
  '#ooooo#.',
  '.#ooo#..',
  '..###...',
];

const GRENADE_PALETTE: Record<string, string> = {
  '#': '#78350f', // dark outline
  o: '#fbbf24', // gold body
  x: '#f1f5f9', // silver cross
  f: '#f97316', // fuse spark
  k: '#6b7280', // cap
};

// King Arthur's keep: a crenellated stone tower with arrow slits and a door.
const KEEP = [
  '................',
  '................',
  '.##.##.##.##.##.',
  '.ssssssssssssss.',
  '.ss##ss##ss##ss.',
  '.ssssssssssssss.',
  '.ss#gg#ss#gg#ss.',
  '.ssssssssssssss.',
  '.ssssssssssssss.',
  '.sssss#gg#sssss.',
  '.ssssssssssssss.',
  '.ssss#ddd#sssss.',
  '.ssss#ddd#sssss.',
  '.ssss#ddd#sssss.',
  '.ssss#ddd#sssss.',
  '.##############.',
];

const KEEP_PALETTE: Record<string, string> = {
  '#': '#475569', // stone outline / detail
  s: '#94a3b8', // stone face
  g: '#1f2937', // arrow slit / window
  d: '#7c2d12', // door
};

export const GRENADE_SPRITE = buildSprite(GRENADE, GRENADE_PALETTE);
export const KEEP_SPRITE = buildSprite(KEEP, KEEP_PALETTE);
