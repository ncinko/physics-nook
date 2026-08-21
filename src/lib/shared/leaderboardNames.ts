/**
 * Leaderboard display-name moderation.
 *
 * Every public board (Zone Challenge, Goal Rush, Caerbannog, Chicken Count)
 * routes names through here. The site is used in classrooms and the boards are
 * global, so a name typed into a game has to be safe on a projector before it
 * reaches everyone else's screen.
 *
 * Two entry points:
 * - `isBlockedLeaderboardName` gates submissions. Games call it for an inline
 *   message; the API validators call it too, so a hand-rolled POST cannot skip
 *   the client check.
 * - `sanitizeLeaderboardName` also runs on the read path, so rows already
 *   stored in D1 are masked at render time without needing a migration.
 *
 * The matcher normalizes away the usual evasions (case, spacing, punctuation,
 * accents, zero-width characters, leetspeak, repeated letters) before
 * comparing. It is deliberately a starting point rather than a proof: add
 * terms to the lists below as a class finds the gaps.
 */

/**
 * Characters that carry no visible meaning but break naive matching: C0/C1
 * controls, soft hyphen, zero-width spaces and joiners, and the bidirectional
 * overrides. Built from escapes so the source stays readable ASCII.
 */
const INVISIBLE_CHARACTERS = new RegExp(
  '[\\u0000-\\u001F\\u007F-\\u009F\\u00AD\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\uFEFF]',
  'g',
);

/** Glyph swaps that still read as letters. Applied before any comparison. */
const CONFUSABLES: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '6': 'g',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'i',
  '+': 't',
  '(': 'c',
  '{': 'c',
  '<': 'c',
};

/**
 * Terms severe enough to block anywhere inside a name, so "xX_term_Xx" and
 * "term123" are both caught. Keep these long and unambiguous. Anything that
 * hides inside an ordinary English word belongs in BLOCKED_WORDS instead, or
 * it will block innocent names.
 */
const BLOCKED_SUBSTRINGS = [
  'fuck',
  'shit',
  'cunt',
  'bitch',
  'bastard',
  'whore',
  'slut',
  'penis',
  'vagina',
  'boob',
  'pussy',
  'twat',
  'wank',
  'jizz',
  'semen',
  'ejacul',
  'masturbat',
  'blowjob',
  'handjob',
  'orgasm',
  'dildo',
  'scrotum',
  'testicle',
  'smegma',
  'asshole',
  'arsehole',
  'dickhead',
  'dumbass',
  'jackass',
  'badass',
  'fatass',
  'smartass',
  'bollock',
  'bugger',
  'porn',
  'horny',
  'molest',
  'incest',
  'pedo',
  'rape',
  'nigger',
  'nigga',
  'faggot',
  'tranny',
  'retard',
  'nazi',
  'hitler',
  'holocaust',
  'suicide',
  'killyourself',
];

/**
 * Terms that are only a problem standing alone. Matched against whole words,
 * so "Class Clown" and "Peacock" survive while a name of just the term does
 * not.
 */
const BLOCKED_WORDS = [
  'ass',
  'arse',
  'anal',
  'anus',
  'butt',
  'cock',
  'dick',
  'cum',
  'tit',
  'tits',
  'titty',
  'sex',
  'sexy',
  'crap',
  'piss',
  'turd',
  'fart',
  'poop',
  'damn',
  'fag',
  'hoe',
  'thot',
  'pimp',
  'coon',
  'chink',
  'spic',
  'kike',
  'gook',
  'dyke',
  'wetback',
  'kys',
  'std',
];

/**
 * Ordinary words that contain a blocked substring. Removed before the
 * substring pass so "Scunthorpe", "Shiitake Fan", and "Grape Soda" survive.
 */
const SAFE_WORDS = [
  'scunthorpe',
  'penistone',
  'shiitake',
  'shitake',
  'grape',
  'drape',
  'scrape',
  'trapeze',
  'therapy',
  'thorny',
  'thorn',
  'basement',
  'casement',
  'easement',
  'torpedo',
  'pedometer',
  'pedagogy',
  'niggardly',
];

/**
 * Strips accents, invisible characters, and glyph swaps, then lowercases.
 * Applied to user input and to every list entry, so the lists stay readable
 * while still matching their obfuscated forms.
 */
const foldConfusables = (value: string) =>
  value
    .normalize('NFKD')
    // Combining marks cover both accents and "zalgo" stacking.
    .replace(/\p{M}+/gu, '')
    .replace(INVISIBLE_CHARACTERS, '')
    .toLowerCase()
    .replace(/./gu, (character) => CONFUSABLES[character] ?? character)
    // 'l' and 'i' are near-identical in most sans-serif faces.
    .replace(/l/g, 'i');

