import type { FlowchartCheckpoint } from 'footprintjs';
import { type RunnerPauseOutcome } from '../pause.js';
import type { PauseOwnership } from '../runnerLive.js';
import type { AgentRunValues } from './runValues.js';
import type { ToolSessionTier } from '../../tools/toolSessions.js';
import { readToolOwner } from '../../tools/toolResourceOwner.js';
import { callerIdentityOf, restoredIdentityOf } from './callerIdentity.js';
import { resumeSessionOf, resumeStateOf } from './resumeCheckpoint.js';
import { ResumeIdentityConflictError } from '../conversation.js';

/** Only descriptive question fields; no executable authority is inferred. */
export function pendingQuestionOf(data: unknown): NonNullable<AgentRunValues['pendingQuestion']> {
  const question = data as
    | { toolName?: unknown; toolCallId?: unknown; question?: unknown }
    | undefined;
  return {
    ...(typeof question?.toolName === 'string' && { toolName: question.toolName }),
    ...(typeof question?.toolCallId === 'string' && { toolCallId: question.toolCallId }),
    ...(typeof question?.question === 'string' && { question: question.question }),
  };
}

/** An actual returned occurrence, captured before a host crosses an await. */
export function capturePauseOwnership(
  values: AgentRunValues | undefined,
  outcome: RunnerPauseOutcome,
): PauseOwnership | undefined {
  if (values?.pauseOutcome !== outcome || values.pendingQuestion === undefined) return undefined;
  const question = values.pendingQuestion;
  const resources = values.resources;
  let settled = false;
  const release = (): void => {
    if (values.pendingQuestion === question) values.pendingQuestion = undefined;
    if (values.pauseOutcome === outcome) values.pauseOutcome = undefined;
  };
  return {
    release() {
      if (settled) return;
      settled = true;
      release();
    },
    async abandon() {
      if (settled) return;
      settled = true;
      await resources?.abandon();
      release();
    },
  };
}

/**
 * A later cancellation names the stored owner, not whatever a shared instance
 * ran last. This is local cleanup under the host's admitted stored checkpoint;
 * the reference is consistency data, never authentication or remote authority.
 */
export async function abandonStoredPause(
  checkpoint: FlowchartCheckpoint,
  tier: () => ToolSessionTier,
): Promise<void> {
  const state = resumeStateOf(checkpoint);
  if (restoredIdentityOf(state) === 'malformed') throw new ResumeIdentityConflictError();
  const sessionId = resumeSessionOf(checkpoint);
  const owner = readToolOwner(state.toolResourceOwner);
  const identity = callerIdentityOf(state);
  await tier().borrow(owner, { identity, sessionId }).finish(false);
}

/**
 * A refused native plan or setup has accepted no answer. Capture the exact
 * prior occurrence, and restore its guard on every exit without a new origin.
 * An admitted leg owns its answer even when later work fails; the named
 * unanswered-answer policy below still covers refusals inside that leg.
 */
export async function preservePendingQuestion<T>(
  previous: AgentRunValues | undefined,
  answerAdmitted: () => boolean,
  resume: () => T | Promise<T>,
): Promise<T> {
  const question = previous?.pendingQuestion;
  try {
    return await resume();
  } finally {
    if (previous !== undefined && !answerAdmitted()) previous.pendingQuestion = question;
  }
}
