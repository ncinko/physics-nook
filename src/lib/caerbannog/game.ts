/**
 * Pure, DOM-free model for the hidden "Rabbit of Caerbannog" defense game.
 *
 * Waves of killer rabbits advance from the right toward King Arthur's keep on
 * the left. The player lobs the Holy Hand Grenade by choosing a launch velocity
 * vector; the grenade flies under gravity, lands, counts down a fuse, and blasts
 * rabbits within a radius — harder the closer they are to the centre of the
 * blast. Killing rabbits earns gold, spent between waves on static defenses
 * (Tim the Enchanter, caltrops, the keep). After waves 1, 4, 7, … the player
 * also picks a grenade *blessing*.
 *
 * World coordinates are y-up with the ground at y = 0. All logic here is
 * deterministic given a seed, so it is unit tested in `tests/caerbannog`; the
 * React island in `src/components/math/caerbannog` owns rendering and input.
 */
import type { Vector2 } from '../math/vectors.ts';
import { createRng, type Rng } from './rng.ts';
import {
  BLESSINGS,
  applyBlessing,
  canBuy,
  shopItem,
  type BlessingId,
  type ShopId,
} from './upgrades.ts';
import { isBlessingWave, waveConfig, type WaveConfig } from './waves.ts';

export const WORLD = {
  width: 100,
  keepX: 8, // rabbits at or past this x have reached the keep
  spawnX: 98, // rabbits enter here and advance left
  // Slingshot emplacement beside the keep. Kept up and to the right of the
  // bottom-left corner so the player has room to pull the sling back down-left
  // without the cursor crowding the edge of the play area.
  launch: { x: 12, y: 11 } as Vector2,
  tim: { x: 4, y: 9 } as Vector2, // where Tim the Enchanter stands to cast
  caltropsZone: 16, // caltrops cover the ground from keepX out to keepX + this
  gravity: 60, // world units / s^2 (pulls -y)
  groundY: 0,
};

export type GamePhase = 'intro' | 'playing' | 'intermission' | 'gameover' | 'victory';
export type RabbitKind = 'common' | 'runner' | 'brute' | 'boss' | 'knight';

/** Seconds a Tim staff-swing animation plays after each cast (purely visual). */
export const TIM_SWING_TIME = 0.4;

/** The Black Knight starts whole with four limbs (two arms, two legs). */
export const KNIGHT_MAX_LIMBS = 4;

/**
 * The Black Knight is a mini-boss that returns every tenth wave (10, 20, 30, …)
 * and — true to Monty Python — loses one limb on each appearance: first his
 * arms, then his legs. Returns the number of limbs he still has (0–4). Off the
 * milestone waves he is notionally whole.
 */
export const knightLimbs = (wave: number): number => {
  if (wave <= 0 || wave % 10 !== 0) {
    return KNIGHT_MAX_LIMBS;
  }
  const appearance = wave / 10; // 1 at wave 10, 2 at wave 20, …
  return Math.max(0, KNIGHT_MAX_LIMBS - (appearance - 1));
};

/** Legs still attached for a given limb count (arms are lost before legs). */
export const knightLegs = (limbs: number): number => Math.min(2, Math.max(0, limbs));

/**
 * The siege is won by clearing wave 50 — the appearance where the Black Knight
 * is whittled down to a limbless torso ("It's just a flesh wound!"). There is no
 * intermission after it: the run ends in victory rather than rolling onward.
 */
export const FINAL_WAVE = 50;

// --- Special grenade weapons -----------------------------------------------
// Each Black Knight (waves 10, 20, …) lets the player claim a secondary effect
// that may trigger after a grenade's initial blast: the FIRST knight (wave 10)
// offers a choice of one, and the SECOND knight (wave 20) grants the *other*, so
// a seasoned run can wield both. Each weapon has two independent upgrade tracks
// bought with gold:
//   - cluster:   scatters bomblets from the blast.
//                · freq track  → more often
//                · power track → more bomblets
//   - lightning: calls a bolt down on the toughest rabbit on screen, dealing a
//                fixed share of that rabbit's full health.
//                · freq track  → more often
//                · power track → a larger share of health per strike
//
// Each Black Knight at waves 30 and 40 (both weapons are in hand by then) also
// grants a one-time, *unleveled* enhancement for an owned special — wave 30
// offers a choice, wave 40 grants the other:
//   - lightning → an arc that chains from the struck rabbit to nearby beasts.
//   - cluster   → holy fire: bomblets scorch the ground, leaving a burning patch.
export type SpecialId = 'cluster' | 'lightning';
/** 'none' is accepted by `chooseSpecial` as an explicit no-op (invalid pick). */
export type SpecialWeapon = 'none' | SpecialId;
/** The two upgrade tracks every special shares: how often, and how hard. */
export type SpecialTrack = 'freq' | 'power';

export const SPECIAL_IDS: SpecialId[] = ['cluster', 'lightning'];

