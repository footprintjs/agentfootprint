/**
 * llm-ledger/build — the builders that make entries at record time, where text enters the ledger.
 *
 * Pattern: one builder per kind that text enters through. A builder reads its
 *          input field by field (own data properties only — a getter is never
 *          called, an unknown field is refused), answers a refusal with a
 *          closed word, and DROPS every text it was handed once it has the
 *          tokens or the digest it keeps. What it returns passes
 *          `entries.ts` · `entryFault` by construction (checked again here,
 *          and again by both stores).
 * Role:    the closed leaf's record-time half: the later stages call these
 *          and append what they make.
 * Emits:   N/A.
 *
 * ## Never stored
 *
 * The text of a read or of a supplied value (only its tokens, its byte count
 * and — for a supplied value — its digest); the draft and the delivered text
 * (a digest and a byte count). A note's text and values are kept as the agent
 * wrote them: they are the agent's own words, and the only free text an agent
 * puts in the log.
 *
 * ## Refusals
 *
 * `bad-input` for a field of the wrong type, an unknown field, a text that is
 * not well-formed Unicode or a reference that is not to an earlier entry;
 * `too-large` past a cap of `limits.ts`; `bad-window` for a window
 * `window.ts` · `readWindow` refuses. A receipt over the token or byte cap is
 * NOT refused: it keeps what fits and says what it left out (`cut`). A
 * supplied value has no `cut`, so one that would be cut is refused whole.
 */
import { digestOf, isDigest } from './digest.js';
import {
  bool,
  chars,
  count,
  deepFreeze,
  earlier,
  entryFault,
  hasControl,
  isObject,
  isRuleName,
  oneOf,
  positive,
  wellFormed,
} from './entries.js';
import { LEDGER_LIMITS as L } from './limits.js';
import { readTokens, tokensOf, utf8Bytes } from './tokens.js';
import type {
  LedgerClaimStanding,
  LedgerDelivered,
  LedgerEntry,
  LedgerNote,
  LedgerNoteKind,
  LedgerOpened,
  LedgerReceipt,
  LedgerSubmit,
  LedgerSupplied,
  LedgerSupplier,
  LedgerWithdrawal,
} from './types.js';
import { isUtcInstant, readWindow } from './window.js';

/** Where an entry goes: its number and the host's clock (RFC 3339 UTC). */
export interface LedgerStamp {
  readonly seq: number;
  readonly at: string;
}

/** A built entry, or the closed word a builder refused with. */
export type LedgerBuilt<E extends LedgerEntry> =
  | { readonly ok: true; readonly entry: E }
  | { readonly ok: false; readonly refused: 'bad-input' | 'too-large' | 'bad-window' };

/** Thrown inside a builder, caught at its edge: never leaves this file. */
class Refusal {
  constructor(readonly word: 'bad-input' | 'too-large' | 'bad-window') {}
}

/** The own data fields of a plain input object, refusing any key outside `allowed`. */
function fieldsOf(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isObject(input)) throw new Refusal('bad-input');
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) throw new Refusal('bad-input');
  const out: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !allowed.includes(key)) throw new Refusal('bad-input');
    const field = Object.getOwnPropertyDescriptor(input, key) as PropertyDescriptor;
    if (!('value' in field)) throw new Refusal('bad-input');
    if (field.value !== undefined) out[key] = field.value;
  }
  return out;
}

/** A string field: `bad-input` when it is not one, `too-large` past `max` characters. */
function textField(v: unknown, max: number, plain = false): string {
  if (typeof v !== 'string' || !wellFormed(v) || v.length === 0) throw new Refusal('bad-input');
  if (plain && hasControl(v)) throw new Refusal('bad-input');
  if (v.length > 2 * max || chars(v) > max) throw new Refusal('too-large');
  return v;
}

