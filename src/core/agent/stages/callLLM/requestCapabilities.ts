import type { LLMProvider, LLMRequest } from '../../../../provider-contract/types.js';
import {
  forcedToolChoiceFor,
  UnsupportedToolChoiceError,
} from '../../../../provider-contract/forcedToolChoice.js';
import {
  nativeOutputSchemaFor,
  UnsupportedNativeOutputError,
} from '../../../../provider-contract/nativeOutputSchema.js';

/** One capability rule at both request boundaries, before cache or model I/O. */
export function assertForcedRequestSupported(provider: LLMProvider, request: LLMRequest): void {
  if (request.toolChoice !== undefined && !forcedToolChoiceFor(provider, request.model)) {
    throw new UnsupportedToolChoiceError({ provider: provider.name, model: request.model });
  }
  // The structured-output twin (`strategy: 'native'`), judged on the same
  // effective model — a configured or per-skill model included.
  if (request.outputFormat !== undefined && !nativeOutputSchemaFor(provider, request.model)) {
    throw new UnsupportedNativeOutputError({ provider: provider.name, model: request.model });
  }
}
