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
import {
  judgeAnswer,
  recordOutputAttempt,
  type ResolvedOutputEnforcement,
} from '../outputEnforcement.js';

export type RouteBranch = 'tool-calls' | 'final' | 'output-retry';

/** The base decision, with the sentence that explains it. Split out so the
 *  enforcement-enabled path can decide, then judge, then announce ONCE — an
 *  agent whose answer is about to be re-asked should not have a route event
 *  saying it finished. */
function decideBranch(scope: TypedScope<AgentState>): {
  chosen: 'tool-calls' | 'final';
  rationale: string;
  /** Set when a LIMIT forced `'final'` while tool calls were still pending. */
  earlyStop?: 'max-iterations' | 'cost-budget';
} {
  const toolCalls = scope.llmLatestToolCalls as readonly { name: string }[];
  const iteration = scope.iteration as number;
  // A halting `costBudget` stops the loop HERE, at the same boundary
  // maxIterations uses (8.14.0). Never mid-call: the call that crossed the
  // budget has already completed, been billed and been recorded — this only
  // decides that there will not be another one.
  const costHalt = scope.costBudgetHit === true && scope.costBudgetOnExceed === 'halt';
  const outOfIterations = iteration >= scope.maxIterations;
  const chosen = toolCalls.length > 0 && !outOfIterations && !costHalt ? 'tool-calls' : 'final';
  // A limit only CUT SHORT a turn if the model still wanted to do something.
  // A turn that ended because the model was done is not an early stop, however
  // many iterations it spent getting there.
  const earlyStop =
    chosen === 'final' && toolCalls.length > 0
      ? outOfIterations
        ? ('max-iterations' as const)
        : costHalt
        ? ('cost-budget' as const)
        : undefined
      : undefined;
  return {
    chosen,
    rationale:
      chosen === 'tool-calls'
        ? `LLM requested ${toolCalls.length} tool call(s)`
        : outOfIterations
        ? 'maxIterations reached — forcing final'
        : costHalt
        ? 'costBudget reached (onExceed: halt) — forcing final'
        : 'LLM produced no tool calls — final answer',
    ...(earlyStop !== undefined && { earlyStop }),
  };
}

/**
 * Record — and announce — a turn that a LIMIT cut short.
 *
 * Fires only when the model asked for tools and this decider refused to run
 * them. A turn that ended because the model was finished is not an early stop,
 * however many iterations it used.
 *
 * Three channels, deliberately, because before 8.14.0 there were none and the
 * caller received `''`:
 *
 *   1. `cost.limit_hit` — the reserved vocabulary (`kind: 'max_iterations'`
 *      has been in `CostLimitHitPayload` since it was written). **Only for the
 *      iteration limit.** A cost budget already emitted its own one-shot
 *      `limit_hit` from `emitCostTick`, at the moment it was crossed, carrying
 *      the real budget as `limit` — and since 8.14.0 carrying `action: 'abort'`
 *      when it is set to halt. A second event here would double-count the
 *      crossing AND report `limit` as the cumulative spend, which is not the
 *      limit;
 *   2. `scope.stoppedEarly` — committed, so the fact is provable after the run
 *      rather than only observable by whoever happened to be subscribed. Both
 *      reasons write it;
 *   3. a `console.warn`, once, and ONLY when the answer is empty — an empty
 *      string reaching a user is indistinguishable from a bug, and the library
 *      knows exactly why it is empty. Both reasons.
 *
 * It does NOT throw. Unlike 8.6.0's outstanding-consent case — a fault, where
 * the run hands back a plausible answer for work a tool never did — this is a
 * limit the consumer set doing precisely what it was set to do, and the answer
 * is sometimes a real one (a model can return content AND tool calls). Raising
 * would reject good answers to fix a bad one.
 */
function recordEarlyStop(
  scope: TypedScope<AgentState>,
  reason: 'max-iterations' | 'cost-budget',
): void {
  const toolCalls = scope.llmLatestToolCalls as readonly { name: string }[];
  const iteration = scope.iteration as number;
  const answerWasEmpty = ((scope.llmLatestContent as string | undefined) ?? '') === '';

  scope.stoppedEarly = {
    reason,
    iteration,
    pendingToolCalls: toolCalls.length,
    answerWasEmpty,
  };

  if (reason === 'max-iterations') {
    typedEmit(scope, 'agentfootprint.cost.limit_hit', {
      kind: 'max_iterations',
      limit: scope.maxIterations as number,
      actual: iteration,
      action: 'abort',
    });
  }

  if (answerWasEmpty) {
    // eslint-disable-next-line no-console
    console.warn(
      `[agentfootprint] this turn stopped at iteration ${iteration} because ` +
        `${
          reason === 'max-iterations' ? 'maxIterations was reached' : 'costBudget was reached'
        }, ` +
        `while the model was still asking for ${toolCalls.length} tool call(s). Those calls did ` +
        `not run, so the answer handed back is the empty string — not a refusal, and not the ` +
        `model's conclusion. Raise the limit, or read agent.stoppedEarly() and decide what to ` +
        `show.`,
    );
  }
}

function emitRouteDecided(
  scope: TypedScope<AgentState>,
  chosen: RouteBranch,
  rationale: string,
): void {
  typedEmit(scope, 'agentfootprint.agent.route_decided', {
    turnIndex: 0,
    iterIndex: scope.iteration as number,
    chosen,
    rationale,
  });
}

