import type { CacheMarker } from '../../../../cache/types.js';
import { withRequestSignal } from '../../../../lib/abort.js';
import {
  forcedToolChoiceFor,
  UnsupportedToolChoiceError,
} from '../../../../provider-contract/forcedToolChoice.js';
import {
  autoNativeOutputSchemaFor,
  nativeOutputSchemaFor,
  UnsupportedNativeOutputError,
} from '../../../../provider-contract/nativeOutputSchema.js';
import type { LLMProvider, LLMRequest } from '../../../../provider-contract/types.js';

type OutputFormat = LLMRequest['outputFormat'];

/** One capability rule at both request boundaries, before cache or model I/O. */
export function assertForcedRequestSupported(provider: LLMProvider, request: LLMRequest): void {
  if (request.toolChoice !== undefined && !forcedToolChoiceFor(provider, request.model)) {
    throw new UnsupportedToolChoiceError({ provider: provider.name, model: request.model });
  }
  // Structured output is judged on the effective model, including a configured
  // or per-skill model, just as forced tool choice is.
  if (request.outputFormat !== undefined && !nativeOutputSchemaFor(provider, request.model)) {
    throw new UnsupportedNativeOutputError({ provider: provider.name, model: request.model });
  }
}

/** Auto follows the actual provider/model, including cache and reliability
 * selection. Explicit formats retain their own capability check. */
export function selectOutputFormat(
  request: LLMRequest,
  provider: LLMProvider,
  auto: boolean,
  outputFormat: OutputFormat,
): LLMRequest {
  if (!auto || outputFormat === undefined) return request;
  if (autoNativeOutputSchemaFor(provider, request.model)) {
    return request.outputFormat === undefined ? { ...request, outputFormat } : request;
  }
  if (request.outputFormat === undefined) return request;
  const { outputFormat: _unused, ...ordinary } = request;
  void _unused;
  return ordinary;
}

/** One editable copy of library data, before the strategy is called. The
 * native fallback schema rides along even if the first model cannot use it.
 * Copy the containers of live TypedScope arrays before cloning their data. */
export function detachProviderInput(
  request: LLMRequest,
  markers: readonly CacheMarker[],
  outputFormat: OutputFormat,
) {
  return structuredClone({
    request: {
      ...request,
      messages: [...request.messages],
      ...(request.tools !== undefined && { tools: [...request.tools] }),
    },
    markers: [...markers],
    outputFormat,
  });
}

/** The built-in strategies leave the message values alone. The receipt can
 * use the corresponding internal messages for digest and measurement reuse.
 * A host strategy may rewrite its copy, so its actual request is read as-is. */
export function receiptProviderRequest(
  prepared: LLMRequest,
  detached: LLMRequest,
  base: LLMRequest,
  hostStrategy: boolean,
): LLMRequest {
  return !hostStrategy && prepared.messages === detached.messages
    ? { ...prepared, messages: base.messages }
    : prepared;
}

/** Reuse the effective dispatch object while the request and selected provider
 * are the same. A real model, replay or feedback rewrite starts a new input. */
export function providerDispatchFor(
  signal: AbortSignal | undefined,
  auto: boolean,
  outputFormat: OutputFormat,
) {
  let prior: { input: LLMRequest; provider: LLMProvider; effective: LLMRequest } | undefined;
  return (input: LLMRequest, provider: LLMProvider): LLMRequest => {
    if (prior?.input === input && prior.provider === provider) return prior.effective;
    const selected = selectOutputFormat(input, provider, auto, outputFormat);
    const effective = withRequestSignal(selected, signal);
    prior = { input, provider, effective };
    return effective;
  };
}
