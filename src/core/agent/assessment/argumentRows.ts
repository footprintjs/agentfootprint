/** Fold — current argument observations, with last-wins identity before assessment. */
import { historyCallResolver, unlandedCallKey, type HistoryCall } from '../recordedCalls.js';
import { isRecord, str } from './recordValues.js';

/** One current `argument` row of this turn — the last per (call, argument). */
export interface ArgumentRowRead {
  readonly index: number;
  readonly toolCallId: string;
  readonly historyIndex?: number;
  readonly unlandedKey?: string;
  readonly argument: string;
  readonly source?: string;
  /** Set on a row that ASKED the person — no source yet. */
  readonly asked: boolean;
  readonly ruled: boolean;
  readonly failed: boolean;
  readonly withheld: boolean;
  /** The declared-sources check judged it (`claimed` present) — and whether it reached a verdict. */
  readonly sourced?: 'verdict' | 'uncheckable';
  /** `said` + `reading`: the value is the model's reading of the person's words. */
  readonly reading: boolean;
  /** `result` + `setAside`: the value came from a result the model had set aside. */
  readonly setAside: boolean;
}

/** A question from the inputs layer pauses before its batch dispatches. */
export function waitingArgumentIteration(
  state: Readonly<Record<string, unknown>>,
): number | undefined {
  const ask = state.argumentAsk;
  return isRecord(ask) && isRecord(ask.waiting) && typeof ask.iteration === 'number'
    ? ask.iteration
    : undefined;
}

/**
 * This turn's CURRENT argument rows (honesty layer 2): the ledger's `argument`
 * rows whose `turn` is the run's `turnNumber` — the ledger crosses turns on a
 * continued conversation, and a row from an earlier turn is about a call this
 * answer does not rest on. The last observation wins for one argument of a
 * proved history occurrence, or for a proposal the record has not landed.
 * When the retained history admits several calls, each row remains evidence
 * without replacing another. A record with no `turnNumber` reads every row.
 */
export function argumentRows(
  state: Readonly<Record<string, unknown>>,
  currentCalls: readonly HistoryCall[],
): readonly ArgumentRowRead[] {
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  const turn = typeof state.turnNumber === 'number' ? state.turnNumber : undefined;
  const waiting = waitingArgumentIteration(state);
  const groups = new Map<number | string | symbol, Map<string, ArgumentRowRead>>();
  let resolve: ReturnType<typeof historyCallResolver> | undefined;
  for (let index = 0; index < ledger.length; index++) {
    const row: unknown = Object.getOwnPropertyDescriptor(ledger, String(index))?.value;
    if (!isRecord(row) || row.kind !== 'argument') continue;
    if (turn !== undefined && row.turn !== turn) continue;
    const toolCallId = str(row.toolCallId);
    const argument = str(row.argument);
    if (toolCallId === undefined || argument === undefined) continue;
    const source = str(row.source);
    const withheld = row.correction !== undefined || row.withheld !== undefined;
    const pending = withheld || (waiting !== undefined && row.iteration === waiting);
    const resolved = pending
      ? undefined
      : (resolve ??= historyCallResolver(currentCalls))(toolCallId, str(row.toolName));
    const historyIndex = resolved?.kind === 'matched' ? resolved.call.index : undefined;
    const unlandedKey =
      resolved === undefined || resolved.kind === 'missing' ? unlandedCallKey(row) : undefined;
    const read: ArgumentRowRead = {
      index,
      toolCallId,
      argument,
      ...(historyIndex !== undefined && { historyIndex }),
      ...(unlandedKey !== undefined && { unlandedKey }),
      ...(source !== undefined && { source }),
      asked: typeof row.asked === 'string' && source === undefined,
      ruled: row.rule !== undefined || row.period === true,
      failed: row.failed !== undefined,
      withheld,
      ...(typeof row.claimed === 'string' && {
        sourced: row.failed === 'uncheckable' ? ('uncheckable' as const) : ('verdict' as const),
      }),
      reading: source === 'said' && row.reading === true,
      setAside: source === 'result' && typeof row.setAside === 'string',
    };
    const key = historyIndex ?? unlandedKey ?? Symbol();
    const forCall = groups.get(key) ?? new Map<string, ArgumentRowRead>();
    forCall.set(argument, read);
    groups.set(key, forCall);
  }
  return [...groups.values()].flatMap((forCall) => [...forCall.values()]);
}
