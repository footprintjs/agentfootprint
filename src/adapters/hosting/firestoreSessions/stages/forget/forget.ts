import type { TypedScope } from 'footprintjs';
import type { Call, Facts } from '../../call.js';
import { capture, publish } from '../../run.js';
import { firestoreFailure } from '../../failure.js';

export async function forget(call: Call): Promise<void> {
  const { sessionId, ports } = call;
  const { open, docFor, collectionName } = ports;

  open('forget a session');
  try {
    // Deleting a document that is not there succeeds in Firestore, which is
    // the outcome this method asked for — so there is no not-found to catch.
    await docFor(sessionId).delete();
  } catch (err) {
    throw firestoreFailure('forgetting a session', collectionName, err);
  }
}

export async function forgetStage(scope: TypedScope<Facts>): Promise<void> {
  const call = scope.$getArgs<{ call: () => Call }>().call();
  await capture(call, () => forget(call));
  publish(scope, call);
}
