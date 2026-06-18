/**
 * Rogue-lite upgrade catalog for the Caerbannog defense game. Each upgrade is a
 * pure mutation of the run's `GameStats`, applied between waves. The type-only
 * import of `GameStats` is erased at runtime, so there is no import cycle with
 * `game.ts` (which imports the values here).
 */
import type { GameStats } from './game.ts';

export type UpgradeId =
  | 'bigger-blast'
  | 'faster-reload'
  | 'extra-ammo'
  | 'short-fuse'
  | 'repair-wall'
  | 'holy-shrapnel'
  | 'caltrops';

export interface Upgrade {
  id: UpgradeId;
  name: string;
  description: string;
  apply: (stats: GameStats) => void;
}

export const UPGRADES: Upgrade[] = [
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
      s.fuseTime = Math.max(0.15, s.fuseTime - 0.25);
    },
  },
  {
    id: 'repair-wall',
    name: 'Shore Up the Wall',
    description: 'Repair the keep and add a heart.',
    apply: (s) => {
      s.maxCastleHp += 1;
      s.castleHp = s.maxCastleHp;
    },
  },
  {
    id: 'holy-shrapnel',
    name: 'Blessed Shrapnel',
    description: 'Each blast deals more damage.',
    apply: (s) => {
      s.damage += 1;
    },
  },
  {
    id: 'caltrops',
    name: 'Scatter Caltrops',
    description: 'The killer rabbits advance more slowly.',
    apply: (s) => {
      s.rabbitSpeedMult = Math.max(0.4, s.rabbitSpeedMult - 0.12);
    },
  },
];

export const applyUpgrade = (stats: GameStats, id: UpgradeId): void => {
  UPGRADES.find((upgrade) => upgrade.id === id)?.apply(stats);
};
