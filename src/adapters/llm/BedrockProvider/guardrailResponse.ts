/** Safe intervention presentation and response projection, before unusable tool/text reads. */
import type { LLMResponse } from '../../../provider-contract/types.js';
import {
  interventionErrorOf,
  type ProviderIntervention,
} from '../../../provider-contract/intervention.js';
import type { BedrockConverseResponse } from './types.js';
import type { GuardrailConfiguration } from './guardrailConfig.js';
import { classifyGuardrail } from './guardrailClassify.js';
import { ownData } from './guardrailRead.js';
import { fromBedrockResponse, normalizeStopReason } from './response.js';

/** Only returned numeric usage crosses the port; metadata accessors are not executed. */
export function guardrailUsage(value: unknown): LLMResponse['usage'] {
  const count = (name: string, cache = false) => {
    const field = ownData(value, name);
    return field.valid &&
      typeof field.value === 'number' &&
      Number.isFinite(field.value) &&
      field.value >= 0 &&
      (!cache || Number.isSafeInteger(field.value))
      ? field.value
      : undefined;
  };
  const cacheRead = count('cacheReadInputTokens', true);
  const cacheWrite = count('cacheWriteInputTokens', true);
  return {
    input: count('inputTokens') ?? 0,
    output: count('outputTokens') ?? 0,
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
  };
}

/** Hook effects belong to the application. No callback can replace the admitted disposition. */
export function presentIntervention(
  value: ProviderIntervention,
  config: GuardrailConfiguration | undefined,
): ProviderIntervention {
  const detached = Object.freeze({
    ...value,
    filters: Object.freeze(value.filters.map((filter) => Object.freeze({ ...filter }))),
  });
  if (value.outcome === 'masked' || config?.cleanMessage === undefined) return detached;
  let message: unknown;
  try {
    message = config.cleanMessage(detached);
  } catch (cause) {
    throw interventionErrorOf(detached, cause);
  }
  if (
    typeof message !== 'string' ||
    message.length > 2048 ||
    Array.from(message).length > 1024 ||
    new TextEncoder().encode(message).length > 4096
  ) {
    throw interventionErrorOf(
      detached,
      new TypeError('The intervention message must be a bounded synchronous string.'),
    );
  }
  return Object.freeze({ ...detached, message });
}

/** A terminal intervention carries safe evidence and usage, and no held provider content. */
export function terminalGuardrailResponse(
  intervention: ProviderIntervention,
  usage: LLMResponse['usage'] = { input: 0, output: 0 },
): LLMResponse {
  return {
    content: '',
    toolCalls: [],
    usage,
    stopReason: normalizeStopReason(intervention.code),
    intervention,
  };
}

/** Classification precedes even the ordinary projector's first output/tool access. */
export function guardedCompleteResponse(
  response: BedrockConverseResponse,
  config: GuardrailConfiguration | undefined,
): LLMResponse {
  const classified = classifyGuardrail(response, config);
  if (classified === undefined) return fromBedrockResponse(response);
  const intervention = presentIntervention(classified, config);
  if (intervention.outcome === 'masked') return { ...fromBedrockResponse(response), intervention };
  const usage = guardrailUsage(ownData(response, 'usage').value);
  const requestId = ownData(ownData(response, 'ResponseMetadata').value, 'RequestId').value;
  return {
    ...terminalGuardrailResponse(intervention, usage),
    ...(typeof requestId === 'string' ? { providerRef: requestId } : {}),
  };
}
