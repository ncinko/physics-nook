import assert from 'node:assert/strict';
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  formatPacificClock,
  getHamletPhase,
  getHamletTime,
  getPacificClock,
} from '../../src/lib/hamlet/hamletTime.ts';
import {
  buildCareSummary,
  deriveHamletMood,
  emptyCareSummary,
  formatRelativeTime,
  isCareAction,
  normalizeCareAggregateRow,
  summarizeCareEvents,
  validateCareSubmission,
} from '../../src/lib/hamlet/hamletCare.ts';

const HOUR = 60 * 60 * 1000;

// --- Pacific clock + day/night phase, with DST handled by the IANA zone ---
{
  // Winter (PST = UTC-8): 20:00Z -> 12:00 PT (noon), daytime.
  const winterNoon = getHamletTime(new Date('2025-01-15T20:00:00Z'));
  assert.equal(winterNoon.clock.hour, 12, 'PST: 20:00Z is noon in California');
  assert.equal(winterNoon.phase, 'day');

  // Summer (PDT = UTC-7): 20:00Z -> 13:00 PT, daytime.
  const summerAfternoon = getHamletTime(new Date('2025-07-15T20:00:00Z'));
  assert.equal(summerAfternoon.clock.hour, 13, 'PDT: 20:00Z is 1pm in California');
  assert.equal(summerAfternoon.phase, 'day');

  // Winter midnight: 08:00Z -> 00:00 PT, night.
  const winterMidnight = getHamletTime(new Date('2025-01-15T08:00:00Z'));
  assert.equal(winterMidnight.clock.hour, 0, 'PST: 08:00Z folds to midnight, not 24');
  assert.equal(winterMidnight.phase, 'night');

  // Summer late evening: 04:00Z -> 21:00 PT, night.
  assert.equal(getHamletPhase(new Date('2025-07-16T04:00:00Z')), 'night');

  // Boundaries: 07:00 PT is day, one minute before is night; 19:00 PT is night.
  const dawn = getPacificClock(new Date('2025-07-15T14:00:00Z')); // 07:00 PDT
  assert.equal(dawn.hour, DAY_START_HOUR);
  assert.equal(getHamletPhase(new Date('2025-07-15T14:00:00Z')), 'day', 'wakes exactly at 07:00 PT');
  assert.equal(getHamletPhase(new Date('2025-07-15T13:59:00Z')), 'night', '06:59 PT is still night');
  assert.equal(getHamletPhase(new Date('2025-07-16T02:00:00Z')), 'night', '19:00 PT turns in');
  assert.equal(getHamletPhase(new Date('2025-07-16T01:59:00Z')), 'day', '18:59 PT still running');

  // Phase progress runs 0..1 across the phase window.
  const sunrise = getHamletTime(new Date('2025-07-15T14:00:00Z')); // 07:00 PDT
  assert.ok(sunrise.phaseProgress < 0.01, 'day progress starts near 0 at sunrise');
  const noon = getHamletTime(new Date('2025-07-15T20:00:00Z')); // 13:00 PDT, midpoint of 7-19
  assert.ok(Math.abs(noon.phaseProgress - 0.5) < 0.01, 'midday is mid-progress');

  assert.equal(DAY_END_HOUR, 19);
}

// --- Pacific clock formatting ---
{
  assert.equal(formatPacificClock({ hour: 0, minute: 0 }), '12:00 AM');
  assert.equal(formatPacificClock({ hour: 9, minute: 5 }), '9:05 AM');
  assert.equal(formatPacificClock({ hour: 12, minute: 0 }), '12:00 PM');
  assert.equal(formatPacificClock({ hour: 14, minute: 30 }), '2:30 PM');
  assert.equal(formatPacificClock({ hour: 23, minute: 9 }), '11:09 PM');
}

console.log('Hamlet time tests passed.');

// --- Care action vocabulary + submission validation ---
{
  assert.ok(isCareAction('feed') && isCareAction('water') && isCareAction('pet'));
  assert.ok(!isCareAction('cuddle') && !isCareAction(42) && !isCareAction(undefined));

  assert.deepEqual(validateCareSubmission({ action: 'feed' }), {
    ok: true,
    action: 'feed',
    errors: [],
  });
  const bad = validateCareSubmission({ action: 'bathe' });
  assert.equal(bad.ok, false);
  assert.equal(bad.action, null);
  assert.equal(bad.errors.length, 1);
  assert.equal(validateCareSubmission({}).ok, false, 'a missing action is rejected');
}

