/**
 * innerRunRecords — the record a tool keeps of its OWN run.
 *
 * Pattern: bounded LRU store + a structural join key (a registry symbol).
 * Role:    the one place the outer trace and an inner trace are allowed to
 *          know about each other. Nothing here executes, renders, or
 *          formats — it holds records and hands them back by id.
 *
 * THE GAP
 * ───────
 * `inspect_tool_call` resolves a tool call end to end and then stops at a
 * wall: *"⚠ boundary: what happened INSIDE the tool is not traced."* That
 * marker is honest for a tool that calls someone else's system. It is
 * needlessly honest for a tool that IS a footprintjs flowchart — that tool
 * recorded every stage it ran, and then threw the recording away, because
 * nobody was holding it.
 *
 * So: hold it. `flowchartAsTool({ keepRecord: true })` keeps each
 * invocation's inner record here, keyed by the `toolCallId` the outer run
 * already uses to name that call. One id, two levels — which is what makes
 * the descent a lookup rather than a correlation puzzle.
 *
 * WHY BOUNDED, AND WHY LRU
 * ────────────────────────
 * A retained snapshot is retained memory. An agent that runs a chart tool
 * on every turn for a week would pin every one of those runs, and the
 * failure would look like a leak rather than like a feature. So the store
 * has a cap (default {@link DEFAULT_INNER_RUN_LIMIT}), drops the
 * least-recently-USED record when it overflows, and COUNTS the drops —
 * because "we kept the last 20 of 340" is an answer a debugging session can
 * act on, and a silently missing row is not.
 *
 * Reading refreshes recency on purpose: a record under active investigation
 * (three drills into one inner run) must not be the next one evicted by a
 * turn happening beside it.
 *
 * THE JOIN KEY
 * ────────────
 * The store rides the `Tool` object under a registry symbol rather than a
 * named property: a `Tool` is a consumer-authored shape, and a plain name
 * like `innerRuns` would be a name a consumer's own tool could collide
 * with. `Symbol.for` (registry, not unique-per-module) because this package
 * ships CJS *and* ESM — two module instances of this file must agree on the
 * key or a tool built in one half would be invisible to the other.
 */

import type { ControlDepLookup } from 'footprintjs/trace';

/**
 * How many invocations one tool keeps by default.
 *
 * Twenty is a debugging window, not an archive: enough that "the call three
 * turns ago" is still there, small enough that a long-lived server holding
 * one store per chart tool has a ceiling it can multiply out. Raise it with
 * `keepRecordLimit` when the sessions are long and the charts are small.
 */
export const DEFAULT_INNER_RUN_LIMIT = 20;

/** How the inner run finished, from the wrapping tool's point of view. */
export type InnerRunOutcome = 'ok' | 'error' | 'paused';

/**
 * One retained inner run — the evidence of a single tool invocation.
 *
 * `recording` is deliberately the `{ snapshot, structure }` shape
 * `recordRun(...).toRecording()` produces, so the same `openRecording`
 * adapter opens it. It is held BY REFERENCE (no clone): the inner executor
 * is discarded after the call, so nothing else can mutate it, and cloning a
 * snapshot per invocation would be the retention cost twice over.
 */
export interface InnerRunRecord {
  /** The outer run's id for this call — the one `inspect_tool_call` takes. */
  readonly toolCallId: string;
  /** The wrapping tool's name, for messages that name what was descended into. */
  readonly toolName: string;
  /** How the invocation ended. A failed inner run is still a complete record. */
  readonly outcome: InnerRunOutcome;
  /** Committed steps in the inner run — the size hint the descent line prints. */
  readonly steps: number;
  /**
   * The OUTER run that made the call (`ctx.runId`) — absent when the tool ran
   * outside an agent run, or for a record a third-party producer filed. The
   * store keys a record by run AND call id, so two runs that reuse a call id
   * (another session's model, a replayed script) never displace each other;
   * and a self-explaining agent serves only the records of the asking
   * conversation's own runs ({@link innerRunsOfConversation}).
   */
  readonly runId?: string;
  /**
   * `{ snapshot, structure }` — absent only when capture itself failed, in
   * which case {@link problem} says why.
   */
  readonly recording?: { readonly snapshot: unknown; readonly structure?: unknown };
  /**
   * The inner run's control-dependence lookup.
   *
   * A serialized recording can never carry one (a function does not
   * serialize — see `openRecording`). This record is LIVE in process, so it
   * can: the wrapping tool attaches a fresh `controlDepRecorder()` per
   * invocation, and inner slices therefore show the `[control: rule]` edges
   * that a reopened JSON recording has to say ⚠ about.
   */
  readonly controlDeps?: ControlDepLookup;
  /** The inner run's narrative lines, when the chart had a narrative attached. */
  readonly narrative?: readonly string[];
  /**
   * Why there is no `recording`.
   *
   * A record that could not be captured is filed anyway, carrying the
   * reason. The alternative — no row at all — is indistinguishable from a
   * call that was never made, which is the one thing a trace must never be
   * ambiguous about.
   */
  readonly problem?: string;
}

