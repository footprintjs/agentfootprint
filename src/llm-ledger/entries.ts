/**
 * llm-ledger/entries — the one check of an entry's shape.
 *
 * Pattern: one table of shapes (`SHAPES`), one check (`entryFault`). Every
 *          entry a store admits passes it, on append and again on load; the
 *          builders in `build.ts` make entries that pass it by construction.
 * Role:    the closed leaf's entries, plus the two judgement helpers the later
 *          stages call: `isIncomplete` and `citeProblem`.
 * Emits:   N/A.
 *
 * The check is context-free: it sees one entry, never the session. A
 * reference to another entry (a cite, a claim, `submit`, `note`, `restsOn`)
 * must be to an EARLIER seq; whether that entry is of the right kind is the
 * session's question (`citeProblem`, and the later stages).
 *
 * ## Who writes what
 *
 * | kind | by / how |
 * |---|---|
 * | `opened`, `supplied`, `delivered` | host / observed |
 * | `receipt` | host / observed or reported (the host's statement) |
 * | `note` | agent / observed, or host / reported (the host noting for the agent) |
 * | `withdrawal`, `submit` | agent / observed |
 * | `check` | ledger / observed |
 * | `released` | person / reported |
 */
import { isDigest } from './digest.js';
import { LEDGER_LIMITS as L } from './limits.js';
import { isToken } from './tokens.js';
import type { LedgerEntry, LedgerKind, LedgerReceipt } from './types.js';
import { isUtcInstant, readWindow } from './window.js';

// ── field checks ─────────────────────────────────────────────────────────

/** Unicode code points of a well-formed string. */
export function chars(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0xdc00 || c > 0xdfff) n++;
  }
  return n;
}

/** No lone surrogate: a string every encoder writes back unchanged. */
export function wellFormed(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}

/** Whether `s` holds a C0 or C1 control character: refused in names (`source`, `externalId`, `ref.uri`). */
export function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}
const BUILT_IN_RULE = /^[a-z][a-z0-9-]{1,47}@[1-9][0-9]{0,8}$/;
const HOST_RULE = /^[a-z][a-z0-9-]{1,31}\/[a-z][a-z0-9-]{1,47}@[1-9][0-9]{0,8}$/;

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const count = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) >= 0;
export const positive = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) >= 1;
export const bool = (v: unknown): boolean => typeof v === 'boolean';
const text = (v: unknown, max: number, plain = false): boolean =>
  typeof v === 'string' &&
  v.length <= 2 * max &&
  wellFormed(v) &&
  chars(v) >= 1 &&
  chars(v) <= max &&
  (!plain || !hasControl(v));
export const oneOf = (v: unknown, words: readonly string[]): boolean =>
  typeof v === 'string' && words.includes(v);
/** A reference to an EARLIER entry of the same session. */
export const earlier = (v: unknown, seq: number): boolean => positive(v) && (v as number) < seq;
/** Earlier seqs, strictly ascending, at most `max`. */
const seqSet = (v: unknown, seq: number, max: number): boolean =>
  Array.isArray(v) &&
  v.length <= max &&
  v.every((x, i) => earlier(x, seq) && (i === 0 || (v[i - 1] as number) < (x as number)));
const tokenList = (v: unknown, max: number): boolean =>
  Array.isArray(v) && v.length <= max && v.every(isToken) && new Set(v).size === v.length;
/** A rule name as a check record and `opened.rules` store it: `id@version`. */
export const isRuleName = (v: unknown): v is string =>
  typeof v === 'string' && (BUILT_IN_RULE.test(v) || HOST_RULE.test(v));
const exactly = (v: unknown, keys: readonly string[]): v is Record<string, unknown> =>
  isObject(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));

type Field = (v: unknown, seq: number, entry: Record<string, unknown>) => boolean;
interface Shape {
  readonly writers: readonly string[];
  readonly required: Readonly<Record<string, Field>>;
  readonly optional: Readonly<Record<string, Field>>;
}

