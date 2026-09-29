/**
 * coverage/inProgress — "this has not finished; its outcome is not known yet".
 *
 * Pattern: one rule set, two doors (the `period.ts` law): `coverage()`'s mint
 *          REFUSES a malformed `inProgress` at the line the author wrote; the
 *          dispatch door READS a foreign `in_progress` (a sidecar in another
 *          language mints `af_coverage` too) and drops a malformed one from the
 *          record, dev-warned, never repaired. Both ask {@link readInProgressList}.
 * Role:    core/ layer, pure.
 * Emits:   N/A (the caller emits `agentfootprint.tools.coverage_declared`).
 *
 * ## Why a third outcome needs its own words
 *
 * A vendor state machine has at least three outcomes: settled-ok, in
 * progress, failed. A tool that tests "equals the success value" counts the
 * middle one as a failure — a backup two hours into its run read beside a VM
 * with no backup at all; an array with zero unhealthy replication sessions
 * read as "97 non-OK" because 96 were still synchronizing. Both were measured
 * in the field, and both would have been escalated.
 *
 * The fix belongs in the TOOL: only the tool knows which of its vendor's states
 * are in flight, and when the vendor gives its own verdict field that verdict
 * wins over a state name. So this library never reads a state string. What it
 * adds is a place to SAY the third outcome — `coverage(value, { checked,
 * inProgress })` — so the model reads it as data, the record keeps it, and a
 * person reading the answer sees it beside the other limits.
 *
 * ## What it deliberately does not do
 *
 * It does not change the answer's standing. "Not sure" would be right only
 * when the answer STATES a settled outcome for an item in flight, and the
 * record holds the answer as prose: telling "vm-42's backup is still running"
 * from "vm-42 has no backup" is a reading of words — a phrase parser or a
 * model judge, both refused here. Firing on every answer from such a tool would
 * mark the honest answers too. So the declaration is a LABEL: served, recorded,
 * printed with the limits (docs/design/honesty/results.md § 11).
 */

import { isDevMode } from 'footprintjs';

import { shortProblem } from './items.js';
import { refusal } from './refusal.js';
import type { InProgressItem } from './types.js';

/**
 * The wire spelling as DATA — the key an in-progress list sits under inside
 * `af_coverage`, and its one item key that is not the coverage items' own.
 * `canonical-notes.json` publishes it (`scripts/gen-canonical-notes.mjs`), so a
 * tool written in another language mints it byte for byte.
 */
export const IN_PROGRESS_WIRE = Object.freeze({
  /** The key the list sits under inside `af_coverage`. */
  key: 'in_progress',
  /** How many things one entry stands for — a positive whole number. */
  count: 'count',
} as const);

/**
 * The one clause the dispatch door appends to the note of a ledger that
 * declares a well-formed, non-empty `in_progress` — the model is SERVED it; the
 * tool's own output keeps `COVERAGE_NOTE`. Static, never interpolated; anchored
 * to "the call this result answers" (the container deictic's own anchor), so a
 * later call re-reading it cannot take it for its own. Added at the door, not
 * at the mint, so an envelope a sidecar minted gets it too.
 */
export const IN_PROGRESS_CLAUSE =
  '`in_progress` is what the call this result answers found still running: its outcome is ' +
  'not known yet, so it is neither a success nor a failure — report it as in progress, never ' +
  'as either.';

/** An item's keys, tied to {@link InProgressItem} in BOTH directions. */
const ITEM_KEYS: readonly string[] = Object.keys({
  what: true,
  why: true,
  short: true,
  count: true,
} satisfies Record<keyof InProgressItem, true>);

/** What one list reads as: its items, or the first problem. */
export type InProgressReading =
  | { readonly items: readonly InProgressItem[]; readonly problem?: undefined }
  | { readonly items?: undefined; readonly problem: string };

type ItemReading =
  | { readonly item: InProgressItem; readonly problem?: undefined }
  | { readonly item?: undefined; readonly problem: string };

/** `null` reads as omitted — a JSON producer writes a missing value as `null`. */
const given = (v: unknown): boolean => v !== undefined && v !== null;

