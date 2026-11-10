import type { AgentRunOptions } from '../runOptions/options.js';
import { refuseFollowUpIdentity } from '../../resumeAnswer.js';
import { abandonPendingQuestion } from '../../pauseOwnership.js';
import { type RunnerPauseOutcome } from '../../../pause.js';
import { assertIdentityShape } from '../../callerIdentity.js';
import { validateCheckpoint, type AgentRunCheckpoint } from '../../../runCheckpoint.js';
import { NoConversationError } from '../../../conversation.js';
import type { AgentOutput } from '../../types.js';
import { requestOf } from '../../../requestOfRun.js';
import type { AgentContext } from '../contracts.js';

export async function followUp(
  this: Pick<AgentContext, 'checkpointFor' | 'lastInputRefused' | 'native' | 'runOwned'>,
  message: string,
  options?: AgentRunOptions,
): Promise<AgentOutput | RunnerPauseOutcome> {
  return this.native.runExecution().withRun(async (invocation) => {
    assertIdentityShape(options?.identity, 'Agent.followUp');
    // A continuation must exist before any history can be selected.
    if (
      invocation.previous?.view.snapshot() === undefined ||
      (this.lastInputRefused(invocation.previous?.view) && !invocation.previous?.value.hadAdmitted)
    ) {
      throw new NoConversationError('Agent.followUp', 'never-run');
    }
    const conversation = this.checkpointFor(invocation.previous);
    if (conversation === undefined || conversation.history.length === 0) {
      throw new NoConversationError(
        'Agent.followUp',
        this.lastInputRefused(invocation.previous?.view)
          ? 'last-input-refused'
          : 'last-run-unfinished',
      );
    }
    if (conversation.identity !== undefined)
      refuseFollowUpIdentity(options?.identity, conversation.identity);
    return this.runOwned(invocation, { message, continueFrom: conversation }, options);
  });
}

export async function abandonPause(
  this: Pick<AgentContext, 'native'>,
): Promise<
  | { readonly toolName?: string; readonly toolCallId?: string; readonly question?: string }
  | undefined
> {
  return this.native
    .runExecution()
    .withRun((invocation) => abandonPendingQuestion(invocation.previous?.value));
}

export async function resumeOnError(
  this: Pick<
    AgentContext,
    'applyContinuation' | 'assertNoPendingQuestion' | 'identityFor' | 'native' | 'runOwned'
  >,
  checkpoint: AgentRunCheckpoint | unknown,
  options?: AgentRunOptions,
): Promise<AgentOutput | RunnerPauseOutcome> {
  return this.native.runExecution().withRun(async (invocation) => {
    const cp = validateCheckpoint(checkpoint);
    // The timing guards run HERE, not only inside `run()`, because the line
    // below writes the side channel: a refusal after that write would leave a
    // restored history armed and the NEXT run would silently continue somebody
    // else's conversation.
    this.assertNoPendingQuestion('Agent.resumeOnError', invocation.previous?.value);
    // A request `run()` would refuse is refused HERE, before the side channel
    // below is armed — a refusal after it would leave the restored history for
    // the next, unrelated run.
    requestOf(options, 'Agent.resumeOnError');
    // Stash the checkpointed history on the side channel; the seed function
    // reads + clears it before scope.history initializes. No message is
    // appended — the failing run's message is already the last user turn in
    // that history, and adding it again would ask twice.
    this.applyContinuation(invocation.value, cp, 'Agent.resumeOnError', false);
    return this.runOwned(
      invocation,
      {
        message: cp.originalInput.message,
        // The conversation's own identity, unless this call named one. Until
        // 9.2.0 there was no way to pass either, so a recovered run silently
        // re-namespaced its memory under a fresh runId and wrote turn two
        // where turn three could not read it.
        ...(this.identityFor(options, cp) !== undefined && {
          identity: this.identityFor(options, cp),
        }),
      },
      options,
    );
  });
}
