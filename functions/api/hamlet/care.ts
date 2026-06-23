import {
  getLeaderboardEnv,
  hashClientAddress,
  jsonResponse,
  parseJsonBody,
} from '../../../src/lib/kinematics/leaderboardApi';
import {
  buildCareSummary,
  normalizeCareAggregateRow,
  validateCareSubmission,
} from '../../../src/lib/hamlet/hamletCare';

// Hamlet is communal but not a stress toy — cap how fast one visitor can act.
const CARE_ACTIONS_PER_HOUR = 120;

const CARE_SUMMARY_QUERY = `SELECT action, COUNT(*) AS count, MAX(created_at) AS last_at
   FROM hamlet_care_events
   GROUP BY action`;

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

  const payload = await parseJsonBody(request);
  const validation = validateCareSubmission((payload ?? {}) as { action?: unknown });
  if (!validation.ok || !validation.action) {
    return jsonResponse(
      {
        ok: false,
        error: 'Invalid care action.',
        errors: validation.errors,
      },
      { status: 400 },
    );
  }

  const db = configured.db as any;
  const now = Date.now();
  const ipHash = await hashClientAddress(request, configured.salt);
  const recent = await db
    .prepare('SELECT COUNT(*) AS count FROM hamlet_care_events WHERE ip_hash = ? AND created_at > ?')
    .bind(ipHash, now - 60 * 60 * 1000)
    .first();

  if (Number(recent?.count ?? 0) >= CARE_ACTIONS_PER_HOUR) {
    return jsonResponse(
      {
        ok: false,
        error: 'Hamlet needs a breather. Please slow down and try again soon.',
      },
      { status: 429 },
    );
  }

  await db
    .prepare('INSERT INTO hamlet_care_events (id, action, ip_hash, created_at) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), validation.action, ipHash, now)
    .run();

  const result = await db.prepare(CARE_SUMMARY_QUERY).all();
  const rows = Array.isArray(result?.results) ? result.results.map(normalizeCareAggregateRow) : [];
  const summary = buildCareSummary(rows);

  return jsonResponse({ ok: true, action: validation.action, ...summary });
};
