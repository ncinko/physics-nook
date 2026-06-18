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
  launch: { x: 10, y: 8 } as Vector2, // catapult muzzle on the keep
  tim: { x: 4, y: 9 } as Vector2, // where Tim the Enchanter stands to cast
  caltropsZone: 16, // caltrops cover the ground from keepX out to keepX + this
  gravity: 60, // world units / s^2 (pulls -y)
  groundY: 0,
};

export type GamePhase = 'intro' | 'playing' | 'intermission' | 'gameover';

export interface Rabbit {
  id: number;
  x: number; // world x; decreases as it advances on the keep
  y: number; // small visual hop height above the ground
  hopPhase: number; // animation phase for the hop bob
  hp: number; // fractional — proximity damage and DoT are continuous
  maxHp: number;
  speed: number; // world units/sec (before the caltrops slow)
}

export interface Grenade {
  id: number;
  pos: Vector2;
  vel: Vector2;
  state: 'flying' | 'fuse';
  fuse: number; // seconds left on the fuse once landed
}

export interface Explosion {
  id: number;
  pos: Vector2;
  radius: number;
  age: number; // seconds since detonation
  ttl: number; // lifetime for the visual flash
}

/** A bolt of Tim's magic, drawn from his staff to the rabbit it struck. */
export interface Zap {
  id: number;
  from: Vector2;
  to: Vector2;
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
}

export interface GameState {
  phase: GamePhase;
  wave: number;
  score: number;
  gold: number; // currency for the static-defense shop
  rabbits: Rabbit[];
  grenades: Grenade[];
  explosions: Explosion[];
  zaps: Zap[];
  stats: GameStats;
  pending: number; // rabbits left to spawn this wave
  spawnTimer: number; // seconds until the next spawn
  offer: BlessingId[]; // blessing choices shown during a blessing intermission
  blessingPending: boolean; // a blessing must be chosen before the next wave
  rng: Rng;
  nextId: number;
  bestWave: number;
}

const MAX_DT_MS = 50; // clamp dt so a stalled tab can't tunnel rabbits/grenades

