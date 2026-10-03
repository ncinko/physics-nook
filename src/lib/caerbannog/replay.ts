/**
 * Deterministic replay of a Caerbannog run, shared by the React island (which
 * records the log) and the leaderboard Pages Function (which re-plays it).
 *
 * The cloud score is never taken from the client. The server issues the seed,
 * the client plays at a fixed timestep and logs every input, and the server
 * re-runs that log through the same pure game model to learn the real wave,
 * kills and gold. A forged score needs a forged *playthrough*, and the model
 * itself limits what any playthrough can do (ammo, reload, gold, phases).
 *
 * Ops are compact JSON arrays so a whole run stays a few kilobytes:
 *   ['g']                    start the siege
 *   ['s', n]                 advance n fixed steps
 *   ['t', vx, vy]            throw a grenade with launch velocity (vx, vy)
 *   ['n']                    begin the next wave
 *   ['b', blessingId]        choose a blessing
 *   ['p', special]           claim a special weapon
 *   ['e', special]           claim the wave-30 enhancement
 *   ['u', special, track]    raise a special's track
 *   ['y', shopId]            buy a static defense
 *   ['r']                    repair a heart
 */
import {
  SPECIAL_IDS,
  buyDefense,
  chooseBlessing,
  chooseEnhancement,
  chooseSpecial,
  createGame,
  nextWave,
  repairKeep,
  startGame,
  step,
  throwGrenade,
  upgradeSpecial,
  type GameState,
  type SpecialId,
  type SpecialTrack,
} from './game.ts';
import type { BlessingId, ShopId } from './upgrades.ts';

/** Bump whenever game rules change, so logs from an old build are refused. */
export const REPLAY_VERSION = 2;

/** The simulation advances in constant steps so a replay is frame-rate independent. */
export const FIXED_STEP_MS = 1000 / 60;

/** Strongest launch the sling can produce; the UI clamps to this. */
export const MAX_THROW_SPEED = 80;

export const REPLAY_LIMITS = {
  maxOps: 20_000,
  /** 45 minutes of game time; a full 40-wave siege takes a fraction of that. */
  maxTotalSteps: 60 * 60 * 45,
  maxStepsPerOp: 60 * 60 * 10,
} as const;

export type ReplayOp =
  | ['g']
  | ['s', number]
  | ['t', number, number]
  | ['n']
  | ['b', BlessingId]
  | ['p', SpecialId]
  | ['e', SpecialId]
  | ['u', SpecialId, SpecialTrack]
  | ['y', ShopId]
  | ['r'];

const SHOP_IDS: ShopId[] = ['tim', 'caltrops', 'keep'];
const TRACKS: SpecialTrack[] = ['freq', 'power'];

/** Accumulates a run's inputs, merging consecutive steps into one op. */
export class ReplayRecorder {
  ops: ReplayOp[] = [];

  push(op: ReplayOp): void {
    this.ops.push(op);
  }

  steps(n: number): void {
    if (n <= 0) {
      return;
    }
    const last = this.ops[this.ops.length - 1];
    if (last && last[0] === 's') {
      last[1] += n;
    } else {
      this.ops.push(['s', n]);
    }
  }

  reset(): void {
    this.ops = [];
  }
}

export type ReplayResult =
  | { ok: true; state: GameState; totalSteps: number }
  | { ok: false; error: string };

const isSpecial = (value: unknown): value is SpecialId =>
  typeof value === 'string' && (SPECIAL_IDS as string[]).includes(value);

/**
 * Re-play a logged run from its server-issued seed. Rejects anything malformed
 * or out of bounds; legal-but-useless inputs (a buy with no gold) are simply
 * no-ops, exactly as they were in the live game.
 */
export const replayRun = (seed: number, ops: unknown): ReplayResult => {
  if (!Number.isInteger(seed)) {
    return { ok: false, error: 'seed is missing.' };
  }
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > REPLAY_LIMITS.maxOps) {
    return { ok: false, error: 'replay log is missing or too long.' };
  }

  let state = createGame(seed);
  let totalSteps = 0;

  for (const raw of ops as unknown[]) {
    // Once the run has ended nothing can change the score, so anything the
    // client logged afterwards (a throw on the frame the keep fell) is ignored.
    if (state.phase === 'gameover' || state.phase === 'victory') {
      break;
    }
    if (!Array.isArray(raw) || typeof raw[0] !== 'string') {
      return { ok: false, error: 'replay log has a malformed entry.' };
    }
    const [kind, a, b] = raw as [string, unknown, unknown];

    switch (kind) {
      case 'g':
        state = startGame(state);
        break;
      case 's': {
        if (
          typeof a !== 'number' ||
          !Number.isInteger(a) ||
          a < 1 ||
          a > REPLAY_LIMITS.maxStepsPerOp
        ) {
          return { ok: false, error: 'replay log has an invalid step count.' };
        }
        for (let i = 0; i < a; i += 1) {
          state = step(state, FIXED_STEP_MS);
          totalSteps += 1;
          if (totalSteps > REPLAY_LIMITS.maxTotalSteps) {
            return { ok: false, error: 'replay log runs too long.' };
          }
          if (state.phase === 'gameover' || state.phase === 'victory') {
            break;
          }
        }
        break;
      }
      case 't': {
        if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) {
          return { ok: false, error: 'replay log has an invalid throw.' };
        }
        if (Math.hypot(a, b) > MAX_THROW_SPEED + 1e-6) {
          return { ok: false, error: 'replay log has a throw stronger than the sling allows.' };
        }
        state = throwGrenade(state, { x: a, y: b });
        break;
      }
      case 'n':
        state = nextWave(state);
        break;
      case 'b':
        if (typeof a !== 'string' || !state.offer.includes(a as BlessingId)) {
          return { ok: false, error: 'replay log picks a blessing that was not offered.' };
        }
        state = chooseBlessing(state, a as BlessingId);
        break;
      case 'p':
        if (!isSpecial(a)) {
          return { ok: false, error: 'replay log has an invalid special.' };
        }
        state = chooseSpecial(state, a);
        break;
      case 'e':
        if (!isSpecial(a)) {
          return { ok: false, error: 'replay log has an invalid enhancement.' };
        }
        state = chooseEnhancement(state, a);
        break;
      case 'u':
        if (!isSpecial(a) || !TRACKS.includes(b as SpecialTrack)) {
          return { ok: false, error: 'replay log has an invalid upgrade.' };
        }
        state = upgradeSpecial(state, a, b as SpecialTrack);
        break;
      case 'y':
        if (!SHOP_IDS.includes(a as ShopId)) {
          return { ok: false, error: 'replay log has an invalid purchase.' };
        }
        state = buyDefense(state, a as ShopId);
        break;
      case 'r':
        state = repairKeep(state);
        break;
      default:
        return { ok: false, error: 'replay log has an unknown entry.' };
    }
  }

  if (state.phase !== 'gameover' && state.phase !== 'victory') {
    return { ok: false, error: 'replay log does not finish the run.' };
  }
  return { ok: true, state, totalSteps };
};
