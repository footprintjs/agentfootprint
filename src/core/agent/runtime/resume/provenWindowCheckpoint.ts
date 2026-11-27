import type { FlowchartCheckpoint } from 'footprintjs';
import { readingsOf } from '../../../../time/rows.js';

/** A later human reply cannot enlarge the measured first-message evidence. */
export function withdrawProvenWindow(
  checkpoint: FlowchartCheckpoint,
  input: unknown,
  structuredDecision: boolean,
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
  if (input == null || typeof input === 'boolean' || typeof input === 'number') return checkpoint;
  // Consent validates its envelope at the resume door. Its request and caller IDs are metadata.
  if (
    structuredDecision &&
    typeof input === 'object' &&
    Object.getOwnPropertyDescriptor(input, 'note') === undefined &&
    typeof Object.getOwnPropertyDescriptor(input, 'value')?.value !== 'string'
  )
    return checkpoint;
  // Unstructured reply payloads are outside the proof. Keep no text, only the withdrawal.
  return { ...checkpoint, sharedState: { ...state, provenWindowWithdrawn: true } };
}