export const MAX_SPECIAL_LEVEL = 6;
const CLUSTER_BOMBLETS_BASE = 5; // bomblets at the first (level-1) power tier
const CLUSTER_RADIUS_SCALE = 0.55; // bomblet blast radius vs the main grenade
const CLUSTER_DAMAGE_SCALE = 0.6; // bomblet damage vs the main grenade
const LIGHTNING_SKY_Y = 40; // world height the bolt descends from

// Wave-30/40 enhancements (flat, unleveled effects on an owned special):
export const LIGHTNING_ARC_RANGE = 16; // world units a bolt will chain across
export const LIGHTNING_ARC_MAX_TARGETS = 2; // extra rabbits a single bolt arcs to
const LIGHTNING_ARC_FALLOFF = 0.5; // arced rabbits take this share of the strike %
const CLUSTER_FIRE_TTL = 2.5; // seconds a scorched patch keeps burning
const CLUSTER_FIRE_DPS_SCALE = 0.6; // burn dps as a share of base grenade damage

/** Per-special upgrade state: ownership, a level on each track, and the one-time enhancement. */
export interface SpecialState {
  owned: boolean;
  freqLevel: number; // 0 = unowned; 1+ raises the post-blast trigger chance
  powerLevel: number; // 0 = unowned; 1+ raises potency (bomblets / strike %)
  enhanced: boolean; // the wave-30/40 enhancement (arc / holy fire) is claimed
}

/** Chance (0–1) a special triggers after a blast, by its frequency level. */
export const specialChance = (level: number): number =>
  level <= 0 ? 0 : Math.min(0.9, 0.25 + (level - 1) * 0.15);

/** Bomblets a cluster scatters when it triggers, by its power level. */
export const clusterBomblets = (level: number): number =>
  level <= 0 ? 0 : CLUSTER_BOMBLETS_BASE + (level - 1);

/** Share (0–1) of a rabbit's full health a lightning strike deals, by power level. */
export const lightningPct = (level: number): number =>
  level <= 0 ? 0 : Math.min(0.5, 0.15 + (level - 1) * 0.07);

/** Gold to advance one special track from its current level to the next. */
export const specialUpgradeCost = (level: number): number => 35 + Math.max(0, level - 1) * 30;

export interface RabbitTraits {
  hpMultiplier: number;
  speedMultiplier: number;
  staticDamageMultiplier: number;
  grenadeDamageMultiplier: number;
  keepDamage: number;
  bounty: number;
  scale: number;
}

export interface Rabbit {
  id: number;
  kind: RabbitKind;
  x: number; // world x; decreases as it advances on the keep
  y: number; // small visual hop height above the ground
  hopPhase: number; // animation phase for the hop bob
  hp: number; // fractional — proximity damage and DoT are continuous
  maxHp: number;
  speed: number; // world units/sec (before the caltrops slow)
  keepDamage: number;
  precisionKill: boolean;
}

export interface Grenade {
  id: number;
  pos: Vector2;
  vel: Vector2;
  state: 'flying' | 'fuse';
  fuse: number; // seconds left on the fuse once landed
  clusterChild?: boolean; // a bomblet from a cluster trigger (smaller, no re-trigger)
}

export interface Explosion {
  id: number;
  pos: Vector2;
  radius: number;
  age: number; // seconds since detonation
  ttl: number; // lifetime for the visual flash
}

/** A bolt of magic: Tim's staff-fire, or a lightning strike from the heavens. */
export interface Zap {
  id: number;
  from: Vector2;
  to: Vector2;
  age: number;
  ttl: number;
  tone?: 'lightning'; // styles the bolt; default is Tim's fire
}

/** A patch of holy fire left by an enhanced cluster's bomblet; burns rabbits over time. */
export interface FirePatch {
  id: number;
  x: number; // world x of the patch centre, on the ground
  radius: number; // world units; rabbits within this of `x` take the burn
  age: number; // seconds since the patch ignited
  ttl: number; // lifetime before the fire burns out
}

export interface RewardPopup {
  id: number;
  pos: Vector2;
  text: string;
  tone: 'precision' | 'boss';
  age: number;
  ttl: number;
}

export interface GameStats {
  castleHp: number;
  maxCastleHp: number;
  ammo: number;
  maxAmmo: number;
  reload: number; // seconds to regenerate one grenade
  reloadTimer: number; // seconds accumulated toward the next grenade
  blastRadius: number;
  damage: number; // base blast damage; scaled by proximity to the centre
  fuseTime: number; // seconds a landed grenade waits before blasting
  caltropsLevel: number; // 0 = none; higher slows + bleeds rabbits near the keep
  timLevel: number; // 0 = not summoned; higher = stronger/faster casts
  timCooldown: number; // seconds until Tim's next cast
  timSwing: number; // seconds left on Tim's staff-swing animation (visual only)
  specials: Record<SpecialId, SpecialState>; // secondary blast effects, claimed on knight waves
}

