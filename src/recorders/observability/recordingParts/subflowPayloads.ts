/**
 * recordingParts/subflowPayloads — what a sub-flow invocation was handed and what it
 * handed back belong to that invocation's part, not to the base part.
 *
 * Role:  Codec. Pure. `cutPayloads` decides, at the cut, which `payload` of a
 *        `subflow.entry` / `subflow.exit` boundary event leaves the base row
 *        and how it is kept; `restorePayloads` puts every one back for a whole
 *        read; `resultValueFor` is the one place a `'same'` payload is found
 *        inside its result.
 * Reads: its arguments (plain JSON data).
 * Emits: N/A.
 *
 * ── The rule: a payload moves only on proof ─────────────────────────────────
 * An event's `payload` moves only when ALL hold:
 *   • its row is a BoundaryEvents row in full mode (`name: 'BoundaryEvents'`,
 *     `meta.mode: 'full'`) and no event of that row already holds the mark key;
 *   • the BoundaryEvents rows hold exactly ONE `subflow.entry` and at most ONE
 *     `subflow.exit` with that `runtimeStageId`, all with the index's
 *     `subflowId` for it — one recorder can be shared by a second executor,
 *     whose own counter writes the same id, so an id alone does not name the
 *     invocation; with that rule restore is keyed by (id, type);
 *   • `payload` is the event's last key (`eventBuilders.ts · buildSubflowEvent`
 *     spreads it last; the cut proves it per event);
 *   • the invocation has a part (a paused mount has none: `part: null`, and
 *     such a recording is `complete: false`, which a host refuses whole).
 * Anything else stays whole in the base and is counted, by why.
 *
 * ── How a moved payload is kept ─────────────────────────────────────────────
 *   • `'same'`: equal JSON text to the result's own value (entry:
 *     `treeContext.history[0].overwrite`, exit: `treeContext.globalContext`),
 *     the alias law used again. Nothing is stored; a whole read restores the
 *     result's own object, shared, as a proven alias is.
 *   • `'stored'`: the texts differ (a policy that selects a seeded key spells
 *     the placeholder differently on the two sides; a nested name rule; an
 *     empty seed; a resumed mount). The payload is stored in the invocation's
 *     part BESIDE its result, never inside it: the alias proof compares
 *     result text.
 *
 * ── How the base row says so ────────────────────────────────────────────────
 * A moved event loses `payload` and gains `payloadWith: 'invocation'` as its
 * last key; a row that lost one gains `meta.subflowPayloads:
 * 'with-invocation'` (appended; `meta.mode` stays `'full'`), and the index
 * lists the row's position (`subflowPayloads.rows`). Restoring touches only
 * the listed rows: it drops both and appends `payload`, so the text is exactly
 * the text before the cut. A row that arrived holding the fact key or the mark
 * key is never marked, never listed and never touched: it reads back whole.
 */

import { utf8Length } from '../../../lib/utf8.js';
import { toWireJson } from '../../../lib/wireJson.js';
import {
  assign,
  isPlainObject,
  ownValue,
  type IndexPayloadPlace,
  type IndexSubflowPayloads,
} from './format.js';
import type { WalkedInvocation } from './invocations.js';

/** The row `meta` key a base part's BoundaryEvents row gains when one of its payloads moved. */
export const SUBFLOW_PAYLOADS_META_KEY = 'subflowPayloads';
/** Its one value. */
export const SUBFLOW_PAYLOADS_WITH_INVOCATION = 'with-invocation';
/** The key a moved event carries in place of `payload`, as its last key. */
export const PAYLOAD_MARK_KEY = 'payloadWith';
/** Its one value. */
export const PAYLOAD_MARK = 'invocation';

const BOUNDARY_ROW_NAME = 'BoundaryEvents';

/** Which boundary payload: `subflow.entry`'s or `subflow.exit`'s. */
export type PayloadKind = 'entry' | 'exit';

/** One payload that left the base row. */
export interface MovedPayload {
  readonly place: IndexPayloadPlace;
  readonly value: unknown;
  /** Compact JSON text of the payload (stored payloads are written from it). */
  readonly text: string;
  readonly bytes: number;
}

/** An invocation's moved payloads. */
export interface MovedPayloads {
  entry?: MovedPayload;
  exit?: MovedPayload;
}

/** The cut's verdict over one snapshot. */
export interface PayloadCut {
  /** `snapshot.recorders` with the moved payloads replaced by marks; absent when nothing moved. */
  readonly recorders?: readonly unknown[];
  /** Per invocation key, the payloads that moved. */
  readonly moved: ReadonlyMap<string, MovedPayloads>;
  readonly counts: IndexSubflowPayloads;
}

