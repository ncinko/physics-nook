import {
  clampLeaderboardLimit,
  getLeaderboardEnv,
  hashClientAddress,
  jsonResponse,
  normalizeGoalRushScoreRow,
  parseJsonBody,
} from '../../../../src/lib/kinematics/leaderboardApi';
import { validateGoalRushScoreSubmission } from '../../../../src/lib/kinematics/goalRush';

const SCORE_SUBMITS_PER_HOUR = 20;

const fetchTopScores = async (db: any, limit: number) => {
  const result = await db
    .prepare(
      `SELECT id, name, score, golden_hits, normal_hits, duration_ms, created_at
       FROM (
         SELECT
           id,
           name,
           score,
           golden_hits,
           normal_hits,
           duration_ms,
           created_at,
           ROW_NUMBER() OVER (
             PARTITION BY lower(trim(name))
             ORDER BY score DESC, duration_ms ASC, created_at ASC
           ) AS score_rank
         FROM kinematics_goal_rush_scores
       )
       WHERE score_rank = 1
       ORDER BY score DESC, duration_ms ASC, created_at ASC
       LIMIT ${limit}`,
    )
    .all();

  return Array.isArray(result?.results) ? result.results.map(normalizeGoalRushScoreRow) : [];
};

export const onRequestOptions = () =>
  jsonResponse(
    { ok: true },
    {
      headers: {
        allow: 'GET, POST, OPTIONS',
      },
    },
  );

export const onRequestGet = async ({ request, env }: { request: Request; env: Record<string, unknown> }) => {
  const configured = getLeaderboardEnv(env);
  if (!configured.ok) {
    return configured.response;
  }

  const url = new URL(request.url);
  const limit = clampLeaderboardLimit(url.searchParams.get('limit'));
  const scores = await fetchTopScores(configured.db, limit);

  return jsonResponse({ ok: true, scores });
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Record<string, unknown> }) => {
  const configured = getLeaderboardEnv(env);
  if (!configured.ok) {
    return configured.response;
  }

  const payload = await parseJsonBody(request);
  if (!payload || typeof payload !== 'object') {
    return jsonResponse(
      {
        ok: false,
        error: 'Expected a JSON score payload.',
      },
      { status: 400 },
    );
  }

  const body = payload as Record<string, unknown>;
  const runId = typeof body.runId === 'string' ? body.runId.trim() : '';
  const validation = validateGoalRushScoreSubmission(body);

  if (!runId || !validation.ok) {
    return jsonResponse(
      {
        ok: false,
        error: 'Invalid score payload.',
        errors: validation.errors,
      },
      { status: 400 },
    );
  }

  const db = configured.db as any;
  const now = Date.now();
  const ipHash = await hashClientAddress(request, configured.salt);
  const recent = await db
    .prepare('SELECT COUNT(*) AS count FROM kinematics_goal_rush_scores WHERE ip_hash = ? AND created_at > ?')
    .bind(ipHash, now - 60 * 60 * 1000)
    .first();

  if (Number(recent?.count ?? 0) >= SCORE_SUBMITS_PER_HOUR) {
    return jsonResponse(
      {
        ok: false,
        error: 'Too many score submissions. Please wait and try again.',
      },
      { status: 429 },
    );
  }

  const runUpdate = await db
    .prepare(
      `UPDATE kinematics_goal_rush_runs
       SET used_at = ?
       WHERE id = ?
         AND ip_hash = ?
         AND used_at IS NULL
         AND expires_at >= ?`,
    )
    .bind(now, runId, ipHash, now)
    .run();

  if (Number(runUpdate?.meta?.changes ?? 0) !== 1) {
    return jsonResponse(
      {
        ok: false,
        error: 'Goal rush run is missing, expired, or already used.',
      },
      { status: 409 },
    );
  }

  await db
    .prepare(
      `INSERT INTO kinematics_goal_rush_scores
        (id, run_id, name, score, golden_hits, normal_hits, duration_ms, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      runId,
      validation.name,
      validation.score,
      validation.goldenHits,
      validation.normalHits,
      validation.durationMs,
      ipHash,
      now,
    )
    .run();

  const scores = await fetchTopScores(db, 10);

  return jsonResponse({
    ok: true,
    scores,
  });
};
