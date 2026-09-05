import {
  clampLeaderboardLimit,
  getLeaderboardEnv,
  hashClientAddress,
  jsonResponse,
  parseJsonBody,
} from '../../../../src/lib/kinematics/leaderboardApi';
import {
  normalizeMotionGameScoreRow,
  validateMotionGameScoreSubmission,
} from '../../../../src/lib/kinematics/motionGame';

const SCORE_SUBMITS_PER_HOUR = 20;

const fetchTopScores = async (db: any, limit: number) => {
  const result = await db
    .prepare(
      `SELECT id, name, score, graph1_score, graph2_score, graph3_score, retries_used, created_at
       FROM (
         SELECT
           id,
           name,
           score,
           graph1_score,
           graph2_score,
           graph3_score,
           retries_used,
           created_at,
           ROW_NUMBER() OVER (
             PARTITION BY lower(trim(name))
             ORDER BY score DESC, retries_used ASC, created_at ASC
           ) AS score_rank
         FROM kinematics_motion_game_scores
       )
       WHERE score_rank = 1
       ORDER BY score DESC, retries_used ASC, created_at ASC
       LIMIT ${limit}`,
    )
    .all();

  return Array.isArray(result?.results) ? result.results.map(normalizeMotionGameScoreRow) : [];
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

export const onRequestGet = async ({
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

  const url = new URL(request.url);
  const limit = clampLeaderboardLimit(url.searchParams.get('limit'));
  const scores = await fetchTopScores(configured.db, limit);

  return jsonResponse({ ok: true, scores });
};

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

  // Replays the recorded traces through the same scoring the browser ran, so
  // the number that lands in D1 is one this endpoint computed. The submitted
  // score is only ever compared against it.
  const validation = validateMotionGameScoreSubmission(body);

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
    .prepare('SELECT COUNT(*) AS count FROM kinematics_motion_game_scores WHERE ip_hash = ? AND created_at > ?')
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
      `UPDATE kinematics_motion_game_runs
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
        error: 'Motion game run is missing, expired, or already used.',
      },
      { status: 409 },
    );
  }

  await db
    .prepare(
      `INSERT INTO kinematics_motion_game_scores
        (id, run_id, name, score, graph1_score, graph2_score, graph3_score, retries_used, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      runId,
      validation.name,
      validation.score,
      validation.graphScores[0],
      validation.graphScores[1],
      validation.graphScores[2],
      validation.retriesUsed,
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
