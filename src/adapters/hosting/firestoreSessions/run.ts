import { decide } from 'footprintjs';
import type { TypedScope } from 'footprintjs';

import { FIRESTORE_MAX_ENVELOPE_BYTES } from './constants.js';
import type { Facts, Outcome } from './call.js';
import { OUTCOME_RULES, READ_RULES, READY, PRESENT, WRITE } from './rules.js';

export const fresh = (): Outcome => ({ failed: false });

/** Catch outside the engine so its error logger never sees an SDK payload. */
export async function capture(call: Outcome, body: () => unknown): Promise<void> {
  try {
    await body();
  } catch (error) {
    call.failed = true;
    call.error = error;
  }
}

export function publish(scope: TypedScope<Facts>, call: Outcome): void {
  scope.failed = call.failed;
  if (call.bytes !== undefined) {
    scope.bytes = call.bytes;
    scope.envelopeLimit = FIRESTORE_MAX_ENVELOPE_BYTES;
  }
  scope.reason = call.reason ?? (call.failed ? 'refused' : 'ready');
}

export const finish = (scope: TypedScope<Facts>) => decide(scope, OUTCOME_RULES, READY);
export const chooseRead = (scope: TypedScope<Facts>) => decide(scope, READ_RULES, PRESENT);
export const chooseOwnership = (scope: TypedScope<Facts>) => decide(scope, OUTCOME_RULES, WRITE);
