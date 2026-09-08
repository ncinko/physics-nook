import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
import { contrastRatio, ensureContrast, mixRgb, relativeLuminance,
  type Rgb } from '../../src/components/shared/themeColors.ts';

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


// --- theme color helpers ---------------------------------------------------
// These back the canvas interactives that bake a bitmap from the active theme.
{
  const white: Rgb = [255, 255, 255];
  const black: Rgb = [0, 0, 0];

  assert.equal(Math.round(contrastRatio(white, black)), 21);
  assert.equal(Math.round(contrastRatio(white, white)), 1);
  assert.ok(relativeLuminance(white) > 0.5 && relativeLuminance(black) < 0.5);

  assert.deepEqual(mixRgb([0, 0, 0], [100, 200, 50], 0.5), [50, 100, 25]);
  assert.deepEqual(mixRgb([10, 20, 30], white, 0), [10, 20, 30]);

  // A color that already has the contrast is returned untouched.
  assert.deepEqual(ensureContrast([0, 0, 0], white), black);

  // The theme palettes as they are defined in src/styles/global.css. The
  // regression this guards: the potential colormap used to blend toward a
  // hardcoded white, so a dark theme painted the whole canvas near-white, and
  // the hardcoded deep blue end sat at 2.3:1 on the dark background.
  const themeCss = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8');
  const palette = (name: string) => {
    const block = themeCss.match(new RegExp(`\\[data-theme="${name}"\\]\\s*\\{([^}]+)\\}`))?.[1];
    assert.ok(block, `${name} theme exists in CSS`);
    return (token: string): Rgb => {
      const hex = block.match(new RegExp(`${token}:\\s*#([0-9a-f]{6});`, 'i'))?.[1];
      assert.ok(hex, `${name} ${token} is a hex color`);
      return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as Rgb;
    };
  };
  for (const name of ['light', 'dark', 'paper']) {
    const color = palette(name);
    const bg = color('--surface-plot');
    const positive = color('--accent-red');
    const negative = color('--accent-blue');
    for (const [role, accent] of [['positive', positive], ['negative', negative]] as const) {
      const end = ensureContrast(accent, bg);
      assert.ok(
        contrastRatio(end, bg) >= 4.5,
        `${name} ${role} colormap end is legible on its own background`,
      );
    }
  }

  const paper = palette('paper');
  for (const surface of ['--bg-primary', '--sim-bg', '--surface-plot', '--surface-elevated']) {
    assert.ok(contrastRatio(paper('--text-primary'), paper(surface)) >= 7, `Paper body text on ${surface}`);
    for (const token of ['--text-muted', '--accent-blue', '--accent-red', '--accent-green', '--accent-purple']) {
      assert.ok(contrastRatio(paper(token), paper(surface)) >= 4.5, `Paper ${token} on ${surface}`);
    }
  }
  assert.ok(contrastRatio(white, paper('--accent-blue')) >= 4.5, 'Paper primary button label');

  // The surface ladder from global.css: a panel is recessed from the page and a
  // plot surface is lifted above the panel, in every theme. Panels stopped
  // reading as panels when components picked --sim-bg for plot fills too, so
  // pin the ordering rather than the individual hex values.
  for (const name of ['light', 'dark', 'paper']) {
    const color = palette(name);
    const page = relativeLuminance(color('--bg-primary'));
    const panel = relativeLuminance(color('--sim-bg'));
    const plot = relativeLuminance(color('--surface-plot'));
    assert.ok(Math.abs(page - panel) >= 0.01, `${name} panel is distinguishable from the page`);
    assert.ok(Math.abs(plot - panel) >= 0.01, `${name} plot surface is distinguishable from its panel`);
    assert.ok(plot > panel, `${name} plot surface sits above its panel`);
  }

  // Zero potential is painted as the theme's own background, so a dark theme
  // stays dark. Blending toward white, as the colormap used to, would have put
  // the neutral at 14.7:1 against the dark background — the bug being fixed.
  const darkBg: Rgb = [31, 41, 55];
  assert.ok(relativeLuminance(darkBg) < 0.5, 'the dark theme background is dark');
  assert.ok(contrastRatio([255, 255, 255], darkBg) > 10, 'white was the wrong neutral for it');

  // The dark theme is the case that motivated all of this: its own accents
  // already clear the bar, so they are used as-is rather than being muddied.
  assert.deepEqual(ensureContrast([248, 113, 113], [31, 41, 55]), [248, 113, 113]);
  // Low-contrast inputs still need correction, independent of shipped themes.
  const paleEnd = ensureContrast([255, 180, 162], [254, 250, 224]);
  assert.notDeepEqual(paleEnd, [255, 180, 162]);
  assert.ok(contrastRatio(paleEnd, [254, 250, 224]) >= 4.5);
}

console.log('shared leaderboard name tests passed');