/** A dense array of at most `max` items, read by index — never iterated through a getter. */
function listField(v: unknown, max: number): unknown[] {
  if (!Array.isArray(v)) throw new Refusal('bad-input');
  if (v.length > max) throw new Refusal('too-large');
  const out: unknown[] = [];
  for (let i = 0; i < v.length; i++) {
    const item = Object.getOwnPropertyDescriptor(v, i);
    if (item === undefined || !('value' in item)) throw new Refusal('bad-input');
    out.push(item.value);
  }
  return out;
}

/** Earlier seqs as a set: sorted and unique. */
function seqsField(v: unknown, seq: number, max: number): number[] {
  const seqs = listField(v, max).map((x) => {
    if (!earlier(x, seq)) throw new Refusal('bad-input');
    return x as number;
  });
  return [...new Set(seqs)].sort((a, b) => a - b);
}

function windowField(v: unknown): LedgerReceipt['window'] {
  const window = readWindow(v);
  if (window === undefined) throw new Refusal('bad-window');
  return window;
}

/** The stamp's own check: a positive seq and a UTC instant. */
function stamped(stamp: LedgerStamp): { v: 1; seq: number; at: string } {
  const fields = fieldsOf(stamp, ['seq', 'at']);
  if (!positive(fields.seq) || !isUtcInstant(fields.at)) throw new Refusal('bad-input');
  return { v: 1, seq: fields.seq as number, at: fields.at as string };
}

/** Run a builder body; a refusal becomes its word, and the result is checked against its shape. */
function built<E extends LedgerEntry>(make: () => E): LedgerBuilt<E> {
  try {
    const entry = make();
    // Defence in depth: a builder that drifts from its shape is a bug, said loudly.
    if (entryFault(entry) !== undefined)
      throw new TypeError('llm-ledger: a builder made an entry its shape refuses');
    return { ok: true, entry: deepFreeze(entry) };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, refused: error.word };
    throw error;
  }
}

async function builtAsync<E extends LedgerEntry>(
  make: () => Promise<() => E>,
): Promise<LedgerBuilt<E>> {
  try {
    const finish = await make();
    return built(finish);
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, refused: error.word };
    throw error;
  }
}

/** The first entry of a session. */
export function openedEntry(
  stamp: LedgerStamp,
  input: {
    readonly rules?: readonly string[];
    readonly confirm?: boolean;
    readonly askRunsRules?: boolean;
  },
): LedgerBuilt<LedgerOpened> {
  return built(() => {
    const f = fieldsOf(input, ['rules', 'confirm', 'askRunsRules']);
    const rules = f.rules === undefined ? [] : listField(f.rules, L.maxRules);
    if (!rules.every(isRuleName) || new Set(rules).size !== rules.length)
      throw new Refusal('bad-input');
    for (const flag of [f.confirm, f.askRunsRules])
      if (flag !== undefined && !bool(flag)) throw new Refusal('bad-input');
    return {
      ...stamped(stamp),
      kind: 'opened',
      by: 'host',
      how: 'observed',
      rules: rules as string[],
      confirm: f.confirm === true,
      askRunsRules: f.askRunsRules === true,
    };
  });
}

/** What the host wants recorded of one read. `text` is read for tokens, then dropped. */
export interface LedgerRecordInput {
  readonly source: string;
  readonly text: string;
  readonly how?: 'observed' | 'reported';
  readonly query?: string;
  readonly window?: { readonly from: string; readonly to: string };
  readonly limit?: { readonly rows: number; readonly hit: boolean };
  readonly nothingFound?: boolean;
  readonly hidden?: number;
  readonly ref?: { readonly uri: string; readonly digest: string };
  readonly externalId?: string;
}

