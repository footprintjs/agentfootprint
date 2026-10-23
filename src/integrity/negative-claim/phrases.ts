/**
 * phrases — the prose grammar's CLOSED phrase packs: data, versioned and hashed.
 *
 * Pattern: plain frozen data. The matcher (`words.ts · matchPhrase`) is the only code that reads
 *          it, and the hash pins every number measured with it to the grammar it measured
 *          (`bench/negative/RULE.md`).
 * Role:    integrity/ layer (L3), read by `detect.ts` (claims, code and language notes) and
 *          `containment.ts` (source and window markers, unbounded words). The answer bench reads
 *          the hedge and source packs from the built package (`bench/answer/labels.mjs`), so the
 *          bench and the library match the same words.
 *
 * A phrase is a list of SLOTS matched against consecutive tokens of one unit, with only spaces
 * between them (so "No, the deploy…" is not "no the"):
 *   - `a|b|c`     — one token, any of the alternatives (tokens are NFC, case-folded);
 *   - a trailing `?` — the slot may be skipped;
 *   - `<word>`    — any token that starts with a letter;
 *   - `!a|b`      — any letter token EXCEPT these;
 *   - `<num>`     — digits, or a number word (`two` … `twenty`);
 *   - `<dur>`     — a look-back spelling (`24h`, `7d`);
 *   - `^`         — only at the start of the unit (first slot only).
 *
 * The packs:
 *   - `none` and `complete` — the CLAIMS: non-existence, and completeness in a frame only
 *     (never a bare "every" or "zero");
 *   - `unbounded` — words that make any claim wider than any search ("never", "anywhere");
 *   - `source` — words that put the negative on the lookup ("the lookup returned nothing"),
 *     which scope a claim to the source, as a `source.said` word does;
 *   - `window` — the window a claim names ("in the last 2 hours");
 *   - `hedge` — words that voice doubt. They are NOT scope: a hedged claim is still a flat claim
 *     (design § 5.2). The pack exists so that law is data a test can walk, and so the answer
 *     bench reads the same list.
 */

import { sha256Hex } from '../../lib/sha256.js';
import { stableJson } from '../../lib/stableJson.js';

/** One phrase: an id (`<pack>.<name>`) and its slots. */
export interface ClaimPhrase {
  readonly id: string;
  readonly words: readonly string[];
}

/** The six packs, by name. */
export interface NegativeClaimPhrasePacks {
  readonly none: readonly ClaimPhrase[];
  readonly complete: readonly ClaimPhrase[];
  readonly unbounded: readonly ClaimPhrase[];
  readonly source: readonly ClaimPhrase[];
  readonly window: readonly ClaimPhrase[];
  readonly hedge: readonly ClaimPhrase[];
}

/** Bump with ANY edit to the packs or to what a slot means — the test pins version → hash. */
export const NEGATIVE_CLAIM_PHRASES_VERSION = '1';

const phrase = (id: string, words: string): ClaimPhrase =>
  Object.freeze({ id, words: Object.freeze(words.split(' ')) });

/** Literal phrases, one slot per word (the hedge and source packs). */
const literal = (pack: string, text: string): ClaimPhrase =>
  phrase(`${pack}.${text.replace(/[^a-z0-9]+/g, '-')}`, text);

const BE = 'is|are|was|were';
const BE_NOT = "isn't|aren't|wasn't|weren't";

const NONE: readonly ClaimPhrase[] = [
  phrase('none.there-are-no', `there ${BE} no`),
  phrase('none.there-have-been-no', 'there have|has been no'),
  phrase('none.there-may-be-no', 'there may|might|could|will|would|should|must be no'),
  phrase('none.there-seem-to-be-no', 'there seem|seems|appear|appears to be no'),
  phrase('none.there-are-not-any', `there ${BE} not any`),
  phrase('none.there-aren-t-any', `there ${BE_NOT} any`),
  phrase('none.there-have-not-been-any', 'there has|have|had not been any'),
  phrase('none.there-haven-t-been-any', "there hasn't|haven't|hadn't been any"),
  phrase('none.has-no', 'has|have|had no'),
  phrase('none.does-not-have-any', 'does|do|did not have any'),
  phrase('none.doesn-t-have-any', "doesn't|don't|didn't have any"),
  phrase('none.no-such', 'no such'),
  phrase('none.does-not-exist', 'does|do|did not exist'),
  phrase('none.doesn-t-exist', "doesn't|don't|didn't exist"),
  phrase('none.is-not-in', `${BE} not in|anywhere`),
  phrase('none.isn-t-in', `${BE_NOT} in|anywhere`),
  phrase('none.is-not-found', `${BE} not found`),
  phrase('none.isn-t-found', `${BE_NOT} found`),
  phrase('none.none-of', 'none of'),
  phrase('none.none-are', `none ${BE}|exist|exists`),
  phrase('none.nothing-is', 'nothing is|was|has|have'),
  phrase('none.nothing-deployed', 'nothing deployed|firing|open|running'),
  phrase('none.none', 'none'),
  phrase('none.zero-noun', '0 <word>'),
  phrase('none.no-lead', '^ no !other|doubt|matter|way|longer|more|less|later|earlier|problem'),
  phrase('none.no-noun-is', `no <word> <word>? ${BE}|exist|exists`),
  phrase('none.never-had', 'never had|has|have|existed|exist|exists|been|occurred|happened'),
];

