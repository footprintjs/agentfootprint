import type { CallLLMStageDeps } from './types.js';
import { captureFindingsRequest, type FindingsRequest } from '../../findings/admission.js';
import { issuedTicketsOf } from '../../placedTickets.js';
import { completeObserved, observeCallRequests, streamObserved } from './servedRequest.js';
import type { TypedScope } from 'footprintjs';
import type { LLMRequest, LLMResponse } from '../../../../provider-contract/types.js';
import { liveChunkEmitter } from './liveChunks.js';
import {
  assertForcedRequestSupported,
  describeProviderDispatch,
  providerDispatchFor,
} from './providerRequest.js';
import { resilienceHooks } from '../../../../recorders/core/resilienceHooks.js';
import { replayAttempts } from '../../../../resilience/replayAttempt.js';
import { throwIfAborted } from '../../../../lib/abort.js';
import { tagThinkingResponse } from '../../../../thinking/dispatch.js';
import { applyOutputSchema } from '../../../../answer-validation/outputSchema.js';
import { sameReplayProjection } from '../../requestTurn/state.js';
import { readSchemaToolAnswer } from '../../outputEnforcement.js';
import {
  executeWithReliability,
  ValidationFailure,
  type OutputSchemaValidator,
  type LLMCallFn,
} from '../reliabilityExecution.js';
import type { AgentState } from '../../types.js';
import type { PreparedCall } from './prepareCall.js';
import {
  isTerminalIntervention,
  isProviderInterventionError,
} from '../../../../provider-contract/intervention.js';
import { admitInterventionError } from '../../../providerIntervention.js';
import { captureProviderResponse } from './capturedResponse.js';

