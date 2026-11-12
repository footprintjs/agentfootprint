import type { TypedScope } from 'footprintjs';
import type { Facts, OwnershipCall } from '../../call.js';
import { publish } from '../../run.js';

export function writeOwner(call: OwnershipCall): void {
  const keptOwner = call.keptOwner;
  // `null`, never `undefined`: an absent owner has to be a STORED fact,
  // because the default client throws on `undefined` and because a field
  // that is simply missing cannot be told apart from a field this store
  // failed to write.
  call.tx.set(call.ref, { ...call.row, owner: keptOwner ?? null });
}

export function writeStage(scope: TypedScope<Facts>): void {
  const call = scope.$getArgs<{ call: () => OwnershipCall }>().call();
  try {
    writeOwner(call);
  } catch (error) {
    call.failed = true;
    call.error = error;
  }
  publish(scope, call);
}
