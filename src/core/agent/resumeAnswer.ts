import { throwIfAborted } from '../../lib/abort.js';
import { knownDecisionState, hasLocalClose } from '../consentLedger.js';
import type { MemoryIdentity } from '../../memory/identity/types.js';
import { sameIdentity } from './callerIdentity.js';
import { ResumeIdentityConflictError } from '../conversation.js';
import type { FlowchartCheckpoint } from 'footprintjs';
import {
  closedProvenKey,
  ledgerIdentityOf,
  notePreviouslySpentDecision,
  type DecisionLedger,
} from '../consentRequest.js';
import { PauseAnswerRequiredError, ResumeDecisionError, type ConsentGate } from '../pause.js';
import { ownField } from './checkpointDomain.js';
import { isArgumentAskPause } from './arguments/askMarker.js';

/** A synchronous issued-ledger read may refuse a replay; only atomic spend authorizes execution. */
export async function refuseKnownSpentAnswer(
  ledger: DecisionLedger,
  input: unknown,
  gate: ConsentGate,
  signal?: AbortSignal,
  envSignal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  throwIfAborted(envSignal);
  const requestId = ownField(input, 'requestId');
  if (typeof requestId !== 'string') return;
  const localClose = hasLocalClose(ledgerIdentityOf(ledger), requestId);
  if (knownDecisionState(ledger, requestId) !== true && !localClose) return;
  notePreviouslySpentDecision(requestId);
  const closed = localClose || knownDecisionState(ledger, closedProvenKey(requestId)) === true;
  throw new ResumeDecisionError(closed ? 'closed-by-host' : 'already-answered', gate.kind);
}

/** The selected CODE-owned tool leaf, without starting or selecting a native execution. */
export function refuseMissingPlainAnswer(checkpoint: FlowchartCheckpoint, input: unknown): void {
  if (input !== undefined || isArgumentAskPause(checkpoint.pauseData)) return;
  const path = checkpoint.subflowPath;
  const leaf =
    path.length === 0
      ? checkpoint.sharedState
      : ownField(checkpoint.subflowStates, path[path.length - 1]!);
  if (ownField(leaf, 'pausedCredential') === true) return;
  const toolCallId = ownField(leaf, 'pausedToolCallId');
  const toolName = ownField(leaf, 'pausedToolName');
  if (typeof toolCallId === 'string' && typeof toolName === 'string')
    throw new PauseAnswerRequiredError({ toolCallId, toolName });
}

/** A follow-up never changes the selected conversation's explicitly named person. */
export function refuseFollowUpIdentity(
  named: MemoryIdentity | undefined,
  selected: MemoryIdentity | undefined,
): void {
  if (named !== undefined && (selected === undefined || !sameIdentity(named, selected)))
    throw new ResumeIdentityConflictError('followUp');
}
