import assert from 'node:assert/strict';
import { createRng } from '../../src/lib/caerbannog/rng.ts';
import {
  BLESSINGS,
  SHOP,
  SHOP_COSTS,
  applyBlessing,
  canBuy,
  type BlessingId,
} from '../../src/lib/caerbannog/upgrades.ts';
import { isBlessingWave, waveConfig } from '../../src/lib/caerbannog/waves.ts';
import {
  WORLD,
  blastDamage,
  buyDefense,
  caltropsDps,
  caltropsSlow,
  canRepairKeep,
  chooseBlessing,
  createGame,
  goldForKill,
  landingPoint,
  nextWave,
  offerBlessings,
  rabbitKindForSpawn,
  rabbitTraits,
  repairCost,
  repairKeep,
  startGame,
  step,
  timStats,
  throwGrenade,
  timeToGround,
  trajectoryPoints,
  waveClearGold,
  type GameState,
  type Rabbit,
  type RabbitKind,
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

const rabbitAt = (x: number, hp = 1, kind: RabbitKind = 'common'): Rabbit => ({
  id: 1,
  kind,
  x,
  y: 0,
  hopPhase: 0,
  hp,
  maxHp: hp,
  speed: 0,
  keepDamage: rabbitTraits(kind, 1).keepDamage,
  precisionKill: false,
});

// --- Blast proximity damage, hit, and miss ---
near(blastDamage(2, 0, 10), 3);
near(blastDamage(2, 5, 10), 2);
near(blastDamage(2, 10, 10), 1);
near(blastDamage(2, 10.1, 10), 0);
{
  const hit = playing({
    rabbits: [rabbitAt(50)],
    grenades: [{ id: 2, pos: { x: 50, y: 0 }, vel: { x: 0, y: 0 }, state: 'fuse', fuse: 0.04 }],
  });
  const after = step(hit, 50);
  assert.equal(after.rabbits.length, 0, 'rabbit in the blast radius is destroyed');
  assert.equal(after.score, 1, 'destroying a rabbit scores');
  assert.equal(after.gold, goldForKill('common', 1, true), 'a direct kill includes its precision bounty');
  assert.equal(after.precisionKillsThisWave, 1, 'a direct kill records precision');
  assert.equal(after.rewardPopups[0]?.text, '+1 PRECISION');
  assert.equal(after.explosions.length, 1, 'a blast leaves an explosion flash');

  const hoppingHit = playing({
    rabbits: [{ ...rabbitAt(50, 1.5), y: 2 }],
    grenades: [{ id: 2, pos: { x: 50, y: 0 }, vel: { x: 0, y: 0 }, state: 'fuse', fuse: 0.04 }],
  });
  assert.equal(step(hoppingHit, 50).rabbits.length, 0, 'visual hop height does not weaken a direct hit');

  const miss = playing({
    rabbits: [rabbitAt(80)],
    grenades: [{ id: 2, pos: { x: 50, y: 0 }, vel: { x: 0, y: 0 }, state: 'fuse', fuse: 0.04 }],
  });
  const afterMiss = step(miss, 50);
  assert.equal(afterMiss.rabbits.length, 1, 'rabbit outside the radius survives');
  assert.equal(afterMiss.rabbits[0].hp, 1, 'a missed rabbit keeps its hp');

  const edgeKill = playing({
    rabbits: [rabbitAt(58, 0.6)],
    grenades: [{ id: 2, pos: { x: 50, y: 0 }, vel: { x: 0, y: 0 }, state: 'fuse', fuse: 0.04 }],
  });
  const afterEdge = step(edgeKill, 50);
  assert.equal(afterEdge.rabbits.length, 0);
  assert.equal(afterEdge.gold, 1, 'an edge kill earns no precision bonus');
  assert.equal(afterEdge.precisionKillsThisWave, 0);

  const bruteHit = playing({
    wave: 7,
    rabbits: [rabbitAt(50, 10, 'brute')],
    grenades: [{ id: 2, pos: { x: 50, y: 0 }, vel: { x: 0, y: 0 }, state: 'fuse', fuse: 0.04 }],
  });
  const afterBruteHit = step(bruteHit, 50);
  near(afterBruteHit.rabbits[0].hp, 10 - 1.5 * 1.2, 1e-6);

  const bossHit = playing({
    wave: 10,
    rabbits: [rabbitAt(50, 1, 'boss')],
    grenades: [{ id: 2, pos: { x: 50, y: 0 }, vel: { x: 0, y: 0 }, state: 'fuse', fuse: 0.04 }],
  });
  const afterBossHit = step(bossHit, 50);
  assert.equal(afterBossHit.gold, goldForKill('boss', 10, true));
  assert.deepEqual(
    afterBossHit.rewardPopups.map((popup) => popup.tone),
    ['precision', 'boss'],
    'a precise boss kill emits both reward callouts',
  );
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

// --- Wave clear -> blessing/shop intermission -> next wave ---
{
  const cleared = playing({ pending: 0 });
  const inter = step(cleared, 16);
  assert.equal(inter.phase, 'intermission', 'clearing a wave starts intermission');
  assert.ok(inter.gold > 0, 'clearing a wave awards a gold purse');
  assert.equal(inter.waveGoldEarned, waveClearGold(1), 'wave summary includes the clear purse');
  assert.equal(inter.blessingPending, true, 'wave 1 grants a blessing');
  assert.equal(inter.offer.length, 3, 'blessing intermission offers three choices');
  assert.equal(new Set(inter.offer).size, 3, 'blessing offers are distinct');
  assert.equal(inter.bestWave, 1, 'best wave is recorded');

  assert.equal(nextWave(inter), inter, 'next wave is blocked until the blessing is chosen');
  const blessed = chooseBlessing(inter, inter.offer[0]);
  assert.equal(blessed.phase, 'intermission', 'choosing a blessing leaves time to shop');
  assert.equal(blessed.blessingPending, false, 'blessing requirement is satisfied');
  const next = nextWave(blessed);
  assert.equal(next.phase, 'playing', 'continue starts play after shopping');
  assert.equal(next.wave, 2, 'the next wave begins');
  assert.equal(next.pending, waveConfig(2).count, 'the next wave is armed');

  const ordinary = step(playing({ wave: 2, pending: 0 }), 16);
  assert.equal(ordinary.phase, 'intermission');
  assert.equal(ordinary.blessingPending, false, 'wave 2 does not grant a blessing');
  assert.deepEqual(ordinary.offer, [], 'ordinary intermissions have no blessing cards');

  const fifth = nextWave({ ...ordinary, wave: 4 });
  assert.equal(fifth.wave, 5);
  assert.equal(fifth.announcementTimer, 2.8, 'milestone waves announce the White Rabbit');
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

  const bruteBreach = playing({
    wave: 7,
    rabbits: [rabbitAt(WORLD.keepX, 5, 'brute')],
    stats: { ...startGame(createGame(7)).stats, castleHp: 5 },
  });
  assert.equal(step(bruteBreach, 16).stats.castleHp, 3, 'a brute removes two keep hearts');

  const bossBreach = playing({
    wave: 10,
    rabbits: [rabbitAt(WORLD.keepX, 5, 'boss')],
    stats: { ...startGame(createGame(7)).stats, castleHp: 5 },
  });
  assert.equal(step(bossBreach, 16).stats.castleHp, 2, 'a boss removes three keep hearts');
}

console.log('Caerbannog game step tests passed.');

// --- Blessings affect grenades only ---
{
  const base = () => ({ ...startGame(createGame(7)).stats });
  const checks: Record<BlessingId, (after: ReturnType<typeof base>, before: ReturnType<typeof base>) => void> = {
    'bigger-blast': (a, b) => near(a.blastRadius, b.blastRadius + 3),
    'faster-reload': (a, b) => assert.ok(a.reload < b.reload, 'reload speeds up'),
    'extra-ammo': (a, b) => {
      assert.equal(a.maxAmmo, b.maxAmmo + 1);
      assert.equal(a.ammo, b.ammo + 1);
    },
    'short-fuse': (a, b) => assert.ok(a.fuseTime < b.fuseTime, 'fuse shortens'),
    'holy-shrapnel': (a, b) => assert.equal(a.damage, b.damage + 1),
  };
  for (const blessing of BLESSINGS) {
    const before = base();
    const after = base();
    applyBlessing(after, blessing.id);
    checks[blessing.id](after, before);
  }
  assert.equal(Object.keys(checks).length, BLESSINGS.length, 'all blessings are covered');
}

// offerBlessings only returns real, distinct blessing ids.
{
  const ids = new Set(BLESSINGS.map((item) => item.id));
  const offered = offerBlessings(createRng(99));
  assert.equal(new Set(offered).size, offered.length);
  for (const id of offered) {
    assert.ok(ids.has(id), 'offered blessing exists');
  }
}

// --- Gold shop and static-defense behavior ---
{
  const intermission = { ...startGame(createGame(4)), phase: 'intermission' as const, gold: 100 };
  for (const item of SHOP) {
    assert.ok(canBuy(intermission.stats, intermission.gold, item.id), `${item.id} is purchasable`);
    const bought = buyDefense(intermission, item.id);
    assert.equal(item.level(bought.stats), 1, `${item.id} gains a level`);
    assert.equal(bought.gold, intermission.gold - item.cost(0), `${item.id} deducts its cost`);
  }
  assert.equal(buyDefense(startGame(createGame(4)), 'tim').stats.timLevel, 0, 'shop is closed during a wave');
  assert.equal(buyDefense({ ...intermission, gold: 0 }, 'tim').stats.timLevel, 0, 'unaffordable purchase is blocked');

  assert.deepEqual(SHOP_COSTS.tim, [30, 60, 105, 165]);
  assert.deepEqual(SHOP_COSTS.caltrops, [20, 45, 80, 130]);
  assert.deepEqual(SHOP_COSTS.keep, [25, 50, 80, 120, 170, 230]);

  const damaged = {
    ...intermission,
    wave: 10,
    stats: { ...intermission.stats, castleHp: 2, maxCastleHp: 5 },
  };
  assert.equal(repairCost(10), 16);
  assert.equal(canRepairKeep(damaged), true);
  const repaired = repairKeep(damaged);
  assert.equal(repaired.stats.castleHp, 3, 'repair restores exactly one heart');
  assert.equal(repaired.stats.maxCastleHp, 5, 'repair does not raise maximum health');
  assert.equal(repaired.gold, damaged.gold - repairCost(10));
  assert.equal(repairKeep({ ...damaged, stats: { ...damaged.stats, castleHp: 5 } }).stats.castleHp, 5);
  const tooPoor = { ...damaged, gold: 0 };
  assert.equal(repairKeep(tooPoor), tooPoor, 'unaffordable repair is a no-op');

  assert.ok(caltropsSlow(2) < caltropsSlow(1));
  assert.ok(caltropsDps(2) > caltropsDps(1));
  const trapped = playing({
    rabbits: [rabbitAt(WORLD.keepX + 8, 10)],
    stats: { ...startGame(createGame(7)).stats, caltropsLevel: 2 },
  });
  const afterTrap = step(trapped, 50);
  assert.ok(afterTrap.rabbits[0].hp < 10, 'caltrops bleed rabbits in their zone');

  const defended = playing({
    rabbits: [rabbitAt(50, 10)],
    stats: { ...startGame(createGame(7)).stats, timLevel: 1, timCooldown: 0 },
  });
  const afterTim = step(defended, 16);
  assert.equal(afterTim.zaps.length, 1, 'Tim casts at the frontmost rabbit');
  near(afterTim.rabbits[0].hp, 10 - timStats(1).damage);

  const bruteTrap = playing({
    wave: 7,
    rabbits: [rabbitAt(WORLD.keepX + 8, 10, 'brute')],
    stats: { ...startGame(createGame(7)).stats, caltropsLevel: 2 },
  });
  const afterBruteTrap = step(bruteTrap, 50);
  near(10 - afterBruteTrap.rabbits[0].hp, (10 - afterTrap.rabbits[0].hp) * 0.35, 1e-6);

  const bruteDefended = playing({
    wave: 7,
    rabbits: [rabbitAt(50, 10, 'brute')],
    stats: { ...startGame(createGame(7)).stats, timLevel: 1, timCooldown: 0 },
  });
  const afterBruteTim = step(bruteDefended, 16);
  near(afterBruteTim.rabbits[0].hp, 10 - timStats(1).damage * 0.35);
}

// --- Fixed archetype schedule and milestone tuning ---
{
  assert.equal(rabbitKindForSpawn(3, 4, waveConfig(3).count), 'common');
  assert.equal(rabbitKindForSpawn(4, 4, waveConfig(4).count), 'runner');
  assert.equal(rabbitKindForSpawn(7, 5, waveConfig(7).count), 'brute');
  assert.equal(rabbitKindForSpawn(12, 9, waveConfig(12).count), 'runner');
  assert.equal(rabbitKindForSpawn(12, 11, waveConfig(12).count), 'brute');
  // Wave 15's final spawn is also divisible by six; boss priority wins.
  assert.equal(rabbitKindForSpawn(15, waveConfig(15).count - 1, waveConfig(15).count), 'boss');

  assert.equal(rabbitTraits('runner', 10).hpMultiplier, 0.65);
  assert.equal(rabbitTraits('brute', 10).staticDamageMultiplier, 0.35);
  assert.equal(rabbitTraits('brute', 10).grenadeDamageMultiplier, 1.2);
  assert.equal(rabbitTraits('boss', 20).keepDamage, 3);
  assert.equal(rabbitTraits('boss', 20).bounty, 18);

  let previousHp = 0;
  for (let wave = 1; wave <= 30; wave += 1) {
    const cfg = waveConfig(wave);
    assert.ok(cfg.hp > previousHp, `wave ${wave} HP grows continuously`);
    assert.ok(cfg.speed <= 14, 'base speed remains aimable');
    assert.ok(cfg.spawnInterval >= 0.45, 'spawn cadence remains bounded');
    previousHp = cfg.hp;
    assert.equal(isBlessingWave(wave), [1, 4, 7, 10, 13, 16, 19, 22, 25, 28].includes(wave));
  }
}

// --- Economy remains alive through the wave-30 arc ---
{
  const totalShopCost = SHOP.flatMap((item) =>
    Array.from({ length: item.maxLevel }, (_, level) => item.cost(level)),
  ).reduce((sum, cost) => sum + cost, 0);
  const earningsThrough = (lastWave: number, precisionRate: number) => {
    let earned = 0;
    let precisionPool = 0;
    for (let wave = 1; wave <= lastWave; wave += 1) {
      const cfg = waveConfig(wave);
      for (let i = 0; i < cfg.count; i += 1) {
        const kind = rabbitKindForSpawn(wave, i, cfg.count);
        earned += goldForKill(kind, wave);
        precisionPool += 1;
      }
      earned += waveClearGold(wave);
    }
    return earned + Math.floor(precisionPool * precisionRate);
  };

  assert.equal(totalShopCost, 1310);
  assert.ok(earningsThrough(12, 1) < totalShopCost * 0.4, 'even perfect wave-12 income cannot finish the shop');
  assert.ok(earningsThrough(25, 0.36) < totalShopCost, 'the shop remains relevant after wave 25');
  assert.ok(earningsThrough(30, 0.36) >= totalShopCost, 'strong accurate play can finish near wave 30');
}

const runUntilPhaseChange = (initial: GameState, maxSeconds = 120): GameState => {
  let state = initial;
  for (let elapsed = 0; state.phase === 'playing' && elapsed < maxSeconds; elapsed += 0.05) {
    state = step(state, 50);
  }
  return state;
};

// Maxed static defenses still dispose of the ordinary late-game line, but the
// real milestone composition eventually overwhelms a player who never fires.
{
  const wave = 20;
  const cfg = waveConfig(wave);
  const spacing = cfg.speed * cfg.spawnInterval;
  const commons = Array.from({ length: cfg.count }, (_, i): Rabbit => ({
    ...rabbitAt(WORLD.spawnX + i * spacing, cfg.hp),
    id: i + 1,
    speed: cfg.speed,
  }));
  const fodderWave = playing({
    wave,
    pending: 0,
    rabbits: commons,
    stats: {
      ...startGame(createGame(8)).stats,
      timLevel: 4,
      caltropsLevel: 4,
      castleHp: 11,
      maxCastleHp: 11,
    },
  });
  const afterFodder = runUntilPhaseChange(fodderWave);
  assert.equal(afterFodder.phase, 'intermission');
  assert.ok(afterFodder.score >= cfg.count * 0.8, 'static defenses clear at least 80% of late fodder');
  assert.ok(afterFodder.stats.castleHp >= 8, 'fodder alone does not seriously threaten the keep');

  let passive = startGame(createGame(77));
  passive = {
    ...passive,
    stats: {
      ...passive.stats,
      timLevel: 4,
      caltropsLevel: 4,
      castleHp: 11,
      maxCastleHp: 11,
    },
  };
  let failedWave = 31;
  for (let waveNumber = 1; waveNumber <= 20; waveNumber += 1) {
    passive = runUntilPhaseChange(passive);
    if (passive.phase === 'gameover') {
      failedWave = waveNumber;
      break;
    }
    if (passive.blessingPending) passive = chooseBlessing(passive, passive.offer[0]);
    passive = nextWave(passive);
  }
  assert.ok(failedWave <= 15, `passive-only play should fail by wave 15, failed at ${failedWave}`);
}

// A damage-focused grenade path has enough accurate shots to stop every boss
// before it reaches the gate, even after reserving a second for flight/fuse.
for (const wave of [5, 10, 15, 20, 25, 30]) {
  const cfg = waveConfig(wave);
  const traits = rabbitTraits('boss', wave);
  const bossHp = cfg.hp * traits.hpMultiplier;
  const milestone = wave / 5;
  const grenadeDamage = 2 + milestone;
  const directDamage = blastDamage(grenadeDamage, 0, 9) * traits.grenadeDamageMultiplier;
  const shotsNeeded = Math.ceil(bossHp / directDamage);
  const travelTime = (WORLD.spawnX - WORLD.keepX) / (cfg.speed * traits.speedMultiplier) - 1;
  const shotsAvailable = 3 + Math.floor(travelTime / 1.6);
  assert.ok(shotsNeeded <= shotsAvailable, `wave ${wave} boss is beatable with accurate grenades`);
}

console.log('Caerbannog progression tests passed.');
