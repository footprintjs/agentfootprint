import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { DispatchCall } from './batchCall.js';
import type { DispatchBatchFrame } from './dispatchBatch.js';

/** Only the native handler translates these local completion facts into its existing return. */
export type DispatchCallOutcome =
  | { readonly kind: 'landed' }
  | { readonly kind: 'halted' }
  | { readonly kind: 'paused'; readonly pause: unknown };

export type DispatchCallRunner = (
  scope: TypedScope<AgentState>,
  tc: DispatchCall,
  callIndex: number,
  batch: DispatchBatchFrame,
) => Promise<DispatchCallOutcome>;
