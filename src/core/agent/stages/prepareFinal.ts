/**
 * prepareFinal — first stage of the agent's "Final" branch subflow.
 *
 * Captures the turn payload (`finalContent` from the LLM's latest
 * content; `newMessages` as the `[user, assistant]` pair the memory-
 * write subflows persist) and emits the per-turn observability
 * brackets (`iteration_end`, `turn_end`).
 *
 * Mounted as the FIRST stage of the final-branch subflow built in
 * `buildAgentChart`. Subsequent memory-write subflows mount AFTER this
 * stage so they have `newMessages` available; `breakFinal` is the
 * terminal stage that stops the ReAct loop.
 *
 * Pure function — no closure over Agent class state. Imported and
 * passed directly to `flowChart(...)` in buildAgentChart.
 *
 * NOT the seam for `messageMiddleware`'s `'output'` half, deliberately.
 * This stage runs inside the Final BRANCH subflow, whose state does not
 * merge back into the run (a branch mount hands its outputMapper the
 * branch's RESULT, not its scope). Rows filed here would land in an
 * isolated commit log and never reach `snapshot.sharedState`, splitting
 * one ledger across two places. The chain runs one stage earlier instead
 * — in the Route decider, in the main chart — and rewrites
 * `llmLatestContent`, which is the value this stage copies. See
 * `stages/route.ts`.
 */

import type { TypedScope } from 'footprintjs';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import { composeAnswerWithCoverage, copyCoverage, type Coverage } from '../coverage/index.js';
import type { AgentState } from '../types.js';

/**
 * The stage body, with the answer passed IN.
 *
 * One body, several entry points. The answer is a parameter rather than a
 * read of `scope.llmLatestContent` because `.limitsTravelWithTheAnswer()`
 * composes a different one — and everything filed here (`finalContent`,
 * `newMessages`, which memory persists, and `turn_end.finalContent`) must
 * agree about what the answer WAS. Note that `llmLatestContent` itself is a
 * READ-ONLY input to this branch subflow, so there is no version of this
 * where the composed answer is written back over it: the capture is the only
 * place all four readers meet.
 *
 * `answerCoverage` is a typed answer's limits
 * (`prepareFinalWithLimitsAsDataStage`), already detached: projected onto
 * `turn_end` beside the answer, never into it.
 */
const captureTurnPayload = (
  scope: TypedScope<AgentState>,
  answer: string,
  commitValidated = false,
  answerCoverage?: Coverage,
): void => {
  const iteration = scope.iteration;
  scope.finalContent = answer;
  // v2.14 — attach thinking blocks to the assistant final message
  // (if any). For non-Anthropic providers this is informational; for
  // Anthropic + extended-thinking-with-tool-use, signature round-trip
  // requires the blocks to persist on the assistant turn even when
  // it's the FINAL turn (continuation in the next user message).
  const thinkingBlocks = scope.thinkingBlocks;
  const hasThinking = thinkingBlocks !== undefined && thinkingBlocks.length > 0;
  // The turn payload memory writes persist: the user's message
  // paired with the agent's final answer.
  scope.newMessages = [
    { role: 'user', content: scope.userMessage },
    {
      role: 'assistant',
      content: scope.finalContent,
      ...(hasThinking && { thinkingBlocks }),
    },
  ];

  if (commitValidated) {
    scope.answerValidationCommitted = true;
    // The stream carries exactly the captured candidate, including any
    // earlier output transformation. Replaying provider chunks would undo it.
    if (answer.length > 0) {
      typedEmit(scope, 'agentfootprint.stream.token', {
        iteration,
        tokenIndex: 0,
        content: answer,
      });
    }
  }

  typedEmit(scope, 'agentfootprint.agent.iteration_end', {
    turnIndex: 0,
    iterIndex: iteration,
    toolCallCount: 0,
  });
  // 9.56.0 — a turn a LIMIT cut short says so ON `turn_end`, the event a
  // consumer already reads to render an outcome. Without it, `finalContent`
  // alone cannot tell a finished answer from the fragment a loop stopped in
  // the middle of, which is how a half-sentence ends up under a green tick.
  // Value-conditional and projected (never the whole committed record): a turn
  // that finished normally emits the exact payload it always did.
  const cut = scope.stoppedEarly;
  typedEmit(scope, 'agentfootprint.agent.turn_end', {
    turnIndex: 0,
    finalContent: scope.finalContent,
    totalInputTokens: scope.totalInputTokens,
    totalOutputTokens: scope.totalOutputTokens,
    iterationCount: iteration,
    durationMs: Date.now() - scope.turnStartMs,
    ...(cut !== undefined && {
      stoppedEarly: {
        reason: cut.reason,
        iteration: cut.iteration,
        pendingToolCalls: cut.pendingToolCalls,
        ...(cut.wrappedUp === true && { wrappedUp: true as const }),
      },
    }),
    // A typed answer's limits, beside it — the same value-conditional grammar:
    // a turn with nothing to carry emits the exact payload it always did.
    ...(answerCoverage !== undefined && { answerCoverage }),
  });
};

export const prepareFinalStage = (scope: TypedScope<AgentState>): void => {
  captureTurnPayload(scope, scope.llmLatestContent);
};

/**
 * Configured answer validation is the only door that may release its candidate.
 * The authoritative report lives in the outer Route stage. This defensive
 * final guard prevents a missing report or prior refusal from reaching the
 * capture, its public events or the memory writers mounted after it.
 */