export interface GameState {
  phase: GamePhase;
  wave: number;
  score: number;
  gold: number; // currency for the static-defense shop
  goldEarned: number; // total gold collected this run; never spent down (for scoring)
  waveGoldEarned: number;
  waveInterest: number; // interest paid on banked gold at the last wave clear (for the summary)
  precisionKillsThisWave: number;
  rabbits: Rabbit[];
  grenades: Grenade[];
  explosions: Explosion[];
  zaps: Zap[];
  firePatches: FirePatch[]; // holy fire left by enhanced cluster bomblets
  rewardPopups: RewardPopup[];
  stats: GameStats;
  pending: number; // rabbits left to spawn this wave
  spawnTimer: number; // seconds until the next spawn
  offer: BlessingId[]; // blessing choices shown during a blessing intermission
  blessingPending: boolean; // a blessing must be chosen before the next wave
  specialPending: boolean; // the one-time cluster/lightning choice is owed
  enhancementPending: boolean; // the wave-30/40 enhancement choice is owed
  rng: Rng;
  nextId: number;
  bestWave: number;
  announcementTimer: number;
  clock: number; // seconds elapsed while playing; drives idle animation
}

const MAX_DT_MS = 50; // clamp dt so a stalled tab can't tunnel rabbits/grenades

export const createGame = (seed = 1): GameState => ({
  phase: 'intro',
  wave: 0,
  score: 0,
  gold: 0,
  goldEarned: 0,
  waveGoldEarned: 0,
  waveInterest: 0,
  precisionKillsThisWave: 0,
  rabbits: [],
  grenades: [],
  explosions: [],
  zaps: [],
  firePatches: [],
  rewardPopups: [],
  stats: {
    castleHp: 5,
    maxCastleHp: 5,
    ammo: 2,
    maxAmmo: 2,
    reload: 1.6,
    reloadTimer: 0,
    blastRadius: 9,
    damage: 1,
    fuseTime: 0.8,
    caltropsLevel: 0,
    timLevel: 0,
    timCooldown: 0,
    timSwing: 0,
    specials: {
      cluster: { owned: false, freqLevel: 0, powerLevel: 0, enhanced: false },
      lightning: { owned: false, freqLevel: 0, powerLevel: 0, enhanced: false },
    },
  },
  pending: 0,
  spawnTimer: 0,
  offer: [],
  blessingPending: false,
  specialPending: false,
  enhancementPending: false,
  rng: createRng(seed),
  nextId: 1,
  bestWave: 0,
  announcementTimer: 0,
  clock: 0,
});

// --- Defense tuning ---------------------------------------------------------

/** Caltrops slow: rabbits in the caltrops zone move at this fraction of speed. */
export const caltropsSlow = (level: number): number =>
  level <= 0 ? 1 : Math.max(0.4, 1 - level * 0.13);

/** Caltrops damage-over-time (hp/sec) dealt to rabbits standing in the zone. */
export const caltropsDps = (level: number): number => level * 0.7;

/** Tim's cast cadence, per-hit damage, and splash radius at a given level. */
export const timStats = (level: number): { interval: number; damage: number; splash: number } => ({
  interval: Math.max(0.7, 2.4 - level * 0.45),
  damage: 1 + level,
  splash: 4,
});

/** Fixed archetype tuning. Wave is used only for the milestone boss bounty. */
export const rabbitTraits = (kind: RabbitKind, wave: number): RabbitTraits => {
  if (kind === 'runner') {
    return {
      hpMultiplier: 0.65,
      speedMultiplier: 1.65,
      staticDamageMultiplier: 1,
      grenadeDamageMultiplier: 1,
      keepDamage: 1,
      bounty: 1,
      scale: 0.9,
    };
  }
  if (kind === 'brute') {
    return {
      hpMultiplier: 2.4,
      speedMultiplier: 0.72,
      staticDamageMultiplier: 0.35,
      grenadeDamageMultiplier: 1.2,
      keepDamage: 2,
      bounty: 3,
      scale: 1.25,
    };
  }
  if (kind === 'boss') {
    const milestone = Math.max(1, Math.floor(wave / 5));
    return {
      hpMultiplier: 4 + milestone * 0.25,
      speedMultiplier: 0.55,
      staticDamageMultiplier: 0.15,
      grenadeDamageMultiplier: 1.25,
      keepDamage: 3,
      bounty: 10 + milestone * 2,
      scale: 1.7,
    };
  }
  if (kind === 'knight') {
    // Armoured mini-boss. Fewer legs (later appearances) drag him slower, but he
    // never gives up. Bounty climbs with each return.
    const milestone = Math.max(1, Math.floor(wave / 10));
    const legs = knightLegs(knightLimbs(wave));
    return {
      hpMultiplier: 3.5 + milestone * 0.2,
      speedMultiplier: 0.3 + 0.15 * legs,
      staticDamageMultiplier: 0.3,
      grenadeDamageMultiplier: 1.15,
      keepDamage: 2,
      bounty: 12 + milestone * 4, // a tougher prize than the White Rabbit boss
      scale: 1.5,
    };
  }
  return {
    hpMultiplier: 1,
    speedMultiplier: 1,
    staticDamageMultiplier: 1,
    grenadeDamageMultiplier: 1,
    keepDamage: 1,
    bounty: 1,
    scale: 1,
  };
};