/**
 * THE rule set for one list. `at` is the list's name as the reader spells it
 * (`inProgress` at the mint, `in_progress` on the wire). `strictKeys` refuses
 * an item key the shape does not have (the mint: a misspelt `why` must not
 * vanish); the wire reader copies the known keys and lets the rest ride, as
 * every recognized envelope does. Everything else is one rule.
 */
export function readInProgressList(
  raw: unknown,
  at: string,
  strictKeys: boolean,
): InProgressReading {
  if (!Array.isArray(raw)) {
    return {
      problem:
        `\`${at}\` must be an array of strings or { what, why?, short?, count? } entries — ` +
        'to say nothing is running, omit it.',
    };
  }
  const items: InProgressItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const read = itemOf(raw[i], `${at}[${i}]`, strictKeys);
    if (read.problem !== undefined) return { problem: read.problem };
    items.push(read.item);
  }
  return { items };
}

function itemOf(raw: unknown, at: string, strictKeys: boolean): ItemReading {
  if (typeof raw === 'string') {
    const what = raw.trim();
    return what === ''
      ? { problem: `${at} is blank — say what is still running.` }
      : { item: { what } };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { problem: `${at} must be a non-empty string or { what, why?, short?, count? }.` };
  }
  const rec = raw as Record<string, unknown>;
  if (strictKeys) {
    const unknownKey = Object.keys(rec).find((k) => !ITEM_KEYS.includes(k));
    if (unknownKey === 'kind') {
      return {
        problem:
          `${at} has \`kind\` — it names ground a call did NOT reach, and an item in progress ` +
          'is ground the call read.',
      };
    }
    if (unknownKey !== undefined) {
      return {
        problem: `${at} has an unknown key '${unknownKey}' — the fields are what, why, short, count.`,
      };
    }
  }
  if (typeof rec.what !== 'string' || rec.what.trim() === '') {
    return { problem: `${at} names nothing — \`what\` must say what is still running.` };
  }
  const what = rec.what.trim();
  const why = given(rec.why) ? rec.why : undefined;
  if (why !== undefined && (typeof why !== 'string' || why.trim() === '')) {
    return { problem: `${at} ('${what}') has a \`why\` that says nothing — give one or omit it.` };
  }
  const short = given(rec.short) ? rec.short : undefined;
  const shortFault = short === undefined ? undefined : shortProblem(short, what);
  if (shortFault !== undefined) return { problem: `${at} ('${what}') — ${shortFault}` };
  const count = given(rec.count) ? rec.count : undefined;
  if (count !== undefined && !(Number.isSafeInteger(count) && (count as number) >= 1)) {
    return {
      problem:
        `${at} ('${what}') — \`count\` must be a whole number of at least 1 (how many things ` +
        'this entry stands for), or omitted for one.',
    };
  }
  return {
    item: {
      what,
      ...(why !== undefined && { why: (why as string).trim() }),
      ...(short !== undefined && { short: (short as string).trim() }),
      ...(count !== undefined && { count: count as number }),
    },
  };
}

/**
 * The mint's reading: the normalized items, `[]` when omitted (`undefined` or
 * `null`) — and a refusal, thrown where `coverage()` is called, for anything
 * the rule set refuses.
 */
export function mintInProgress(raw: unknown): readonly InProgressItem[] {
  if (!given(raw)) return [];
  const read = readInProgressList(raw, 'inProgress', true);
  if (read.problem !== undefined) throw refusal(read.problem);
  return read.items;
}

/** Tools already warned about a dropped list — once per tool per process. */
const warnedTools = new Set<string>();
const MAX_WARNED = 1000;

/**
 * A ledger marker's `in_progress`, read for the RECORD: the items when the list
 * is well-formed and non-empty, else `undefined` — a malformed one dropped from
 * the record and named once per tool in dev mode (the model still reads what
 * the tool wrote, without the clause).
 */