function kindOf(type: unknown): PayloadKind | undefined {
  if (type === 'subflow.entry') return 'entry';
  if (type === 'subflow.exit') return 'exit';
  return undefined;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** An array's element at `at`, as an own data value (never a getter). */
function element(list: readonly unknown[], at: number): unknown {
  return ownValue(list as unknown as Record<string, unknown>, String(at));
}

/**
 * The result's own value a payload of `kind` is compared with and, when
 * `'same'`, restored from: `treeContext.history[0].overwrite` for an entry,
 * `treeContext.globalContext` for an exit. `undefined` when the result holds none.
 */
export function resultValueFor(result: unknown, kind: PayloadKind): unknown {
  if (!isPlainObject(result)) return undefined;
  const context = ownValue(result, 'treeContext');
  if (!isPlainObject(context)) return undefined;
  if (kind === 'exit') return ownValue(context, 'globalContext');
  const history = ownValue(context, 'history');
  if (!Array.isArray(history) || history.length === 0) return undefined;
  const first = element(history, 0);
  return isPlainObject(first) ? ownValue(first, 'overwrite') : undefined;
}

function isBoundaryRow(row: unknown): row is Record<string, unknown> {
  return (
    isPlainObject(row) &&
    ownValue(row, 'name') === BOUNDARY_ROW_NAME &&
    Array.isArray(ownValue(row, 'data'))
  );
}

/** A BoundaryEvents row in full mode whose events the cut may mark. */
function isCandidateRow(row: unknown): row is Record<string, unknown> {
  if (!isBoundaryRow(row)) return false;
  const meta = ownValue(row, 'meta');
  if (!isPlainObject(meta) || ownValue(meta, 'mode') !== 'full') return false;
  return !hasOwn(meta, SUBFLOW_PAYLOADS_META_KEY);
}

/** Whether any event of the row already holds the mark key: then no mark there is unambiguous. */
function usesMarkKey(data: readonly unknown[]): boolean {
  for (let at = 0; at < data.length; at++) {
    const event = element(data, at);
    if (isPlainObject(event) && hasOwn(event, PAYLOAD_MARK_KEY)) return true;
  }
  return false;
}

interface Tally {
  entries: number;
  exits: number;
  readonly subflowIds: Set<unknown>;
}

/** Why one sub-flow payload stays in the base row (the index's `kept` reasons), or that it may move. */
export type PayloadVerdict = 'move' | keyof IndexSubflowPayloads['kept'];

/** One payload-bearing sub-flow event and the rule's verdict on it. */
interface Classified {
  readonly rowAt: number;
  readonly at: number;
  readonly event: Record<string, unknown>;
  readonly kind: PayloadKind;
  readonly verdict: PayloadVerdict;
}

/**
 * The rule, with no value serialised: every payload-bearing sub-flow event of
 * every BoundaryEvents row, and whether it may move or why it stays. `owners`
 * maps each invocation that HAS a part to its `subflowId`. The cut runs it to
 * decide; a whole read runs it again over what it restored, to check the
 * index's claims (`payloadClaims`).
 */
function classifyPayloads(
  rows: readonly unknown[],
  owners: ReadonlyMap<string, string>,
): Classified[] {
  const candidates = new Set<number>();
  rows.forEach((row, at) => {
    if (isCandidateRow(row) && !usesMarkKey(ownValue(row, 'data') as unknown[])) {
      candidates.add(at);
    }
  });

  // Every sub-flow boundary event of every BoundaryEvents row counts for the
  // id rule, whether or not it carries a payload or its row may be marked.
  const tally = new Map<string, Tally>();
  for (const row of rows) {
    if (!isBoundaryRow(row)) continue;
    const data = ownValue(row, 'data') as unknown[];
    for (let at = 0; at < data.length; at++) {
      const event = element(data, at);
      if (!isPlainObject(event)) continue;
      const kind = kindOf(ownValue(event, 'type'));
      const id = ownValue(event, 'runtimeStageId');
      if (kind === undefined || typeof id !== 'string') continue;
      const seen = tally.get(id) ?? { entries: 0, exits: 0, subflowIds: new Set<unknown>() };
      if (kind === 'entry') seen.entries++;
      else seen.exits++;
      seen.subflowIds.add(ownValue(event, 'subflowId'));
      tally.set(id, seen);
    }
  }

  const out: Classified[] = [];
  rows.forEach((row, rowAt) => {
    if (!isBoundaryRow(row)) return;
    const data = ownValue(row, 'data') as unknown[];
    for (let at = 0; at < data.length; at++) {
      const event = element(data, at);
      if (!isPlainObject(event) || !hasOwn(event, 'payload')) continue;
      const kind = kindOf(ownValue(event, 'type'));
      if (kind === undefined) continue;
      const verdict = (v: PayloadVerdict): void =>
        void out.push({ rowAt, at, event, kind, verdict: v });
      if (!candidates.has(rowAt)) {
        // A row not in full mode, or one that already uses the mark key: no
        // mark in it could be told from the row's own data.
        verdict('notLast');
        continue;
      }
      const id = ownValue(event, 'runtimeStageId');
      const subflowId = typeof id === 'string' ? owners.get(id) : undefined;
      if (typeof id !== 'string' || subflowId === undefined) {
        verdict('noPart');
        continue;
      }
      const seen = tally.get(id);
      if (
        seen === undefined ||
        seen.entries !== 1 ||
        seen.exits > 1 ||
        seen.subflowIds.size !== 1 ||
        !seen.subflowIds.has(subflowId)
      ) {
        verdict('ambiguous');
        continue;
      }
      const keys = Object.keys(event);
      verdict(keys[keys.length - 1] !== 'payload' ? 'notLast' : 'move');
    }
  });
  return out;
}

function rowsOf(snapshot: unknown): unknown[] | undefined {
  if (!isPlainObject(snapshot)) return undefined;
  const recorders = ownValue(snapshot, 'recorders');
  if (!Array.isArray(recorders)) return undefined;
  return recorders.map((_, at) => element(recorders, at));
}

/**
 * Decide which boundary payloads leave the base row (see the file header for
 * the rule). Pure: the snapshot is not changed; the rows that change are
 * copied, every other value is shared.
 */
export function cutPayloads(
  snapshot: unknown,
  invocations: readonly WalkedInvocation[],
): PayloadCut {
  const kept = { ambiguous: 0, notLast: 0, noPart: 0 };
  const totals = { same: 0, stored: 0, restoredBytes: 0 };
  const moved = new Map<string, MovedPayloads>();
  const marked: number[] = [];
  const result = (): PayloadCut => ({ moved, counts: { ...totals, rows: marked, kept } });
  const rows = rowsOf(snapshot);
  if (rows === undefined) return result();

  const withResult = new Map<string, WalkedInvocation>();
  const owners = new Map<string, string>();
  for (const invocation of invocations) {
    if (!('result' in invocation)) continue;
    withResult.set(invocation.key, invocation);
    owners.set(invocation.key, invocation.subflowId);
  }

  const rewritten = new Map<number, unknown[]>();
  for (const { rowAt, at, event, kind, verdict } of classifyPayloads(rows, owners)) {
    if (verdict !== 'move') {
      kept[verdict]++;
      continue;
    }
    const id = ownValue(event, 'runtimeStageId') as string;
    const invocation = withResult.get(id) as WalkedInvocation;
    const value = ownValue(event, 'payload');
    const text = jsonText(value);
    if (text === undefined) {
      // Nothing JSON can carry, or too deep to write (parsed data always can):
      // leave it where it is; the base then refuses as `unserializable`.
      kept.notLast++;
      continue;
    }
    const own = resultValueFor(invocation.result, kind);
    const place: IndexPayloadPlace =
      own !== undefined && jsonText(own) === text ? 'same' : 'stored';
    const bytes = utf8Length(text);
    const entry = moved.get(id) ?? {};
    entry[kind] = { place, value, text, bytes };
    moved.set(id, entry);
    if (place === 'same') {
      totals.same++;
      totals.restoredBytes += bytes;
    } else totals.stored++;

    const withMark: Record<string, unknown> = {};
    for (const key of Object.keys(event)) {
      if (key !== 'payload') assign(withMark, key, ownValue(event, key));
    }
    assign(withMark, PAYLOAD_MARK_KEY, PAYLOAD_MARK);
    const row = rows[rowAt] as Record<string, unknown>;
    const copy = rewritten.get(rowAt) ?? [...(ownValue(row, 'data') as unknown[])];
    copy[at] = withMark;
    rewritten.set(rowAt, copy);
  }
  if (rewritten.size === 0) return result();
  // The rows the cut marked, by position: the ONLY rows a reader restores. A
  // row that arrived carrying the fact or the mark key is kept whole (its
  // payloads counted as `notLast`), and a reader never touches it.
  marked.push(...[...rewritten.keys()].sort((a, b) => a - b));

  const recordersOut = rows.map((row, at) => {
    const data = rewritten.get(at);
    if (data === undefined) return row;
    const source = row as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      if (key === 'data') assign(out, key, data);
      else if (key === 'meta') {
        const meta: Record<string, unknown> = {};
        const sourceMeta = ownValue(source, 'meta') as Record<string, unknown>;
        for (const field of Object.keys(sourceMeta))
          assign(meta, field, ownValue(sourceMeta, field));
        assign(meta, SUBFLOW_PAYLOADS_META_KEY, SUBFLOW_PAYLOADS_WITH_INVOCATION);
        assign(out, key, meta);
      } else assign(out, key, ownValue(source, key));
    }
    return out;
  });
  return { ...result(), recorders: recordersOut };
}

