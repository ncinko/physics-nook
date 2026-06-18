import assert from 'node:assert/strict';
import { createRng } from '../../src/lib/caerbannog/rng.ts';
import {
  UPGRADES,
  applyUpgrade,
  type UpgradeId,
} from '../../src/lib/caerbannog/upgrades.ts';
import { waveConfig } from '../../src/lib/caerbannog/waves.ts';
import {
  WORLD,
  chooseUpgrade,
  createGame,
  landingPoint,
  offerUpgrades,
  startGame,
  step,
  throwGrenade,
  timeToGround,
  trajectoryPoints,
  type GameState,
  type Rabbit,
} from '../../src/lib/caerbannog/game.ts';

const near = (actual: number, expected: number, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be near ${expected}`);
};

// --- Seeded RNG determinism ---

const seqA = Array.from({ length: 6 }, () => createRng(42).next());
const rngB = createRng(42);
const seqB = Array.from({ length: 6 }, () => rngB.next());
// Same seed, fresh instance each time -> identical first value.
assert.equal(seqA[0], seqB[0]);
// Same seed, single instance -> deterministic, reproducible sequence.
const rngC = createRng(42);
for (const expected of seqB) {
  assert.equal(rngC.next(), expected);
}
for (let i = 0; i < 1000; i += 1) {
  const v = rngB.next();
  assert.ok(v >= 0 && v < 1, 'rng.next stays in [0, 1)');
  const n = rngB.int(2, 5);
  assert.ok(n >= 2 && n <= 5 && Number.isInteger(n), 'rng.int stays in range');
  const r = rngB.range(-3, 3);
  assert.ok(r >= -3 && r < 3, 'rng.range stays in range');
}

console.log('Caerbannog RNG tests passed.');

// --- Projectile analytics ---

near(timeToGround(0, 10, 10, 0), 2);
near(landingPoint({ x: 0, y: 0 }, { x: 10, y: 10 }, 10, 0).x, 20);

const arc = trajectoryPoints({ x: 0, y: 0 }, { x: 10, y: 10 }, 10, 10, 0);
assert.deepEqual(arc[0], { x: 0, y: 0 });
near(arc[arc.length - 1].x, 20, 1e-6);
near(arc[arc.length - 1].y, 0, 1e-6);
// The arc rises then falls (apex in the middle, above the endpoints).
assert.ok(arc[5].y > arc[0].y && arc[5].y > arc[arc.length - 1].y, 'trajectory arcs over');

// The integrator in step() lands close to the analytic landing point.
{
  const vel = { x: 30, y: 25 };
  const analytic = landingPoint(WORLD.launch, vel).x;
  let s = throwGrenade(startGame(createGame(7)), vel);
  let landedX: number | null = null;
  for (let i = 0; i < 400 && landedX === null; i += 1) {
    s = step(s, 16);
    const g = s.grenades[0];
    if (g && g.state === 'fuse') {
      landedX = g.pos.x;
    }
  }
  assert.ok(landedX !== null, 'thrown grenade lands');
  assert.ok(Math.abs(landedX! - analytic) <= 2, `integrator landing ${landedX} ~ ${analytic}`);
}

console.log('Caerbannog projectile tests passed.');

// --- step(): spawning and rabbit advance ---
{
  let s = startGame(createGame(7));
  assert.equal(s.phase, 'playing');
  assert.equal(s.wave, 1);
  assert.equal(s.pending, waveConfig(1).count);
  // Step past the first spawn delay; a rabbit should appear and then advance left.
  for (let i = 0; i < 40 && s.rabbits.length === 0; i += 1) {
    s = step(s, 16);
  }
  assert.ok(s.rabbits.length >= 1, 'a rabbit spawns');
  const before = s.rabbits[0].x;
  s = step(s, 50);
  assert.ok(s.rabbits[0].x < before, 'rabbit advances toward the keep');
}

// --- Helper to build a controlled, mid-game state ---
const playing = (overrides: Partial<GameState>): GameState => ({
  ...startGame(createGame(7)),
  phase: 'playing',
  pending: 99, // keep the wave from clearing during the assertion
  rabbits: [],
  grenades: [],
  explosions: [],
  ...overrides,
});

const rabbitAt = (x: number, hp = 1): Rabbit => ({
  id: 1,
  x,
  y: 0,
  hopPhase: 0,
  hp,
  maxHp: hp,
  speed: 0,
});

// --- Blast hit vs miss ---
{
  const hit = playing({
    rabbits: [rabbitAt(50)],
    grenades: [{ id: 2, pos: { x: 50, y: 0 }, vel: { x: 0, y: 0 }, state: 'fuse', fuse: 0.04 }],
  });
  const after = step(hit, 50);
  assert.equal(after.rabbits.length, 0, 'rabbit in the blast radius is destroyed');
  assert.equal(after.score, 1, 'destroying a rabbit scores');
  assert.equal(after.explosions.length, 1, 'a blast leaves an explosion flash');

  const miss = playing({
    rabbits: [rabbitAt(80)],
    grenades: [{ id: 2, pos: { x: 50, y: 0 }, vel: { x: 0, y: 0 }, state: 'fuse', fuse: 0.04 }],
  });
  const afterMiss = step(miss, 50);
  assert.equal(afterMiss.rabbits.length, 1, 'rabbit outside the radius survives');
  assert.equal(afterMiss.rabbits[0].hp, 1, 'a missed rabbit keeps its hp');
}

// --- Fuse timing ---
{
  const armed = playing({
    grenades: [{ id: 2, pos: { x: 40, y: 0 }, vel: { x: 0, y: 0 }, state: 'fuse', fuse: 0.08 }],
  });
  const s1 = step(armed, 50); // 0.08 - 0.05 = 0.03 left
  assert.equal(s1.grenades.length, 1, 'grenade still ticking before fuse expires');
  const s2 = step(s1, 50); // 0.03 - 0.05 <= 0 -> detonate
  assert.equal(s2.grenades.length, 0, 'grenade detonates when fuse expires');
  assert.equal(s2.explosions.length, 1, 'detonation creates an explosion');
}

// --- Throw gating and reload ---
{
  const ready = startGame(createGame(7));
  const thrown = throwGrenade(ready, { x: 30, y: 25 });
  assert.equal(thrown.grenades.length, 1, 'throwing spawns a grenade');
  assert.equal(thrown.stats.ammo, ready.stats.ammo - 1, 'throwing consumes a grenade');

  const empty = { ...ready, stats: { ...ready.stats, ammo: 0 } };
  const blocked = throwGrenade(empty, { x: 30, y: 25 });
  assert.equal(blocked, empty, 'no ammo -> throw is a no-op (same state)');

  let reloading = playing({ stats: { ...ready.stats, ammo: 0, maxAmmo: 1, reload: 1, reloadTimer: 0 } });
  for (let i = 0; i < 21; i += 1) {
    reloading = step(reloading, 50); // 21 * 0.05 = 1.05s > reload
  }
  assert.equal(reloading.stats.ammo, 1, 'reload regenerates a grenade');
}

// --- Wave clear -> intermission -> next wave ---
{
  const cleared = playing({ pending: 0 });
  const inter = step(cleared, 16);
  assert.equal(inter.phase, 'intermission', 'clearing a wave starts intermission');
  assert.equal(inter.offer.length, 3, 'intermission offers three upgrades');
  assert.equal(new Set(inter.offer).size, 3, 'upgrade offers are distinct');
  assert.equal(inter.bestWave, 1, 'best wave is recorded');

  const next = chooseUpgrade(inter, inter.offer[0]);
  assert.equal(next.phase, 'playing', 'choosing an upgrade resumes play');
  assert.equal(next.wave, 2, 'the next wave begins');
  assert.equal(next.pending, waveConfig(2).count, 'the next wave is armed');
}

// --- Game over when the keep falls ---
{
  const danger = playing({
    rabbits: [rabbitAt(WORLD.keepX, 5)],
    stats: { ...startGame(createGame(7)).stats, castleHp: 1 },
  });
  const over = step(danger, 16);
  assert.equal(over.phase, 'gameover', 'keep falling ends the game');
  assert.equal(over.stats.castleHp, 0, 'castle hp does not go negative');
  assert.equal(over.bestWave, 1, 'best wave is recorded on loss');
}

console.log('Caerbannog game step tests passed.');

// --- Upgrades apply to the right field ---
{
  const base = () => ({ ...startGame(createGame(7)).stats });
  const checks: Record<UpgradeId, (after: ReturnType<typeof base>, before: ReturnType<typeof base>) => void> = {
    'bigger-blast': (a, b) => near(a.blastRadius, b.blastRadius + 3),
    'faster-reload': (a, b) => assert.ok(a.reload < b.reload, 'reload speeds up'),
    'extra-ammo': (a, b) => {
      assert.equal(a.maxAmmo, b.maxAmmo + 1);
      assert.equal(a.ammo, b.ammo + 1);
    },
    'short-fuse': (a, b) => assert.ok(a.fuseTime < b.fuseTime, 'fuse shortens'),
    'repair-wall': (a, b) => {
      assert.equal(a.maxCastleHp, b.maxCastleHp + 1);
      assert.equal(a.castleHp, a.maxCastleHp);
    },
    'holy-shrapnel': (a, b) => assert.equal(a.damage, b.damage + 1),
    caltrops: (a, b) => assert.ok(a.rabbitSpeedMult < b.rabbitSpeedMult, 'rabbits slow down'),
  };
  for (const upgrade of UPGRADES) {
    const before = base();
    const after = base();
    applyUpgrade(after, upgrade.id);
    checks[upgrade.id](after, before);
  }
  // Every offerable upgrade has a check above.
  assert.equal(Object.keys(checks).length, UPGRADES.length, 'all upgrades are covered');
}

// offerUpgrades only returns real upgrade ids.
{
  const ids = new Set(UPGRADES.map((u) => u.id));
  const offered = offerUpgrades(createRng(99));
  for (const id of offered) {
    assert.ok(ids.has(id), 'offered upgrade exists');
  }
}

console.log('Caerbannog upgrade tests passed.');
