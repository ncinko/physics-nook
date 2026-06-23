/**
 * Hamlet's care is communal. Anyone can feed, water, or pet him, and the
 * timestamps + tallies are shared globally (persisted in D1 behind the
 * `/api/hamlet/*` Pages Functions) so every visitor can see when he was last
 * looked after.
 *
 * This module holds the pure, DOM-free pieces shared by the Functions, the
 * React island, and the tests: the action vocabulary, submission validation,
 * the summary shape, and the deterministic mood + relative-time helpers.
 */

export const CARE_ACTIONS = ['feed', 'water', 'pet'] as const;
export type CareAction = (typeof CARE_ACTIONS)[number];

export const isCareAction = (value: unknown): value is CareAction =>
  typeof value === 'string' && (CARE_ACTIONS as readonly string[]).includes(value);

export interface CareValidationResult {
  ok: boolean;
  action: CareAction | null;
  errors: string[];
}

/** Validate an incoming care POST body. Mirrors the caerbannog validator shape. */
export const validateCareSubmission = (payload: { action?: unknown }): CareValidationResult => {
  const action = isCareAction(payload?.action) ? payload.action : null;
  const errors = action ? [] : [`action must be one of: ${CARE_ACTIONS.join(', ')}.`];
  return { ok: errors.length === 0, action, errors };
};

export interface CareSummary {
  lastFedAt: number | null;
  lastWateredAt: number | null;
  lastPettedAt: number | null;
  counts: Record<CareAction, number>;
  total: number;
}

export const emptyCareSummary = (): CareSummary => ({
  lastFedAt: null,
  lastWateredAt: null,
  lastPettedAt: null,
  counts: { feed: 0, water: 0, pet: 0 },
  total: 0,
});

export interface CareAggregateRow {
  action: CareAction;
  count: number;
  lastAt: number | null;
}

/** Normalize one `GROUP BY action` D1 row (snake_case) into a typed aggregate. */
export const normalizeCareAggregateRow = (row: Record<string, unknown>): CareAggregateRow => {
  const lastRaw = row.last_at ?? row.lastAt;
  const lastAt = lastRaw === null || lastRaw === undefined ? null : Number(lastRaw);
  return {
    action: String(row.action) as CareAction,
    count: Number(row.count ?? 0),
    lastAt: lastAt !== null && Number.isFinite(lastAt) ? lastAt : null,
  };
};

/** Fold per-action aggregate rows into the care summary the client renders. */
export const buildCareSummary = (rows: CareAggregateRow[]): CareSummary => {
  const summary = emptyCareSummary();

  for (const row of rows) {
    if (!isCareAction(row.action)) continue;
    summary.counts[row.action] = Number.isFinite(row.count) ? row.count : 0;
    if (row.action === 'feed') summary.lastFedAt = row.lastAt;
    else if (row.action === 'water') summary.lastWateredAt = row.lastAt;
    else summary.lastPettedAt = row.lastAt;
  }

  summary.total = summary.counts.feed + summary.counts.water + summary.counts.pet;
  return summary;
};

/** Reduce a raw list of care events into a summary (used in tests). */
export const summarizeCareEvents = (
  events: Array<{ action: unknown; createdAt: unknown }>,
): CareSummary => {
  const tally = new Map<CareAction, { count: number; lastAt: number }>();

  for (const event of events) {
    if (!isCareAction(event.action)) continue;
    const createdAt = Number(event.createdAt);
    if (!Number.isFinite(createdAt)) continue;
    const current = tally.get(event.action) ?? { count: 0, lastAt: -Infinity };
    tally.set(event.action, {
      count: current.count + 1,
      lastAt: Math.max(current.lastAt, createdAt),
    });
  }

  return buildCareSummary(
    [...tally.entries()].map(([action, { count, lastAt }]) => ({ action, count, lastAt })),
  );
};

export type HamletMood = 'hungry' | 'thirsty' | 'happy' | 'content';

export interface HamletMoodResult {
  mood: HamletMood;
  label: string;
}

const HUNGRY_AFTER_MS = 8 * 60 * 60 * 1000;
const THIRSTY_AFTER_MS = 8 * 60 * 60 * 1000;
const RECENTLY_PETTED_MS = 60 * 60 * 1000;

/**
 * Hamlet's mood from how recently he was cared for. Deterministic in `now`:
 * hunger takes priority, then thirst, then a recent pet leaves him happy,
 * otherwise he is simply content.
 */
export const deriveHamletMood = (summary: CareSummary, now: number): HamletMoodResult => {
  const since = (at: number | null) => (at === null ? Infinity : now - at);

  if (since(summary.lastFedAt) > HUNGRY_AFTER_MS) {
    return { mood: 'hungry', label: 'Hamlet is hungry.' };
  }
  if (since(summary.lastWateredAt) > THIRSTY_AFTER_MS) {
    return { mood: 'thirsty', label: 'Hamlet is thirsty.' };
  }
  if (since(summary.lastPettedAt) <= RECENTLY_PETTED_MS) {
    return { mood: 'happy', label: 'Hamlet feels loved.' };
  }
  return { mood: 'content', label: 'Hamlet is content.' };
};

/** Human-friendly "x ago" for a timestamp, or "never". Pure in `now`. */
export const formatRelativeTime = (timestamp: number | null, now: number): string => {
  if (timestamp === null || !Number.isFinite(timestamp)) return 'never';

  const diffMs = Math.max(0, now - timestamp);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};
