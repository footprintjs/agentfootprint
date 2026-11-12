import type { TypedScope } from 'footprintjs';
import type { Facts, ReadCall } from '../../call.js';
import { capture, publish } from '../../run.js';

export async function read(call: ReadCall): Promise<void> {
  call.ports.open(call.verb);
  call.row = await call.ports.readRow(call.sessionId, call.operation);
}

export async function readStage(scope: TypedScope<Facts>): Promise<void> {
  const call = scope.$getArgs<{ call: () => ReadCall }>().call();
  await capture(call, () => read(call));
  publish(scope, call);
  if (!call.failed) scope.present = call.row !== undefined;
}
