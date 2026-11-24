import type { TypedScope } from 'footprintjs';
import type { LLMMessage } from '../../../provider-contract/types.js';
import { runMessageChain } from '../../../tools/runChain.js';
import { applyOutputSchema } from '../../../answer-validation/outputSchema.js';
import { typedEmit, emitTurnEnd } from '../../../recorders/core/typedEmit.js';
import { recordDecisions } from '../middleware/ledger.js';
import type { AgentState } from '../types.js';
import type { AgentConfiguration } from '../runtime/configuration/types.js';
import type { AgentRunValues } from '../runValues.js';
import type { RunnerScopeValues } from '../../runnerExecution.js';

/** Only deterministic output checks may admit a host reply. The candidate
 * stays outside recorded scope until those checks have accepted its wording. */
export async function settleHostReply(
  scope: TypedScope<AgentState>,
  run: RunnerScopeValues<AgentRunValues>,
  config: AgentConfiguration,
): Promise<void> {
  const decision = run.value.hostTurn;
  if (!decision) throw new Error('A host decision is required');
  scope.$getEnv()?.signal?.throwIfAborted();
  if (
    config.answerValidationConfig ||
    config.evidenceGate ||
    config.negativeClaimsConfig ||
    config.findingsOptions ||
    config.answerLayerOption?.standingLine === 'always' ||
    config.answerLayerOption?.standingLineRaiseOn !== undefined ||
    config.limitsTravelWithTheAnswerValue ||
    config.scriptTravel ||
    config.typedNegativeClaimsConfig ||
    config.memories.some((m) => m.write && (m.type !== 'episodic' || m.strategy !== 'window'))
  )
    throw new Error('The configured terminal policy requires an ordinary agent turn');
  const verdict = await runMessageChain(config.messageMiddleware, {
    phase: 'output',
    content: decision.reply,
    iteration: 0,
    history: (scope.$getValue('history') as readonly LLMMessage[] | undefined) ?? [],
    identity: run.value.identity ?? scope.runIdentity,
  });
  // Record the middleware's decision without publishing a withheld candidate
  // or any intermediate rewrite through its before/after fields.
  recordDecisions(
    scope,
    verdict.decisions.map(({ middleware, at, moment, phase, iteration, outcome, changed }) => ({
      middleware,
      at,
      moment,
      phase,
      iteration,
      outcome,
      changed,
    })),
  );
  if (verdict.kind === 'deny') {
    scope.messageDeniedPhase = 'output';
    scope.messageDeniedBy = verdict.middleware;
    scope.messageDeniedReason = verdict.reason;
    scope.$break('Output policy withheld the host reply');
    return;
  }
  if (config.outputSchemaParser) {
    try {
      applyOutputSchema(verdict.content, config.outputSchemaParser);
    } catch {
      throw new Error('The host reply did not satisfy the output schema');
    }
  }
  scope.$getEnv()?.signal?.throwIfAborted();
  const reply: LLMMessage = {
    role: 'assistant',
    content: verdict.content,
    replyOrigin: { kind: 'host', runId: run.context.runId },
  };
  scope.finalContent = reply.content;
  scope.newMessages = decision.hasInput
    ? [{ role: 'user', content: scope.userMessage }, reply]
    : [reply];
  run.value.hostSettlement = reply;
}

export function finishHostReply(scope: TypedScope<AgentState>): string {
  scope.$getEnv()?.signal?.throwIfAborted();
  const content = scope.finalContent;
  if (content.length)
    typedEmit(scope, 'agentfootprint.stream.token', { iteration: 0, tokenIndex: 0, content });
  emitTurnEnd(scope, {
    turnIndex: 0,
    finalContent: content,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    iterationCount: 0,
    durationMs: Date.now() - scope.turnStartMs,
  });
  scope.$break('Host reply delivered');
  return content;
}

export function chooseHostTurn(
  scope: TypedScope<AgentState>,
  run: RunnerScopeValues<AgentRunValues>,
  config: AgentConfiguration,
): string | Promise<string> {
  if (!run.value.hostTurn) return 'model';
  scope.hostEndReason = run.value.hostTurn.reason;
  return settleHostReply(scope, run, config).then(() => 'host');
}
