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

// Tim the Enchanter: horned hood, long beard, crook staff, ceremonial stole,
// purple-edged black robes, and a flame held aloft. The compact silhouette is
// based on the supplied reference while matching the game's chunky pixel grid.
const TIM_WIDTH = 30;
const TIM = [
  '..............................',
  '........HHH.....HHH...........',
  '.......HhhhH...HhhhH..........',
  '......Hhh.HH###HH.hhH.........',
  '..bbb.Hhh.#kkkkk#.hhH.........',
  '.bb.b.Hh.##kkkkk##.hH.........',
  '.b..b..H.#ksssssk#.H....f.....',
  '.b.....H.#kswswsk#.H...fff....',
  '.b......##kssSssk##...ffFff...',
  '.b......#kkggGggkk#....fFf....',
  '.b.....##kggGGGggk##...fWf....',
  '.b....#rrkkgGGGgkkrr#...s.....',
  '.b...#ryrkkggGggkkryr#..sss...',
  'Bbss#kkrrkkgGgkkrrkk#...s.....',
  'Bbss#kpkkrkkGkkkpkkk#.........',
  '.b..#kppkrkkrrrkkppkk#........',
  '.b..#kppkrkkryrkkppkk#........',
  '.b..#kppkrkkrrrkkppkk#........',
  '.b..#kppkrkkryrkkppkk#........',
  '.b.#kkppkrkkrrkkppkkkk#.......',
  '.b.#kpppkrkkrykkpppkkk#.......',
  '.b#kkpppkrkkrrkkpppkkkk#......',
  '.b#kppppkrkkrykkppppkkk#......',
  '.b#kkkkkkrrkyyrrkkkkkkkk#......',
  '.b.##kkk###kkkk###kkk##........',
  '.b...bbb..##..##...............',
].map((row) => row.padEnd(TIM_WIDTH, '.'));

const TIM_PALETTE: Record<string, string> = {
  '#': '#111827', // near-black outline
  k: '#1f2937', // black robe and hood
  p: '#6b2d83', // purple robe trim
  r: '#991b1b', // red ceremonial stole
  y: '#f59e0b', // gold embroidery
  h: '#7c4a21', // horn shadow
  H: '#d6a75c', // horn highlight
  g: '#57534e', // beard
  G: '#a8a29e', // beard highlight
  s: '#c26d3a', // skin
  S: '#f0a35e', // skin highlight
  w: '#f8fafc', // eyes
  b: '#4a2a15', // staff
  B: '#8b5a2b', // staff highlight
  f: '#ea580c', // outer flame
  F: '#fbbf24', // inner flame
  W: '#fff7ae', // flame core
};

export const GRENADE_SPRITE = buildSprite(GRENADE, GRENADE_PALETTE);
export const KEEP_SPRITE = buildSprite(KEEP, KEEP_PALETTE);
export const TIM_SPRITE = buildSprite(TIM, TIM_PALETTE);

// --- The Black Knight (mini-boss) -----------------------------------------
// Authored front-on as separate limb layers over one shared 16×26 canvas so the
// game can drop a limb each appearance (Monty Python style) and substitute a
// bloody stump in its place. A great helm with a cross-slit visor, a black
// surcoat bearing a red device, a belt, and a longsword held point-down.
export const KNIGHT_COLS = 16;
export const KNIGHT_ROWS = 26;

const knightLayer = (rows: string[]): string[] => {
  const padded = rows.map((row) => row.padEnd(KNIGHT_COLS, '.'));
  while (padded.length < KNIGHT_ROWS) {
    padded.push('.'.repeat(KNIGHT_COLS));
  }
  return padded;
};

const KNIGHT_BODY = knightLayer([
  '......kkkk......',
  '.....kKKKKk.....',
  '.....kMMMMk.....',
  '.....keeeek.....',
  '.....kMMMMk.....',
  '.....kMeeMk.....',
  '.....kMMMMk.....',
  '.....kkKKkk.....',
  '......kKKk......',
  '....kKKKKKKk....',
  '...kKKKKKKKKk...',
  '...kKrKKKKrKk...',
  '...kKrRKKRrKk...',
  '...kKKrRRrKKk...',
  '...kKKrRRrKKk...',
  '...kKKKrrKKKk...',
  '...kKKKMMKKKk...',
  '...kKKKKKKKKk...',
  '...kKKKKKKKKk...',
  '..kKKKKKKKKKKk..',
  '..kKKKKKKKKKKk..',
]);