/** Learnable one-based spawn pattern: knight/boss finale, then brute, runner, common. */
export const rabbitKindForSpawn = (wave: number, spawnIndex: number, count: number): RabbitKind => {
  const ordinal = spawnIndex + 1;
  if (spawnIndex === count - 1) {
    // Every tenth wave the Black Knight headlines; the other milestone waves
    // (5, 15, 25, …) send the White Rabbit.
    if (wave % 10 === 0) return 'knight';
    if (wave % 5 === 0) return 'boss';
  }
  if (wave >= 7 && ordinal % 6 === 0) return 'brute';
  if (wave >= 4 && ordinal % 5 === 0) return 'runner';
  return 'common';
};

/**
 * Blast damage as a function of how close the rabbit is to the centre: a
 * dead-centre hit deals 1.5× the base, fading linearly to 0.5× at the very
 * edge of the radius. Rewards accurate, close shots. Zero outside the radius.
 */
export const blastDamage = (base: number, dist: number, radius: number): number => {
  if (dist > radius) {
    return 0;
  }
  const proximity = 1 - dist / radius; // 1 at the centre, 0 at the edge
  return base * (0.5 + proximity);
};

/** Gold awarded for felling a rabbit — tougher rabbits pay out more. */
export const goldForKill = (kind: RabbitKind, wave: number, precision = false): number =>
  rabbitTraits(kind, wave).bounty + (precision ? 1 : 0);

/** Gold bonus for clearing a wave outright. */
export const waveClearGold = (wave: number): number => 5 + Math.floor(wave / 5) * 2;

/** Interest paid on banked gold at each wave clear, rounded up to a whole coin. */
const GOLD_INTEREST_RATE = 0.1;
export const goldInterest = (gold: number): number =>
  gold <= 0 ? 0 : Math.ceil(gold * GOLD_INTEREST_RATE);

/** Repeatable price to repair one lost keep heart between waves. */
export const repairCost = (wave: number): number => 12 + Math.floor(wave / 5) * 2;

// --- Wave / phase control ---------------------------------------------------

const beginWave = (state: GameState, wave: number): GameState => ({
  ...state,
  phase: 'playing',
  wave,
  pending: waveConfig(wave).count,
  spawnTimer: 0.5, // small beat before the first rabbit appears
  offer: [],
  blessingPending: false,
  specialPending: false,
  enhancementPending: false,
  waveGoldEarned: 0,
  waveInterest: 0,
  precisionKillsThisWave: 0,
  rewardPopups: [],
  announcementTimer: wave % 5 === 0 ? 2.8 : 0,
  // Give a short lead-in so Tim doesn't dump a cast the instant the wave opens.
  stats: { ...state.stats, timCooldown: state.stats.timLevel > 0 ? 0.6 : 0 },
});

/** Leave the intro screen and start wave 1. */
export const startGame = (state: GameState): GameState => beginWave(state, 1);

/** Apply the chosen grenade blessing (only valid while one is pending). */
export const chooseBlessing = (state: GameState, id: BlessingId): GameState => {
  if (state.phase !== 'intermission' || !state.blessingPending) {
    return state;
  }
  const stats = { ...state.stats };
  applyBlessing(stats, id);
  return { ...state, stats, blessingPending: false, offer: [] };
};

/** Specials still available to claim (unowned), offered on a knight wave. */
export const offerableSpecials = (stats: GameStats): SpecialId[] =>
  SPECIAL_IDS.filter((id) => !stats.specials[id].owned);

/**
 * Claim a special grenade weapon (only valid while a choice is pending and the
 * weapon is still unowned). Both upgrade tracks start at level 1. One claim
 * satisfies the pending choice, so the *other* weapon waits for the next knight.
 */
export const chooseSpecial = (state: GameState, weapon: SpecialWeapon): GameState => {
  if (
    state.phase !== 'intermission' ||
    !state.specialPending ||
    weapon === 'none' ||
    state.stats.specials[weapon].owned
  ) {
    return state;
  }
  return {
    ...state,
    specialPending: false,
    stats: {
      ...state.stats,
      specials: {
        ...state.stats.specials,
        [weapon]: { owned: true, freqLevel: 1, powerLevel: 1, enhanced: false },
      },
    },
  };
};

/** Owned specials that have not yet claimed their wave-30/40 enhancement. */
export const offerableEnhancements = (stats: GameStats): SpecialId[] =>
  SPECIAL_IDS.filter((id) => stats.specials[id].owned && !stats.specials[id].enhanced);

/**
 * Claim a special's one-time enhancement (valid only while a choice is pending
 * and the weapon is owned but not already enhanced). One claim satisfies the
 * pending choice, so the *other* enhancement waits for the next knight.
 */
export const chooseEnhancement = (state: GameState, weapon: SpecialWeapon): GameState => {
  if (
    state.phase !== 'intermission' ||
    !state.enhancementPending ||
    weapon === 'none' ||
    !state.stats.specials[weapon].owned ||
    state.stats.specials[weapon].enhanced
  ) {
    return state;
  }
  return {
    ...state,
    enhancementPending: false,
    stats: {
      ...state.stats,
      specials: {
        ...state.stats.specials,
        [weapon]: { ...state.stats.specials[weapon], enhanced: true },
      },
    },
  };
};