/** A retained record, named without opening it. */
export interface InnerRunSummary {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly outcome: InnerRunOutcome;
  readonly steps: number;
  /** See {@link InnerRunRecord.runId}. */
  readonly runId?: string;
}

/** Read side — what the trace tools are given. */
export interface InnerRunLookup {
  /** The record for one tool call, or undefined (never kept, or evicted). */
  get(toolCallId: string): InnerRunRecord | undefined;
  /**
   * Every record still held, least-recently-used first. Used for the
   * unknown-id correction, so the model is told which calls it CAN descend
   * into rather than only which one it cannot.
   */
  list(): readonly InnerRunSummary[];
  /** Records dropped to stay under the cap. Non-zero means "ask sooner". */
  readonly dropped: number;
  /** The cap in force (the smallest, when several stores are merged). */
  readonly limit: number;
  /**
   * The most recent record for `toolCallId` that `accept` admits — optional,
   * so a lookup built before it existed still type-checks; a view falls back
   * to {@link get} and checks the one record it returns.
   */
  getWhere?(
    toolCallId: string,
    accept: (record: InnerRunRecord) => boolean,
  ): InnerRunRecord | undefined;
  /** Drops of records whose `runId` `accept` admits (optional; see {@link getWhere}). */
  droppedWhere?(accept: (runId: string | undefined) => boolean): number;
}

/** Write side — what the wrapping tool holds. */
export interface InnerRunStore extends InnerRunLookup {
  /** File one invocation's record, evicting the least-recently-used if full. */
  keep(record: InnerRunRecord): void;
}

/**
 * The key an inner-record store rides on a `Tool`.
 *
 * Registry symbol, not a unique one: this package ships CJS and ESM, and a
 * tool built through one entry point must be readable through the other.
 */
export const INNER_RUN_RECORDS: unique symbol = Symbol.for('agentfootprint.trace.innerRunRecords');

/** A `Tool` (or anything) that carries retained inner runs. */
export interface KeepsInnerRuns {
  readonly [INNER_RUN_RECORDS]: InnerRunLookup;
}

/**
 * Read the inner-run store off a candidate, or undefined when it carries
 * none. Structural and total — a plain tool, a string, `null` all answer
 * "no records" rather than throwing.
 */
export function innerRunsOf(candidate: unknown): InnerRunLookup | undefined {
  if (candidate === null || typeof candidate !== 'object') return undefined;
  const held = (candidate as Partial<KeepsInnerRuns>)[INNER_RUN_RECORDS];
  if (held === null || typeof held !== 'object') return undefined;
  return typeof (held as InnerRunLookup).get === 'function' ? (held as InnerRunLookup) : undefined;
}

/**
 * A bounded LRU store of inner runs.
 *
 * @param limit maximum retained records (clamped to at least 1 — a store
 *              that keeps nothing is `keepRecord: false`, and saying so with
 *              a zero would be config that lies).
 */
export function innerRunStore(limit: number = DEFAULT_INNER_RUN_LIMIT): InnerRunStore {
  const cap = Math.max(1, Math.floor(limit));
  // Insertion order IS recency order: delete-then-set moves a key to the
  // end, so the first key is always the least-recently-used one. Keyed by
  // run AND call id — see `InnerRunRecord.runId`.
  const records = new Map<string, InnerRunRecord>();
  let dropped = 0;
  // Drops per outer run ('' = no run), bounded like the records they count.
  const dropsByRun = new Map<string, number>();
  const keyOf = (record: InnerRunRecord): string =>
    `${record.runId ?? ''}\u001f${record.toolCallId}`;
  const touch = (key: string, record: InnerRunRecord): void => {
    records.delete(key);
    records.set(key, record);
  };
  const newestWhere = (
    toolCallId: string,
    accept: (record: InnerRunRecord) => boolean,
  ): [string, InnerRunRecord] | undefined => {
    const all = [...records.entries()];
    for (let i = all.length - 1; i >= 0; i--) {
      const entry = all[i] as [string, InnerRunRecord];
      if (entry[1].toolCallId === toolCallId && accept(entry[1])) return entry;
    }
    return undefined;
  };

  // Reading refreshes recency (a record under investigation stays).
  const getWhere = (
    toolCallId: string,
    accept: (record: InnerRunRecord) => boolean,
  ): InnerRunRecord | undefined => {
    const found = newestWhere(toolCallId, accept);
    if (found === undefined) return undefined;
    touch(found[0], found[1]);
    return found[1];
  };

  return {
    keep(record: InnerRunRecord): void {
      touch(keyOf(record), record);
      while (records.size > cap) {
        const oldest = records.entries().next().value;
        if (oldest === undefined) break;
        records.delete(oldest[0]);
        dropped++;
        const run = oldest[1].runId ?? '';
        dropsByRun.delete(run);
        dropsByRun.set(run, (dropsByRun.get(run) ?? 0) + 1);
        while (dropsByRun.size > cap * 4) {
          const first = dropsByRun.keys().next();
          if (first.done === true) break;
          dropsByRun.delete(first.value);
        }
      }
    },
    get: (toolCallId) => getWhere(toolCallId, () => true),
    getWhere,
    list(): readonly InnerRunSummary[] {
      return [...records.values()].map((record) => ({
        toolCallId: record.toolCallId,
        toolName: record.toolName,
        outcome: record.outcome,
        steps: record.steps,
        ...(record.runId !== undefined && { runId: record.runId }),
      }));
    },
    get dropped(): number {
      return dropped;
    },
    droppedWhere(accept): number {
      let total = 0;
      for (const [run, count] of dropsByRun)
        if (accept(run === '' ? undefined : run)) total += count;
      return total;
    },
    get limit(): number {
      return cap;
    },
  };
}