/** Letters and digits only, with punctuation and spacing removed. */
const toCollapsedForm = (value: string) => foldConfusables(value).replace(/[^a-z0-9]+/g, '');

/** Word tokens, for the terms that are only blocked in isolation. */
const toWordTokens = (value: string) =>
  foldConfusables(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * Builds a pattern that tolerates any letter being repeated, so "fuuuck" is
 * caught. Done with a pattern rather than by collapsing runs in the input,
 * because collapsing would shorten "ass" to "as" and match far too much.
 */
const toRepeatTolerantSource = (term: string) =>
  toCollapsedForm(term)
    .split('')
    .map((character) => `${character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}+`)
    .join('');

/** Matches the term anywhere inside a name. */
const toRepeatTolerantPattern = (term: string) => new RegExp(toRepeatTolerantSource(term));

/**
 * Matches only when a whole word is the term. Anchoring beats comparing
 * run-collapsed strings, which would reduce "ass" to "as" and wrongly reject
 * the ordinary word "As".
 */
const toWholeWordPattern = (term: string) => new RegExp(`^${toRepeatTolerantSource(term)}$`);

const BLOCKED_SUBSTRING_PATTERNS = BLOCKED_SUBSTRINGS.map(toRepeatTolerantPattern);
const BLOCKED_WORD_PATTERNS = BLOCKED_WORDS.map(toWholeWordPattern);
const SAFE_WORD_FORMS = SAFE_WORDS.map(toCollapsedForm).filter(Boolean);

/**
 * True when a name should not reach a shared board. Used by the games for an
 * inline message and by the API validators as the authoritative check.
 */
export const isBlockedLeaderboardName = (name: unknown) => {
  const raw = typeof name === 'string' ? name : '';
  // An empty name falls back to a default rather than being a rejection.
  if (!raw.trim()) return false;

  const tokens = toWordTokens(raw);
  if (tokens.some((token) => BLOCKED_WORD_PATTERNS.some((pattern) => pattern.test(token)))) {
    return true;
  }

  let collapsed = toCollapsedForm(raw);
  // Remove innocent words first so "scunthorpe" does not trip the "cunt" rule.
  // Replaced with a space so stripping cannot splice two fragments together.
  SAFE_WORD_FORMS.forEach((safeWord) => {
    collapsed = collapsed.split(safeWord).join(' ');
  });

  return BLOCKED_SUBSTRING_PATTERNS.some((pattern) => pattern.test(collapsed));
};

const NAME_ADJECTIVES = [
  'Swift', 'Brave', 'Clever', 'Cosmic', 'Curious', 'Bright', 'Bold', 'Calm',
  'Daring', 'Eager', 'Fearless', 'Gentle', 'Humble', 'Keen', 'Lucky', 'Mighty',
  'Nimble', 'Noble', 'Quick', 'Quiet', 'Rapid', 'Sharp', 'Silent', 'Solar',
  'Steady', 'Stellar', 'Sunny', 'Tidal', 'Wandering', 'Zesty', 'Amber',
  'Azure', 'Crimson', 'Golden', 'Silver', 'Violet',
];

const NAME_NOUNS = [
  'Otter', 'Heron', 'Falcon', 'Badger', 'Lynx', 'Ibis', 'Marmot', 'Puffin',
  'Raven', 'Sparrow', 'Tapir', 'Walrus', 'Yak', 'Zebra', 'Comet', 'Quasar',
  'Photon', 'Neutron', 'Quark', 'Pulsar', 'Meteor', 'Nebula', 'Beacon',
  'Compass', 'Lantern', 'Prism', 'Rocket', 'Turbine', 'Vector', 'Voyager',
];

/**
 * A safe display name for the "roll a name" button, so a student who would
 * rather not type one still gets something better than "Player".
 */
export const generateLeaderboardName = (random: () => number = Math.random) => {
  const adjective = NAME_ADJECTIVES[Math.floor(random() * NAME_ADJECTIVES.length)];
  const noun = NAME_NOUNS[Math.floor(random() * NAME_NOUNS.length)];

  return `${adjective} ${noun}`;
};

/**
 * Normalizes whitespace, caps length, and swaps a blocked name for the
 * fallback. Runs on the write path (the stored value) and on the read path, so
 * anything already in the database is masked when a board renders.
 */
export const sanitizeLeaderboardName = (name: unknown, fallback = 'Player') => {
  const value = typeof name === 'string' ? name : '';
  const collapsed = value.replace(/\s+/g, ' ').trim();

  if (isBlockedLeaderboardName(collapsed)) return fallback;

  return (collapsed || fallback).slice(0, 24);
};
