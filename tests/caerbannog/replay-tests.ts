import assert from 'node:assert/strict';
import {
  WORLD,
  landingPoint,
  chooseBlessing,
  chooseEnhancement,
  chooseSpecial,
  createGame,
  buyDefense,
  nextWave,
  offerableEnhancements,
  offerableSpecials,
  repairKeep,
  startGame,
  step,
  throwGrenade,
  type GameState,
} from '../../src/lib/caerbannog/game.ts';
import {
  FIXED_STEP_MS,
  MAX_THROW_SPEED,
  REPLAY_LIMITS,
  ReplayRecorder,
  replayRun,
  type ReplayOp,
} from '../../src/lib/caerbannog/replay.ts';

/**
 * A scripted player that drives the game the same way the React island does,
 * recording every input. It is not a good player, but it exercises throws,
 * shop buys, blessings and the special choices so a replay has real work to do.
 */
const playScripted = (seed: number, maxSteps = 60 * 60 * 20) => {
  const rec = new ReplayRecorder();
  let state: GameState = startGame(createGame(seed));
  rec.push(['g']);
  let steps = 0;
  let sinceThrow = 0;

  while (state.phase !== 'gameover' && state.phase !== 'victory' && steps < maxSteps) {
    if (state.phase === 'intermission') {
      if (state.blessingPending) {
        const id = state.offer[0];
        state = chooseBlessing(state, id);
        rec.push(['b', id]);
      }
      if (state.specialPending) {
        const weapon = offerableSpecials(state.stats)[0];
        state = chooseSpecial(state, weapon);
        rec.push(['p', weapon]);
      }
      if (state.enhancementPending) {
        const weapon = offerableEnhancements(state.stats)[0];
        state = chooseEnhancement(state, weapon);
        rec.push(['e', weapon]);
      }
      for (const id of ['tim', 'caltrops', 'keep'] as const) {
        const bought = buyDefense(state, id);
        if (bought !== state) {
          state = bought;
          rec.push(['y', id]);
        }
      }
      const repaired = repairKeep(state);
      if (repaired !== state) {
        state = repaired;
        rec.push(['r']);
      }
      state = nextWave(state);
      rec.push(['n']);
      continue;
    }

    sinceThrow += 1;
    if (sinceThrow > 40 && state.stats.ammo >= 1 && state.rabbits.length > 0) {
      const front = state.rabbits.reduce((a, b) => (a.x < b.x ? a : b));
      // Search launch angles for the one that lands just ahead of the front rabbit.
      const target = front.x - 2;
      let best = { err: Infinity, vx: 0, vy: 0 };
      for (let deg = 5; deg <= 85; deg += 0.5) {
        const angle = (deg * Math.PI) / 180;
        const vel = { x: MAX_THROW_SPEED * Math.cos(angle), y: MAX_THROW_SPEED * Math.sin(angle) };
        const err = Math.abs(landingPoint(WORLD.launch, vel).x - target);
        if (err < best.err) best = { err, vx: vel.x, vy: vel.y };
      }
      const { vx, vy } = best;
      state = throwGrenade(state, { x: vx, y: vy });
      rec.push(['t', vx, vy]);
      sinceThrow = 0;
    }
    state = step(state, FIXED_STEP_MS);
    rec.steps(1);
    steps += 1;
  }
  return { state, ops: rec.ops, steps };
};

const SEED = 20240611;
const run = playScripted(SEED);
assert.ok(run.state.phase === 'gameover' || run.state.phase === 'victory', 'the scripted run finishes');
assert.ok(run.state.wave >= 2, 'the scripted run gets past the first wave');

// An honest log replays to exactly the state the player saw.
{
  const started = performance.now();
  const replay = replayRun(SEED, JSON.parse(JSON.stringify(run.ops)));
  const elapsed = performance.now() - started;
  assert.ok(replay.ok, replay.ok ? '' : replay.error);
  if (replay.ok) {
    assert.equal(replay.state.wave, run.state.wave);
    assert.equal(replay.state.score, run.state.score);
    assert.equal(replay.state.goldEarned, run.state.goldEarned);
    assert.equal(replay.totalSteps <= run.steps, true);
  }
  console.log(
    `  replay: wave ${run.state.wave}, ${run.state.score} kills, ${run.steps} steps, ${run.ops.length} ops, ${elapsed.toFixed(0)}ms`,
  );
}

// A different seed does not reproduce the run (the seed really is load-bearing).
{
  const replay = replayRun(SEED + 1, run.ops);
  assert.ok(
    !replay.ok || replay.state.score !== run.state.score || replay.state.goldEarned !== run.state.goldEarned,
    'replaying under another seed changes the outcome',
  );
}

// Malformed, forged or unfinished logs are rejected.
{
  const bad = (ops: unknown, why: string) => assert.equal(replayRun(SEED, ops).ok, false, why);
  bad(undefined, 'no log');
  bad([], 'empty log');
  bad(run.ops.slice(0, 3), 'a log that does not finish the run');
  bad([['g'], ['s', 0]], 'a zero step count');
  bad([['g'], ['s', 1.5]], 'a fractional step count');
  bad([['g'], ['s', REPLAY_LIMITS.maxStepsPerOp + 1]], 'an enormous step count');
  bad([['g'], ['t', MAX_THROW_SPEED, MAX_THROW_SPEED], ['s', 10]], 'a throw stronger than the sling');
  bad([['g'], ['t', Number.NaN, 1], ['s', 10]], 'a non-finite throw');
  bad([['g'], ['b', 'free-wins'], ['s', 10]], 'a blessing that was never offered');
  bad([['g'], ['y', 'dragon'], ['s', 10]], 'an unknown shop item');
  bad([['g'], ['x']], 'an unknown op');
  bad([['g'], 'throw'], 'a malformed entry');
  bad(Array.from({ length: REPLAY_LIMITS.maxOps + 1 }, () => ['r']), 'too many ops');

  // Seconds of "playing" beyond the cap are refused so a log can't burn CPU.
  const long: ReplayOp[] = [['g'], ['s', REPLAY_LIMITS.maxStepsPerOp], ['s', REPLAY_LIMITS.maxStepsPerOp]];
  bad(Array.from({ length: 6 }, (_, i) => (i === 0 ? ['g'] : ['s', REPLAY_LIMITS.maxStepsPerOp])), 'a log that runs too long');
  void long;
}

// Inputs logged after the keep falls cannot change the result.
{
  const padded = replayRun(SEED, [...run.ops, ['t', 10, 10], ['s', 50]]);
  assert.ok(padded.ok, 'trailing ops after the end are ignored');
  if (padded.ok) {
    assert.equal(padded.state.score, run.state.score);
    assert.equal(padded.state.goldEarned, run.state.goldEarned);
  }
}

// Tampering with the inputs changes what the server computes: dropping the
// throws turns the run into a quick loss, never a better score.
{
  const noThrows = run.ops.filter((op) => op[0] !== 't');
  const replay = replayRun(SEED, noThrows);
  if (replay.ok) {
    assert.ok(replay.state.score <= run.state.score, 'removing throws cannot raise the score');
  }
}

console.log('Caerbannog replay tests passed.');