/** The nine shapes. A field not listed here is refused. */
const SHAPES: Readonly<Record<LedgerKind, Shape>> = {
  opened: {
    writers: ['host/observed'],
    required: {
      rules: (v) =>
        Array.isArray(v) &&
        v.length <= L.maxRules &&
        v.every(isRuleName) &&
        new Set(v).size === v.length,
      confirm: bool,
      askRunsRules: bool,
    },
    optional: {},
  },
  receipt: {
    writers: ['host/observed', 'host/reported'],
    required: {
      source: (v) => text(v, L.maxSourceChars, true),
      bytes: count,
      nothingFound: bool,
      tokens: (v) => tokenList(v, L.maxTokens),
    },
    optional: {
      query: (v) => text(v, L.maxQueryChars),
      window: (v) => readWindow(v) !== undefined,
      limit: (v) => exactly(v, ['rows', 'hit']) && positive(v.rows) && bool(v.hit),
      cut: (v) =>
        exactly(v, ['tokensDropped', 'bytesUnread']) &&
        count(v.tokensDropped) &&
        count(v.bytesUnread) &&
        ((v.tokensDropped as number) > 0 || (v.bytesUnread as number) > 0),
      groupedNumbers: positive,
      escapedPieces: positive,
      hidden: positive,
      ref: (v) =>
        exactly(v, ['uri', 'digest']) && text(v.uri, L.maxRefUriChars, true) && isDigest(v.digest),
      externalId: (v) => text(v, L.maxExternalIdChars, true),
    },
  },
  supplied: {
    writers: ['host/observed'],
    required: {
      from: (v) => oneOf(v, ['person', 'app', 'system']),
      tokens: (v) => tokenList(v, L.maxTokens),
      bytes: (v) => count(v) && (v as number) <= L.maxTextBytes,
      digest: isDigest,
    },
    optional: {},
  },
  note: {
    writers: ['agent/observed', 'host/reported'],
    required: {
      noteKind: (v) => oneOf(v, ['claim', 'ruled-out', 'question']),
      text: (v) => text(v, L.maxNoteChars),
      cites: (v, seq) => seqSet(v, seq, L.maxCites),
    },
    optional: {
      values: (v) =>
        Array.isArray(v) &&
        v.length >= 1 &&
        v.length <= L.maxValues &&
        v.every((x) => text(x, L.maxValueChars)),
      window: (v) => readWindow(v) !== undefined,
    },
  },
  withdrawal: {
    writers: ['agent/observed'],
    required: { note: earlier, why: (v) => text(v, L.maxWhyChars) },
    optional: {},
  },
  submit: {
    writers: ['agent/observed'],
    required: {
      claims: (v, seq) =>
        Array.isArray(v) &&
        v.length <= L.maxClaims &&
        v.every((x) => earlier(x, seq)) &&
        new Set(v).size === v.length,
      draftDigest: isDigest,
      draftBytes: (v) => count(v) && (v as number) <= L.maxDraftBytes,
    },
    optional: {},
  },
  check: {
    writers: ['ledger/observed'],
    required: {
      submit: earlier,
      subject: (v, seq) =>
        (exactly(v, ['note']) && earlier(v.note, seq)) ||
        (exactly(v, ['draft']) && v.draft === true),
      rule: isRuleName,
      disposition: (v, _seq, e) =>
        (v === 'not-applicable' && e.verdict === undefined) ||
        (v === 'checked-pass' &&
          (e.verdict === 'verified' || e.verdict === 'consistent-with-reported')) ||
        (v === 'checked-fail' && e.verdict === 'unsupported') ||
        (v === 'unreachable' && e.verdict === 'open'),
      restsOn: (v, seq) => seqSet(v, seq, L.maxEntries),
      counts: (v) =>
        exactly(v, ['visible', 'missing', 'supplied', 'incomplete']) &&
        count(v.visible) &&
        count(v.missing) &&
        count(v.supplied) &&
        count(v.incomplete),
    },
    optional: {
      verdict: (v) => oneOf(v, ['verified', 'consistent-with-reported', 'unsupported', 'open']),
      decision: (_v, _seq, e) => isObject(e.decision) && e.why === undefined,
      missing: (v, _seq, e) =>
        tokenList(v, L.maxMissing) &&
        isObject(e.counts) &&
        (v as string[]).length <= (e.counts.missing as number),
      why: (v, _seq, e) =>
        oneOf(v, ['rule-threw', 'rule-timeout', 'bad-result']) && e.disposition === 'unreachable',
    },
  },
  released: {
    writers: ['person/reported'],
    required: { submit: earlier, answer: (v) => oneOf(v, ['release', 'withhold']) },
    optional: { why: (v, _seq, e) => v === 'no-person-channel' && e.answer === 'withhold' },
  },
  delivered: {
    writers: ['host/observed'],
    required: {
      digest: isDigest,
      bytes: count,
      submit: (v, seq) => v === null || earlier(v, seq),
      matches: (v, _seq, e) => bool(v) && (v === false || e.submit !== null),
    },
    optional: {},
  },
};

