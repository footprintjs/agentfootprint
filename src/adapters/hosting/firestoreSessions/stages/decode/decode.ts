import type { TypedScope } from 'footprintjs';
import type { Facts, ReadCall } from '../../call.js';
import { publish } from '../../run.js';
import { checkEnvelope } from '../../../../../hosting/envelope.js';
import { UnreadableEnvelopeError } from '../../../../../hosting/errors.js';
import type { CheckpointEnvelope } from '../../../../../hosting/types.js';

export function decode(row: Record<string, unknown>, sessionId: string): CheckpointEnvelope {
  const stored = row['envelope'];
  if (typeof stored !== 'string') {
    // A document exists and its payload is not even text. Present,
    // unreadable — and specifically NOT `undefined`.
    throw new UnreadableEnvelopeError(stored, sessionId);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    // Bytes written by something that was not this store. Same fact, same
    // refusal: a conversation EXISTS here and this runtime cannot see it.
    throw new UnreadableEnvelopeError(stored, sessionId);
  }
  // Validated HERE as well as in the composer, so a refusal points at the
  // store that produced the bytes rather than at whoever read them next.
  return checkEnvelope(parsed, sessionId);
}

export function decodeStage(scope: TypedScope<Facts>): void {
  const call = scope.$getArgs<{ call: () => ReadCall }>().call();
  try {
    call.value = decode(call.row as Record<string, unknown>, call.sessionId);
  } catch (error) {
    call.failed = true;
    call.error = error;
  }
  publish(scope, call);
}
