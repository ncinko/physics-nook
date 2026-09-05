import assert from 'node:assert/strict';
import {
  generateLeaderboardName,
  isBlockedLeaderboardName,
  sanitizeLeaderboardName,
} from '../../src/lib/shared/leaderboardNames.ts';
import { validateScoreSubmission, STOP_ZONE_DEFAULTS } from '../../src/lib/kinematics/stopZones.ts';
import { validateGoalRushScoreSubmission } from '../../src/lib/kinematics/goalRush.ts';
import { validateCaerbannogScoreSubmission } from '../../src/lib/caerbannog/leaderboard.ts';
import { validateChickenCountScoreSubmission } from '../../src/lib/measurement/chickenCount.ts';
import { validateMotionGameScoreSubmission } from '../../src/lib/kinematics/motionGame.ts';

// --- names that must never reach a shared board --------------------------
// Each entry is a distinct evasion the normalizer has to undo.
const blocked: [string, string][] = [
  ['fuck', 'plain'],
  ['FUCK', 'uppercase'],
  ['f u c k', 'spaced'],
  ['f.u.c.k', 'punctuated'],
  ['f_u_c_k', 'underscored'],
  ['fuuuuck', 'repeated letters'],
  ['sh1t', 'digit for letter'],
  ['$h1t', 'symbol for letter'],
  ['@sshole', 'at for a'],
  ['p3n1s', 'multiple digits'],
  ['pu55y', 'double digit'],
  ['r3t4rd', 'mixed leet'],
  ['xX_Fuck_Xx', 'decorated'],
  ['MyNameIsFuck', 'embedded in a longer name'],
  ['shit123', 'trailing digits'],
  ['n1gger', 'slur, leet'],
  ['b!tch', 'bang for i'],
  ['SmartAss', 'compound'],
  ['Ass', 'standalone word'],
  ['ASS', 'standalone, uppercase'],
  ['Sex', 'standalone word'],
  ['kys', 'standalone abbreviation'],
  ['Damn', 'mild, standalone'],
  ['FaG', 'slur, mixed case'],
];

for (const [name, why] of blocked) {
  assert.equal(isBlockedLeaderboardName(name), true, `should block ${JSON.stringify(name)} (${why})`);
}

// Accents and zero-width characters must not smuggle a term through.
assert.equal(isBlockedLeaderboardName('fu​ck'), true, 'zero-width space');
assert.equal(isBlockedLeaderboardName('fück'), true, 'diacritic');
assert.equal(isBlockedLeaderboardName('f́úćḱ'), true, 'combining marks');
assert.equal(isBlockedLeaderboardName('f­u­c­k'), true, 'soft hyphens');
assert.equal(isBlockedLeaderboardName('‮fuck‬'), true, 'bidi override');

// --- names that must survive ---------------------------------------------
// Mostly the Scunthorpe family: innocent words containing a blocked term.
const allowed = [
  'Ada Lovelace',
  'NC',
  'Mr. Cinko',
  'As',
  'Al',
  'Class Clown',
  'Classic Physics',
  'Scunthorpe United',
  'Shiitake Fan',
  'Grape Soda',
  'Peacock',
  'Hancock',
  'Dickens',
  'Bass Player',
  'Massive',
  'Analysis',
  'Document',
  'Cucumber',
  'Thorny Rose',
  'Basement Cat',
  'Torpedo',
  'Sussex',
  'Title Holder',
  'Butter',
  'But',
  'Compass Rose',
  'Passing Grade',
  'Cocktail',
  'Constitution',
  'Magnitude',
  'Therapy Dog',
  'Raccoon',
  'Lynx',
  'Hell',
  'Heck of a Run',
];

for (const name of allowed) {
  assert.equal(isBlockedLeaderboardName(name), false, `should allow ${JSON.stringify(name)}`);
}

// An empty name is a fallback case, not a rejection.
assert.equal(isBlockedLeaderboardName(''), false);
assert.equal(isBlockedLeaderboardName('   '), false);
assert.equal(isBlockedLeaderboardName(null), false);

