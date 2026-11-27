import type { AgentRunCheckpoint } from '../../core/runCheckpoint.js';
import { AGENT_CHECKPOINT_VERSION } from '../../core/runCheckpointTypes.js';
import { closedConversation } from '../answeredPause.js';
import type { ThreadBinding } from '../protocolAdapter.js';
import type { SessionLifecycle } from '../types.js';
import type { Held, AcceptedStreamTurn, StreamRunner } from './types.js';

/**
 * A held thread whose pause no answer can reach, with the conversation it goes
 * on from (`answeredPause.ts` · `closedConversation`) — settled against this
 * request's runner and the handler's session store, which together say
 * whether the calls the pause left open provably never ran. Any other held thread is handed back as it was.
 */
export async function settleClosed(
  held: Held,
  runner: StreamRunner,
  store: SessionLifecycle | undefined,
): Promise<Held> {
  return held.closed === undefined
    ? held
    : { ...held, prior: await closedConversation(held.closed.paused, { runner, store }) };
}

/**
 * A conversation record for a runner that keeps none (an `LLMCall`, a
 * composition): no history, only what a stored session needs — the run, the
 * message, and whose it is.
 */
export function noConversation(
  turn: AcceptedStreamTurn<unknown>,
  recordRunId: string | undefined,
  identity: ThreadBinding['identity'],
): AgentRunCheckpoint {
  const message =
    turn.plan.turn.kind === 'message'
      ? turn.plan.turn.message
      : turn.held.paused?.conversation.originalInput.message ?? '';
  return {
    version: AGENT_CHECKPOINT_VERSION,
    runId: recordRunId ?? 'unknown',
    history: [],
    lastCompletedIteration: 0,
    originalInput: { message },
    checkpointedAt: Date.now(),
    ...(identity !== undefined && { identity }),
  };
}
