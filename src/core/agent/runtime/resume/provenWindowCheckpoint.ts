import type { FlowchartCheckpoint } from 'footprintjs';
import type { CheckInDecision } from '../../../checkin.js';
import { readingsOf } from '../../../../time/rows.js';

/** A later human reply cannot enlarge the measured first-message evidence. */
export function withdrawProvenWindow(
  checkpoint: FlowchartCheckpoint,
  input: unknown,
  decision: Partial<CheckInDecision> | undefined,
): FlowchartCheckpoint {
  const state = checkpoint.sharedState;
  if (
    state.turnNumber !== 1 ||
    state.provenWindowWithdrawn === true ||
    !readingsOf(state.findingsLedger as readonly unknown[] | undefined, 1).some(
      (row) => row.choice?.by === 'proven',
    )
  )
    return checkpoint;
  if (input === null || typeof input === 'boolean' || typeof input === 'number') return checkpoint;
  // The consent door copies note and value once, including inherited fields.
  if (decision?.approved === true && decision.note === undefined && decision.value === undefined)
    return checkpoint;
  // Unstructured reply payloads are outside the proof. Keep no text, only the withdrawal.
  return { ...checkpoint, sharedState: { ...state, provenWindowWithdrawn: true } };
}
