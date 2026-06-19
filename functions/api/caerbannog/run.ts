import {
  getLeaderboardEnv,
  getUserAgent,
  hashClientAddress,
  jsonResponse,
} from '../../../src/lib/kinematics/leaderboardApi';

const RUNS_PER_HOUR = 60;
// A defense run can stretch across many waves, so give the token a long life.
const RUN_TTL_MS = 6 * 60 * 60 * 1000;

export const onRequestOptions = () =>
  jsonResponse(
    { ok: true },
    {
      headers: {
        allow: 'POST, OPTIONS',
      },
    },
  );

export const onRequestPost = async ({ request, env }: { request: Request; env: Record<string, unknown> }) => {
  const configured = getLeaderboardEnv(env);
  if (!configured.ok) {
    return configured.response;
  }

  const db = configured.db as any;
  const now = Date.now();
  const ipHash = await hashClientAddress(request, configured.salt);
  const recent = await db
    .prepare('SELECT COUNT(*) AS count FROM caerbannog_runs WHERE ip_hash = ? AND created_at > ?')
    .bind(ipHash, now - 60 * 60 * 1000)
    .first();

  if (Number(recent?.count ?? 0) >= RUNS_PER_HOUR) {
    return jsonResponse(
      {
        ok: false,
        error: 'Too many siege runs. Please wait and try again.',
      },
      { status: 429 },
    );
  }

  const runId = crypto.randomUUID();
  const expiresAt = now + RUN_TTL_MS;

  await db
    .prepare(
      `INSERT INTO caerbannog_runs (id, ip_hash, user_agent, created_at, expires_at, used_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .bind(runId, ipHash, getUserAgent(request), now, expiresAt)
    .run();

  return jsonResponse({
    ok: true,
    runId,
    expiresAt,
  });
};
