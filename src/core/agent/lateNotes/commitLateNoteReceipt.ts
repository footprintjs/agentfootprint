import type { TypedScope } from 'footprintjs';
import type { trackLateRecordNote } from '../../../provider-contract/lateRecordNote.js';
import type { LLMResponse } from '../../../provider-contract/types.js';
import { canStorePrivateFields, markPrivateFields } from '../../../redaction/runRedaction.js';
import type { AgentState } from '../types.js';

/** File disposition and private proof in the owning call's native commit. */
export function commitLateNoteReceipt(
  scope: TypedScope<AgentState>,
  attempt: ReturnType<typeof trackLateRecordNote>,
  response: LLMResponse | undefined,
): void {
  scope.lateRecordNoteReceipt = [attempt.receipt(response)];
  const proofs = attempt.privateProofs();
  if (canStorePrivateFields(scope) && (proofs.length > 0 || 'recordNoteWireProof' in scope)) {
    markPrivateFields(scope, [{ root: 'recordNoteWireProof', path: '' }]);
    // Use the engine's private write door. The locator and digest are not part
    // of the served record, and a later call cannot carry an earlier proof.
    scope.$setValue('recordNoteWireProof', proofs.length > 0 ? [proofs] : undefined, true);
  }
}
