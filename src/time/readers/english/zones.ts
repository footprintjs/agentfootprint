import { zoneOfPlace } from '../../zone.js';
import type { Atom } from './types.js';

/** Closed recognition policy; every token is returned as written, never mapped. */
const ZONE_WORDS = {
  anyCase: ['EST', 'EDT', 'CST', 'CDT', 'MST', 'MDT', 'PST', 'PDT', 'UTC', 'GMT'],
  capitals: [
    'PT',
    'MT',
    'CT',
    'ET',
    'AKST',
    'AKDT',
    'HST',
    'AST',
    'ADT',
    'NST',
    'NDT',
    'BST',
    'IST',
    'CET',
    'CEST',
    'EET',
    'EEST',
    'WET',
    'WEST',
    'MSK',
    'JST',
    'KST',
    'HKT',
    'SGT',
    'AEST',
    'AEDT',
    'ACST',
    'ACDT',
    'AWST',
    'NZST',
    'NZDT',
    'SAST',
  ],
  regional: ['Eastern', 'Central', 'Mountain', 'Pacific'],
} as const;

/** Case folding applies only to the finite words above, not the whole zone grammar. */
const anyCase = (word: string): string =>
  [...word].map((letter) => `[${letter.toLowerCase()}${letter.toUpperCase()}]`).join('');
const regional = `(?:${ZONE_WORDS.regional.map(anyCase).join('|')})`;
const capitalized = ZONE_WORDS.regional.map((word) => word[0] + anyCase(word.slice(1))).join('|');
const timeWord = anyCase('time');
const zoneWord = anyCase('zone');
// Keep “time zone” as the correction wrapper; otherwise “time” belongs to the token.
const REGIONAL_WORD =
  `(?:${regional}\\s+${timeWord}(?!\\s+${zoneWord}\\b)` +
  `|${regional}(?=\\s+${timeWord}\\s+${zoneWord}\\b)|${capitalized})`;
const ABBREVIATION = `(?:${ZONE_WORDS.anyCase.map(anyCase).join('|')}|${ZONE_WORDS.capitals.join(
  '|',
)})`;
const IANA_AREAS =
  'Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc';
/** Attached unknown places stay tokens; whole corrections separately require a real place. */
const PLACE_TIME = '(?<placeName>[A-Z][a-z]+(?:[ -][A-Z][a-z]+){0,2})\\s+[Tt]ime';

/** A zone right after a phrase: optional `(`, or `in`, then its token and optional `)`. */
const ZONE_AFTER = new RegExp(
  '^(?<lead>\\s*\\(?\\s*|\\s+in\\s+)' +
    `(?:(?<iana>(?:${IANA_AREAS})/[A-Za-z0-9_+-]+(?:/[A-Za-z0-9_+-]+)?)` +
    `|(?:${anyCase('UTC')}|${anyCase('GMT')})\\s?(?<offset>[+-]\\d{1,2}(?::?\\d{2})?)` +
    `|(?<regional>${REGIONAL_WORD})` +
    `|(?<abbreviation>${ABBREVIATION})` +
    `|(?<place>${PLACE_TIME}))(?![A-Za-z0-9_/])(?<close>\\s*\\))?`,
);

/** The ONE lexical zone match, shared by attached zones and whole corrections. */
function zoneAtStart(
  text: string,
): { readonly token: string; readonly consumed: number; readonly place?: string } | undefined {
  const m = ZONE_AFTER.exec(text);
  if (m === null || m.groups === undefined) return undefined;
  const { lead, iana, offset, regional, place, placeName, abbreviation, close } = m.groups;
  if ((lead as string).includes('(') !== (close !== undefined)) return undefined;
  return {
    token: iana ?? offset ?? regional ?? abbreviation ?? (place as string),
    consumed: m[0].length,
    ...(placeName !== undefined && { place: placeName }),
  };
}

// Affirmative wrapper grammar, not a rejection-phrase list. Every character
// after it must be the same lexical zone plus the optional “time zone” suffix.
const CORRECTION_PREFIX =
  /^(?:no,\s*)?(?:please\s+)?(?:(?:(?:show|present|display)\s+(?:it|(?:the\s+)?(?:range|time|window|results))\s+)?in\s+)?/i;
const CORRECTION_SUFFIX = /^(?:\s+time\s+zone)?\s*\.?\s*$/i;

/**
 * A complete affirmative zone-only reply, without interpreting the token.
 * Unsupported wrappers, negation, multiple zones or leftover words return
 * no reading. Internal English facade port, not a new public package export.
 */
export function readEnglishZoneCorrection(text: string): string | undefined {
  if (text.length === 0 || text.length > 4096) return undefined;
  const clean = text.trim();
  const prefix = CORRECTION_PREFIX.exec(clean)?.[0] ?? '';
  const remaining = clean.slice(prefix.length);
  const zone = zoneAtStart(remaining);
  if (zone === undefined || !CORRECTION_SUFFIX.test(remaining.slice(zone.consumed)))
    return undefined;
  // A generic capitalized phrase is not evidence of a place (for example “Wrong time”).
  // This shared lookup qualifies it only; the written token is still never mapped here.
  if (zone.place !== undefined && zoneOfPlace(zone.place) === undefined) return undefined;
  return zone.token;
}

/**
 * A zone written right after a date, a time or a day word joins that
 * phrase, as written. The resolver decides whether it interprets a civil
 * time or displays elapsed instants: neither may silently drop a stated zone.
 */
export function attachZone(text: string, atom: Atom): void {
  if (atom.kind === 'bare') return;
  if (atom.zoneToken !== undefined) return;
  const zone = zoneAtStart(text.slice(atom.end));
  if (zone === undefined) return;
  // Shared lexical selection retains the written name/word or offset; interpretation stays outside.
  atom.zoneToken = zone.token;
  atom.end += zone.consumed;
}
