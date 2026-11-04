import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { Tool } from '../../../../../tools/tools.js';
import { type ToolArgs, runToolAfterChain } from '../../../../../tools/runChain.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import { captureNegativeRefusal, keepNegativeResultOut } from '../../../negativeClaims/capture.js';
import { servedToModel } from '../../../../../semantics/coverage/read.js';
import { recordDecisions } from '../../../middleware/ledger.js';
import { readToolResultEnvelope } from '../../../../../semantics/toolEffects.js';
import { isJsonFaithful } from '../../../../../lib/jsonFaithful.js';
import type { ToolMiddlewareOperations } from '../contracts/operations/middleware.js';

/** Compose the existing middleware callbacks once for this handler. */
export function buildToolMiddlewareOperations(
  deps: Pick<ToolCallsHandlerDeps, 'negativeClaimsArmed' | 'toolMiddleware'>,
): ToolMiddlewareOperations {
  /**
   * The after-tool moment: the chain's last word, on a call that RAN.
   *
   * Called from all FIVE dispatch sites and from nowhere else — the loop, an
   * approved ask, an approved check-in, a granted credential consent, and (since
   * 8.13.0) a resumed `pauseHere` / `askHuman`. Every one of them has just
   * produced the result of a call that ran, which is the entire precondition. A
   * call the chain denied, a call whose args were rejected, a call whose
   * credential never issued and a call still waiting on a person have no result,
   * and asking a rule about a result that does not exist would be the same
   * fabrication the outcome union removes.
   *
   * On the `pauseHere` path the value is the one a PERSON supplied, and that is
   * still this moment's business: the handler's contract is that the human's
   * answer IS the paused tool's result — it lands as `role: 'tool'` under the
   * same `toolCallId`, `stream.tool_end` reports it, and `lastToolResult` fires
   * `on-tool-return` triggers off it. A redaction rule that runs on every other
   * tool result and not on that one is a redaction rule with a hole in it, in
   * the one channel where a person can paste a secret.
   *
   * Returns what the MODEL reads. The real result stays with the caller for
   * `stream.tool_end`, so an event stream keeps reporting what the tool
   * returned while the history carries what the rules allowed through — and
   * the ledger row beside them says which is which.
   */
  const afterMoment = async (
    scope: TypedScope<AgentState>,
    call: {
      readonly tool?: Tool;
      readonly toolName: string;
      readonly toolCallId: string;
      readonly iteration: number;
      readonly args: ToolArgs;
      readonly result: unknown;
      readonly error?: boolean;
      readonly negativeResultId?: string;
      readonly history: readonly LLMMessage[];
      readonly identity?: { tenant?: string; principal?: string; conversationId: string };
      readonly signal?: AbortSignal;
    },
  ): Promise<unknown> => {
    // The record-only coverage fields (`short`, `kind`) come off FIRST, so the
    // model is never served them and every link below is handed what the
    // model will read — none can re-serve them. Every dispatch path calls
    // this moment for a result that ran (the batch loop and the four resume
    // doors), which is why the strip lives here and nowhere else. The SAME
    // reference back when no item carried either key: a run whose tools
    // declare neither serves the bytes it always did, and the callers'
    // reference-inequality stamp of `tool_end.modelResult` stays unstamped.
    if (deps.negativeClaimsArmed === true && call.error)
      captureNegativeRefusal(scope, call.toolName, call.result, call.args);
    const served = servedToModel(call.result);
    const chain = deps.toolMiddleware ?? [];
    // No `onToolResult` hook anywhere in the chain → no walk, no rows, no await
    // beyond the ones this dispatch already made. An agent whose middleware
    // only governs calls is byte-identical to one built before this moment
    // existed.
    if (!chain.some((mw) => typeof mw.onToolResult === 'function')) return served;
    const verdict = await runToolAfterChain(chain, {
      toolName: call.toolName,
      ...(call.tool?.source !== undefined && { toolSource: call.tool.source }),
      toolCallId: call.toolCallId,
      iteration: call.iteration,
      args: call.args,
      result: served,
      ...(call.error === true && { error: true as const }),
      history: call.history,
      ...(call.identity && { identity: call.identity }),
      ...(call.signal && { signal: call.signal }),
    });
    recordDecisions(scope, verdict.decisions);
    const delivered = verdict.kind === 'deny' ? verdict.reason : verdict.result;
    // An explicit policy denial withdraws access to the native observation.
    // A guessed handle must not make the final composer disclose it again.
    // Allowed summaries remain eligible: their native coverage and gaps, not
    // the summary's claims, are what the final checker uses.
    if (deps.negativeClaimsArmed === true) {
      const transformedStatus = readToolResultEnvelope(delivered)?.status;
      const notRead = ['invalid', 'denied', 'failure', 'pending'].includes(transformedStatus ?? '');
      if (verdict.kind === 'deny' || notRead || !isJsonFaithful(delivered))
        keepNegativeResultOut(scope, call.negativeResultId);
      if (verdict.kind === 'deny' || notRead)
        captureNegativeRefusal(scope, call.toolName, delivered, call.args);
    }
    return delivered;
  };

  return { afterMoment };
}
