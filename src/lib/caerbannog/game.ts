/**
 * Pure, DOM-free model for the hidden "Rabbit of Caerbannog" defense game.
 *
 * Waves of killer rabbits advance from the right toward King Arthur's keep on
 * the left. The player lobs the Holy Hand Grenade by choosing a launch velocity
 * vector; the grenade flies under gravity, lands, counts down a fuse, and blasts
 * rabbits within a radius. Between waves the player picks one rogue-lite upgrade.
 *
 * World coordinates are y-up with the ground at y = 0. All logic here is
 * deterministic given a seed, so it is unit tested in `tests/caerbannog`; the
 * React island in `src/components/math/caerbannog` owns rendering and input.
 */
import type { Vector2 } from '../math/vectors.ts';
import { createRng, type Rng } from './rng.ts';
import { UPGRADES, applyUpgrade, type UpgradeId } from './upgrades.ts';
import { waveConfig, type WaveConfig } from './waves.ts';

export const WORLD = {
  width: 100,
  keepX: 8, // rabbits at or past this x have reached the keep
  spawnX: 98, // rabbits enter here and advance left
  launch: { x: 10, y: 8 } as Vector2, // catapult muzzle on the keep
  gravity: 60, // world units / s^2 (pulls -y)
  groundY: 0,
};

export type GamePhase = 'intro' | 'playing' | 'intermission' | 'gameover';

export interface Rabbit {
  id: number;
  x: number; // world x; decreases as it advances on the keep
  y: number; // small visual hop height above the ground
  hopPhase: number; // animation phase for the hop bob
  hp: number;
  maxHp: number;
  speed: number; // world units/sec (before the caltrops multiplier)
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

export interface GameStats {
  castleHp: number;
  maxCastleHp: number;
  ammo: number;
  maxAmmo: number;
  reload: number; // seconds to regenerate one grenade
  reloadTimer: number; // seconds accumulated toward the next grenade
  blastRadius: number;
  damage: number;
  fuseTime: number; // seconds a landed grenade waits before blasting
  rabbitSpeedMult: number; // caltrops slow the rabbits
}

export interface GameState {
  phase: GamePhase;
  wave: number;
  score: number;
  rabbits: Rabbit[];
  grenades: Grenade[];
  explosions: Explosion[];
  stats: GameStats;
  pending: number; // rabbits left to spawn this wave
  spawnTimer: number; // seconds until the next spawn
  offer: UpgradeId[]; // upgrade choices shown during intermission
  rng: Rng;
  nextId: number;
  bestWave: number;
}

const MAX_DT_MS = 50; // clamp dt so a stalled tab can't tunnel rabbits/grenades

export const createGame = (seed = 1): GameState => ({
  phase: 'intro',
  wave: 0,
  score: 0,
  rabbits: [],
  grenades: [],
  explosions: [],
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
    rabbitSpeedMult: 1,
  },
  pending: 0,
  spawnTimer: 0,
  offer: [],
  rng: createRng(seed),
  nextId: 1,
  bestWave: 0,
});

const beginWave = (state: GameState, wave: number): GameState => ({
  ...state,
  phase: 'playing',
  wave,
  pending: waveConfig(wave).count,
  spawnTimer: 0.5, // small beat before the first rabbit appears
  offer: [],
});

/** Leave the intro screen and start wave 1. */
export const startGame = (state: GameState): GameState => beginWave(state, 1);

/** Apply the chosen upgrade and arm the next, harder wave. */
export const chooseUpgrade = (state: GameState, id: UpgradeId): GameState => {
  if (state.phase !== 'intermission') {
    return state;
  }
  const stats = { ...state.stats };
  applyUpgrade(stats, id);
  return beginWave({ ...state, stats }, state.wave + 1);
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

const spawnRabbit = (id: number, cfg: WaveConfig, rng: Rng): Rabbit => ({
  id,
  x: WORLD.spawnX + rng.range(0, 6),
  y: 0,
  hopPhase: rng.range(0, Math.PI * 2),
  hp: cfg.hp,
  maxHp: cfg.hp,
  speed: cfg.speed * rng.range(0.9, 1.1),
});

/** Pick three distinct upgrade choices for the intermission. */
export const offerUpgrades = (rng: Rng): UpgradeId[] => {
  const ids = UPGRADES.map((upgrade) => upgrade.id);
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

  // 3. Advance rabbits toward the keep with a little hop bob.
  for (const r of rabbits) {
    r.x -= r.speed * stats.rabbitSpeedMult * dt;
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

  // 5. Advance grenades; landed ones run their fuse, then detonate.
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

  // 6. Resolve blasts: damage rabbits within radius, spawn an explosion flash.
  for (const blast of blasts) {
    explosions.push({ id: nextId, pos: blast.pos, radius: blast.radius, age: 0, ttl: 0.4 });
    nextId += 1;
    for (const r of rabbits) {
      if (Math.hypot(r.x - blast.pos.x, r.y - blast.pos.y) <= blast.radius) {
        r.hp -= stats.damage;
      }
    }
  }
  rabbits = rabbits.filter((r) => {
    if (r.hp <= 0) {
      score += 1;
      return false;
    }
    return true;
  });

  // 7. Phase transitions: loss, or wave cleared -> intermission.
  stats.castleHp = Math.max(0, castleHp);
  let phase: GamePhase = state.phase;
  let offer = state.offer;
  let bestWave = state.bestWave;
  if (castleHp <= 0) {
    phase = 'gameover';
    bestWave = Math.max(bestWave, state.wave);
  } else if (pending === 0 && rabbits.length === 0) {
    phase = 'intermission';
    offer = offerUpgrades(rng);
    bestWave = Math.max(bestWave, state.wave);
  }

  return {
    ...state,
    phase,
    score,
    rabbits,
    grenades,
    explosions,
    stats,
    pending,
    spawnTimer,
    offer,
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