/** What the rule says about a (restored) snapshot: the payloads that may move, and why the rest stay. */
export interface PayloadClaims {
  /** `kind:id` of every payload the rule moves. */
  readonly moved: ReadonlySet<string>;
  readonly kept: IndexSubflowPayloads['kept'];
}

/**
 * The rule run again over a snapshot a whole read restored, with the index's
 * own invocations as owners: what the index must have said about moves and
 * kept payloads. No value is serialised; `same` vs `stored` and the restored
 * bytes are checked by measuring as they are restored.
 */
export function payloadClaims(
  snapshot: unknown,
  owners: ReadonlyMap<string, string>,
): PayloadClaims {
  const kept = { ambiguous: 0, notLast: 0, noPart: 0 };
  const moved = new Set<string>();
  const rows = rowsOf(snapshot);
  if (rows === undefined) return { moved, kept };
  for (const { event, kind, verdict } of classifyPayloads(rows, owners)) {
    if (verdict === 'move') moved.add(`${kind}:${ownValue(event, 'runtimeStageId') as string}`);
    else kept[verdict]++;
  }
  return { moved, kept };
}

/**
 * A value's compact JSON text, or `undefined` when JSON cannot carry it or it is
 * too deep for this runtime's stack to write (a `RangeError`, never escaped).
 */
