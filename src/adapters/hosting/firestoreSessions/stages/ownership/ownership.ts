import type { TypedScope } from 'footprintjs';
import type { Facts, OwnershipCall } from '../../call.js';
import { capture, publish } from '../../run.js';
import { resolveSessionOwner } from '../../../../../hosting/sessionOwnership.js';

export async function readOwner(call: OwnershipCall): Promise<void> {
  // Every read in a Firestore transaction must precede every write. This
  // one read is all there is, so that ordering is structural here rather
  // than something to remember.
  const snapshot = await call.tx.get(call.ref);
  const existing = snapshot.exists ? snapshot.data() : undefined;
  const existingOwner = existing?.['owner'];
  call.existingOwner = typeof existingOwner === 'string' ? existingOwner : undefined;
  // Throws SessionOwnershipConflictError on a different signer, out of
  // the transaction function and therefore out of `runTransaction` —
  // which is exactly the behaviour wanted: an aborted transaction
  // writes nothing at all.
  call.keptOwner = resolveSessionOwner(call.sessionId, call.existingOwner, call.owner);
}

export async function ownershipStage(scope: TypedScope<Facts>): Promise<void> {
  const call = scope.$getArgs<{ call: () => OwnershipCall }>().call();
  await capture(call, () => readOwner(call));
  publish(scope, call);
}

export function refuseOwnership(scope: TypedScope<Facts>): void {
  publish(scope, scope.$getArgs<{ call: () => OwnershipCall }>().call());
}
