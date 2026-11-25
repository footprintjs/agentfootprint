import type { TypedScope } from 'footprintjs';
import type { LLMMessage } from '../../../provider-contract/types.js';
import { runMessageChain } from '../../../tools/runChain.js';
import { applyOutputSchema } from '../../../answer-validation/outputSchema.js';
import type { hostWriters } from './projection.js';
import { acceptedTurnMessages } from '../assistantReplay.js';
import { recordDecisions } from '../middleware/ledger.js';
import type { AgentState } from '../types.js';
import type { AgentConfiguration } from '../runtime/configuration/types.js';
import type { AgentRunValues } from '../runValues.js';
import type { RunnerScopeValues } from '../../runnerExecution.js';

/** Only deterministic output checks may admit a host reply. The candidate
 * stays outside recorded scope until those checks have accepted its wording. */
async function admitHostReply(
  scope: TypedScope<AgentState>,
  run: RunnerScopeValues<AgentRunValues>,
  config: AgentConfiguration,
  writers: ReturnType<typeof hostWriters>,
): Promise<void> {
  const decision = run.value.hostTurn;
  if (!decision) throw new Error('A host decision is required');
  const signal = scope.$getEnv()?.signal;
  signal?.throwIfAborted();
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
    signal,
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
    // A denial or a thrown callback may quote the candidate verbatim.
    // Retain the responsible middleware and outcome in the native record.
    scope.messageDeniedReason = 'Output policy withheld the host reply';
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
  signal?.throwIfAborted();
  const reply: LLMMessage = {
    role: 'assistant',
    content: verdict.content,
    replyOrigin: { kind: 'host', runId: run.context.runId },
  };
  run.value.hostAdmission = {
    reply,
    writers,
    signal,
    deadline: scope.$getEnv()?.deadline,
    turnStartMs: scope.turnStartMs,
    memoryInput: {
      runIdentity: { ...scope.runIdentity },
      turnNumber: scope.turnNumber,
      contextTokensRemaining: scope.contextTokensRemaining,
      newMessages: acceptedTurnMessages(decision.hasInput ? scope.userMessage : undefined, reply),
    },
  };
}

export function chooseHostTurn(
  scope: TypedScope<AgentState>,
  run: RunnerScopeValues<AgentRunValues>,
  config: AgentConfiguration,
  writers: ReturnType<typeof hostWriters>,
): string | Promise<string> {
  if (!run.value.hostTurn) return 'model';
  scope.hostEndReason = run.value.hostTurn.reason;
  return admitHostReply(scope, run, config, writers).then(() => 'host');
}
