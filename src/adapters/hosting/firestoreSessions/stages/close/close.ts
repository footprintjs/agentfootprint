import type { TypedScope } from 'footprintjs';
import type { Facts, CloseCall } from '../../call.js';
import { capture, publish } from '../../run.js';

export async function close(call: CloseCall): Promise<void> {
  const { lifecycle, db, ownsClient } = call;

  if (lifecycle.closed) return;
  lifecycle.closed = true;
  if (!ownsClient) return;
  try {
    await db.terminate();
  } catch {
    // The store is closed either way. A failure to hand back gRPC channels
    // is not something a caller shutting down can act on, and a throw here
    // would turn an orderly shutdown into a crash over a released resource.
  }
}

export async function closeStage(scope: TypedScope<Facts>): Promise<void> {
  const call = scope.$getArgs<{ call: () => CloseCall }>().call();
  await capture(call, () => close(call));
  publish(scope, call);
}
