import { fixedOffsetZone, isZoneName, zoneOfPlace, type ZoneName } from '../zone.js';
import {
  offsetOfToken,
  type TimePolicy,
  type ZoneAbbreviation,
  type TimeNote,
  type ReadingTags,
} from '../resolveRecord.js';

// ─── Zones ───────────────────────────────────────────────────────────────

/** How a zone read from words got there, when the words were no zone name (`London time`, `PST`). */
export interface ZoneVia {
  readonly token: string;
  readonly as: 'place' | 'abbreviation' | 'abbreviation-literal';
}

export type ZoneRead =
  | {
      readonly kind: 'iana';
      readonly zone: ZoneName;
      readonly said: boolean;
      readonly via?: ZoneVia;
    }
  | {
      readonly kind: 'offset';
      readonly minutes: number;
      readonly spelled: string;
      readonly via?: ZoneVia;
      /** The zone a window read at this offset is presented in — absent: the clock's. */
      readonly shownIn?: ZoneName;
    };

/**
 * `London time`, `New York time` — a place named with the word `time` (the
 * reader keeps it as written): `/^(.+?)\s+time$/i.exec(token)?.[1]`, in one
 * pass. That regex grew its lazy place one character at a time and, at each,
 * re-read the blank run after it looking for `time` — quadratic on a letter, a
 * long blank run and anything but `time`, and a token can come straight from
 * the message. The place is everything before the blank run that ends just
 * before `time` (at least one character), and holds no line break, which `.`
 * would not match.
 */
export function placeBeforeTime(token: string): string | undefined {
  const timeAt = token.length - 4;
  if (timeAt < 2 || !spellsTimeAt(token, timeAt)) return undefined;
  let blankStart = timeAt;
  while (blankStart > 0 && isRegExpWhitespace(token.charCodeAt(blankStart - 1))) blankStart--;
  const placeEnd = Math.max(blankStart, 1);
  if (placeEnd >= timeAt) return undefined;
  for (let at = 0; at < placeEnd; at++) {
    if (isLineBreak(token.charCodeAt(at))) return undefined;
  }
  return token.slice(0, placeEnd);
}

/** `time`, in any ASCII case, at `at`. */
function spellsTimeAt(token: string, at: number): boolean {
  const word = 'time';
  for (let i = 0; i < word.length; i++) {
    if ((token.charCodeAt(at + i) | 0x20) !== word.charCodeAt(i)) return false;
  }
  return true;
}

// `lib/linearText.ts` · `isRegExpWhitespace` / `isLineBreak`, restated because
// this folder imports nothing outside itself. Both are pinned on every UTF-16
// code unit through `placeBeforeTime` in `test/security/linear-scanners.test.ts`.

/** `\s`: WhiteSpace and LineTerminator. */
function isRegExpWhitespace(code: number): boolean {
  if (code <= 0x20) return code === 0x20 || (code >= 0x09 && code <= 0x0d);
  if (code < 0xa0) return false;
  return (
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/** What `.` does not match: LF, CR, U+2028, U+2029. */
function isLineBreak(code: number): boolean {
  return code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029;
}

/** The policy half the resolver reads: the app's abbreviation map. */
export type ZonePolicy = Pick<TimePolicy, 'abbreviations'>;

/**
 * The app's entry for an abbreviation token — looked up by OWN key only. A
 * token is whatever a reader returned (a `model` or custom reader may pass
 * `constructor` or `__proto__` straight from the message), and the map is a
 * plain object, so an inherited member must read as "not in the map" — the
 * zone is then asked, never thrown on.
 */
function abbreviationOf(
  policy: ZonePolicy | undefined,
  token: string,
): ZoneAbbreviation | undefined {
  const map = policy?.abbreviations;
  return map !== undefined && Object.prototype.hasOwnProperty.call(map, token)
    ? map[token]
    : undefined;
}

/**
 * Every zone reading of a token — one, or TWO for an abbreviation in the
 * app's map (its zone, then its literal offset) — or `undefined` when the
 * token names no zone this layer can read, so the zone is ASKED. The one
 * owner of which words become a zone (§ 5.3): an IANA name and a numeric
 * offset as said; a place named with `time` only when the tz database has
 * exactly one zone for it (`zone.ts` · `zoneOfPlace`); an abbreviation only
 * through the app's map. Nothing else — never a hand word list.
 */
export function zoneReadsOf(
  token: string | undefined,
  clockZone: ZoneName,
  policy: ZonePolicy | undefined,
): ZoneRead[] | undefined {
  if (token === undefined) return [{ kind: 'iana', zone: clockZone, said: false }];
  if (isZoneName(token)) return [{ kind: 'iana', zone: token, said: true }];
  if (token === 'Z') return [{ kind: 'offset', minutes: 0, spelled: 'Z' }];
  const offset = offsetOfToken(token);
  if (offset !== undefined) return [{ kind: 'offset', ...offset }];
  const mapped = abbreviationOf(policy, token);
  if (mapped !== undefined) {
    const literal = offsetOfToken(mapped.offset);
    const reads: ZoneRead[] = [
      { kind: 'iana', zone: mapped.zone, said: true, via: { token, as: 'abbreviation' } },
    ];
    if (literal !== undefined) {
      const via: ZoneVia = { token, as: 'abbreviation-literal' };
      const fixed = fixedOffsetZone(literal.minutes);
      reads.push(
        fixed !== undefined
          ? { kind: 'iana', zone: fixed, said: true, via }
          : { kind: 'offset', ...literal, via, shownIn: mapped.zone },
      );
    }
    return reads;
  }
  const place = placeBeforeTime(token);
  const zone = place === undefined ? undefined : zoneOfPlace(place);
  if (zone !== undefined) return [{ kind: 'iana', zone, said: true, via: { token, as: 'place' } }];
  return undefined;
}

/** What a zone read adds to a point: the note naming the words, and the abbreviation's reading tag. */
export function viaOf(zone: ZoneRead): {
  notes: TimeNote[];
  tags: Pick<ReadingTags, 'abbreviation'>;
} {
  if (zone.kind === 'offset' && zone.via === undefined) {
    return { notes: [{ kind: 'offset-said', offset: zone.spelled }], tags: {} };
  }
  const via = zone.via;
  if (via === undefined) return { notes: [], tags: {} };
  const note: TimeNote = { kind: 'zone-read', token: via.token, as: via.as };
  if (via.as === 'place') return { notes: [note], tags: {} };
  return { notes: [note], tags: { abbreviation: via.as === 'abbreviation' ? 'zone' : 'literal' } };
}

/** The display zone available in the existing IANA-only candidate carrier. */
export function lookbackZoneReadsOf(
  token: string | undefined,
  clockZone: ZoneName,
  policy: ZonePolicy | undefined,
):
  | { readonly read: ZoneRead; readonly zone: ZoneName; readonly unconverted?: string }[]
  | { readonly needsZone: true; readonly reason?: string } {
  const reads = zoneReadsOf(token, clockZone, policy);
  if (reads === undefined)
    return [{ read: { kind: 'iana', zone: 'UTC', said: false }, zone: 'UTC', unconverted: token }];
  const out: { read: ZoneRead; zone: ZoneName; unconverted?: string }[] = [];
  for (const read of reads) {
    const zone = read.kind === 'iana' ? read.zone : fixedOffsetZone(read.minutes);
    if (zone === undefined) {
      out.push({
        read,
        zone: 'UTC',
        unconverted: token ?? (read.kind === 'offset' ? read.spelled : read.zone),
      });
      continue;
    }
    out.push({ read, zone });
  }
  return out;
}
