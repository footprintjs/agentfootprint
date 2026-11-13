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
 * What a reader is handed about the receipt: the issued tickets by
 * `toolCallId`, or {@link RECORDED_BEFORE_RECEIPT} for a recording older than
 * the receipt itself.
 */
export type IssuedTickets = ReadonlyMap<string, string> | typeof RECORDED_BEFORE_RECEIPT;

/**
 * A recording made before the library kept its receipt. Only the time-travel
 * rebuild hands it in (`time-travel/servedView/requestOnly.ts`): such a run
 * composed its lines by the ticket's shape alone, and a rebuild must give back
 * exactly what was sent then. A live run never uses it: a live run without a
 * receipt has issued nothing.
 */
export const RECORDED_BEFORE_RECEIPT = 'recorded-before-receipt' as const;

/**
 * The issued tickets as a map, `toolCallId` → ref. Read defensively because
 * the value comes from scope, a recording or a stored conversation: anything
 * that is not a list of `{ toolCallId, ref }` strings issues nothing.
 */
export function issuedTicketsOf(value: unknown): ReadonlyMap<string, string> {
  const issued = new Map<string, string>();
  if (!Array.isArray(value)) return issued;
  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { toolCallId, ref } = entry as { toolCallId?: unknown; ref?: unknown };
    if (typeof toolCallId === 'string' && typeof ref === 'string') issued.set(toolCallId, ref);
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
  return toolCallId !== undefined && issued.get(toolCallId) === parsed.ref;
}

/**
 * The tickets a stored conversation keeps: only those whose call is still a
 * `role: 'tool'` message of the stored `history`, so the list is bounded by
 * the history it stands beside (a ticket whose message a window or a fold
 * removed can never be read again). `undefined` when none is left, so a
 * conversation that placed nothing stores no key.
 */
export function ticketsStillServed(
  tickets: unknown,
  history: readonly { readonly role: string; readonly toolCallId?: string }[],
): readonly PlacedTicket[] | undefined {
  const issued = issuedTicketsOf(tickets);
  if (issued.size === 0) return undefined;
  const kept: PlacedTicket[] = [];
  for (const { role, toolCallId } of history) {
    if (role !== 'tool' || toolCallId === undefined) continue;
    const ref = issued.get(toolCallId);
    if (ref !== undefined && !kept.some((t) => t.toolCallId === toolCallId)) {
      kept.push({ toolCallId, ref });
    }
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
        'when present. It is the receipt of the placement tickets this conversation issued.',
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