const BASE = ['v', 'seq', 'kind', 'by', 'how', 'at'];

/**
 * `undefined` when `value` is an entry of one of the nine shapes, else the
 * name of the first field that is wrong — a fixed word from the shapes,
 * never a value and never a key the caller wrote (`'unknown-field'`).
 * `value` is plain data (what `JSON.parse` gives).
 */
export function entryFault(value: unknown): string | undefined {
  if (!isObject(value)) return 'entry';
  if (value.v !== 1) return 'v';
  if (!positive(value.seq)) return 'seq';
  const seq = value.seq as number;
  // Strings first, before any lookup: an array would pass `Object.hasOwn` and a template string
  // (`['opened']` reads as `'opened'`), and so would let a second `opened` in.
  if (typeof value.kind !== 'string' || !Object.hasOwn(SHAPES, value.kind)) return 'kind';
  const shape = SHAPES[value.kind as LedgerKind];
  if (typeof value.by !== 'string' || typeof value.how !== 'string') return 'by';
  if (!shape.writers.includes(`${value.by}/${value.how}`)) return 'by';
  if (!isUtcInstant(value.at)) return 'at';
  for (const key of Object.keys(value)) {
    if (
      !BASE.includes(key) &&
      !Object.hasOwn(shape.required, key) &&
      !Object.hasOwn(shape.optional, key)
    )
      return 'unknown-field'; // never the key itself: a key is the caller's text
  }
  for (const [key, ok] of Object.entries(shape.required)) {
    if (!Object.hasOwn(value, key) || !ok(value[key], seq, value)) return key;
  }
  for (const [key, ok] of Object.entries(shape.optional)) {
    if (Object.hasOwn(value, key) && !ok(value[key], seq, value)) return key;
  }
  return undefined;
}

// ── judgement helpers the later stages call ──────────────────────────────

/**
 * A receipt is incomplete when it was cut, when it holds numbers written with thousands
 * separators or pieces next to a backslash that read two ways (values no token shows), when the
 * host masked values, or when its row limit was hit.
 */
export function isIncomplete(receipt: LedgerReceipt): boolean {
  const cut = receipt.cut;
  return (
    (cut !== undefined && (cut.tokensDropped > 0 || cut.bytesUnread > 0)) ||
    (receipt.groupedNumbers ?? 0) > 0 ||
    (receipt.escapedPieces ?? 0) > 0 ||
    (receipt.hidden ?? 0) > 0 ||
    receipt.limit?.hit === true
  );
}

/**
 * Why `cites` cannot stand in this session's `log` (entries 1…n, in order),
 * or `undefined`: each cite must be the seq of a receipt. The first bad cite
 * decides. A note with no cites is admitted here and judged at submit.
 */
export function citeProblem(
  log: readonly LedgerEntry[],
  cites: readonly number[],
): 'unknown-receipt' | 'not-a-receipt' | undefined {
  for (const cite of cites) {
    if (!positive(cite) || cite > log.length) return 'unknown-receipt';
    if ((log[cite - 1] as LedgerEntry).kind !== 'receipt') return 'not-a-receipt';
  }
  return undefined;
}

/** Freeze a plain value and everything under it. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
