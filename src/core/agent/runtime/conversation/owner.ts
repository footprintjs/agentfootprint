import type { AgentRunOptions } from '../runOptions/options.js';
import { evidenceRecoveryOf, foldedSpansOf, findingsLedgerOf } from './checkpointParts.js';
import { pendingQuestionOf } from '../../pauseOwnership.js';
import { type AgentRunValues } from '../../runValues.js';
import { type RunnerInvocation, type RunnerSelection } from '../../../runnerExecution.js';
import { assistantReplayFields } from '../../assistantReplay.js';
import { type RunnerPauseOutcome } from '../../../pause.js';
import type { LLMMessage } from '../../../../provider-contract/types.js';
import type { MemoryIdentity } from '../../../../memory/identity/types.js';
import {
  assertContinuable,
  checkpointReplayHistory,
  type AgentRunCheckpoint,
} from '../../../runCheckpoint.js';
import { requireVerificationOnResume } from '../../findings/verificationCheckpoint.js';
import { PendingQuestionError } from '../../../conversation.js';
import { type TimeAnswerContext } from '../../../../tools/inputRequest.js';
import { type ClockDraft, type ReadRunTime } from '../../../../time/clock.js';
import type { AgentOutput, AgentState } from '../../types.js';
import { negativeCheckpointOf } from '../../negativeClaims/checkpoint.js';
import {
  draftAgentClock,
  clockForSeed,
  readAgentTime,
  agentTimeAnswerContext,
} from '../../run/clocks.js';
import type { AgentContext } from '../contracts.js';

/**
 * Which identity a continued turn runs under: the caller's if they named
 * one, otherwise the conversation's own.
 *
 * @internal
 */
export function identityFor(
  this: Pick<AgentContext>,
  options: AgentRunOptions | undefined,
  cp: AgentRunCheckpoint,
): MemoryIdentity | undefined {
  return options?.identity ?? cp.identity;
}

export function clockDraftFor(
  this: Pick<AgentContext, 'configuration'>,
  time: unknown,
  runner: string,
): ClockDraft | undefined {
  return draftAgentClock(time, runner, this.configuration.timeOptions);
}

export function seedClockDraft(
  this: Pick<AgentContext, 'configuration'>,
  values: AgentRunValues,
): ClockDraft {
  return clockForSeed(values, this.configuration.timeOptions);
}

export function passedTimeFor(
  this: Pick<AgentContext, 'configuration'>,
  time: unknown,
  runner: string,
): ReadRunTime | undefined {
  return readAgentTime(time, runner, this.configuration.timeOptions);
}

export function checkpoint(
  this: Pick<AgentContext, 'checkpointFor' | 'native'>,
): AgentRunCheckpoint | undefined {
  return this.checkpointFor(this.native.runExecution().selected());
}

export function checkpointFor(
  this: Pick<
    AgentContext,
    | 'configuration'
    | 'continuityCursorOf'
    | 'conversationOwner'
    | 'lastInputRefused'
    | 'turnNumberOf'
  >,
  selected: RunnerSelection<AgentRunValues> | undefined,
): AgentRunCheckpoint | undefined {
  const snapshot = selected?.view.snapshot();
  if (!snapshot) return undefined;
  const state = snapshot.sharedState as Partial<AgentState> | undefined;
  // Admission is decided by seed, before any conversation state is written.
  // Do not manufacture a blank replay carrier for an unadmitted attempt.
  if (this.lastInputRefused(selected?.view)) return undefined;
  const recorded = (state?.history ?? []) as readonly LLMMessage[];
  const history: LLMMessage[] = [...recorded];
  if (
    selected!.value.answer !== undefined &&
    (selected!.value.answer.length > 0 || state?.llmLatestReplay !== undefined)
  ) {
    history.push({
      role: 'assistant',
      content: selected!.value.answer,
      ...assistantReplayFields(state ?? {}),
    });
  }
  const folded = foldedSpansOf(state);
  const owner = this.conversationOwner(selected!.value);
  const skillCursor = this.continuityCursorOf(state);
  const evidenceRecovery = evidenceRecoveryOf(state);
  const findingsLedger = findingsLedgerOf(state);
  const turnNumber = this.turnNumberOf(state);
  return {
    version: 1,
    runId: selected!.context.runId,
    history: structuredClone(checkpointReplayHistory(history, selected!.value.checkpointTracker)),
    lastCompletedIteration: typeof state?.iteration === 'number' ? state.iteration : 0,
    originalInput: { message: typeof state?.userMessage === 'string' ? state.userMessage : '' },
    checkpointedAt: Date.now(),
    // Absent when nothing ever folded — a key that is always there and
    // usually empty reads like "no folds were retained", which is a
    // different claim from "there were no folds".
    ...(folded !== undefined && { folded }),
    // Who it was for and who ran it (9.2.0) — both absent unless chosen.
    ...(owner.identity !== undefined && { identity: owner.identity }),
    ...(owner.agentId !== undefined && { agent: { id: owner.agentId } }),
    // Where the graph stood (SG-C) — written ONLY under
    // `continuity: 'conversation'`, so every other checkpoint keeps its
    // exact byte shape.
    ...(skillCursor !== undefined && { skillCursor }),
    ...(evidenceRecovery !== undefined && { evidenceRecovery }),
    // The model's standings (9.101.0) — absent unless the run recorded any,
    // by the `folded` rule: an optional key, never a format change.
    ...(findingsLedger !== undefined && { findingsLedger }),
    // The turn this history ends on (honesty layers) — absent unless a
    // layer is armed, so every other checkpoint keeps its byte shape.
    ...(turnNumber !== undefined && { turnNumber }),
    ...(this.configuration.negativeClaimsConfig === undefined || state === undefined
      ? {}
      : negativeCheckpointOf(state)),
  };
}

