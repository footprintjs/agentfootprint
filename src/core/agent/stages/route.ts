/**
 * route — decider that branches the ReAct loop into 'tool-calls' or 'final'.
 *
 * Runs after CallLLM. If the LLM returned tool calls AND we haven't hit
 * `maxIterations`, route to the tool execution branch (which loops back
 * to PromptBuilder). Otherwise route to the final-branch subflow which
 * persists memory writes and breaks the loop.
 *
 * Emits `agentfootprint.agent.route_decided` with the chosen branch +
 * a human-readable rationale (visible in narrative + observability).
 *
 * Pure function — no closure over Agent class state. Imported and
 * passed directly to `addDeciderFunction(...)` in buildAgentChart.
 */

import type { TypedScope } from 'footprintjs';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import type { AgentState } from '../types.js';
import type { LLMMessage } from '../../../adapters/types.js';
import type { MessageMiddleware } from '../middleware/types.js';
import { runMessageChain } from '../middleware/runChain.js';
import { recordDecisions } from '../middleware/ledger.js';

export type RouteBranch = 'tool-calls' | 'final';

export const routeDeciderStage = (scope: TypedScope<AgentState>): RouteBranch => {
  const toolCalls = scope.llmLatestToolCalls as readonly { name: string }[];
  const iteration = scope.iteration as number;
  const chosen: RouteBranch =
    toolCalls.length > 0 && iteration < scope.maxIterations ? 'tool-calls' : 'final';

  typedEmit(scope, 'agentfootprint.agent.route_decided', {
    turnIndex: 0,
    iterIndex: iteration,
    chosen,
    rationale:
      chosen === 'tool-calls'
        ? `LLM requested ${toolCalls.length} tool call(s)`
        : iteration >= scope.maxIterations
        ? 'maxIterations reached — forcing final'
        : 'LLM produced no tool calls — final answer',
  });

  return chosen;
};

/**
 * Build the Route decider, optionally carrying the `'output'` half of the
 * message chain.
 *
 * ## Why the chain runs HERE and not in PrepareFinal
 *
 * PrepareFinal is where `finalContent` is set, which makes it look like the
 * output seam. It is not, for one structural reason: it lives inside the Final
 * BRANCH subflow, and a branch mount hands its `outputMapper` the branch's
 * RESULT, not its scope — so nothing that stage writes reaches the run's
 * shared state. Ledger rows filed there would sit in an isolated commit log,
 * and one ledger would be split across two places a reader has to know about.
 *
 * The decider is one stage earlier, in the main chart, and it is the first
 * moment the run KNOWS this turn is the final answer. Its writes commit before
 * the branch resolves (footprintjs commits a decider stage ahead of matching
 * the branch), and the value it rewrites — `llmLatestContent` — is exactly
 * what PrepareFinal copies into `finalContent`. So the caller, the committed
 * record, the `newMessages` the memory writes persist, and the ledger row all
 * carry the same string. One seam, one answer.
 *
 * The `'tool-calls'` path is untouched: a turn that is still calling tools has
 * not produced an answer, and running an output rule over a half-finished turn
 * would be running it over something that is not the output.
 *
 * Empty chain → the exact synchronous decider this file has always exported.
 */
export function buildRouteDeciderStage(
  messageMiddleware?: readonly MessageMiddleware[],
): (scope: TypedScope<AgentState>) => RouteBranch | Promise<RouteBranch> {
  const chain = messageMiddleware ?? [];
  if (chain.length === 0) return routeDeciderStage;
  return async (scope) => {
    const chosen = routeDeciderStage(scope);
    if (chosen !== 'final') return chosen;

    const verdict = await runMessageChain(chain, {
      phase: 'output',
      content: scope.llmLatestContent,
      history: [...(scope.history as readonly LLMMessage[])],
      iteration: scope.iteration,
      ...(scope.runIdentity && { identity: scope.runIdentity }),
    });
    recordDecisions(scope, verdict.decisions);
    if (verdict.kind === 'deny') {
      // The answer is NOT released. It stays in the commit log where the run
      // put it, under whatever redaction the run configured, and the boundary
      // raises instead of returning — handing the caller a refusal in place of
      // an answer is the one substitution they must never make unknowingly.
      scope.messageDeniedReason = verdict.reason;
      scope.messageDeniedPhase = 'output';
      scope.messageDeniedBy = verdict.middleware;
    }
    // Committed either way: on a refusal this is what was withheld, and the
    // ledger row beside it says who withheld it and why.
    scope.llmLatestContent = verdict.content;
    return chosen;
  };
}
