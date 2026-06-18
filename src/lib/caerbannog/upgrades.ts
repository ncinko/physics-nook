/**
 * Upgrade catalog for the Caerbannog defense game, split into two tracks:
 *
 *  - **Blessings** — grenade upgrades granted *only* after waves 1, 4, 7, …
 *    (a choose-one card draw, the rogue-lite spine of the run).
 *  - **The Shop** — static defenses bought with gold during any intermission:
 *    Tim the Enchanter, caltrops, and the keep itself. Each is leveled and
 *    grows more expensive per level.
 *
 * Everything here is a pure mutation of the run's `GameStats`. The type-only
 * import of `GameStats` is erased at runtime, so there is no import cycle with
 * `game.ts` (which imports the values here).
 */
import type { GameStats } from './game.ts';

// --- Blessings: grenade upgrades, offered on waves 1, 4, 7, … ---------------

export type BlessingId =
  | 'bigger-blast'
  | 'faster-reload'
  | 'extra-ammo'
  | 'short-fuse'
  | 'holy-shrapnel';

export interface Blessing {
  id: BlessingId;
  name: string;
  description: string;
  apply: (stats: GameStats) => void;
}

export const BLESSINGS: Blessing[] = [
  {
    id: 'bigger-blast',
    name: 'Larger Antioch',
    description: 'The Holy Hand Grenade clears a wider blast.',
    apply: (s) => {
      s.blastRadius += 3;
    },
  },
  {
    id: 'faster-reload',
    name: 'Brother Maynard Reads Faster',
    description: 'Grenades return to your hand more quickly.',
    apply: (s) => {
      s.reload = Math.max(0.4, s.reload * 0.8);
    },
  },
  {
    id: 'extra-ammo',
    name: 'Deeper Satchel',
    description: 'Hold one more grenade at the ready.',
    apply: (s) => {
      s.maxAmmo += 1;
      s.ammo += 1;
    },
  },
  {
    id: 'short-fuse',
    name: 'Three Shall Be the Number',
    description: 'A landed grenade counts down to the blast faster.',
    apply: (s) => {
      s.fuseTime = Math.max(0.15, s.fuseTime - 0.2);
    },
  },
  {
    id: 'holy-shrapnel',
    name: 'Blessed Shrapnel',
    description: 'Each blast deals more damage (a dead-centre hit hits hardest).',
    apply: (s) => {
      s.damage += 1;
    },
  },
];

export const applyBlessing = (stats: GameStats, id: BlessingId): void => {
  BLESSINGS.find((b) => b.id === id)?.apply(stats);
};

// --- Shop: static defenses bought with gold ---------------------------------

export type ShopId = 'tim' | 'caltrops' | 'keep';

export interface ShopItem {
  id: ShopId;
  name: string;
  /** Read the current level of this item from the run's stats. */
  level: (stats: GameStats) => number;
  /** Highest level this item can reach. */
  maxLevel: number;
  /** Gold cost to advance from `level` to `level + 1`. */
  cost: (level: number) => number;
  /** Headline shown on the shop card. */
  blurb: string;
  /** What the *next* purchase does, given the current level. */
  detail: (level: number) => string;
  /** Apply one purchase: advance the item one level (mutates stats). */
  apply: (stats: GameStats) => void;
}

export const SHOP: ShopItem[] = [
  {
    id: 'tim',
    name: 'Tim the Enchanter',
    level: (s) => s.timLevel,
    maxLevel: 4,
    cost: (level) => 24 + level * 22,
    blurb: 'A sorcerer atop the keep who hurls fire at the nearest beast.',
    detail: (level) =>
      level === 0
        ? 'Summon Tim — he zaps the frontmost rabbit on a slow cadence.'
        : 'Sharper bolts and a faster cast.',
    apply: (s) => {
      s.timLevel += 1;
    },
  },
  {
    id: 'caltrops',
    name: 'Caltrops',
    level: (s) => s.caltropsLevel,
    maxLevel: 4,
    cost: (level) => 12 + level * 14,
    blurb: 'Spikes strewn before the gate: rabbits crossing them slow and bleed.',
    detail: (level) =>
      level === 0
        ? 'Scatter caltrops near the keep — rabbits there slow down and take damage.'
        : 'A deeper slow and a sharper bite.',
    apply: (s) => {
      s.caltropsLevel += 1;
    },
  },
  {
    id: 'keep',
    name: 'Shore Up the Keep',
    level: (s) => s.maxCastleHp - INITIAL_CASTLE_HP,
    maxLevel: 6,
    cost: (level) => 18 + level * 18,
    blurb: 'Masons reinforce the wall and patch the breaches.',
    detail: () => 'Repair the keep to full and add a heart.',
    apply: (s) => {
      s.maxCastleHp += 1;
      s.castleHp = s.maxCastleHp;
    },
  },
];

/** Starting (and minimum) keep hearts; the keep shop item is leveled off this. */
export const INITIAL_CASTLE_HP = 5;

export const shopItem = (id: ShopId): ShopItem => SHOP.find((item) => item.id === id)!;

/** Whether the run can afford and has room to buy one more of `id`. */
export const canBuy = (stats: GameStats, gold: number, id: ShopId): boolean => {
  const item = shopItem(id);
  const level = item.level(stats);
  return level < item.maxLevel && gold >= item.cost(level);
};
