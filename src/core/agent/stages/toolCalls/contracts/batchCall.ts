import type { LLMMessage } from '../../../../../provider-contract/types.js';

/** The existing materialized tool proposal, passed between synchronous batch operations. */
export interface DispatchCall {
  readonly id: string;
  readonly callOccurrenceKey?: import('../../../../../lib/callOccurrence.js').CallOccurrenceKey;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly argumentsFailure?: LLMMessage['toolArgumentsFailure'];
}
