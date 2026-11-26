/**
 * recordingParts/payloads — what a sub-flow invocation was handed and what it
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
 * 'with-invocation'` (appended; `meta.mode` stays `'full'`). Restoring drops
 * both and appends `payload`, so the text is exactly the text before the cut.
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
  const result = (): PayloadCut => ({ moved, counts: { ...totals, kept } });
  if (!isPlainObject(snapshot)) return result();
  const recorders = ownValue(snapshot, 'recorders');
  if (!Array.isArray(recorders)) return result();

  const rows = recorders.map((_, at) => element(recorders, at));
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

  const withResult = new Map<string, WalkedInvocation>();
  for (const invocation of invocations) {
    if ('result' in invocation) withResult.set(invocation.key, invocation);
  }

  const rewritten = new Map<number, unknown[]>();
  rows.forEach((row, rowAt) => {
    if (!isBoundaryRow(row)) return;
    const data = ownValue(row, 'data') as unknown[];
    for (let at = 0; at < data.length; at++) {
      const event = element(data, at);
      if (!isPlainObject(event) || !hasOwn(event, 'payload')) continue;
      const kind = kindOf(ownValue(event, 'type'));
      if (kind === undefined) continue;
      if (!candidates.has(rowAt)) {
        // A row not in full mode, or one that already uses the mark key: no
        // mark in it could be told from the row's own data.
        kept.notLast++;
        continue;
      }
      const id = ownValue(event, 'runtimeStageId');
      const invocation = typeof id === 'string' ? withResult.get(id) : undefined;
      if (typeof id !== 'string' || invocation === undefined) {
        kept.noPart++;
        continue;
      }
      const seen = tally.get(id);
      if (
        seen === undefined ||
        seen.entries !== 1 ||
        seen.exits > 1 ||
        seen.subflowIds.size !== 1 ||
        !seen.subflowIds.has(invocation.subflowId)
      ) {
        kept.ambiguous++;
        continue;
      }
      const keys = Object.keys(event);
      if (keys[keys.length - 1] !== 'payload') {
        kept.notLast++;
        continue;
      }
      const value = ownValue(event, 'payload');
      const text = toWireJson(value) as string | undefined;
      if (text === undefined) {
        // Nothing JSON can carry (parsed data always can): leave it where it is.
        kept.notLast++;
        continue;
      }
      const own = resultValueFor(invocation.result, kind);
      const place: IndexPayloadPlace =
        own !== undefined && toWireJson(own) === text ? 'same' : 'stored';
      const bytes = utf8Length(text);
      const entry = moved.get(id) ?? {};
      entry[kind] = { place, value, text, bytes };
      moved.set(id, entry);
      if (place === 'same') {
        totals.same++;
        totals.restoredBytes += bytes;
      } else totals.stored++;

      const marked: Record<string, unknown> = {};
      for (const key of keys) if (key !== 'payload') assign(marked, key, ownValue(event, key));
      assign(marked, PAYLOAD_MARK_KEY, PAYLOAD_MARK);
      const copy = rewritten.get(rowAt) ?? [...data];
      copy[at] = marked;
      rewritten.set(rowAt, copy);
    }
  });
  if (rewritten.size === 0) return result();

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

/** A moved payload's value, or `undefined` when the index or its part has none. */
export type PayloadResolver = (
  key: string,
  kind: PayloadKind,
) => { readonly value: unknown } | undefined;

/**
 * Put every moved payload back into a v2 base recording, IN PLACE (the reader
 * owns the freshly parsed base). `expected` is the index's `same + stored`.
 * Returns `false`, having proven nothing, when the base and the index
 * disagree: a mark that resolves to nothing, a mark twice, a mark not in the
 * last place or beside a `payload`, a row fact with no mark, or a count that
 * differs. The caller answers that `part-changed`.
 */
export function restorePayloads(
  recording: Record<string, unknown>,
  resolve: PayloadResolver,
  expected: number,
): boolean {
  const snapshot = ownValue(recording, 'snapshot');
  const recorders = isPlainObject(snapshot) ? ownValue(snapshot, 'recorders') : undefined;
  if (!Array.isArray(recorders)) return expected === 0;
  const restored = new Set<string>();
  for (let rowAt = 0; rowAt < recorders.length; rowAt++) {
    const row = element(recorders, rowAt);
    if (!isPlainObject(row)) continue;
    const meta = ownValue(row, 'meta');
    if (!isPlainObject(meta)) continue;
    const fact = ownValue(meta, SUBFLOW_PAYLOADS_META_KEY);
    if (fact === undefined) continue;
    const metaKeys = Object.keys(meta);
    const data = ownValue(row, 'data');
    if (
      fact !== SUBFLOW_PAYLOADS_WITH_INVOCATION ||
      metaKeys[metaKeys.length - 1] !== SUBFLOW_PAYLOADS_META_KEY ||
      !Array.isArray(data)
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