const trackLevel = (state: SpecialState, track: SpecialTrack): number =>
  track === 'freq' ? state.freqLevel : state.powerLevel;

/** Whether the run can afford to raise the given track of an owned special. */
export const canUpgradeSpecial = (
  state: GameState,
  id: SpecialId,
  track: SpecialTrack,
): boolean => {
  const special = state.stats.specials[id];
  return (
    state.phase === 'intermission' &&
    special.owned &&
    trackLevel(special, track) < MAX_SPECIAL_LEVEL &&
    state.gold >= specialUpgradeCost(trackLevel(special, track))
  );
};

/** Spend gold to raise one track of a special weapon by a level. */
export const upgradeSpecial = (
  state: GameState,
  id: SpecialId,
  track: SpecialTrack,
): GameState => {
  if (!canUpgradeSpecial(state, id, track)) return state;
  const special = state.stats.specials[id];
  const cost = specialUpgradeCost(trackLevel(special, track));
  const key = track === 'freq' ? 'freqLevel' : 'powerLevel';
  return {
    ...state,
    gold: state.gold - cost,
    stats: {
      ...state.stats,
      specials: {
        ...state.stats.specials,
        [id]: { ...special, [key]: trackLevel(special, track) + 1 },
      },
    },
  };
};

/** Buy one level of a static defense with gold (only valid during intermission). */
export const buyDefense = (state: GameState, id: ShopId): GameState => {
  if (state.phase !== 'intermission' || !canBuy(state.stats, state.gold, id)) {
    return state;
  }
  const item = shopItem(id);
  const cost = item.cost(item.level(state.stats));
  const stats = { ...state.stats };
  item.apply(stats);
  return { ...state, stats, gold: state.gold - cost };
};

export const canRepairKeep = (state: GameState): boolean =>
  state.phase === 'intermission' &&
  state.stats.castleHp < state.stats.maxCastleHp &&
  state.gold >= repairCost(state.wave);

/** Spend gold to restore exactly one heart without increasing maximum health. */
export const repairKeep = (state: GameState): GameState => {
  if (!canRepairKeep(state)) return state;
  return {
    ...state,
    gold: state.gold - repairCost(state.wave),
    stats: { ...state.stats, castleHp: state.stats.castleHp + 1 },
  };
};

/** Begin the next wave (blocked until any pending blessing/special is chosen). */
export const nextWave = (state: GameState): GameState => {
  if (
    state.phase !== 'intermission' ||
    state.blessingPending ||
    state.specialPending ||
    state.enhancementPending
  ) {
    return state;
  }
  return beginWave(state, state.wave + 1);
};

const spawnRabbit = (
  id: number,
  cfg: WaveConfig,
  wave: number,
  spawnIndex: number,
  rng: Rng,
): Rabbit => {
  const kind = rabbitKindForSpawn(wave, spawnIndex, cfg.count);
  const traits = rabbitTraits(kind, wave);
  const hp = Math.round(cfg.hp * traits.hpMultiplier * 10) / 10;
  return {
    id,
    kind,
    x: WORLD.spawnX + rng.range(0, 6),
    y: 0,
    hopPhase: rng.range(0, Math.PI * 2),
    hp,
    maxHp: hp,
    speed: cfg.speed * traits.speedMultiplier * rng.range(0.9, 1.1),
    keepDamage: traits.keepDamage,
    precisionKill: false,
  };
};

/** Pick three distinct blessing choices for a blessing intermission. */
export const offerBlessings = (rng: Rng): BlessingId[] => {
  const ids = BLESSINGS.map((blessing) => blessing.id);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, 3);
};