/** A receipt: the read's capped tokens and its facts, never its text. */
export function receiptEntry(
  stamp: LedgerStamp,
  input: LedgerRecordInput,
): LedgerBuilt<LedgerReceipt> {
  return built(() => {
    const f = fieldsOf(input, [
      'source',
      'text',
      'how',
      'query',
      'window',
      'limit',
      'nothingFound',
      'hidden',
      'ref',
      'externalId',
    ]);
    if (typeof f.text !== 'string') throw new Refusal('bad-input');
    if (f.how !== undefined && f.how !== 'observed' && f.how !== 'reported')
      throw new Refusal('bad-input');
    if (f.nothingFound !== undefined && !bool(f.nothingFound)) throw new Refusal('bad-input');
    if (f.hidden !== undefined && !count(f.hidden)) throw new Refusal('bad-input');
    const entry: Record<string, unknown> = {
      ...stamped(stamp),
      kind: 'receipt',
      by: 'host',
      how: f.how ?? 'observed',
      source: textField(f.source, L.maxSourceChars, true),
    };
    if (f.query !== undefined) entry.query = textField(f.query, L.maxQueryChars);
    if (f.window !== undefined) entry.window = windowField(f.window);
    if (f.limit !== undefined) {
      const limit = fieldsOf(f.limit, ['rows', 'hit']);
      if (!positive(limit.rows) || !bool(limit.hit)) throw new Refusal('bad-input');
      entry.limit = { rows: limit.rows, hit: limit.hit };
    }
    const reading = readTokens(f.text);
    entry.bytes = reading.bytes;
    entry.nothingFound = f.nothingFound === true;
    entry.tokens = [...reading.tokens];
    if (reading.cut !== undefined) entry.cut = { ...reading.cut };
    if (reading.groupedNumbers !== undefined) entry.groupedNumbers = reading.groupedNumbers;
    if (reading.escapedPieces !== undefined) entry.escapedPieces = reading.escapedPieces;
    if ((f.hidden as number | undefined) !== undefined && (f.hidden as number) > 0)
      entry.hidden = f.hidden;
    if (f.ref !== undefined) {
      const ref = fieldsOf(f.ref, ['uri', 'digest']);
      if (!isDigest(ref.digest)) throw new Refusal('bad-input');
      entry.ref = { uri: textField(ref.uri, L.maxRefUriChars, true), digest: ref.digest };
    }
    if (f.externalId !== undefined)
      entry.externalId = textField(f.externalId, L.maxExternalIdChars, true);
    return entry as unknown as LedgerReceipt;
  });
}

/** A digest-compared text: well formed, at most `maxBytes`. */
function comparedText(v: unknown, maxBytes: number): string {
  if (typeof v !== 'string' || !wellFormed(v)) throw new Refusal('bad-input');
  if (v.length > maxBytes || utf8Bytes(v) > maxBytes) throw new Refusal('too-large');
  return v;
}

/** A value the person, the app or the system gave: tokens and a digest, never the text. Host only. */
export function suppliedEntry(
  stamp: LedgerStamp,
  input: { readonly from: LedgerSupplier; readonly text: string },
): Promise<LedgerBuilt<LedgerSupplied>> {
  return builtAsync(async () => {
    const f = fieldsOf(input, ['from', 'text']);
    if (!oneOf(f.from, ['person', 'app', 'system'])) throw new Refusal('bad-input');
    const supplied = comparedText(f.text, L.maxTextBytes);
    const tokens = tokensOf(supplied);
    // A supplied entry has no `cut`: a value that would be cut is refused whole.
    if (tokens.length > L.maxTokens || tokens.some((t) => t.length > L.maxTokenChars))
      throw new Refusal('too-large');
    const base = stamped(stamp);
    const digest = await digestOf(supplied);
    const bytes = utf8Bytes(supplied);
    return () => ({
      ...base,
      kind: 'supplied',
      by: 'host',
      how: 'observed',
      from: f.from as LedgerSupplier,
      tokens,
      bytes,
      digest,
    });
  });
}