// --- sanitize keeps its existing contract, plus masking -------------------
assert.equal(sanitizeLeaderboardName('  Ada   Lovelace  '), 'Ada Lovelace');
assert.equal(sanitizeLeaderboardName(''), 'Player');
assert.equal(sanitizeLeaderboardName('abcdefghijklmnopqrstuvwxyzzz'), 'abcdefghijklmnopqrstuvwx');
// Masking on the read path is what hides rows already stored in D1.
assert.equal(sanitizeLeaderboardName('f u c k'), 'Player');
assert.equal(sanitizeLeaderboardName('sh1t', 'Anonymous'), 'Anonymous');

// --- generated names are always safe and fit the column ------------------
for (let i = 0; i < 200; i += 1) {
  const generated = generateLeaderboardName();
  assert.equal(isBlockedLeaderboardName(generated), false, `generated name blocked: ${generated}`);
  assert.equal(sanitizeLeaderboardName(generated), generated, `generated name altered: ${generated}`);
  assert.ok(generated.length <= 24, `generated name too long: ${generated}`);
}
// Deterministic with an injected source of randomness.
assert.equal(typeof generateLeaderboardName(() => 0), 'string');
assert.equal(generateLeaderboardName(() => 0), generateLeaderboardName(() => 0));

// --- every board's validator rejects a blocked name ----------------------
const nameRejected = (errors: string[]) => errors.some((error) => error.startsWith('name is not allowed'));

const zone = validateScoreSubmission({
  name: 'sh1t',
  timeMs: 30000,
  stops: STOP_ZONE_DEFAULTS.winStops,
});
assert.equal(zone.ok, false, 'zone challenge should reject a blocked name');
assert.ok(nameRejected(zone.errors));
// The stored value is masked too, so a bypassed check still cannot post it.
assert.equal(zone.name, 'Player');

// An otherwise identical submission with a clean name still passes.
const zoneClean = validateScoreSubmission({
  name: 'Ada Lovelace',
  timeMs: 30000,
  stops: STOP_ZONE_DEFAULTS.winStops,
});
assert.equal(zoneClean.ok, true, 'clean zone submission should pass');
assert.equal(zoneClean.name, 'Ada Lovelace');

const goalRush = validateGoalRushScoreSubmission({
  name: '@sshole',
  score: 10,
  goldenHits: 1,
  normalHits: 1,
  durationMs: 30000,
});
assert.equal(goalRush.ok, false, 'goal rush should reject a blocked name');
assert.ok(nameRejected(goalRush.errors));
assert.equal(goalRush.name, 'Player');

const caerbannog = validateCaerbannogScoreSubmission({
  name: 'FUCK',
  score: 10,
  wave: 2,
  enemiesSlain: 5,
  goldCollected: 5,
});
assert.equal(caerbannog.ok, false, 'caerbannog should reject a blocked name');
assert.ok(nameRejected(caerbannog.errors));
assert.equal(caerbannog.name, 'Player');

const chicken = validateChickenCountScoreSubmission({
  name: 'n1gger',
  score: 10,
  rounds: [],
});
assert.equal(chicken.ok, false, 'chicken count should reject a blocked name');
assert.ok(nameRejected(chicken.errors));
assert.equal(chicken.name, 'Player');

const motionGame = validateMotionGameScoreSubmission(
  {
    name: 'n1gger',
    score: 0,
    retriesUsed: 0,
    attempts: [],
  },
  // Any seed will do: the name gate runs before the targets matter.
  1,
);
assert.equal(motionGame.ok, false, 'motion game should reject a blocked name');
assert.ok(nameRejected(motionGame.errors));
assert.equal(motionGame.name, 'Player');

// The endpoints bind `validation.name`, so even if the `ok` check were ever
// bypassed the value reaching D1 is the masked one, never the raw payload.

console.log('shared leaderboard name tests passed');