/** Advance the simulation by `dtMs` milliseconds. No-op unless playing. */
export const step = (state: GameState, dtMs: number): GameState => {
  if (state.phase !== 'playing') {
    return state;
  }
  const dt = Math.min(dtMs, MAX_DT_MS) / 1000;
  const rng = state.rng;
  const stats = { ...state.stats };
  let score = state.score;
  let gold = state.gold;
  let goldEarned = state.goldEarned;
  let waveGoldEarned = state.waveGoldEarned;
  let waveInterest = state.waveInterest;
  let precisionKillsThisWave = state.precisionKillsThisWave;
  let nextId = state.nextId;
  let announcementTimer = Math.max(0, state.announcementTimer - dt);
  const clock = state.clock + dt;
  const rewardPopups = state.rewardPopups
    .map((popup) => ({ ...popup, age: popup.age + dt }))
    .filter((popup) => popup.age < popup.ttl);

  // 1. Reload one grenade at a time.
  if (stats.ammo < stats.maxAmmo) {
    stats.reloadTimer += dt;
    if (stats.reloadTimer >= stats.reload) {
      stats.reloadTimer -= stats.reload;
      stats.ammo += 1;
    }
  } else {
    stats.reloadTimer = 0;
  }

  // 2. Spawn the next rabbit of the wave when its timer elapses.
  let pending = state.pending;
  let spawnTimer = state.spawnTimer - dt;
  const cfg = waveConfig(state.wave);
  let rabbits = state.rabbits.map((r) => ({ ...r }));
  if (pending > 0 && spawnTimer <= 0) {
    const spawnIndex = cfg.count - pending;
    rabbits.push(spawnRabbit(nextId, cfg, state.wave, spawnIndex, rng));
    nextId += 1;
    pending -= 1;
    spawnTimer = cfg.spawnInterval;
  }

  // 3. Advance rabbits toward the keep with a little hop bob. Rabbits crossing
  //    the caltrops zone near the keep are slowed.
  const slow = caltropsSlow(stats.caltropsLevel);
  const caltropsEdge = WORLD.keepX + WORLD.caltropsZone;
  // A limbless Black Knight has nothing left to march on, so he hops along like
  // the famous torso; otherwise the knight gets a small marching bob rather than
  // a bunny hop.
  const knightHop = knightLimbs(state.wave) === 0 ? 2.4 : 0.6;
  for (const r of rabbits) {
    const inCaltrops = r.x <= caltropsEdge;
    r.x -= r.speed * (inCaltrops ? slow : 1) * dt;
    r.hopPhase += dt * 7;
    r.y = Math.abs(Math.sin(r.hopPhase)) * (r.kind === 'knight' ? knightHop : 2);
  }

  // 4. Rabbits that reach the keep bite the wall and are removed.
  let castleHp = stats.castleHp;
  rabbits = rabbits.filter((r) => {
    if (r.x <= WORLD.keepX) {
      castleHp -= r.keepDamage;
      return false;
    }
    return true;
  });

  // 5. Caltrops bleed rabbits standing in the spikes.
  const dps = caltropsDps(stats.caltropsLevel);
  if (dps > 0) {
    for (const r of rabbits) {
      if (r.x <= caltropsEdge) {
        r.hp -= dps * dt * rabbitTraits(r.kind, state.wave).staticDamageMultiplier;
      }
    }
  }

  // 5b. Holy fire (enhanced cluster): scorched patches burn any rabbit that
  //     lingers in them. Patches age out; fresh ones spawned by this frame's
  //     bomblet blasts (below) start burning next frame.
  const firePatches = state.firePatches
    .map((p) => ({ ...p, age: p.age + dt }))
    .filter((p) => p.age < p.ttl);
  if (firePatches.length > 0) {
    const burn = stats.damage * CLUSTER_FIRE_DPS_SCALE;
    for (const r of rabbits) {
      for (const p of firePatches) {
        if (Math.abs(r.x - p.x) <= p.radius) {
          r.hp -= burn * dt * rabbitTraits(r.kind, state.wave).grenadeDamageMultiplier;
        }
      }
    }
  }

  // 6. Advance grenades; landed ones run their fuse, then detonate.
  const explosions = state.explosions
    .map((e) => ({ ...e, age: e.age + dt }))
    .filter((e) => e.age < e.ttl);
  const grenades: Grenade[] = [];
  const blasts: Array<{ pos: Vector2; radius: number; damageScale: number; fromChild: boolean }> = [];
  for (const prev of state.grenades) {
    const g: Grenade = { ...prev, pos: { ...prev.pos }, vel: { ...prev.vel } };
    if (g.state === 'flying') {
      g.vel.y -= WORLD.gravity * dt;
      g.pos.x += g.vel.x * dt;
      g.pos.y += g.vel.y * dt;
      if (g.pos.y <= WORLD.groundY) {
        g.pos.y = WORLD.groundY;
        g.state = 'fuse';
        // Bomblets pop quickly so a cluster reads as one chained burst.
        g.fuse = g.clusterChild ? Math.min(stats.fuseTime, 0.35) : stats.fuseTime;
        g.vel = { x: 0, y: 0 };
      }
      grenades.push(g);
    } else {
      g.fuse -= dt;
      if (g.fuse <= 0) {
        const child = g.clusterChild === true;
        blasts.push({
          pos: g.pos,
          radius: child ? stats.blastRadius * CLUSTER_RADIUS_SCALE : stats.blastRadius,
          damageScale: child ? CLUSTER_DAMAGE_SCALE : 1,
          fromChild: child,
        });
      } else {
        grenades.push(g);
      }
    }
  }

  // Bolts (Tim's fire and lightning strikes) share one list so a grenade blast
  // can add lightning here before Tim takes his turn below.
  const zaps = state.zaps
    .map((z) => ({ ...z, age: z.age + dt }))
    .filter((z) => z.age < z.ttl);

  // 7. Resolve blasts: damage rabbits by proximity, spawn an explosion flash,
  //    then maybe fire the chosen special weapon off a primary (non-child) blast.
  for (const blast of blasts) {
    explosions.push({
      id: nextId,
      pos: blast.pos,
      radius: blast.radius,
      age: 0,
      ttl: blast.fromChild ? 0.22 : 0.3,
    });
    nextId += 1;
    for (const r of rabbits) {
      // `r.y` is only a hop animation. Accuracy must depend on where the player
      // landed the grenade, not which frame of the rabbit's bob happened to be
      // showing when the fuse expired.
      const dist = Math.abs(r.x - blast.pos.x);
      const wasAlive = r.hp > 0;
      const traits = rabbitTraits(r.kind, state.wave);
      r.hp -= blastDamage(stats.damage * blast.damageScale, dist, blast.radius) * traits.grenadeDamageMultiplier;
      if (wasAlive && r.hp <= 0 && dist <= blast.radius * 0.25) {
        r.precisionKill = true;
      }
    }

    // Enhanced cluster bomblets scorch the ground where they burst, leaving a
    // patch of holy fire that burns rabbits walking through it.
    if (blast.fromChild && stats.specials.cluster.enhanced) {
      firePatches.push({
        id: nextId,
        x: blast.pos.x,
        radius: blast.radius,
        age: 0,
        ttl: CLUSTER_FIRE_TTL,
      });
      nextId += 1;
    }

    // Each owned special rolls independently off a primary (non-child) blast.
    if (!blast.fromChild) {
      const cluster = stats.specials.cluster;
      if (cluster.owned && rng.next() < specialChance(cluster.freqLevel)) {
        // Scatter bomblets up and outward from the blast; they arc, land, and
        // pop on their own short fuse (and never re-trigger the special).
        const count = clusterBomblets(cluster.powerLevel);
        for (let i = 0; i < count; i += 1) {
          const dir = rng.range(-1, 1);
          grenades.push({
            id: nextId,
            pos: { x: blast.pos.x, y: 1 },
            vel: { x: dir * rng.range(6, 16), y: rng.range(14, 24) },
            state: 'flying',
            fuse: stats.fuseTime,
            clusterChild: true,
          });
          nextId += 1;
        }
      }

      const lightning = stats.specials.lightning;
      if (lightning.owned && rng.next() < specialChance(lightning.freqLevel)) {
        // Lightning seeks the toughest rabbit anywhere on screen (most current
        // health) and burns away a fixed share of its full health.
        let target: Rabbit | null = null;
        for (const r of rabbits) {
          if (r.hp > 0 && (target === null || r.hp > target.hp)) {
            target = r;
          }
        }
        if (target) {
          const hub = target;
          hub.hp -= lightningPct(lightning.powerLevel) * hub.maxHp;
          zaps.push({
            id: nextId,
            from: { x: hub.x, y: LIGHTNING_SKY_Y },
            to: { x: hub.x, y: hub.y },
            age: 0,
            ttl: 0.22,
            tone: 'lightning',
          });
          nextId += 1;
          // Enhanced: the bolt arcs from the struck rabbit to the nearest others,
          // searing each for a reduced share of its own full health.
          if (lightning.enhanced) {
            const arcShare = lightningPct(lightning.powerLevel) * LIGHTNING_ARC_FALLOFF;
            const chained = rabbits
              .filter((r) => r !== hub && r.hp > 0 && Math.abs(r.x - hub.x) <= LIGHTNING_ARC_RANGE)
              .sort((a, b) => Math.abs(a.x - hub.x) - Math.abs(b.x - hub.x))
              .slice(0, LIGHTNING_ARC_MAX_TARGETS);
            for (const r of chained) {
              r.hp -= arcShare * r.maxHp;
              zaps.push({
                id: nextId,
                from: { x: hub.x, y: hub.y },
                to: { x: r.x, y: r.y },
                age: 0,
                ttl: 0.2,
                tone: 'lightning',
              });
              nextId += 1;
            }
          }
        }
      }
    }
  }

  // 8. Tim the Enchanter zaps the frontmost rabbit on his cadence.
  stats.timSwing = Math.max(0, stats.timSwing - dt);
  if (stats.timLevel > 0) {
    stats.timCooldown -= dt;
    if (stats.timCooldown <= 0 && rabbits.length > 0) {
      const tim = timStats(stats.timLevel);
      let target = rabbits[0];
      for (const r of rabbits) {
        if (r.x < target.x) {
          target = r;
        }
      }
      for (const r of rabbits) {
        if (Math.abs(r.x - target.x) <= tim.splash) {
          r.hp -= tim.damage * rabbitTraits(r.kind, state.wave).staticDamageMultiplier;
        }
      }
      zaps.push({
        id: nextId,
        from: { ...WORLD.tim },
        to: { x: target.x, y: target.y },
        age: 0,
        ttl: 0.18,
      });
      nextId += 1;
      stats.timCooldown = tim.interval;
      stats.timSwing = TIM_SWING_TIME; // kick off the staff-swing animation
    }
  }

  // 9. Clear out the dead: score and earn gold for each felled rabbit.
  rabbits = rabbits.filter((r) => {
    if (r.hp <= 0) {
      score += 1;
      const reward = goldForKill(r.kind, state.wave, r.precisionKill);
      gold += reward;
      goldEarned += reward;
      waveGoldEarned += reward;
      if (r.precisionKill) {
        precisionKillsThisWave += 1;
        rewardPopups.push({
          id: nextId,
          pos: { x: r.x, y: r.y + 5 },
          text: '+1 PRECISION',
          tone: 'precision',
          age: 0,
          ttl: 0.9,
        });
        nextId += 1;
      }
      if (r.kind === 'boss') {
        rewardPopups.push({
          id: nextId,
          pos: { x: r.x, y: r.y + 10 },
          text: `WHITE RABBIT +${rabbitTraits('boss', state.wave).bounty} GOLD`,
          tone: 'boss',
          age: 0,
          ttl: 1.4,
        });
        nextId += 1;
      }
      if (r.kind === 'knight') {
        rewardPopups.push({
          id: nextId,
          pos: { x: r.x, y: r.y + 10 },
          text: `BLACK KNIGHT FALLS +${rabbitTraits('knight', state.wave).bounty} GOLD`,
          tone: 'boss',
          age: 0,
          ttl: 1.4,
        });
        nextId += 1;
      }
      return false;
    }
    return true;
  });

  // 10. Phase transitions: loss, or wave cleared -> intermission.
  stats.castleHp = Math.max(0, castleHp);
  let phase: GamePhase = state.phase;
  let offer = state.offer;
  let blessingPending = state.blessingPending;
  let specialPending = state.specialPending;
  let enhancementPending = state.enhancementPending;
  let bestWave = state.bestWave;
  if (castleHp <= 0) {
    phase = 'gameover';
    bestWave = Math.max(bestWave, state.wave);
  } else if (pending === 0 && rabbits.length === 0) {
    const clearReward = waveClearGold(state.wave);
    gold += clearReward;
    goldEarned += clearReward;
    waveGoldEarned += clearReward;
    // Interest accrues on everything banked so far this clear, paid on top.
    waveInterest = goldInterest(gold);
    gold += waveInterest;
    goldEarned += waveInterest;
    bestWave = Math.max(bestWave, state.wave);
    if (state.wave >= FINAL_WAVE) {
      // The limbless Black Knight is felled — the siege is won, the run ends.
      phase = 'victory';
    } else {
      phase = 'intermission';
      blessingPending = isBlessingWave(state.wave);
      offer = blessingPending ? offerBlessings(rng) : [];
      // Every Black Knight lets the player claim a reward while one is still
      // unclaimed: a special weapon at waves 10 & 20 (one each), then a one-time
      // enhancement for an owned weapon at waves 30 & 40 (one each).
      specialPending = state.wave % 10 === 0 && offerableSpecials(stats).length > 0;
      enhancementPending =
        state.wave % 10 === 0 && state.wave >= 30 && offerableEnhancements(stats).length > 0;
    }
  }

  return {
    ...state,
    phase,
    score,
    gold,
    goldEarned,
    waveGoldEarned,
    waveInterest,
    precisionKillsThisWave,
    rabbits,
    grenades,
    explosions,
    zaps,
    firePatches,
    rewardPopups,
    stats,
    pending,
    spawnTimer,
    offer,
    blessingPending,
    specialPending,
    enhancementPending,
    nextId,
    bestWave,
    announcementTimer,
    clock,
  };
};