export const prepareFinalWithValidationStage = (scope: TypedScope<AgentState>): void => {
  const report = scope.answerValidation;
  const mayDeliver =
    report !== undefined &&
    (report.mode === 'observe' ||
      (report.mode === 'enforce' && report.status === 'passed' && report.schemaAccepted === true));
  if (
    scope.answerValidationBlocked === true ||
    !mayDeliver ||
    scope.messageDeniedReason !== undefined ||
    scope.unsupportedValues?.refused === true
  ) {
    scope.$break('answer validation withheld terminal delivery');
    return;
  }
  captureTurnPayload(scope, scope.llmLatestContent, true);
};

/**
 * `.limitsTravelWithTheAnswer()` on a TYPED answer (`.outputSchema()`) — the
 * SAME stage, with the answer left exactly as the model sent it and the limits
 * carried beside it.
 *
 * Mounted in place of `prepareFinalStage` by both chart builders only when the
 * agent has an output schema AND asked for its limits to travel. The block
 * `prepareFinalWithLimitsStage` appends is prose, and a typed answer followed
 * by prose is not JSON — `runTyped()` threw on every answer that had limits.
 * So nothing is appended here: `finalContent`, the memory turn and
 * `turn_end.finalContent` all carry the model's (peeled) answer, and the limits
 * the block would have printed ride `turn_end.answerCoverage` — a projection
 * of `AgentState.answerCoverage`, which the Route decider committed on the main
 * chart (`./answerCoverage.ts` · `withAnswerCoverage`). The key is read only
 * under this arm: a run that asked for neither never reads it.
 */
export const prepareFinalWithLimitsAsDataStage = (scope: TypedScope<AgentState>): void => {
  const limits = scope.answerCoverage;
  captureTurnPayload(
    scope,
    scope.llmLatestContent,
    false,
    limits === undefined ? undefined : copyCoverage(limits),
  );
};

/**
 * `.limitsTravelWithTheAnswer()`'s half of prepare-final — the SAME stage,
 * with the run's declared coverage folded into the answer first.
 *
 * Mounted in place of `prepareFinalStage` by both chart builders when the
 * option is configured on an answer with no output schema, and nowhere else:
 * an agent that did not ask for it runs `prepareFinalStage`, byte for byte,
 * and a TYPED answer runs `prepareFinalWithLimitsAsDataStage` (above), which
 * appends nothing. Written as one stage rather than a second one because
 * everything the capture files must agree about what the answer WAS — a
 * second stage afterwards would leave `turn_end` reporting an answer the
 * caller never saw.
 *
 * It runs AFTER the evidence gate has judged (the gate is in the Route
 * decider, one stage earlier). That ordering is deliberate: the block is
 * composed by the framework out of what the TOOLS declared, so subjecting it
 * to a check for values the MODEL could not support would be asking whether
 * the library grounded itself.
 */
export const prepareFinalWithLimitsStage = (scope: TypedScope<AgentState>): void => {
  const declared = scope.coverageDeclared;
  const answer =
    declared !== undefined && declared.length > 0
      ? composeAnswerWithCoverage(scope.llmLatestContent, declared)
      : scope.llmLatestContent;
  captureTurnPayload(scope, answer);
};

/**
 * `.limitsTravelWithTheAnswer()` on an agent whose inputs layer is armed
 * (honesty layer 2) — the limits stage above, plus the values a tool's
 * `assume` rule filled THIS turn: "Assumed (a tool's rule, not your words)",
 * composed by the framework from the committed `argument` rows
 * (`arguments/serve.ts` · `assumedBlockOf`), so the model cannot drop it.
 *
 * Mounted in place of `prepareFinalWithLimitsStage` by both chart builders
 * ONLY when both arms are on — the one place the final branch reads the
 * ledger's argument rows, so a run that armed neither never reads the key (a
 * tracked read of a key a run never writes is a phantom context source). With
 * neither coverage nor an assumed value this turn, the answer is unchanged.
 * The block's reader is loaded through `import()` — the optional-family law
 * of docs-next's site budget — so this variant is async where the others are
 * not, and only an armed agent ever mounts it.
 *
 * `readsRewrites` — the agent has a before-tool middleware chain
 * (`.toolMiddleware()`), so a middleware may have rewritten an argument the
 * layer filled: the call then ran with the REWRITE's value, and a line naming
 * the filled one would put a value in the person's answer that the call did
 * not run with. The stage then reads `middlewareDecisions` and leaves such a
 * row out (omit, never deny) — the reading the answer's standing takes
 * (`middleware/rewrites.ts` · `argumentRewritesOf`), which reads the rewrite
 * itself. Without a chain the key can hold no tool rewrite and is never read.
 */
export function prepareFinalWithLimitsAndAssumedStage(
  readsRewrites: boolean,
): (scope: TypedScope<AgentState>) => Promise<void> {
  return async (scope) => {
    const { assumedBlockOf } = await import('../arguments/serve.js');
    const declared = scope.coverageDeclared ?? [];
    // The decisions are read only when there is a row a rewrite could
    // supersede — and only on an agent whose chain can write one.
    const assumed = assumedBlockOf(
      scope.findingsLedger ?? [],
      scope.turnNumber as number,
      readsRewrites
        ? () => [...((scope.middlewareDecisions as readonly unknown[] | undefined) ?? [])]
        : undefined,
    );
    const answer =
      declared.length > 0 || assumed !== ''
        ? composeAnswerWithCoverage(scope.llmLatestContent, declared, assumed)
        : scope.llmLatestContent;
    captureTurnPayload(scope, answer);
  };
}
