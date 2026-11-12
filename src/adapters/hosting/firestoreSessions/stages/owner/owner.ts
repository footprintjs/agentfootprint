import type { TypedScope } from 'footprintjs';
import type { Facts, ReadCall } from '../../call.js';
import { publish } from '../../run.js';

export function ownerOf(row: Record<string, unknown> | undefined): string | undefined {
  const owner = row?.['owner'];
  // `undefined` for "no such session" AND for "a session nobody signed for"
  // — the deliberate ambiguity the composer's one not-found rests on. A store
  // that answered those differently would hand a caller an oracle for which
  // session ids are real.
  return typeof owner === 'string' && owner.length > 0 ? owner : undefined;
}

export function ownerStage(scope: TypedScope<Facts>): void {
  const call = scope.$getArgs<{ call: () => ReadCall }>().call();
  try {
    call.value = ownerOf(call.row);
  } catch (error) {
    call.failed = true;
    call.error = error;
  }
  publish(scope, call);
}