export const createGame = (seed = 1): GameState => ({
  phase: 'intro',
  wave: 0,
  score: 0,
  gold: 0,
  rabbits: [],
  grenades: [],
  explosions: [],
  zaps: [],
  stats: {
    castleHp: 5,
    maxCastleHp: 5,
    ammo: 3,
    maxAmmo: 3,
    reload: 1.6,
    reloadTimer: 0,
    blastRadius: 9,
    damage: 1,
    fuseTime: 0.8,
    caltropsLevel: 0,
    timLevel: 0,
    timCooldown: 0,
  },
  pending: 0,
  spawnTimer: 0,
  offer: [],
  blessingPending: false,
  rng: createRng(seed),
  nextId: 1,
  bestWave: 0,
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
export const goldForKill = (maxHp: number): number => 1 + Math.floor(maxHp / 2);

/** Gold bonus for clearing a wave outright. */
export const waveClearGold = (wave: number): number => 6 + wave * 3;

// --- Wave / phase control ---------------------------------------------------

const beginWave = (state: GameState, wave: number): GameState => ({
  ...state,
  phase: 'playing',
  wave,
  pending: waveConfig(wave).count,
  spawnTimer: 0.5, // small beat before the first rabbit appears
  offer: [],
  blessingPending: false,
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

/** Begin the next wave (blocked until any pending blessing is chosen). */
export const nextWave = (state: GameState): GameState => {
  if (state.phase !== 'intermission' || state.blessingPending) {
    return state;
  }
  return beginWave(state, state.wave + 1);
};

const spawnRabbit = (id: number, cfg: WaveConfig, rng: Rng): Rabbit => ({
  id,
  x: WORLD.spawnX + rng.range(0, 6),
  y: 0,
  hopPhase: rng.range(0, Math.PI * 2),
  hp: cfg.hp,
  maxHp: cfg.hp,
  speed: cfg.speed * rng.range(0.9, 1.1),
});

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
  let nextId = state.nextId;

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
    rabbits.push(spawnRabbit(nextId, cfg, rng));
    nextId += 1;
    pending -= 1;
    spawnTimer = cfg.spawnInterval;
  }

  // 3. Advance rabbits toward the keep with a little hop bob. Rabbits crossing
  //    the caltrops zone near the keep are slowed.
  const slow = caltropsSlow(stats.caltropsLevel);
  const caltropsEdge = WORLD.keepX + WORLD.caltropsZone;
  for (const r of rabbits) {
    const inCaltrops = r.x <= caltropsEdge;
    r.x -= r.speed * (inCaltrops ? slow : 1) * dt;
    r.hopPhase += dt * 7;
    r.y = Math.abs(Math.sin(r.hopPhase)) * 2;
  }

  // 4. Rabbits that reach the keep bite the wall and are removed.
  let castleHp = stats.castleHp;
  rabbits = rabbits.filter((r) => {
    if (r.x <= WORLD.keepX) {
      castleHp -= 1;
      return false;
    }
    return true;
  });

  // 5. Caltrops bleed rabbits standing in the spikes.
  const dps = caltropsDps(stats.caltropsLevel);
  if (dps > 0) {
    for (const r of rabbits) {
      if (r.x <= caltropsEdge) {
        r.hp -= dps * dt;
      }
    }
  }

  // 6. Advance grenades; landed ones run their fuse, then detonate.
  const explosions = state.explosions
    .map((e) => ({ ...e, age: e.age + dt }))
    .filter((e) => e.age < e.ttl);
  const grenades: Grenade[] = [];
  const blasts: Array<{ pos: Vector2; radius: number }> = [];
  for (const prev of state.grenades) {
    const g: Grenade = { ...prev, pos: { ...prev.pos }, vel: { ...prev.vel } };
    if (g.state === 'flying') {
      g.vel.y -= WORLD.gravity * dt;
      g.pos.x += g.vel.x * dt;
      g.pos.y += g.vel.y * dt;
      if (g.pos.y <= WORLD.groundY) {
        g.pos.y = WORLD.groundY;
        g.state = 'fuse';
        g.fuse = stats.fuseTime;
        g.vel = { x: 0, y: 0 };
      }
      grenades.push(g);
    } else {
      g.fuse -= dt;
      if (g.fuse <= 0) {
        blasts.push({ pos: g.pos, radius: stats.blastRadius });
      } else {
        grenades.push(g);
      }
    }
  }

  // 7. Resolve blasts: damage rabbits by proximity, spawn an explosion flash.
  for (const blast of blasts) {
    explosions.push({ id: nextId, pos: blast.pos, radius: blast.radius, age: 0, ttl: 0.3 });
    nextId += 1;
    for (const r of rabbits) {
      // `r.y` is only a hop animation. Accuracy must depend on where the player
      // landed the grenade, not which frame of the rabbit's bob happened to be
      // showing when the fuse expired.
      const dist = Math.abs(r.x - blast.pos.x);
      r.hp -= blastDamage(stats.damage, dist, blast.radius);
    }
  }

  // 8. Tim the Enchanter zaps the frontmost rabbit on his cadence.
  const zaps = state.zaps
    .map((z) => ({ ...z, age: z.age + dt }))
    .filter((z) => z.age < z.ttl);
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
          r.hp -= tim.damage;
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
    }
  }

  // 9. Clear out the dead: score and earn gold for each felled rabbit.
  rabbits = rabbits.filter((r) => {
    if (r.hp <= 0) {
      score += 1;
      gold += goldForKill(r.maxHp);
      return false;
    }
    return true;
  });

  // 10. Phase transitions: loss, or wave cleared -> intermission.
  stats.castleHp = Math.max(0, castleHp);
  let phase: GamePhase = state.phase;
  let offer = state.offer;
  let blessingPending = state.blessingPending;
  let bestWave = state.bestWave;
  if (castleHp <= 0) {
    phase = 'gameover';
    bestWave = Math.max(bestWave, state.wave);
  } else if (pending === 0 && rabbits.length === 0) {
    phase = 'intermission';
    gold += waveClearGold(state.wave);
    blessingPending = isBlessingWave(state.wave);
    offer = blessingPending ? offerBlessings(rng) : [];
    bestWave = Math.max(bestWave, state.wave);
  }

  return {
    ...state,
    phase,
    score,
    gold,
    rabbits,
    grenades,
    explosions,
    zaps,
    stats,
    pending,
    spawnTimer,
    offer,
    blessingPending,
    nextId,
    bestWave,
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