export const routeDeciderStage = (scope: TypedScope<AgentState>): RouteBranch => {
  const { chosen, rationale, earlyStop } = decideBranch(scope);
  emitRouteDecided(scope, chosen, rationale);
  if (earlyStop !== undefined) recordEarlyStop(scope, earlyStop);
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
 *
 * ## Why the schema is judged HERE too
 *
 * The same property that made this the output seam makes it the enforcement
 * seam. `outputSchema` used to be judged only at the caller's boundary, after
 * the run — a fine place to reject an answer and a useless place to fix one,
 * because the loop has already stopped. Judged here, one stage before the
 * Final branch, the run still HAS a loop: a failed answer can route to
 * `'output-retry'`, which loops back for one more real turn.
 *
 * The judging runs AFTER the message chain, over the content the chain
 * produced, because that is the string the caller will receive — validating
 * the pre-chain value would judge an answer nobody gets. A DENIED answer is
 * never judged or retried: it was withheld on purpose, and re-asking for it
 * would be the library working around a rule the app wrote.
 */
export function buildRouteDeciderStage(
  messageMiddleware?: readonly MessageMiddleware[],
  enforcement?: ResolvedOutputEnforcement,
): (scope: TypedScope<AgentState>) => RouteBranch | Promise<RouteBranch> {
  const chain = messageMiddleware ?? [];
  if (chain.length === 0 && enforcement === undefined) return routeDeciderStage;
  if (enforcement !== undefined) return buildEnforcingDecider(chain, enforcement);
  return async (scope) => {
    const { chosen, rationale, earlyStop } = decideBranch(scope);
    emitRouteDecided(scope, chosen, rationale);
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
    // AFTER the chain: `answerWasEmpty` has to be judged on the string the
    // caller will actually receive, and the chain may have rewritten it.
    if (earlyStop !== undefined) recordEarlyStop(scope, earlyStop);
    return chosen;
  };
}

/**
 * The decider an agent with `.outputSchema(parser, { retries })` runs:
 * decide, run the output chain if there is one, judge the answer, THEN
 * announce the branch — so `route_decided` names the branch the run actually
 * took rather than the one it was heading for.
 */
function buildEnforcingDecider(
  chain: readonly MessageMiddleware[],
  enforcement: ResolvedOutputEnforcement,
): (scope: TypedScope<AgentState>) => Promise<RouteBranch> {
  return async (scope) => {
    const base = decideBranch(scope);
    if (base.chosen !== 'final') {
      emitRouteDecided(scope, base.chosen, base.rationale);
      return base.chosen;
    }

    let denied = false;
    if (chain.length > 0) {
      const verdict = await runMessageChain(chain, {
        phase: 'output',
        content: scope.llmLatestContent,
        history: [...(scope.history as readonly LLMMessage[])],
        iteration: scope.iteration,
        ...(scope.runIdentity && { identity: scope.runIdentity }),
      });
      recordDecisions(scope, verdict.decisions);
      if (verdict.kind === 'deny') {
        denied = true;
        scope.messageDeniedReason = verdict.reason;
        scope.messageDeniedPhase = 'output';
        scope.messageDeniedBy = verdict.middleware;
      }
      scope.llmLatestContent = verdict.content;
    }

    // A withheld answer is not judged and never re-asked. The app decided
    // nobody gets this string; asking the model for a better-shaped version
    // of it would be the library routing around that decision.
    if (denied) {
      emitRouteDecided(scope, 'final', base.rationale);
      if (base.earlyStop !== undefined) recordEarlyStop(scope, base.earlyStop);
      return 'final';
    }

    const attempt = ((scope.outputAttempts?.length as number | undefined) ?? 0) + 1;
    const failure = judgeAnswer(scope.llmLatestContent as string, enforcement.parser);

    if (failure === undefined) {
      recordOutputAttempt(scope, {
        attempt,
        iteration: scope.iteration as number,
        outcome: 'passed',
      });
      emitRouteDecided(scope, 'final', base.rationale);
      if (base.earlyStop !== undefined) recordEarlyStop(scope, base.earlyStop);
      return 'final';
    }

    if (attempt <= enforcement.retries) {
      // The retry stage writes the correction and files the row, because it
      // is the one that knows what it wrote. This is the hand-off.
      scope.outputSchemaFailure = { attempt, ...failure };
      emitRouteDecided(
        scope,
        'output-retry',
        `final answer failed the output schema (${failure.stage}) — ` +
          `asking again, attempt ${attempt + 1} of ${enforcement.retries + 1}`,
      );
      return 'output-retry';
    }

    // Out of retries. The answer stands as the run's answer; `runTyped()`
    // throws on it at the boundary exactly as it did before any of this
    // existed, and `.outputFallback()` still gets its turn there.
    recordOutputAttempt(scope, {
      attempt,
      iteration: scope.iteration as number,
      outcome: 'exhausted',
      stage: failure.stage,
      error: failure.error,
      ...(failure.path !== undefined && { path: failure.path }),
    });
    emitRouteDecided(
      scope,
      'final',
      `final answer failed the output schema (${failure.stage}) and ` +
        `${enforcement.retries} retry/retries were spent`,
    );
    if (base.earlyStop !== undefined) recordEarlyStop(scope, base.earlyStop);
    return 'final';
  };
}
