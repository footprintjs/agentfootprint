/**
 * pendingAsk — what a paused run is waiting on, as data a door may hand back.
 *
 * ONE projection, used by every door that keeps a paused run for a later
 * request (`standingAgent`, `streamHandler`): the question, never the state.
 */

import { readAskComponent } from '../tools/askComponent.js';
import type { RunnerPauseOutcome } from '../core/pause.js';
import type { PendingAsk } from './types.js';

/**
 * Project a paused run into the part that is safe to hand back: the question,
 * never the state.
 *
 * Every field is read from what the run actually recorded — the tool name and
 * question the dispatch loop stamps on `pauseData`, the typed `checkIn`, the
 * middleware `ask`. A field the run did not record is simply absent. Nothing
 * here infers, summarises or invents, which is why the raw `pauseData` rides
 * along untouched: the tool's author chose those words.
 */
export function describePause(
  outcome: RunnerPauseOutcome,
  sessionId: string | undefined,
): PendingAsk {
  const data = outcome.pauseData as { toolName?: unknown; question?: unknown } | undefined;
  const tool = typeof data?.toolName === 'string' ? data.toolName : undefined;
  const question = typeof data?.question === 'string' ? data.question : undefined;
  // The typed half of the question (9.24.0), lifted from whichever pause kind
  // carried it — a plain ask keeps it at the top of `pauseData`, a check-in on
  // the typed request, a middleware ask on the question. `readAskComponent` is
  // the one reader of those homes; this projection is where a screen looks.
  const component = readAskComponent(outcome.pauseData);
  return {
    ...(sessionId !== undefined && { sessionId }),
    ...(tool !== undefined && { tool }),
    ...(question !== undefined && { question }),
    ...(outcome.checkIn !== undefined && { checkIn: outcome.checkIn }),
    ...(outcome.ask !== undefined && { ask: outcome.ask }),
    ...(outcome.awaitingInput !== undefined && { awaitingInput: outcome.awaitingInput }),
    ...(component !== undefined && { component }),
    pauseData: outcome.pauseData,
  };
}
