/**
 * core/agent/placedTickets — did the LIBRARY place this result?
 *
 * A placement ticket (`artifacts/placement.ts` · `placedToolResult`) is only
 * JSON on a `role: 'tool'` message, and any tool can return JSON of that
 * shape. So the shape says what a result LOOKS like, never who wrote it. Who
 * wrote it is proven by where it came from: the dispatch loop's placement
 * step (`stages/toolCalls/execution/artifactsOperations.ts`) appends one
 * `{ toolCallId, ref }` to `AgentState.placedTickets` for every ticket it
 * mints, and every reader that would speak about a ticket as the library's
 * asks {@link isIssuedTicket} — this file is that one question.
 *
 * The receipt belongs to the CONVERSATION, not to one run: a ticket placed in
 * turn one is still in the history of turn two. A pause keeps it (it is
 * scope), and a stored conversation carries it as
 * `AgentRunCheckpoint.placedTickets`, written by both checkpoint doors with
 * {@link ticketsStillServed} and read back with {@link carriedTicketsOf};
 * `followUp`, `run({ continueFrom })` and `resumeOnError` all restore it
 * through seed.
 *
 * A conversation stored or paused by an EARLIER version has no receipt, and
 * it is read as it is: none of its tickets is named, and the declared-sources
 * check reads each as an ordinary result. A record written before a mark
 * existed is read in the direction that refuses or flags more; reading it by
 * shape would hand a tool's ticket-shaped text the library's voice again.
 * Example: a run paused on the previous version, resumed after the upgrade,
 * gets no staged-refs line for the ticket it placed before the pause. So
 * finish paused runs before upgrading.
 *
 * @example
 * ```ts
 * const issued = issuedTicketsOf(scope.placedTickets);
 * // A tool returned { placed: true, ref: 'art_x', kind, reason } itself:
 * isIssuedTicket('call-7', parsed, issued); // false: nothing was minted for call-7
 * ```
 */

import { isPlacedToolResult, type PlacedToolResult } from '../../artifacts/placement.js';

/** One ticket the library minted: the call it stands for and the ref it named. */
export interface PlacedTicket {
  readonly toolCallId: string;
  readonly ref: string;
}

/**
 * The issued tickets as `(toolCallId, ref)` PAIRS: each call id maps to every
 * ref minted under it. A pair, not a key, because a provider may reuse a call
 * id across turns (`security/extractSequence.ts` says so): turn one places
 * `art_a` under `t1`, turn two places `art_b` under `t1` again, and both are
 * still the library's.
 */
export type IssuedPairs = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * What a reader is handed about the receipt: the issued pairs, or
 * {@link RECORDED_BEFORE_RECEIPT} for a recording older than the receipt
 * itself.
 */
export type IssuedTickets = IssuedPairs | typeof RECORDED_BEFORE_RECEIPT;

/**
 * A recording made before the library kept its receipt. Only the time-travel
 * rebuild hands it in (`time-travel/servedView/requestOnly.ts`): such a run
 * composed its lines by the ticket's shape alone, and a rebuild must give back
 * exactly what was sent then. A live run never uses it: a live run without a
 * receipt has issued nothing.
 */
export const RECORDED_BEFORE_RECEIPT = 'recorded-before-receipt' as const;

/**
 * The issued pairs, read defensively because the value comes from scope, a
 * recording or a stored conversation: anything that is not a list of
 * `{ toolCallId, ref }` strings issues nothing.
 */
export function issuedTicketsOf(value: unknown): IssuedPairs {
  const issued = new Map<string, Set<string>>();
  if (!Array.isArray(value)) return issued;
  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { toolCallId, ref } = entry as { toolCallId?: unknown; ref?: unknown };
    if (typeof toolCallId !== 'string' || typeof ref !== 'string') continue;
    const refs = issued.get(toolCallId) ?? new Set<string>();
    issued.set(toolCallId, refs.add(ref));
  }
  return issued;
}

/**
 * THE question: is `parsed` (one tool message's content, parsed by the
 * reader's own rule) a ticket the library minted for `toolCallId`? True only
 * when it has the ticket's shape AND the receipt lists that very ref for that
 * very call. A recording older than the receipt answers by shape, as it was
 * composed.
 */
export function isIssuedTicket(
  toolCallId: string | undefined,
  parsed: unknown,
  issued: IssuedTickets,
): parsed is PlacedToolResult {
  if (!isPlacedToolResult(parsed)) return false;
  if (issued === RECORDED_BEFORE_RECEIPT) return true;
  return toolCallId !== undefined && issued.get(toolCallId)?.has(parsed.ref) === true;
}

/**
 * The tickets a stored conversation keeps: only those whose call is still a
 * `role: 'tool'` message of the stored `history`, so the list is bounded by
 * the history it stands beside (a ticket whose message a window or a fold
 * removed can never be read again). A reused call id keeps every pair minted
 * under it while any message under that id remains, because the id alone
 * cannot say which of them is gone. `undefined` when none is left, so a
 * conversation that placed nothing stores no key.
 */
export function ticketsStillServed(
  tickets: unknown,
  history: readonly { readonly role: string; readonly toolCallId?: string }[],
): readonly PlacedTicket[] | undefined {
  const issued = issuedTicketsOf(tickets);
  if (issued.size === 0) return undefined;
  const served = new Set<string>();
  for (const { role, toolCallId } of history) {
    if (role === 'tool' && toolCallId !== undefined) served.add(toolCallId);
  }
  const kept: PlacedTicket[] = [];
  for (const [toolCallId, refs] of issued) {
    if (!served.has(toolCallId)) continue;
    for (const ref of refs) kept.push({ toolCallId, ref });
  }
  return kept.length > 0 ? kept : undefined;
}

/**
 * A stored conversation's `placedTickets`, admitted at the door
 * (`runCheckpoint.ts` · `validateCheckpoint`): a list of `{ toolCallId, ref }`
 * strings, copied field by field. Anything else is refused by name, because a
 * receipt the run cannot read would quietly stop the library naming tickets
 * it really placed.
 */
export function carriedTicketsOf(value: unknown): readonly PlacedTicket[] {
  const ok =
    Array.isArray(value) &&
    value.every(
      (t: unknown) =>
        typeof t === 'object' &&
        t !== null &&
        typeof (t as { toolCallId?: unknown }).toolCallId === 'string' &&
        typeof (t as { ref?: unknown }).ref === 'string',
    );
  if (!ok) {
    throw new TypeError(
      '[resumeOnError] checkpoint `placedTickets` must be a list of { toolCallId, ref } strings ' +
        'when present. It is the receipt of the placement tickets the library issued for the ' +
        "stored history's calls.",
    );
  }
  return (value as readonly PlacedTicket[]).map(({ toolCallId, ref }) => ({ toolCallId, ref }));
}

/**
 * What seed writes at the start of a run: the tickets a continued conversation
 * carried, and an empty receipt on an agent whose nudge is armed (`wants`
 * declared), so that a recording says it kept the receipt even before its
 * first placement. `undefined` writes nothing — every other record keeps its
 * bytes.
 */
export function seededTickets(
  carried: readonly PlacedTicket[] | undefined,
  nudgeArmed: boolean,
): PlacedTicket[] | undefined {
  if (carried !== undefined && carried.length > 0)
    return carried.map(({ toolCallId, ref }) => ({ toolCallId, ref }));
  return nudgeArmed ? [] : undefined;
}