/** What the agent notes. `by: 'host'` is the host noting for the agent (`how: 'reported'`). */
export function noteEntry(
  stamp: LedgerStamp,
  input: {
    readonly kind: LedgerNoteKind;
    readonly claimStanding?: LedgerClaimStanding;
    readonly text: string;
    readonly values?: readonly string[];
    readonly window?: { readonly from: string; readonly to: string };
    readonly cites: readonly number[];
  },
  by: 'agent' | 'host' = 'agent',
): LedgerBuilt<LedgerNote> {
  return built(() => {
    const f = fieldsOf(input, ['kind', 'text', 'values', 'window', 'cites', 'claimStanding']);
    const base = stamped(stamp);
    if (!oneOf(f.kind, ['claim', 'ruled-out', 'question'])) throw new Refusal('bad-input');
    const entry: Record<string, unknown> = {
      ...base,
      kind: 'note',
      by,
      how: by === 'agent' ? 'observed' : 'reported',
      noteKind: f.kind,
      text: textField(f.text, L.maxNoteChars),
    };
    if (f.claimStanding !== undefined) {
      if (f.kind === 'question' || !oneOf(f.claimStanding, ['sure', 'qualified']))
        throw new Refusal('bad-input');
      entry.claimStanding = f.claimStanding;
    }
    if (f.values !== undefined) {
      const values = listField(f.values, L.maxValues).map((v) => textField(v, L.maxValueChars));
      if (values.length > 0) entry.values = values;
    }
    if (f.window !== undefined) entry.window = windowField(f.window);
    entry.cites = seqsField(f.cites, base.seq, L.maxCites);
    return entry as unknown as LedgerNote;
  });
}

/** The agent takes a note back, saying why. */
export function withdrawalEntry(
  stamp: LedgerStamp,
  input: { readonly note: number; readonly why: string },
): LedgerBuilt<LedgerWithdrawal> {
  return built(() => {
    const f = fieldsOf(input, ['note', 'why']);
    const base = stamped(stamp);
    if (!earlier(f.note, base.seq)) throw new Refusal('bad-input');
    const why = textField(f.why, L.maxWhyChars);
    return {
      ...base,
      kind: 'withdrawal',
      by: 'agent',
      how: 'observed',
      note: f.note as number,
      why,
    };
  });
}

/** The agent's draft, as a digest and a size, and the notes it names, in its order. */
export function submitEntry(
  stamp: LedgerStamp,
  input: { readonly draft: string; readonly claims: readonly number[] },
): Promise<LedgerBuilt<LedgerSubmit>> {
  return builtAsync(async () => {
    const f = fieldsOf(input, ['draft', 'claims']);
    const base = stamped(stamp);
    const draft = comparedText(f.draft, L.maxDraftBytes);
    const claims = [...new Set(listField(f.claims, L.maxClaims))];
    if (!claims.every((c) => earlier(c, base.seq))) throw new Refusal('bad-input');
    const draftDigest = await digestOf(draft);
    const draftBytes = utf8Bytes(draft);
    return () => ({
      ...base,
      kind: 'submit',
      by: 'agent',
      how: 'observed',
      claims: claims as number[],
      draftDigest,
      draftBytes,
    });
  });
}

/** What the host delivered, compared with the last submit's draft digest (`undefined`: no submit yet). */
export function deliveredEntry(
  stamp: LedgerStamp,
  input: { readonly text: string },
  lastSubmit: { readonly seq: number; readonly draftDigest: string } | undefined,
): Promise<LedgerBuilt<LedgerDelivered>> {
  return builtAsync(async () => {
    const f = fieldsOf(input, ['text']);
    const base = stamped(stamp);
    if (typeof f.text !== 'string' || !wellFormed(f.text)) throw new Refusal('bad-input');
    const delivered = f.text;
    const digest = await digestOf(delivered);
    const bytes = utf8Bytes(delivered);
    const submit = lastSubmit === undefined ? null : lastSubmit.seq;
    const matches = lastSubmit !== undefined && lastSubmit.draftDigest === digest;
    return () => ({
      ...base,
      kind: 'delivered',
      by: 'host',
      how: 'observed',
      digest,
      bytes,
      submit,
      matches,
    });
  });
}
