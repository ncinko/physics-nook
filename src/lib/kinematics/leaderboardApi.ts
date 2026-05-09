import { sanitizeLeaderboardName } from './stopZones';

export interface LeaderboardScore {
  id: string;
  name: string;
  timeMs: number;
  stops: number;
  createdAt: number;
}

export const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...init.headers,
    },
  });

export const parseJsonBody = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

export const clampLeaderboardLimit = (value: string | null, fallback = 10) => {
  const parsed = Number(value ?? fallback);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(50, Math.floor(parsed)));
};

export const getClientAddress = (request: Request) => {
  const forwarded = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for');

  return (forwarded?.split(',')[0] ?? 'unknown').trim() || 'unknown';
};

export const getUserAgent = (request: Request) =>
  (request.headers.get('user-agent') ?? '').slice(0, 240);

export const hashClientAddress = async (request: Request, salt: string) => {
  const input = `${salt}:${getClientAddress(request)}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const getLeaderboardEnv = (env: Record<string, unknown>) => {
  const db = env.KINEMATICS_DB;
  const salt = env.LEADERBOARD_SALT;

  if (!db || typeof salt !== 'string' || salt.length < 16) {
    return {
      ok: false as const,
      response: jsonResponse(
        {
          ok: false,
          error: 'Leaderboard is not configured.',
        },
        { status: 503 },
      ),
    };
  }

  return {
    ok: true as const,
    db,
    salt,
  };
};

export const normalizeScoreRow = (row: Record<string, unknown>): LeaderboardScore => ({
  id: String(row.id),
  name: sanitizeLeaderboardName(row.name),
  timeMs: Number(row.time_ms ?? row.timeMs),
  stops: Number(row.stops),
  createdAt: Number(row.created_at ?? row.createdAt),
});
