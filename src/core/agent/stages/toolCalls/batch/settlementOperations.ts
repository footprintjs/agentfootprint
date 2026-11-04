import type { buildToolResolver } from '../../toolResolver.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import { joinSystemPrompt } from '../../../composeRequest.js';
import type { InjectionRecord } from '../../../../../recorders/core/types.js';
import type { BatchSettlement } from '../contracts/callFacts.js';
import { pausedBatchOf } from './paused.js';
import { notDispatchedResult, notDispatchedMarker } from './settle.js';
import type { ToolSettlementOperations } from '../contracts/operations/settlement.js';
import type { ToolScriptsOperations } from '../contracts/operations/scripts.js';
import type { ToolCatalogOperations } from '../contracts/operations/catalog.js';
import type { ToolObservationsOperations } from '../contracts/operations/observations.js';

interface ToolSettlementOperationsLinks {
  readonly fileScript: ToolScriptsOperations['fileScript'];
  readonly resolveTool: ReturnType<typeof buildToolResolver>;
  readonly programOfCall: ToolScriptsOperations['programOfCall'];
  readonly peelCall: ToolCatalogOperations['peelCall'];
  readonly emitToolStart: ToolObservationsOperations['emitToolStart'];
  readonly emitToolEnd: ToolObservationsOperations['emitToolEnd'];
}

/** Compose the existing settlement callbacks once for this handler. */
export function buildToolSettlementOperations(
  deps: Pick<ToolCallsHandlerDeps, 'scriptRecord'>,
  links: ToolSettlementOperationsLinks,
): ToolSettlementOperations {
  /**
   * The conversation the check-in gate judges — the run history with a synthetic
   * `system` frame in front of it.
   *
   * The system prompt is not in `scope.history` (the slots assemble it
   * separately), so without this the evidence's `read` and the `drivers` ranking
   * could cite the conversation but never a system RULE, and a `CheckInDemand`
   * predicate reading `ctx.history` would be judging a different conversation
   * than the one the run actually had.
   *
   * Hoisted to the handler closure because BOTH gate sites need the SAME shape:
   * the loop's gate (which decides whether to pause) and the ask-resume gate
   * (which decides whether that pause was owed). A predicate that answered
   * differently on the two sides would make the refusal depend on which door the
   * call came through, and that is not a property of the tool.
   */
  const historyForCheckIn = (
    scope: TypedScope<AgentState>,
    history: readonly LLMMessage[],
  ): LLMMessage[] => {
    const systemPrompt = joinSystemPrompt(
      (scope.systemPromptInjections as readonly InjectionRecord[] | undefined) ?? [],
    );
    return systemPrompt ? [{ role: 'system', content: systemPrompt }, ...history] : [...history];
  };

  const settleBatch = (
    answered: LLMMessage[],
    paused: { readonly toolName: string; readonly toolCallId: string },
  ): BatchSettlement => {
    const batch = pausedBatchOf(answered, paused.toolCallId);
    if (batch.undispatched.length === 0)
      return { history: answered, settled: [], size: batch.size, paused };
    const settled = batch.undispatched.map((call) => ({
      call,
      result: notDispatchedResult(call.name, paused),
    }));
    return {
      history: [
        ...answered,
        ...settled.map(
          ({ call, result }): LLMMessage => ({
            role: 'tool',
            content: result,
            toolCallId: call.id,
            toolName: call.name,
            notDispatched: notDispatchedMarker(paused),
          }),
        ),
      ],
      settled,
      size: batch.size,
      paused,
    };
  };

  /**
   * Each settled sibling's bracket, after the paused call's own `tool_end` —
   * the ONE site that stamps `notDispatched` on the stream: `tool_start` with
   * the args the call would have run with (the batch loop's peel, so
   * `_findings` never shows on a bracket), then `tool_end` carrying the
   * sentence and `durationMs: 0`. Both carry the marker the history message
   * carries (`notDispatchedMarker`), and no other bracket in the library ever
   * does.
   *
   * No `error`. It says a call FAILED — the tool threw, or the call itself
   * could not run as written (an args rejection, a `wants` block, a consent
   * the tool needed and did not get, an unknown name). A settled call did not
   * fail: the library decided not to dispatch it, as it does for a call a
   * permission policy denies or halts, and those brackets carry no `error`
   * either. Stamped here, it would register a tool failure in every
   * error-rate reader (a span status, a dashboard, an alert) on every
   * mid-batch pause, and say a second, false thing beside the marker, which
   * is the one owner of why there is no result (`src/core/README.md` · "One
   * owner of 'never dispatched' — in history and on the stream", the reader
   * table). No `status` either: that field is the TOOL's own word.
   */
  const bracketSettled = (scope: TypedScope<AgentState>, settlement: BatchSettlement): void => {
    for (const { call, result } of settlement.settled) {
      // Never dispatched: the program is on the record as proposed, `submitted`.
      // Guarded here — the arguments read the scope, and an unarmed agent reads
      // nothing new.
      if (deps.scriptRecord === true) {
        links.fileScript(scope, {
          tool: links.resolveTool(call.name).tool,
          toolName: call.name,
          toolCallId: call.id,
          iteration: scope.iteration as number,
          proposed: links.programOfCall(
            links.resolveTool(call.name).tool,
            links.peelCall(call).args,
          ),
          settlement: 'not-entered',
        });
      }
      links.emitToolStart(scope, {
        toolName: call.name,
        toolCallId: call.id,
        args: links.peelCall(call).args,
        parallelCount: settlement.size,
        notDispatched: notDispatchedMarker(settlement.paused),
      });
      links.emitToolEnd(
        scope,
        call.name,
        {
          toolCallId: call.id,
          result,
          durationMs: 0,
          notDispatched: notDispatchedMarker(settlement.paused),
        },
        false,
      );
    }
  };

  return { historyForCheckIn, settleBatch, bracketSettled };
}
