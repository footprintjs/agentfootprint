import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';

/** Stop before final capture and memory writes, including restored branches.
 * Route owns the chain and records its verdict; this guard only consumes it.
 * It does not infer approval from successful execution or inspect audit rows. */
export function withheldByOutputPolicy(scope: TypedScope<AgentState>): boolean {
  if (scope.messageDeniedPhase !== 'output') return false;
  scope.$break('output middleware withheld terminal delivery');
  return true;
}