/** Called as each run/resume ends: remember a run that got past input admission. */
export function noteAdmittedRun(
  this: Pick<AgentContext, 'lastInputRefused'>,
  invocation: RunnerInvocation<AgentRunValues>,
): void {
  if (invocation.view.snapshot() !== undefined && !this.lastInputRefused(invocation.view)) {
    invocation.value.hadAdmitted = true;
  }
}

/**
 * Whether the evidence gate's revision calls no tools: a posture that can
 * revise (`'guard'`, `'rails'`) under an ENFORCING answer validation. There
 * the answer may yet be withheld, so a revision must not run a tool that
 * writes or sends again — and the library cannot tell one that only reads.
 */
export function revisionWithholdsTools(this: Pick<AgentContext, 'configuration'>): boolean {
  return (
    this.configuration.typedNegativeClaimsConfig !== undefined ||
    this.configuration.evidenceGate?.toolsOffAfterRevision === true
  );
}

/** Whether input middleware refused the last run's message — the one reading both doors ask. */
export function lastInputRefused(
  this: Pick<AgentContext>,
  view: import('footprintjs').RunView | undefined,
): boolean {
  const state = view?.snapshot()?.sharedState as Partial<AgentState> | undefined;
  return state?.messageDeniedPhase === 'input';
}

/**
 * The graph cursor a conversation carrier stores — the run's final
 * committed `currentSkillId`, read from the SNAPSHOT (the state the run
 * actually committed; both chart shapes map the advanced cursor onto it
 * every iteration), and only when the mounted graph declared
 * `continuity: 'conversation'`.
 *
 * ONE reader for BOTH carriers — `checkpoint()` (the conversation door
 * `followUp()` walks through) and the crash checkpoint
 * `RunCheckpointError` carries — the `foldedSpansOf`/`conversationOwner`
 * rule: a conversation must not keep its place on one path and silently
 * lose it on the other.
 *
 * @internal
 */
export function continuityCursorOf(
  this: Pick<AgentContext, 'configuration'>,
  state?: Partial<AgentState>,
): string | undefined {
  if (this.configuration.skillGraphCascade?.continuity !== 'conversation') return undefined;
  const cursor = state?.currentSkillId;
  return typeof cursor === 'string' && cursor.length > 0 ? cursor : undefined;
}

export function timeAnswerContextOf(
  this: Pick<AgentContext, 'configuration'>,
  state: unknown,
): TimeAnswerContext | undefined {
  return agentTimeAnswerContext(state, this.configuration.timeOptions);
}

/**
 * The turn a checkpoint's history ends on — `findingsLedgerOf`'s twin, one
 * reader for `checkpoint()` and the crash carrier. Only while an honesty
 * layer is armed (the run constant `honestyLayers`, read from the same
 * snapshot): that is when every ledger row carries its `turn` and the next
 * run's stamp must continue from it (`AgentRunCheckpoint.turnNumber`).
 * `undefined` otherwise, so the key stays absent.
 *
 * @internal
 */
export function turnNumberOf(
  this: Pick<AgentContext, 'configuration'>,
  state?: Partial<AgentState>,
): number | undefined {
  if (state?.honestyLayers === undefined && this.configuration.negativeClaimsConfig === undefined)
    return undefined;
  const turn = state?.turnNumber;
  return typeof turn === 'number' && Number.isSafeInteger(turn) && turn >= 1 ? turn : undefined;
}

/**
 * The two owner facts every conversation carrier stamps — who the run was
 * for, and which agent ran it (9.2.0).
 *
 * One reader for `checkpoint()` and the crash checkpoint, the same rule
 * `foldedSpansOf` follows: a fact kept on one carrier and lost on the other
 * is worse than a fact kept on neither. Both are absent unless the caller
 * chose them, which is what keeps the fingerprint refusal narrow and the
 * default `conversationId` out of storage.
 *
 * @internal
 */
