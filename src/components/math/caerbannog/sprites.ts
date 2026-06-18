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
