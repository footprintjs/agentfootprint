import type { FlowchartCheckpoint } from 'footprintjs';
import {
  ResumeDecisionError,
  DecisionRequiredError,
  PauseAnswerRequiredError,
  type RunnerPauseOutcome,
} from '../pause.js';
import type { ComponentResources } from './componentResources.js';
import type { PauseOwnership } from '../runnerLive.js';
import type { AgentRunValues } from './runValues.js';
import type { ToolSessionTier } from '../../tools/toolSessions.js';
import { readToolOwner } from '../../tools/toolResourceOwner.js';
import { callerIdentityOf, restoredIdentityOf } from './callerIdentity.js';
import { resumeSessionOf, resumeStateOf } from './resumeCheckpoint.js';
import { ResumeIdentityConflictError } from '../conversation.js';

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

/** Named refusals that hand no answer to a paused tool. */
export function isUnansweredPause(error: unknown): boolean {
  return (
    error instanceof ResumeDecisionError ||
    error instanceof DecisionRequiredError ||
    error instanceof PauseAnswerRequiredError
  );
}

/** Native finalization still joins; only the retained owner's terminal differs. */
export async function withUnansweredPause<T>(
  resources: ComponentResources | undefined,
  body: () => T | Promise<T>,
): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (isUnansweredPause(error)) resources?.retainPause();
    throw error;
  }
}