const KNIGHT_ARM_L = knightLayer([
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '.kKKk...........',
  'kKKKk...........',
  '.kKKk...........',
  '.kKMk...........',
  '.kKMk...........',
  '.kKMk...........',
  '.kKKk...........',
  '.kKKk...........',
  '..kKk...........',
  '..kKk...........',
]);

const KNIGHT_ARM_R = knightLayer([
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '...........kKKk.',
  '..........kKKKk.',
  '...........kKKk.',
  '...........kMKk.',
  '...........kMKk.',
  '...........kMKk.',
  '...........kKKk.',
  '...........kKKk.',
  '..........ggggg.',
  '............sS..',
  '............sS..',
  '............sS..',
  '............sS..',
  '............sS..',
  '............sS..',
  '............sS..',
  '............sS..',
  '............ss..',
]);

const KNIGHT_LEG_L = knightLayer([
  ...Array.from({ length: 21 }, () => ''),
  '...kKKk.........',
  '...kKKk.........',
  '...kKKk.........',
  '..kKKKk.........',
  '..kkkkk.........',
]);

const KNIGHT_LEG_R = knightLayer([
  ...Array.from({ length: 21 }, () => ''),
  '.........kKKk...',
  '.........kKKk...',
  '.........kKKk...',
  '.........kKKKk..',
  '.........kkkkk..',
]);

const KNIGHT_PALETTE: Record<string, string> = {
  k: '#0b0f17', // deepest outline / near-black
  K: '#1f2937', // armour base
  m: '#374151', // armour mid
  M: '#4b5563', // bright metal edge
  r: '#7f1d1d', // dark red device
  R: '#dc2626', // bright red device
  e: '#020617', // helm slit (cross visor)
  s: '#64748b', // sword blade
  S: '#cbd5e1', // sword highlight
  g: '#475569', // crossguard
};

export type KnightPartName = 'body' | 'armL' | 'armR' | 'legL' | 'legR';

export const KNIGHT_PARTS: Record<KnightPartName, PixelSprite> = {
  body: buildSprite(KNIGHT_BODY, KNIGHT_PALETTE),
  armL: buildSprite(KNIGHT_ARM_L, KNIGHT_PALETTE),
  armR: buildSprite(KNIGHT_ARM_R, KNIGHT_PALETTE),
  legL: buildSprite(KNIGHT_LEG_L, KNIGHT_PALETTE),
  legR: buildSprite(KNIGHT_LEG_R, KNIGHT_PALETTE),
};

// A few red pixels marking where a severed limb used to attach. '"Tis but a
// scratch."' Drawn in place of the missing arm/leg.
export const KNIGHT_STUMPS: Record<
  Exclude<KnightPartName, 'body'>,
  Array<{ x: number; y: number; fill: string }>
> = {
  armL: [
    { x: 3, y: 9, fill: '#7f1d1d' },
    { x: 2, y: 10, fill: '#dc2626' },
    { x: 3, y: 10, fill: '#7f1d1d' },
  ],
  armR: [
    { x: 12, y: 9, fill: '#7f1d1d' },
    { x: 13, y: 10, fill: '#dc2626' },
    { x: 12, y: 10, fill: '#7f1d1d' },
  ],
  legL: [
    { x: 4, y: 21, fill: '#7f1d1d' },
    { x: 5, y: 21, fill: '#dc2626' },
    { x: 4, y: 22, fill: '#7f1d1d' },
  ],
  legR: [
    { x: 10, y: 21, fill: '#7f1d1d' },
    { x: 11, y: 21, fill: '#dc2626' },
    { x: 11, y: 22, fill: '#7f1d1d' },
  ],
};
