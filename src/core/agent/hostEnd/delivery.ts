import { buildEventMeta } from '../../../bridge/eventMeta.js';
import type { EventDispatcher } from '../../../events/dispatcher.js';
import type { LLMMessage } from '../../../provider-contract/types.js';
import type { RunnerInvocation } from '../../runnerExecution.js';
import type { AgentRunValues } from '../runValues.js';
import type { HostMemoryInput, hostWriters } from './projection.js';

export interface HostAdmission {
  readonly signal?: AbortSignal;
  readonly deadline?: number;
  readonly reply: LLMMessage;
  readonly turnStartMs: number;
  readonly memoryInput: HostMemoryInput;
  readonly writers: ReturnType<typeof hostWriters>;
}

/** Called under the admitted lease after the last terminal and integrity veto.
 * Publication is synchronous. Store acknowledgments may arrive after cancellation. */
export async function deliverHostReply(
  invocation: RunnerInvocation<AgentRunValues>,
  admitted: HostAdmission,
  dispatcher: EventDispatcher,
  recording: { complete(value: string): void } | undefined,
): Promise<string> {
  const { reply } = admitted;
  const context = invocation.context();
  const serving = invocation.value.redaction?.serving;
  const stage = { runtimeStageId: '__host_settlement__' };
  admitted.signal?.throwIfAborted();
  if (admitted.deadline !== undefined && Date.now() >= admitted.deadline)
    throw new Error('Host turn deadline expired before delivery');
  invocation.value.hostSettlement = reply;
  invocation.value.answer = reply.content;
  recording?.complete(reply.content);
  if (reply.content.length)
    dispatcher.dispatchForRun(
      {
        type: 'agentfootprint.stream.token',
        meta: buildEventMeta(stage, context),
        payload: { iteration: 0, tokenIndex: 0, content: reply.content },
      },
      serving,
    );
  dispatcher.dispatchForRun(
    {
      type: 'agentfootprint.agent.turn_end',
      meta: buildEventMeta({ ...stage, rootTurn: true }, context),
      payload: {
        turnIndex: 0,
        finalContent: reply.content,
        replyAuthor: 'host',
        totalInputTokens: 0,
        totalOutputTokens: 0,
        iterationCount: 0,
        durationMs: Date.now() - admitted.turnStartMs,
      },
    },
    serving,
  );
  for (const writer of admitted.writers) {
    const outcome = await writer.write(admitted.memoryInput);
    dispatcher.dispatchForRun(
      {
        type: 'agentfootprint.memory.write_outcome',
        meta: buildEventMeta({ runtimeStageId: '__host_memory_projection__' }, context),
        payload: { memoryId: writer.id, outcome },
      },
      serving,
    );
  }
  return reply.content;
}
