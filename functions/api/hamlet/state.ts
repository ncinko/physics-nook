import { getLeaderboardEnv, jsonResponse } from '../../../src/lib/kinematics/leaderboardApi';
import { buildCareSummary, normalizeCareAggregateRow } from '../../../src/lib/hamlet/hamletCare';

const CARE_SUMMARY_QUERY = `SELECT action, COUNT(*) AS count, MAX(created_at) AS last_at
   FROM hamlet_care_events
   GROUP BY action`;

export const onRequestOptions = () =>
  jsonResponse(
    { ok: true },
    {
      headers: {
        allow: 'GET, OPTIONS',
      },
    },
  );

export const onRequestGet = async ({ env }: { env: Record<string, unknown> }) => {
  const configured = getLeaderboardEnv(env);
  if (!configured.ok) {
    return configured.response;
  }

  const db = configured.db as any;
  const result = await db.prepare(CARE_SUMMARY_QUERY).all();
  const rows = Array.isArray(result?.results) ? result.results.map(normalizeCareAggregateRow) : [];
  const summary = buildCareSummary(rows);

  return jsonResponse({ ok: true, ...summary });
};
