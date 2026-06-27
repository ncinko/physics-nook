import { jsonResponse } from '../../src/lib/kinematics/leaderboardApi';

const coordinateFromCfField = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const onRequestOptions = () =>
  jsonResponse(
    { ok: true },
    {
      headers: {
        allow: 'GET, OPTIONS',
      },
    },
  );

export const onRequestGet = ({ request }: { request: Request & { cf?: Record<string, unknown> } }) => {
  const latitude = coordinateFromCfField(request.cf?.latitude);
  const longitude = coordinateFromCfField(request.cf?.longitude);

  if (latitude === null || longitude === null) {
    return jsonResponse({
      ok: false,
      available: false,
    });
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return jsonResponse({
      ok: false,
      available: false,
    });
  }

  return jsonResponse({
    ok: true,
    available: true,
    latitude,
    longitude,
  });
};