export function conversationOwner(
  this: Pick<AgentContext, 'configuration'>,
  values: AgentRunValues,
): {
  identity?: MemoryIdentity;
  agentId?: string;
} {
  return {
    ...(values.identity !== undefined && { identity: values.identity }),
    ...(this.configuration.explicitId !== undefined && {
      agentId: this.configuration.explicitId,
    }),
  };
}

/**
 * Restore a stored conversation onto the side channel `seed` reads.
 *
 * THE one restoration path — `run({ continueFrom })` and `resumeOnError()`
 * both come through here, so the conversation door and the error door cannot
 * disagree about what continuing means. It checks the agent fingerprint,
 * restores history + folded spans, and adopts the conversation's identity so
 * the continued turn writes its memory where the earlier turns are.
 *
 * `appendsUserTurn` is the difference between the two callers, and it is the
 * whole difference. Continuing a conversation ADDS this turn's user message
 * to the stored history; resuming after an error does NOT, because there the
 * message is already the last user turn in that history and appending it
 * would ask the same question twice.
 *
 * Only the FLAG is stashed, never the entry (9.112.2). The entry is written
 * by `seed.ts · historyForTurn` from the message the `'input'` middleware
 * chain let through; an entry built here, before that chain has run, is the
 * caller's raw text — which is what a continued turn served the model
 * through 9.112.1, while the record said the rewrite had happened.
 *
 * @internal
 */
export function applyContinuation(
  this: Pick<AgentContext, 'configuration'>,
  values: AgentRunValues,
  cp: AgentRunCheckpoint,
  door: string,
  appendsUserTurn: boolean,
): void {
  assertContinuable(cp, this.configuration.explicitId, door);
  requireVerificationOnResume(cp, false);
  if (
    this.configuration.negativeClaimsConfig === undefined &&
    negativeCheckpointOf(cp) !== undefined
  )
    throw new TypeError(
      'Continuation requires the negative-claims setting used by the recording agent.',
    );
  values.pendingResumeHistory = {
    history: cp.history as readonly LLMMessage[],
    appendsUserTurn,
    // The turn the stored history ends on (honesty layers) — seed continues
    // the turn stamp from it only while a layer is armed.
    ...(cp.turnNumber !== undefined && { turn: cp.turnNumber }),
    ...(this.configuration.negativeClaimsConfig === undefined
      ? {}
      : { negatives: negativeCheckpointOf(cp) }),
  };
  // The folded spans beside it. A conversation stored before 8.2 has none,
  // and `undefined` is the right answer there — it means "this conversation
  // recorded no folds", which is exactly true.
  values.pendingResumeFolded = cp.folded;
  // The findings ledger beside it (9.101.0). Stashed whether or not THIS
  // agent is armed: seed restores it only under `.findings()` (the deps
  // gate), and an unarmed continuation consumes and ignores it — exactly
  // like a `folded` field on an agent that never folds.
  values.pendingResumeFindingsLedger = cp.findingsLedger;
  // The conversation's skill cursor (SG-C). Stashed unconditionally —
  // whether it is HONORED is seed's `restoreSkillCursor` gate, which reads
  // the mounted graph's `continuity` declaration; a checkpoint written by a
  // continuity graph and continued on a `'turn'` one is consumed and
  // ignored, exactly like a `folded` field on an agent that never folds.
  values.pendingResumeSkillCursor = cp.skillCursor;
  // Same failed request retains its single repair budget. A new user turn
  // receives neither the rejected draft nor a spent retry allowance.
  values.pendingEvidenceRecovery =
    !appendsUserTurn && cp.evidenceRecovery !== undefined
      ? structuredClone(cp.evidenceRecovery)
      : undefined;
}

/** A person's unanswered question outranks a new message — see
 *  `PendingQuestionError`. @internal */
export function assertNoPendingQuestion(
  this: Pick<AgentContext>,
  door: string,
  values: AgentRunValues | undefined,
): void {
  if (values?.pendingQuestion !== undefined) {
    throw new PendingQuestionError(door, values.pendingQuestion);
  }
}

/**
 * Remember (or forget) the question this run ended on.
 *
 * A paused outcome sets it; anything else clears it, because a run that
 * reached an answer has no outstanding question by definition. Reads the
 * same `pauseData` fields `standingAgent.describePause` reads — the tool
 * name and question the dispatch loop stamped — and invents nothing.
 *
 * @internal
 */
export function recordPendingQuestion(
  this: Pick<AgentContext>,
  values: AgentRunValues,
  outcome: AgentOutput | RunnerPauseOutcome,
): void {
  if (typeof outcome === 'string') {
    values.pauseOutcome = undefined;
    values.pendingQuestion = undefined;
    return;
  }
  values.pauseOutcome = outcome;
  values.pendingQuestion = pendingQuestionOf(outcome.pauseData);
}
