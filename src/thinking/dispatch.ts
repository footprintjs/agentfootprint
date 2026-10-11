/** One raw-thinking envelope for a provider choice, shared by both routing paths. */
import type { LLMProvider, LLMResponse } from '../adapters/types.js';
import type { ThinkingHandler } from './types.js';
import { thinkingHandlerFor } from './thinkingHandlerFor.js';

/** Plain data only; handler functions stay in the chart's build-time closure. */
export function tagThinkingResponse(response: LLMResponse, answeredBy: string): LLMResponse {
  return response.rawThinking === undefined
    ? response
    : {
        ...response,
        rawThinking: { answeredBy, raw: response.rawThinking },
      };
}

/** Decode only with the handler belonging to the transport that answered. */
export function dispatchThinkingHandler(
  id: string,
  handlers: Readonly<Record<string, ThinkingHandler | undefined>>,
  untagged?: ThinkingHandler,
): ThinkingHandler {
  return {
    id,
    normalize(value) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'answeredBy' in value &&
        typeof value.answeredBy === 'string' &&
        'raw' in value &&
        Object.hasOwn(handlers, value.answeredBy)
      ) {
        return handlers[value.answeredBy]?.normalize(value.raw) ?? [];
      }
      if (untagged !== undefined) return untagged.normalize(value);
      throw new TypeError(
        'This thinking does not say which side answered, so no matching handler can read it.',
      );
    },
  };
}

/** Keep explicit override/null intent while routing declared handlers by list index. */
export function thinkingForProviders(
  provider: LLMProvider,
  providers: readonly LLMProvider[] = [],
  override?: ThinkingHandler | null,
): ThinkingHandler | undefined {
  if (override === null) return undefined;
  const base = override ?? thinkingHandlerFor(provider);
  if (providers.length === 0) return base;
  const handlers = Object.fromEntries(
    providers.map((entry, index) => [String(index), override ?? thinkingHandlerFor(entry)]),
  );
  if (base === undefined && Object.values(handlers).every((handler) => handler === undefined))
    return undefined;
  return dispatchThinkingHandler(
    `selected-${Object.values(handlers)
      .map((handler) => handler?.id ?? 'none')
      .join('-or-')}`,
    handlers,
    base,
  );
}
