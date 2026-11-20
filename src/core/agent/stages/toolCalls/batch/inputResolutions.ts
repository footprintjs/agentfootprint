import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { InputsDispatch } from '../contracts/inputsDispatch.js';
import type { DispatchCall } from '../contracts/batchCall.js';
import type { BatchAddress } from '../../../arguments/batchAddress.js';

/** Read this iteration's fills and consume only the already-used kept answers. */
export function readBatchResolutions(
  scope: TypedScope<AgentState>,
  inputs: InputsDispatch | undefined,
  iteration: number,
  toolCalls: readonly Pick<DispatchCall, 'id' | 'name' | 'callOccurrenceKey'>[],
  excludedCallAddresses: readonly BatchAddress[],
  consumeKept = true,
) {
  // THE INPUTS LAYER'S RESOLUTIONS for this batch — read only under the
  // arm, and only the entries resolved for THIS iteration.
  let resolutions = inputs?.resolutionsFor(scope, iteration);
  if (resolutions !== undefined && excludedCallAddresses.length > 0) {
    const refused = new Set(excludedCallAddresses);
    resolutions = new Map([...resolutions].filter(([address]) => !refused.has(address)));
  }
  // A fill the layer took from an answer this turn KEPT (a call of the
  // batch that asked could not finish) is that answer's one use — dropped
  // before anything else (`arguments/dispatch.ts` · `dropUsedKept`).
  if (consumeKept && inputs !== undefined && resolutions !== undefined) {
    inputs.dropUsedKept(scope, resolutions, toolCalls);
  }
  return resolutions;
}
