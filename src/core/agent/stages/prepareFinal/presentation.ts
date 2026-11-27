import type { TypedScope } from 'footprintjs';
import type { BoundPresentation } from '../../../../time/present.js';
import { clockOf, presentationZoneOf } from '../../../../time/rows.js';
import { displayOfTurn, displayPresentationOf } from '../../../../time/display.js';
import type { AgentState } from '../../types.js';
import type { FindingsLedger } from '../../findings/types.js';

/**
 * The run's presentation zone (the time layer) — the zone of the turn's
 * `clock` row (`time/rows.ts` · `presentationZoneOf`). Read ONLY by the
 * variants mounted under `.time()`, so an agent without the layer never reads
 * the ledger here. `undefined` when no clock was filed (a paused turn from a
 * runtime without the layer): the lines are then the declared instants.
 */
export async function presentationOf(
  scope: TypedScope<AgentState>,
): Promise<BoundPresentation | undefined> {
  const ledger = scope.findingsLedger as FindingsLedger | undefined;
  const zone = presentationZoneOf(ledger);
  if (zone === undefined) return undefined;
  // The renderer loads only here, under `.time()` — the optional-family law.
  const { bindPresentation } = await import('../../../../time/present.js');
  return bindPresentation({
    zone,
    ...displayPresentationOf(displayOfTurn(ledger, clockOf(ledger)?.turn)),
  });
}