/**
 * One lookup over several stores — an agent may mount more than one chart
 * tool, and the model asking "descend into call c3" should not have to know
 * which tool produced c3.
 *
 * Returns undefined for an empty list so callers can spread the field
 * conditionally rather than passing an empty lookup that answers "nothing
 * was kept" when the truth is "nothing keeps anything".
 */
export function mergeInnerRuns(lookups: readonly InnerRunLookup[]): InnerRunLookup | undefined {
  if (lookups.length === 0) return undefined;
  if (lookups.length === 1) return lookups[0];
  return {
    get: (toolCallId) => {
      for (const lookup of lookups) {
        const found = lookup.get(toolCallId);
        if (found !== undefined) return found;
      }
      return undefined;
    },
    getWhere: (toolCallId, accept) => {
      for (const lookup of lookups) {
        const found = viewGet(lookup, toolCallId, accept);
        if (found !== undefined) return found;
      }
      return undefined;
    },
    list: () => lookups.flatMap((lookup) => lookup.list()),
    get dropped(): number {
      return lookups.reduce((total, lookup) => total + lookup.dropped, 0);
    },
    droppedWhere: (accept) =>
      lookups.reduce((total, lookup) => total + (lookup.droppedWhere?.(accept) ?? 0), 0),
    get limit(): number {
      return Math.min(...lookups.map((lookup) => lookup.limit));
    },
  };
}

/**
 * The records ONE conversation's runs filed — the view a self-explaining agent
 * serves (`selfExplain.ts · SelfExplainBinding`), so a why-question asked in
 * one conversation can neither descend into, list, nor count a call another
 * conversation's run made.
 *
 * `belongs(runId)` answers for a record's outer run (`InnerRunRecord.runId`);
 * a record that names no run is asked with `undefined`. A record the view does
 * not admit answers exactly like a record never kept — the same not-found, so
 * the view says nothing about whether anyone else called the tool — and its
 * drops are not in `dropped`. `limit` is the store's.
 *
 * @example
 * ```ts
 * const mine = innerRunsOfConversation(lookup, (runId) => myRuns.has(runId ?? ''));
 * mine.get('call-from-another-run'); // undefined — not found, not forbidden
 * ```
 */
export function innerRunsOfConversation(
  lookup: InnerRunLookup,
  belongs: (runId: string | undefined) => boolean,
): InnerRunLookup {
  const admits = (record: InnerRunRecord): boolean => belongs(record.runId);
  return {
    get: (toolCallId) => viewGet(lookup, toolCallId, admits),
    getWhere: (toolCallId, accept) =>
      viewGet(lookup, toolCallId, (record) => admits(record) && accept(record)),
    list: () => lookup.list().filter((summary) => belongs(summary.runId)),
    get dropped(): number {
      return lookup.droppedWhere?.(belongs) ?? 0;
    },
    droppedWhere: (accept) =>
      lookup.droppedWhere?.((runId) => belongs(runId) && accept(runId)) ?? 0,
    get limit(): number {
      return lookup.limit;
    },
  };
}

/** `getWhere` when the lookup has it; else `get`, admitted or not found. */
function viewGet(
  lookup: InnerRunLookup,
  toolCallId: string,
  accept: (record: InnerRunRecord) => boolean,
): InnerRunRecord | undefined {
  if (lookup.getWhere !== undefined) return lookup.getWhere(toolCallId, accept);
  const found = lookup.get(toolCallId);
  return found !== undefined && accept(found) ? found : undefined;
}
