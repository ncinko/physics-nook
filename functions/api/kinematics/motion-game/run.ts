import {
  getLeaderboardEnv,
  getUserAgent,
  hashClientAddress,
  jsonResponse,
} from '../../../../src/lib/kinematics/leaderboardApi';
import { randomSeed } from '../../../../src/lib/kinematics/motionGame';

const RUNS_PER_HOUR = 60;

/**
 * Three 14-second rounds, but the clock starts before the detector is even
 * connected: plugging in, checking the calibration, clearing floor space, and
 * up to one retry per graph. Thirty minutes covers a real setup without
 * leaving tokens valid all afternoon.
 */
const RUN_TTL_MS = 30 * 60 * 1000;

export const onRequestOptions = () =>
  jsonResponse(
    { ok: true },
    {
      headers: {
        allow: 'POST, OPTIONS',
      },
    },
  );

export const onRequestPost = async ({
  request,
  env,
}: {
  request: Request;
  env: Record<string, unknown>;
}) => {
  const configured = getLeaderboardEnv(env);
  if (!configured.ok) {
    return configured.response;
  }

  const db = configured.db as any;
  const now = Date.now();
  const ipHash = await hashClientAddress(request, configured.salt);
  const recent = await db
    .prepare('SELECT COUNT(*) AS count FROM kinematics_motion_game_runs WHERE ip_hash = ? AND created_at > ?')
    .bind(ipHash, now - 60 * 60 * 1000)
    .first();

  if (Number(recent?.count ?? 0) >= RUNS_PER_HOUR) {
    return jsonResponse(
      {
        ok: false,
        error: 'Too many motion game runs. Please wait and try again.',
      },
      { status: 429 },
    );
  }

  const runId = crypto.randomUUID();
  const expiresAt = now + RUN_TTL_MS;

  // The seed is minted here, not by the browser. The player gets it so their
  // page can draw the targets, but the copy that counts is the one stored
  // against the run — a submission is always scored against the graphs this
  // endpoint chose.
  const seed = randomSeed(() => crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000);

  await db
    .prepare(
      `INSERT INTO kinematics_motion_game_runs (id, ip_hash, user_agent, created_at, expires_at, used_at, seed)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    )
    .bind(runId, ipHash, getUserAgent(request), now, expiresAt, seed)
    .run();

  return jsonResponse({
    ok: true,
    runId,
    expiresAt,
    seed,
  });
};