function jsonText(value: unknown): string | undefined {
  try {
    return toWireJson(value) as string | undefined;
  } catch (err) {
    if (err instanceof RangeError) return undefined;
    throw err;
  }
}

/** A moved payload's value, or `undefined` when the index or its part has none. */
export type PayloadResolver = (
  key: string,
  kind: PayloadKind,
) => { readonly value: unknown } | undefined;

/**
 * Put every moved payload back into a v2 base recording, IN PLACE (the reader
 * owns the freshly parsed base). `rows` is the index's list of the rows the cut
 * marked, and `expected` its `same + stored`. Only those rows are touched:
 * any other row, even one whose `meta` holds a `subflowPayloads` key or whose
 * events hold a `payloadWith` key, is the recording's own data and stays as
 * stored. Returns `false`, having proven nothing, when the base and the index
 * disagree: a listed row the cut could not have marked (not a BoundaryEvents
 * row in full mode, its fact missing or not last, no mark in it), a mark that
 * resolves to nothing, a mark twice, a mark not in the last place or beside a
 * `payload`, or a count that differs. The caller answers that `part-changed`.
 */
export function restorePayloads(
  recording: Record<string, unknown>,
  resolve: PayloadResolver,
  expected: number,
  rows: readonly number[],
): boolean {
  const snapshot = ownValue(recording, 'snapshot');
  const recorders = isPlainObject(snapshot) ? ownValue(snapshot, 'recorders') : undefined;
  if (!Array.isArray(recorders)) return expected === 0 && rows.length === 0;
  const restored = new Set<string>();
  for (const rowAt of rows) {
    const row = element(recorders, rowAt);
    if (!isBoundaryRow(row)) return false;
    const meta = ownValue(row, 'meta');
    if (!isPlainObject(meta) || ownValue(meta, 'mode') !== 'full') return false;
    const fact = ownValue(meta, SUBFLOW_PAYLOADS_META_KEY);
    const metaKeys = Object.keys(meta);
    const data = ownValue(row, 'data') as unknown[];
    if (
      fact !== SUBFLOW_PAYLOADS_WITH_INVOCATION ||
      metaKeys[metaKeys.length - 1] !== SUBFLOW_PAYLOADS_META_KEY
    ) {
      return false;
    }
    let marks = 0;
    for (let at = 0; at < data.length; at++) {
      const event = element(data, at);
      if (!isPlainObject(event) || !hasOwn(event, PAYLOAD_MARK_KEY)) continue;
      const keys = Object.keys(event);
      const kind = kindOf(ownValue(event, 'type'));
      const id = ownValue(event, 'runtimeStageId');
      if (
        ownValue(event, PAYLOAD_MARK_KEY) !== PAYLOAD_MARK ||
        keys[keys.length - 1] !== PAYLOAD_MARK_KEY ||
        hasOwn(event, 'payload') ||
        kind === undefined ||
        typeof id !== 'string'
      ) {
        return false;
      }
      const slot = `${kind}:${id}`;
      const found = restored.has(slot) ? undefined : resolve(id, kind);
      if (found === undefined) return false;
      restored.add(slot);
      marks++;
      delete event[PAYLOAD_MARK_KEY];
      assign(event, 'payload', found.value);
    }
    if (marks === 0) return false;
    delete meta[SUBFLOW_PAYLOADS_META_KEY];
  }
  return restored.size === expected;
}