export async function executeCall(
  scope: TypedScope<AgentState>,
  deps: CallLLMStageDeps,
  prepared: PreparedCall,
) {
  const {
    peel,
    iteration,
    provider,
    model,
    committed,
    tail,
    continuing,
    wireMessages,
    detached,
    serving,
    llmRequest,
  } = prepared;
  // Streaming-first: when the provider implements `stream()` we
  // consume chunk-by-chunk so consumers see tokens as they arrive
  // instead of waiting for the full LLM call to finish. Non-terminal
  // chunks can carry thinking, visible text, or both. The
  // terminal chunk SHOULD carry the authoritative `LLMResponse`;
  // when it doesn't (older providers, partial implementations) we
  // fall back to `complete()` for the authoritative payload —
  // keeping the ReAct loop deterministic.
  //
  // `singleProviderCall` is the per-attempt call function. Used
  // directly when reliability is OFF; passed into `executeWithReliability`
  // when reliability is configured (the helper invokes it once per
  // retry-loop iteration).
  //
  // `providerHooks` is the resilience-report channel handed to the
  // provider on every call. When `deps.provider` is decorated
  // (withFallback / withRetry / withCircuitBreaker) its reports become
  // in-run typed events with this stage's real runtimeStageId. Built
  // once per stage — reused across reliability-loop
  // iterations. Named to avoid shadowing `singleProviderCall`'s own
  // `hooks` parameter, which is the unrelated `{ onFirstChunk }` bag.
  const providerHooks = resilienceHooks(scope, deps.recordReceipt !== false, deps.onReplayPrepared);
  let answeredBy = { provider: provider.name, model, native: false };
  let localFallback = false;
  let acceptedFindingsRequest: FindingsRequest | undefined;
  const preserveReplay =
    deps.hasEvidenceRecovery === true ||
    deps.hasFindingsLedger === true ||
    tail.length > 0 ||
    continuing !== undefined;
  let acceptedProjection = false;
  const issued = deps.findings === true ? issuedTicketsOf(scope.placedTickets) : undefined;
  const capture = (req: LLMRequest) => captureFindingsRequest(req, committed, iteration, issued);
  // The run signal reaches the wire. See callLLM/README.md#dispatch-lifetime.
  const runSignal = scope.$getEnv?.()?.signal;
  const dispatchFor = providerDispatchFor(
    runSignal,
    deps.nativeOutputAuto === true,
    detached.outputFormat,
  );
  const singleProviderCall: LLMCallFn = async (req, hooks): Promise<LLMResponse> => {
    try {
      const selectedProvider = hooks.provider ?? provider;
      req = dispatchFor.forAttempt(req, selectedProvider);
      assertForcedRequestSupported(selectedProvider, req);
      throwIfAborted(runSignal);
      const attempts = replayAttempts(req, hooks.providerHooks ?? providerHooks);
      let dispatch = describeProviderDispatch(selectedProvider, req);
      let candidate = deps.findings === true ? capture(req) : undefined;
      let stableProjection = preserveReplay && sameReplayProjection(wireMessages, req.messages);
      if (selectedProvider !== provider) serving?.discard();
      const attemptHooks = observeCallRequests(
        attempts.hooks,
        serving === undefined && deps.findings !== true && !preserveReplay
          ? undefined
          : (request) => {
              serving?.beforeRequest(request);
              if (deps.findings === true) candidate = capture(request);
              if (preserveReplay)
                stableProjection = sameReplayProjection(wireMessages, request.messages);
            },
        serving?.discard,
      );
      let resp: LLMResponse | undefined;
      // THE STREAM CARRIES WHAT STANDS (9.114.2, `.findings()`): each chunk
      // goes through the scanner the answer's peel uses, so a token never
      // carries the model's `_findings` notes — not even when a chunk ends
      // part way through the key — and the tokens join to exactly the text
      // the run hands back. A fresh scanner per attempt; unarmed, the chunks
      // go out as the provider sent them.
      const shown = deps.suppressDraftTokens === true ? undefined : peel?.reservedMemberFilter();
      const liveChunks = liveChunkEmitter(scope, runSignal, {
        providerName: selectedProvider.name,
        iteration,
        suppressDraftTokens: deps.suppressDraftTokens === true,
        allowHeldProviderSummary: deps.allowHeldProviderSummary === true,
        textFilter: shown,
        onFirstChunk: hooks.onFirstChunk,
      });
      if (selectedProvider.stream) {
        for await (const chunk of streamObserved(
          selectedProvider,
          attempts.request,
          attemptHooks,
          runSignal,
        )) {
          if (chunk.done) {
            if (chunk.response) resp = chunk.response;
            break;
          }
          liveChunks.push(chunk);
        }
      }
      liveChunks.finish();
      if (!resp) {
        // No `stream()` OR stream finished without a response payload.
        // Raw errors propagate so the reliability loop can classify them;
        // friendly translation happens at the terminal ErrorBridge.
        //
        // Hooks are passed to BOTH phases. A decorated provider that falls
        // back in each reports twice — deliberately NOT deduped, because
        // those are two genuinely billed calls and collapsing them would
        // hide real double-billing. (That this branch can re-call at all
        // after a stream is a pre-existing quirk; see MENTAL_MODEL §14.)
        const completion = selectedProvider.stream
          ? dispatchFor.select(attempts.request, selectedProvider)
          : attempts.request;
        dispatch = describeProviderDispatch(selectedProvider, completion);
        if (deps.findings === true) candidate = capture(completion);
        if (preserveReplay)
          stableProjection = sameReplayProjection(wireMessages, completion.messages);
        resp = await completeObserved(selectedProvider, completion, attemptHooks, runSignal);
      }
      // An answer that arrived after the abort is not an answer: refused here,
      // before the usage is counted, the turn committed or `llm_end` fired.
      throwIfAborted(runSignal);
      resp = captureProviderResponse(resp);
      if (isTerminalIntervention(resp)) {
        answeredBy = dispatch;
        return attempts.response(resp);
      }
      // `'tool-forced'`: the answer arrived as the synthetic tool's ARGUMENTS,
      // so it is moved into `content` and the call is taken off the list here,
      // at the single seam every later reader goes through. Everything
      // downstream — the reliability validator, the scope writes, the Route
      // decider, the retry loop — then sees the response it would have seen
      // under `'instruct'`: a final answer that is a JSON string, and no tool
      // calls. One normalization, no second code path, and nothing further
      // down has to know which strategy is in force.
      const forcedName = deps.schemaTool?.name;
      if (forcedName !== undefined) {
        const answer = readSchemaToolAnswer(resp);
        if (answer !== undefined) {
          resp = {
            ...resp,
            content: answer,
            toolCalls: resp.toolCalls.filter((tc) => tc.name !== forcedName),
          };
        }
      }
      const answered =
        hooks.providerIndex === undefined
          ? resp
          : tagThinkingResponse(resp, String(hooks.providerIndex));
      answeredBy = dispatch;
      acceptedFindingsRequest = candidate;
      acceptedProjection = stableProjection;
      return attempts.response(answered);
    } catch (error) {
      if (isProviderInterventionError(error)) admitInterventionError(scope, error);
      throw error;
    }
  };

  // v2.13 — build the output-schema validator hook when both
  // reliability + outputSchemaParser are configured. The reliability
  // loop applies the validator only on terminal turns (toolCalls
  // empty) so tool-using turns aren't rejected for failing the final-
  // answer schema. ValidationFailure carries `stage` + `path` for the
  // typed event payload.
  let postValidate: OutputSchemaValidator | undefined;
  if (deps.outputSchemaParser !== undefined) {
    const parser = deps.outputSchemaParser;
    postValidate = (response) => {
      try {
        // Judged with the reserved answer key peeled under the arm
        // (9.101.0): this runs BEFORE the route decider's own peel, and a
        // strict schema must see the answer the model meant, not the
        // envelope its standings rode in on. Unarmed: the content itself.
        applyOutputSchema(
          peel !== undefined ? peel.peelAnswerFindings(response.content).content : response.content,
          parser,
        );
      } catch (err) {
        // applyOutputSchema throws OutputSchemaError with
        // {stage, rawOutput, cause}. Convert to ValidationFailure for
        // the gate's typed handling. Pull a `path` if the underlying
        // cause exposes Zod-style issues. Use the cause's message
        // (the actual parser error) when available, falling back to
        // the wrapper's message for parsers without a cause.
        const e = err as {
          message: string;
          stage?: 'json-parse' | 'schema-validate';
          rawOutput?: string;
          cause?: {
            message?: string;
            issues?: ReadonlyArray<{ path?: ReadonlyArray<string | number> }>;
          };
        };
        let path: string | undefined;
        const firstIssue = e.cause?.issues?.[0];
        if (firstIssue?.path && firstIssue.path.length > 0) {
          path = firstIssue.path.join('.');
        }
        // Use cause message when present (parsers like Zod attach the
        // real error as cause); fall back to wrapper message.
        const message = e.cause?.message ?? e.message;
        throw new ValidationFailure({
          message,
          stage: e.stage ?? 'schema-validate',
          ...(path !== undefined && { path }),
          ...(e.rawOutput !== undefined && { rawOutput: e.rawOutput }),
        });
      }
    };
  }

  let response: LLMResponse | undefined;
  if (deps.reliability) {
    response = await executeWithReliability(
      scope,
      llmRequest,
      deps.reliability,
      provider,
      provider.name,
      model,
      singleProviderCall,
      postValidate,
      {
        ...(deps.withholdDraftContent === true && { withholdDraftContent: true }),
        providerHooks,
        prepareFallback: (request: LLMRequest) => {
          serving?.discard();
          const witness = deps.findings === true ? capture(request) : undefined;
          return () => {
            // A local answer does not inherit the replaced provider's stop reason
            // or native generation. The callback may return arbitrary text.
            localFallback = true;
            acceptedFindingsRequest = witness;
          };
        },
        isTerminalRefusal: (response: LLMResponse) =>
          isTerminalIntervention(response) ||
          (deps.outputFormat !== undefined &&
            answeredBy.native &&
            response.stopReason === 'refusal'),
      },
    );
    // `executeWithReliability` returns `undefined` when it took the
    // fail-fast path. It already wrote scope state and called
    // `$break(reason)` — `Agent.run()` translates the propagated
    // break into a `ReliabilityFailFastError` at the API boundary.
    // Skip the post-call state writes; there is no response to commit.
    if (response === undefined) return;
  } else {
    response = await singleProviderCall(llmRequest, {});
  }

  return { response, answeredBy, localFallback, acceptedFindingsRequest, acceptedProjection };
}

export type ExecutedCall = Exclude<Awaited<ReturnType<typeof executeCall>>, undefined>;
