import type { CallOccurrenceKey } from '../../../../lib/callOccurrence.js';
import type { LLMMessage, LLMResponse } from '../../../../provider-contract/types.js';

/** Stamp the accepted proposal once, before downstream inputs writers observe it. */
export function identifyAcceptedToolCalls(
  calls: LLMResponse['toolCalls'],
): NonNullable<LLMMessage['toolCalls']> {
  if (calls.length === 0) return calls;
  const [a, b, c, d] = globalThis.crypto.getRandomValues(new Uint32Array(4));
  return calls.map((call, index) => {
    if (call === null || typeof call !== 'object') return call;
    // Preserve the provider's input shape without invoking getters. The batch
    // still owns validation of a malformed proposal, including an accessor ID.
    const descriptors = Object.getOwnPropertyDescriptors(call);
    const key: CallOccurrenceKey = Object.freeze([a, b, c, d, index]);
    return Object.defineProperties(
      {},
      {
        ...descriptors,
        callOccurrenceKey: { value: key, enumerable: true, writable: true, configurable: true },
      },
    ) as typeof call;
  });
}
