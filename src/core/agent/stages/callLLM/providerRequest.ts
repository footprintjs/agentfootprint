import type { LLMRequest } from '../../../../provider-contract/types.js';

/**
 * Give each provider invocation its own editable request. Copy at dispatch so
 * receipt assembly can still reuse unchanged message projections. TypedScope
 * arrays may be live proxies; copy their containers before cloning their data.
 * The run's signal is a live cancellation channel and keeps its identity.
 */
export function copyProviderRequest(request: LLMRequest): LLMRequest {
  const { signal, ...data } = request;
  const copy = structuredClone({
    ...data,
    messages: [...data.messages],
    ...(data.tools !== undefined && { tools: [...data.tools] }),
    ...(data.cacheMarkers !== undefined && { cacheMarkers: [...data.cacheMarkers] }),
    ...(data.stop !== undefined && { stop: [...data.stop] }),
  });
  return signal === undefined ? copy : { ...copy, signal };
}
