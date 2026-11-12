import type { TypedScope } from 'footprintjs';
import type { Call, Facts } from '../../call.js';
import { publish } from '../../run.js';

export function completeStage(scope: TypedScope<Facts>): void {
  const call = scope.$getArgs<{ call: () => Call }>().call();
  publish(scope, call);
}
