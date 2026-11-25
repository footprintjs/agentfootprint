/**
 * callLLM — the LLM-invocation stage of the agent's chart.
 *
 * Reads the assembled prompt + messages from scope (populated by the
 * upstream slot subflows: SystemPrompt, Messages, Tools, CacheDecision,
 * CacheGate). Calls `provider.stream()` if available (token streaming
 * with per-chunk events) else falls back to `provider.complete()`.
 * Writes the response to scope (`llmLatestContent`, `llmLatestToolCalls`,
 * cumulative tokens) for the downstream Route decider to read.
 *
 * Emits `agentfootprint.stream.llm_start` + `llm_end` brackets for
 * observability adapters and per-chunk `stream.token` events during
 * streaming. Emits `cost.tick` via `emitCostTick` when a `pricingTable`
 * is configured.
 *
 * Factory signature so the chart-build-time provider/model/etc. deps
 * are explicit. The `toolSchemas` value is late-bound via a getter
 * because tool schema composition completes after the seed factory is
 * built but before the chart actually runs.
 */

import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';
import type { CallLLMStageDeps } from './callLLM/types.js';
import { prepareCall } from './callLLM/prepareCall.js';
import { executeCall } from './callLLM/executeCall.js';
import { acceptResponse } from './callLLM/acceptResponse.js';
import { admitProviderIntervention } from '../../providerIntervention.js';
import { recordTerminalResponse } from './callLLM/responseAccounting.js';
import { rememberForCall } from '../contextBinding/forCall.js';

// LENS · system-text + tool-list · request-ephemeral
// reads: systemPrompt ← scope.systemPromptInjections, joined by `systemPrompt` below (the system-prompt slot's output)
//        messages ← scope.history (`history`; `messages` is its wire-only collapse of judged tool results under `.findings()` — `collapseJudged`); tools ← scope.dynamicToolSchemas (`registeredToolSchemas`), EMPTIED to EMPTY_TOOL_SCHEMAS under scope.wrapUpAsked
//        ontology piece ← scope.ontology (`ontologyPieceRecord`, under `deps.ontology` only), joined after the recovery piece
//        findings DATA ← scope.findingsLedger (under `deps.hasFindingsLedger` only), appended after committed history
//        brain ← deps.brainFor(nextSkillCursor ?? currentSkillId)
// THIS is the wire, assembled by `callLLM/prepareCall.ts · prepareCall` inside the
// native stage `buildCallLLMStage` wires — cite that assembly owner, not this header,
// when another file points at the assembly. The three slots feed it; they are not it. The staged-refs
// nudge appended by `wireMessages` exists on THIS request only — scope.history is untouched, which is the right
// lifetime for a forward-looking sentence.
// law: may omit, never deny; every clause anchored to the call it was composed on.
/**
 * Build the callLLM stage function. Captures the LLM provider + model
 * config + cache strategy via the deps object; everything per-iteration
 * comes from scope.
 */
export function buildCallLLMStage(
  deps: CallLLMStageDeps,
): (scope: TypedScope<AgentState>) => Promise<void> {
  return async (scope) => {
    const prepared = await prepareCall(scope, deps);
    // A bound model's tool turn whose context changed under its signed
    // reasoning stops here, named, before the adapter's own guard would.
    const refusal = prepared.contextCheck?.outcome.refusal;
    if (refusal !== undefined) throw refusal;
    const executed = await executeCall(scope, deps, prepared);
    if (executed === undefined) return;
    if (
      admitProviderIntervention(scope, executed.response, () =>
        recordTerminalResponse(scope, deps, prepared, executed),
      )
    )
      return;
    await acceptResponse(scope, deps, prepared, executed);
    rememberForCall(deps, prepared.contextCheck, executed.response);
  };
}

export type { CallLLMStageDeps } from './callLLM/types.js';
