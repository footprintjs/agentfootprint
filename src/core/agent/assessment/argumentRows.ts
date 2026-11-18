/** Fold — current argument observations, with last-wins identity before assessment. */
import { isRecord, str } from './recordValues.js';

/** One current `argument` row of this turn — the last per (call, argument). */
export interface ArgumentRowRead {
  readonly index: number;
  readonly toolCallId: string;
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

/**
 * This turn's CURRENT argument rows (honesty layer 2): the ledger's `argument`
 * rows whose `turn` is the run's `turnNumber` — the ledger crosses turns on a
 * continued conversation, and a row from an earlier turn is about a call this
 * answer does not rest on — keyed by call, then argument, the LAST row
 * winning. A record with no `turnNumber` reads every argument row (it may
 * over-report; it never hides).
 */
export function argumentRows(state: Readonly<Record<string, unknown>>): readonly ArgumentRowRead[] {
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  const turn = typeof state.turnNumber === 'number' ? state.turnNumber : undefined;
  const byCall = new Map<string, Map<string, ArgumentRowRead>>();
  ledger.forEach((row: unknown, index) => {
    if (!isRecord(row) || row.kind !== 'argument') return;
    if (turn !== undefined && row.turn !== turn) return;
    const toolCallId = str(row.toolCallId);
    const argument = str(row.argument);
    if (toolCallId === undefined || argument === undefined) return;
    const source = str(row.source);
    const read: ArgumentRowRead = {
      index,
      toolCallId,
      argument,
      ...(source !== undefined && { source }),
      asked: typeof row.asked === 'string' && source === undefined,
      ruled: row.rule !== undefined || row.period === true,
      failed: row.failed !== undefined,
      withheld: row.correction !== undefined || row.withheld !== undefined,
      ...(typeof row.claimed === 'string' && {
        sourced: row.failed === 'uncheckable' ? ('uncheckable' as const) : ('verdict' as const),
      }),
      reading: source === 'said' && row.reading === true,
      setAside: source === 'result' && typeof row.setAside === 'string',
    };
    const forCall = byCall.get(toolCallId) ?? new Map<string, ArgumentRowRead>();
    forCall.set(argument, read);
    byCall.set(toolCallId, forCall);
  });
  return [...byCall.values()].flatMap((forCall) => [...forCall.values()]);
}