export function inProgressOf(
  marker: { readonly in_progress?: unknown },
  toolName: string | undefined,
): readonly InProgressItem[] | undefined {
  const raw = marker.in_progress;
  if (!given(raw)) return undefined;
  const read = readInProgressList(raw, IN_PROGRESS_WIRE.key, false);
  if (read.problem !== undefined) {
    warnDropped(toolName, read.problem);
    return undefined;
  }
  return read.items.length > 0 ? read.items : undefined;
}

function warnDropped(toolName: string | undefined, problem: string): void {
  const key = toolName ?? '';
  if (warnedTools.has(key) || !isDevMode()) return;
  if (warnedTools.size < MAX_WARNED) warnedTools.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `agentfootprint coverage: tool '${toolName ?? '(unknown)'}' returned an in_progress list ` +
      `the record cannot carry, so it was left off the record (the result itself is kept and ` +
      `served as written): ${problem} This warning fires once per tool per process.`,
  );
}

/**
 * Forget every dropped-list warning issued so far.
 * @internal test seam — the ledger is process-wide and warn-once.
 */
export function _resetInProgressWarnings(): void {
  warnedTools.clear();
}

/**
 * One ledger marker as SERVED: {@link IN_PROGRESS_CLAUSE} after its note when
 * it declares a well-formed, non-empty `in_progress`. The same reference back
 * otherwise — an undeclared ledger is served byte for byte — and when the note
 * already ends with the clause (served once is served).
 */
export function withInProgressServed<T extends object>(marker: T): T {
  const rec = marker as Record<string, unknown>;
  if (!given(rec.in_progress)) return marker;
  const read = readInProgressList(rec.in_progress, IN_PROGRESS_WIRE.key, false);
  if (read.problem !== undefined || read.items.length === 0) return marker;
  const note = rec.note;
  if (
    typeof note === 'string' &&
    (note === IN_PROGRESS_CLAUSE || note.endsWith(` ${IN_PROGRESS_CLAUSE}`))
  ) {
    return marker;
  }
  const served =
    typeof note === 'string' && note !== '' ? `${note} ${IN_PROGRESS_CLAUSE}` : IN_PROGRESS_CLAUSE;
  return { ...rec, note: served } as T;
}

/**
 * The inverse, for a reader of what the model was served (the evidence
 * projection): the marker with the clause removed from the END of its note —
 * words the library derived never ground an answer. The same reference back
 * when the note does not end with it.
 */
export function withoutInProgressServed<T extends object>(marker: T): T {
  const rec = marker as Record<string, unknown>;
  const note = rec.note;
  if (typeof note !== 'string') return marker;
  if (note === IN_PROGRESS_CLAUSE) {
    const { note: _dropped, ...rest } = rec;
    return rest as T;
  }
  if (!note.endsWith(` ${IN_PROGRESS_CLAUSE}`)) return marker;
  return { ...rec, note: note.slice(0, -(IN_PROGRESS_CLAUSE.length + 1)) } as T;
}

/** The section heading the limits block prints in-progress items under. Stable — readers match on it. */
export const IN_PROGRESS_SECTION_LABEL = 'In progress (outcome not known yet)';

/**
 * One line of that section: the tool, then the item as it declared it — its
 * count in brackets, its `why` after a dash. Static words around the tool's own.
 *
 * @example
 * ```ts
 * inProgressLine('replication_sessions', { what: 'sessions still synchronizing', count: 96 });
 * // 'replication_sessions: sessions still synchronizing (96)'
 * ```
 */
export function inProgressLine(toolName: string, item: InProgressItem): string {
  const count = item.count !== undefined ? ` (${item.count})` : '';
  const why = item.why !== undefined ? ` — ${item.why}` : '';
  return `${toolName}: ${item.what}${count}${why}`;
}

/** One item as detached plain data — the declared fields, nothing else. */
export function copyInProgressItem(item: InProgressItem): InProgressItem {
  return {
    what: item.what,
    ...(item.why !== undefined && { why: item.why }),
    ...(item.short !== undefined && { short: item.short }),
    ...(item.count !== undefined && { count: item.count }),
  };
}