// --- Aggregate normalization + summary building ---
{
  const rows = [
    normalizeCareAggregateRow({ action: 'feed', count: 3, last_at: 1000 }),
    normalizeCareAggregateRow({ action: 'pet', count: 5, last_at: 2000 }),
    normalizeCareAggregateRow({ action: 'mystery', count: 9, last_at: 9999 }), // ignored
  ];
  const summary = buildCareSummary(rows);
  assert.equal(summary.lastFedAt, 1000);
  assert.equal(summary.lastPettedAt, 2000);
  assert.equal(summary.lastWateredAt, null, 'never watered -> null');
  assert.deepEqual(summary.counts, { feed: 3, water: 0, pet: 5 });
  assert.equal(summary.total, 8, 'unknown actions do not count');

  // A null MAX(created_at) (no rows for an action) normalizes to null.
  assert.equal(normalizeCareAggregateRow({ action: 'water', count: 0, last_at: null }).lastAt, null);
}

// --- Raw event reduction matches the aggregate path ---
{
  const summary = summarizeCareEvents([
    { action: 'feed', createdAt: 100 },
    { action: 'feed', createdAt: 300 },
    { action: 'water', createdAt: 250 },
    { action: 'bogus', createdAt: 999 },
    { action: 'pet', createdAt: 'NaN' },
  ]);
  assert.equal(summary.counts.feed, 2);
  assert.equal(summary.lastFedAt, 300, 'keeps the most recent feed');
  assert.equal(summary.counts.water, 1);
  assert.equal(summary.lastWateredAt, 250);
  assert.equal(summary.counts.pet, 0, 'non-finite timestamps are dropped');
  assert.equal(summary.total, 3);

  assert.deepEqual(emptyCareSummary().counts, { feed: 0, water: 0, pet: 0 });
}

// --- Mood: deterministic in `now`, hunger first, then thirst, then love ---
{
  const now = 100 * HOUR;
  const fresh = { ...emptyCareSummary(), lastFedAt: now, lastWateredAt: now, lastPettedAt: now };

  assert.equal(deriveHamletMood(fresh, now).mood, 'happy', 'just petted -> loved');
  assert.equal(deriveHamletMood(emptyCareSummary(), now).mood, 'hungry', 'never fed -> hungry');

  const thirsty = { ...fresh, lastWateredAt: now - 9 * HOUR };
  assert.equal(deriveHamletMood(thirsty, now).mood, 'thirsty');

  const hungry = { ...fresh, lastFedAt: now - 9 * HOUR, lastWateredAt: now - 9 * HOUR };
  assert.equal(deriveHamletMood(hungry, now).mood, 'hungry', 'hunger outranks thirst');

  const content = {
    ...fresh,
    lastPettedAt: now - 5 * HOUR, // petted, but not recently
  };
  assert.equal(deriveHamletMood(content, now).mood, 'content');
}

// --- Relative time formatting ---
{
  const now = 1_000_000_000;
  assert.equal(formatRelativeTime(null, now), 'never');
  assert.equal(formatRelativeTime(now - 30 * 1000, now), 'just now');
  assert.equal(formatRelativeTime(now - 90 * 1000, now), '1 minute ago');
  assert.equal(formatRelativeTime(now - 5 * 60 * 1000, now), '5 minutes ago');
  assert.equal(formatRelativeTime(now - 1 * HOUR, now), '1 hour ago');
  assert.equal(formatRelativeTime(now - 3 * HOUR, now), '3 hours ago');
  assert.equal(formatRelativeTime(now - 26 * HOUR, now), '1 day ago');
  assert.equal(formatRelativeTime(now - 50 * HOUR, now), '2 days ago');
  assert.equal(formatRelativeTime(now + 5000, now), 'just now', 'future timestamps clamp to now');
}

console.log('Hamlet care tests passed.');