const COMPLETE: readonly ClaimPhrase[] = [
  phrase('complete.these-are-all', 'these|those are|were all|every|everything'),
  phrase('complete.these-are-the-only', 'these|those are|were the only'),
  phrase('complete.that-is-all', 'that|this is|was all|every|everything'),
  phrase('complete.that-s-all', "that's all|every|everything"),
  phrase('complete.that-is-the-only', 'that|this is|was the only'),
  phrase('complete.that-s-the-only', "that's the only"),
  phrase('complete.the-complete-list', 'the complete|full|entire|whole list|set|inventory'),
  phrase('complete.all-n', 'all <num>'),
  phrase('complete.nothing-else', 'nothing else'),
  phrase('complete.no-other', 'no other'),
];

const UNBOUNDED: readonly ClaimPhrase[] = [
  phrase('unbounded.never', 'never'),
  phrase('unbounded.ever', 'ever'),
  phrase('unbounded.anywhere', 'anywhere'),
  phrase('unbounded.at-all', 'at all'),
  phrase('unbounded.across-all', 'across all'),
  phrase(
    'unbounded.in-the-estate',
    'in|across|throughout the|your|our|this estate|company|organization|organisation|environment|enterprise',
  ),
];

/** The bench's attribution list, minus "according to" and "based on" — hedges, never scope. */
const SOURCE: readonly ClaimPhrase[] = [
  'the lookup returned nothing',
  "couldn't find",
  'could not find',
  "didn't find",
  'did not find',
  'found no',
  'found nothing',
  'returned no',
  'returned nothing',
  'returned an empty',
  'returned empty',
  'came back empty',
  'shows no',
  'show no',
  'lists no',
  'no results',
  'no matching',
  'matched nothing',
].map((text) => literal('source', text));

const UNIT = 'minute|minutes|hour|hours|day|days|week|weeks';

const WINDOW: readonly ClaimPhrase[] = [
  phrase('window.last-n', `in|over|during|for|within? the? last|past|previous <num>? ${UNIT}`),
  phrase('window.last-duration', 'in|over|during|for|within? the? last|past|previous <dur>'),
];

/** The bench's hedge list, verbatim, plus the two § 5.2 names ("based on", "according to"). */
const HEDGE: readonly ClaimPhrase[] = [
  'not sure',
  'unsure',
  'uncertain',
  'unclear',
  "can't confirm",
  'cannot confirm',
  "couldn't confirm",
  'could not confirm',
  'unable to confirm',
  'unable to verify',
  "can't verify",
  'cannot verify',
  "can't tell",
  'cannot tell',
  "don't know",
  'do not know',
  'not able to',
  'no way to',
  'may not',
  'might not',
  'may be',
  'might be',
  'possibly',
  "it's possible",
  'it is possible',
  'appears to',
  'seems',
  'not checked',
  "wasn't checked",
  "weren't checked",
  'not covered',
  "doesn't cover",
  'does not cover',
  "didn't cover",
  'did not cover',
  'only covers',
  'only checked',
  'only keeps',
  'only holds',
  'only shows',
  'only includes',
  'only returns',
  'only lists',
  'only has',
  'only goes back',
  'only reaches',
  'limited to',
  'partial',
  'incomplete',
  'timed out',
  'not collected',
  "couldn't check",
  'could not check',
  "didn't check",
  'did not check',
  'not included',
  "wasn't reached",
  'not reached',
  'no data for',
  'no information',
  "don't have",
  'do not have',
  "doesn't have",
  'does not have',
  'not available',
  "isn't available",
  'caveat',
  'keep in mind',
  'according to',
  'based on',
].map((text) => literal('hedge', text));

/** The packs — closed and frozen. An app's own phrases are a later door (PR 5). */
export const NEGATIVE_CLAIM_PHRASES: NegativeClaimPhrasePacks = Object.freeze({
  none: Object.freeze([...NONE]),
  complete: Object.freeze([...COMPLETE]),
  unbounded: Object.freeze([...UNBOUNDED]),
  source: Object.freeze([...SOURCE]),
  window: Object.freeze([...WINDOW]),
  hedge: Object.freeze([...HEDGE]),
});

/** sha256 of the packs' stable JSON — what a measured number names. */
export const NEGATIVE_CLAIM_PHRASES_HASH: string = sha256Hex(
  stableJson(NEGATIVE_CLAIM_PHRASES) ?? '',
);
