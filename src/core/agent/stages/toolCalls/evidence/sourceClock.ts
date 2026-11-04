import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { FindingsLedger } from '../../../findings/types.js';
import { sourceClocksOf, sourceClockRow } from '../../../../../time/rows.js';
import { recordFindings } from '../../../findings/ledger.js';

/**
 * File the `source-clock` row for one call's dataset whose declared time axis
 * names `zone` (step T8) — once per call and zone this turn, through the one
 * writer; no event (the row is the record).
 */
export function recordSourceClock(
  scope: TypedScope<AgentState>,
  call: { readonly toolCallId: string; readonly toolName: string },
  zone: string,
): void {
  const ledger = scope.findingsLedger as FindingsLedger | undefined;
  const turn = scope.turnNumber as number;
  const filed = sourceClocksOf(ledger, turn).some(
    (r) => r.toolCallId === call.toolCallId && r.zone === zone,
  );
  if (filed) return;
  recordFindings(scope, [
    sourceClockRow(call, { turn, iteration: scope.iteration as number }, zone),
  ]);
}
