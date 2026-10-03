import {
  clampLeaderboardLimit,
  getLeaderboardEnv,
  hashClientAddress,
  jsonResponse,
  parseJsonBody,
} from '../../../src/lib/kinematics/leaderboardApi';
import {
  caerbannogScore,
  normalizeCaerbannogScoreRow,
  validateCaerbannogScoreSubmission,
} from '../../../src/lib/caerbannog/leaderboard';
import { FIXED_STEP_MS, REPLAY_VERSION, replayRun } from '../../../src/lib/caerbannog/replay';
import { isBlockedLeaderboardName } from '../../../src/lib/kinematics/stopZones';

const SCORE_SUBMITS_PER_HOUR = 5;
// Network and timer jitter between the run being minted and the first frame.
const REPLAY_CLOCK_SLACK_MS = 5_000;

const fetchTopScores = async (db: any, limit: number) => {
  const result = await db
    .prepare(
      `SELECT id, name, score, wave, enemies_slain, gold_collected, created_at
       FROM (
         SELECT
           id,
           name,
           score,
           wave,
           enemies_slain,
           gold_collected,
           created_at,
           ROW_NUMBER() OVER (
             PARTITION BY lower(trim(name))
             ORDER BY score DESC, created_at ASC
           ) AS score_rank
         FROM caerbannog_scores
       )
       WHERE score_rank = 1
       ORDER BY score DESC, created_at ASC
       LIMIT ${limit}`,
    )
    .all();

  return Array.isArray(result?.results) ? result.results.map(normalizeCaerbannogScoreRow) : [];
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

  // The score is never read from the request. The client sends its input log;
  // the server re-plays it from the seed it issued and scores the result.
  const body = payload as Record<string, unknown>;
  const runId = typeof body.runId === 'string' ? body.runId.trim() : '';

  if (!runId || !Array.isArray(body.log)) {
    return jsonResponse({ ok: false, error: 'Invalid score payload.' }, { status: 400 });
  }

  if (body.version !== REPLAY_VERSION) {
    return jsonResponse(
      { ok: false, error: 'This game build is out of date. Please reload and play again.' },
      { status: 409 },
    );
  }

  // Checked before the run is redeemed so a rejected name doesn't burn the run.
  if (isBlockedLeaderboardName(body.name)) {
    return jsonResponse(
      {
        ok: false,
        error: 'Invalid score payload.',
        errors: ['name is not allowed. Please choose a different display name.'],
      },
      { status: 400 },
    );
  }

  const db = configured.db as any;
  const now = Date.now();
  const ipHash = await hashClientAddress(request, configured.salt);
  const recent = await db
    .prepare('SELECT COUNT(*) AS count FROM caerbannog_scores WHERE ip_hash = ? AND created_at > ?')
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

  // Redeem the run atomically and read back the seed and start time in one go.
  // Runs minted before seeds existed have a NULL seed and can't be replayed.
  const run = await db
    .prepare(
      `UPDATE caerbannog_runs
       SET used_at = ?
       WHERE id = ?
         AND ip_hash = ?
         AND used_at IS NULL
         AND expires_at >= ?
         AND seed IS NOT NULL
       RETURNING seed, created_at`,
    )
    .bind(now, runId, ipHash, now)
    .first();

  if (!run) {
    return jsonResponse(
      {
        ok: false,
        error: 'Siege run is missing, expired, or already used.',
      },
      { status: 409 },
    );
  }

  const replay = replayRun(Number(run.seed), body.log);
  if (!replay.ok) {
    return jsonResponse({ ok: false, error: 'Invalid score payload.', errors: [replay.error] }, { status: 400 });
  }

  // The game can only be played in real time, so a run that took longer to play
  // than the wall clock allowed was simulated offline.
  const playedMs = replay.totalSteps * FIXED_STEP_MS;
  if (playedMs > now - Number(run.created_at) + REPLAY_CLOCK_SLACK_MS) {
    return jsonResponse(
      { ok: false, error: 'Invalid score payload.', errors: ['run finished faster than real time allows.'] },
      { status: 400 },
    );
  }

  const validation = validateCaerbannogScoreSubmission({
    name: body.name,
    score: caerbannogScore(replay.state.wave, replay.state.score, replay.state.goldEarned),
    wave: replay.state.wave,
    enemiesSlain: replay.state.score,
    goldCollected: replay.state.goldEarned,
  });
  if (!validation.ok) {
    return jsonResponse(
      { ok: false, error: 'Invalid score payload.', errors: validation.errors },
      { status: 400 },
    );
  }

  await db
    .prepare(
      `INSERT INTO caerbannog_scores
        (id, run_id, name, score, wave, enemies_slain, gold_collected, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      runId,
      validation.name,
      validation.score,
      validation.wave,
      validation.enemiesSlain,
      validation.goldCollected,
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
