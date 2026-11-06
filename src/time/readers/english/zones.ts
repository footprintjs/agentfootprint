import type { Atom } from './types.js';

/** Zone abbreviations the reader TOKENIZES after a time or a date — never maps (§ 5.3). */
const ZONE_ABBREVIATIONS = [
  'UTC', 'GMT', 'PST', 'PDT', 'PT', 'MST', 'MDT', 'MT', 'CST', 'CDT', 'CT', 'EST', 'EDT', 'ET',
  'AKST', 'AKDT', 'HST', 'AST', 'ADT', 'NST', 'NDT', 'BST', 'IST', 'CET', 'CEST', 'EET', 'EEST',
  'WET', 'WEST', 'MSK', 'JST', 'KST', 'HKT', 'SGT', 'AEST', 'AEDT', 'ACST', 'ACDT', 'AWST',
  'NZST', 'NZDT', 'SAST',
] as const; // prettier-ignore

const IANA_AREAS =
  'Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc';
/**
 * A place named with the word `time` — `London time`, `New York time` — kept
 * as written: which zone it names is `resolve.ts`'s (the tz database's one
 * zone for the place, else asked). Capitalised words only, so `the same
 * time` is no zone.
 */
const PLACE_TIME = '[A-Z][a-z]+(?:[ -][A-Z][a-z]+){0,2}\\s+[Tt]ime';

/** A zone right after a phrase: optional `(`, or `in`, then the token (and a closing `)`). */
const ZONE_AFTER = new RegExp(
  '^(?<lead>\\s*\\(?\\s*|\\s+in\\s+)' +
    `(?:(?<iana>(?:${IANA_AREAS})/[A-Za-z0-9_+-]+(?:/[A-Za-z0-9_+-]+)?)` +
    '|(?:UTC|GMT)\\s?(?<offset>[+-]\\d{1,2}(?::?\\d{2})?)' +
    `|(?<place>${PLACE_TIME})` +
    `|(?<abbreviation>${ZONE_ABBREVIATIONS.join('|')}))(?![A-Za-z0-9_/])(?<close>\\s*\\))?`,
);

/**
 * A zone written right after a date, a time or a day word joins that
 * phrase, as written. The resolver decides whether it interprets a civil
 * time or displays elapsed instants: neither may silently drop a stated zone.
 */
export function attachZone(text: string, atom: Atom): void {
  if (atom.kind === 'bare') return;
  if (atom.zoneToken !== undefined) return;
  const m = ZONE_AFTER.exec(text.slice(atom.end));
  if (m === null || m.groups === undefined) return;
  const { lead, iana, offset, place, abbreviation, close } = m.groups;
  if ((lead as string).includes('(') !== (close !== undefined)) return;
  // The IANA name, else the offset after `UTC` / `GMT`, else the place, else the abbreviation — each verbatim.
  const token = iana ?? offset ?? place ?? (abbreviation as string);
  atom.zoneToken = token;
  atom.end += m[0].length;
}
