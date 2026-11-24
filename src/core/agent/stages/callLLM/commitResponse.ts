import type { TypedScope } from 'footprintjs';
import type { SubmittedCitationOffer } from '../../../../provider-contract/citationResponse.js';
import type { LLMResponse } from '../../../../provider-contract/types.js';
import { acceptedAnswerDigest } from '../../citations/accepted.js';
import type { FindingsRequest } from '../../findings/admission.js';
import { recordResponseStop } from '../../honesty/responseStop.js';
import type { AgentState } from '../../types.js';
import { identifyAcceptedToolCalls } from './acceptedCalls.js';
import type { CallLLMStageDeps } from './types.js';

/** Bind response-owned facts to the single response selected by the call stage. */
export function commitAcceptedResponse(
  scope: TypedScope<AgentState>,
  deps: Pick<
    CallLLMStageDeps,
    'outputFormat' | 'nativeOutputAuto' | 'findings' | 'offerCitations' | 'onResponseCommitted'
  >,
  response: LLMResponse,
  accepted: {
    readonly localFallback: boolean;
    readonly answeredBy: { readonly provider: string; readonly native: boolean };
    readonly findingsRequest: FindingsRequest | undefined;
    readonly citationOffer: SubmittedCitationOffer | undefined;
  },
) {
  const { localFallback, answeredBy, findingsRequest, citationOffer } = accepted;
  const nativeOutput =
    deps.outputFormat !== undefined &&
    !localFallback &&
    (deps.nativeOutputAuto !== true || answeredBy.native);
  // A provider that states its manifest (wireManifest.ts)
  // and says no format crossed sent the request unconstrained while it
  // declared the capability — refused, never delivered as constrained.
  if (
    nativeOutput &&
    response.wireManifest !== undefined &&
    response.wireManifest.outputFormat === undefined
  ) {
    throw new Error(
      `Agent: native structured output — '${answeredBy.provider}' ` +
        `declares a native structured-output format, but its wire manifest says the request ` +
        `it sent carried none. The answer was not constrained, so it is not delivered as if ` +
        `it were.`,
    );
  }
  if (deps.findings === true)
    scope.findingsRequest = findingsRequest === undefined ? undefined : [findingsRequest];
  if (deps.offerCitations === true) {
    const answerDigest = acceptedAnswerDigest(response.content);
    scope.acceptedCitationOffer =
      localFallback ||
      citationOffer === undefined ||
      response.toolCalls.length > 0 ||
      answerDigest === undefined
        ? undefined
        : [{ submitted: citationOffer, answerDigest }];
  }
  scope.llmLatestContent = response.content;
  deps.onResponseCommitted?.();
  const acceptedToolCalls = identifyAcceptedToolCalls(response.toolCalls);
  scope.llmLatestToolCalls = acceptedToolCalls;
  recordResponseStop(
    scope,
    localFallback ? undefined : response.stopReason,
    nativeOutput,
    deps.outputFormat !== undefined,
  );
  return acceptedToolCalls;
}
