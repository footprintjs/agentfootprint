import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { FindingsLedger } from '../../../findings/types.js';
import { sourceClocksOf, sourceClockRow, type TimeCallIdentity } from '../../../../../time/rows.js';
import { readCallOccurrenceKey } from '../../../../../lib/callOccurrence.js';
import { recordFindings } from '../../../findings/ledger.js';

/**
 * File the `source-clock` row for one call's dataset whose declared time axis
 * names `zone` (step T8) — once per call and zone this turn, through the one
 * writer; no event (the row is the record).
 */
export function recordSourceClock(
  scope: TypedScope<AgentState>,
  call: TimeCallIdentity,
  zone: string,
): void {
  const ledger = scope.findingsLedger as FindingsLedger | undefined;
  const turn = scope.turnNumber as number;
  const row = sourceClockRow(call, { turn, iteration: scope.iteration as number }, zone);
  const key = readCallOccurrenceKey(row);
  const filed = sourceClocksOf(ledger, turn).some(
    (r) => r.toolCallId === call.toolCallId && r.zone === zone && readCallOccurrenceKey(r) === key,
  );
  if (filed) return;
  recordFindings(scope, [row]);
}