/** Analytic time for a projectile to fall back to the ground (positive root). */
export const timeToGround = (
  y0: number,
  vy: number,
  gravity = WORLD.gravity,
  groundY = WORLD.groundY,
): number => {
  const a = -0.5 * gravity;
  const b = vy;
  const c = y0 - groundY;
  const disc = b * b - 4 * a * c;
  if (disc < 0) {
    return 0;
  }
  const root = Math.sqrt(disc);
  return Math.max((-b + root) / (2 * a), (-b - root) / (2 * a));
};

/** Where a grenade launched with `vel` from `launch` lands on the ground. */
export const landingPoint = (
  launch: Vector2,
  vel: Vector2,
  gravity = WORLD.gravity,
  groundY = WORLD.groundY,
): Vector2 => {
  const t = timeToGround(launch.y, vel.y, gravity, groundY);
  return { x: launch.x + vel.x * t, y: groundY };
};

/** Sampled points along the launch arc, for the aim preview. */
export const trajectoryPoints = (
  launch: Vector2,
  vel: Vector2,
  samples = 24,
  gravity = WORLD.gravity,
  groundY = WORLD.groundY,
): Vector2[] => {
  const tEnd = timeToGround(launch.y, vel.y, gravity, groundY);
  const points: Vector2[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = (tEnd * i) / samples;
    points.push({
      x: launch.x + vel.x * t,
      y: launch.y + vel.y * t - 0.5 * gravity * t * t,
    });
  }
  return points;
};

/** Lob a grenade with the given launch velocity, if a grenade is loaded. */
export const throwGrenade = (state: GameState, velocity: Vector2): GameState => {
  if (state.phase !== 'playing' || state.stats.ammo < 1) {
    return state;
  }
  const grenade: Grenade = {
    id: state.nextId,
    pos: { ...WORLD.launch },
    vel: { ...velocity },
    state: 'flying',
    fuse: state.stats.fuseTime,
  };
  return {
    ...state,
    nextId: state.nextId + 1,
    stats: { ...state.stats, ammo: state.stats.ammo - 1 },
    grenades: [...state.grenades, grenade],
  };
};
