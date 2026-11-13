import { startRunRecording } from '../recording/recording.js';
import type { AgentRunOptions } from '../runOptions/options.js';
import { refuseKnownSpentAnswer, refuseMissingPlainAnswer } from '../../resumeAnswer.js';
import { throughAroundTurn } from '../../aroundTurn/index.js';
import { resumeStateOf, resumeSessionOf } from '../../resumeCheckpoint.js';
import { preservePendingQuestion } from '../../pauseOwnership.js';
import { type AgentRunValues } from '../../runValues.js';
import { finishLeg, type RunnerInvocation } from '../../../runnerExecution.js';
import { type FlowchartCheckpoint } from 'footprintjs';
import {
  assertDecisionIsNotStale,
  pauseDemandsDecision,
  type RunnerPauseOutcome,
} from '../../../pause.js';
import { checkDecisionAgainst, processDecisionLedger } from '../../../consentRequest.js';
import { assertRedactionPolicy, unionRedactionPolicies } from '../../../../redaction/policy.js';
import { policyOfCoverage } from '../../../../redaction/coverage.js';
import { ResumeRedactionError } from '../../../conversation.js';
import { privateResumeOf } from '../../../../redaction/privateCheckpoint.js';
import { redactionDeclaredBy } from '../../../../redaction/declared.js';
import { carriedRunPolicy, conversationRedaction } from '../../../../redaction/conversation.js';
import {
  assertIdentityShape,
  callerIdentityOf,
  restoredIdentityOf,
  sameIdentity,
} from '../../callerIdentity.js';
import { requireVerificationOnResume } from '../../findings/verificationCheckpoint.js';
import { ResumeIdentityConflictError } from '../../../conversation.js';
import {
  applyInputResponse,
  readAwaitingInput,
  type AnsweredAsk,
} from '../../../../tools/inputRequest.js';
import type { AgentOutput } from '../../types.js';
import { negativeCheckpointOf } from '../../negativeClaims/checkpoint.js';
import { requestOf } from '../../../requestOfRun.js';
import { withoutTime } from '../../run/withoutTime.js';
import { resumeRedactionOf } from '../../run/resumeRedaction.js';
import type { AgentContext } from '../contracts.js';

export async function resume(
  this: Pick<AgentContext, 'native' | 'resumeOwned'>,
  checkpoint: FlowchartCheckpoint,
  input?: unknown,
  options?: AgentRunOptions,
): Promise<AgentOutput | RunnerPauseOutcome> {
  this.native.noteResumeTakenUp(checkpoint);
  return this.native.runExecution().withRun((invocation) =>
    preservePendingQuestion(
      invocation.previous?.value,
      () => invocation.value.resources?.answer.consumed === true,
      () => this.resumeOwned(invocation, checkpoint, input, options),
    ),
  );
}

/** The funnel, for an answered pause. Inside the lease and `preservePendingQuestion`. */
export function resumeOwned(
  this: Pick<AgentContext, 'configuration' | 'noteAroundTurnFailed' | 'resumeLeg'>,
  invocation: RunnerInvocation<AgentRunValues>,
  checkpoint: FlowchartCheckpoint,
  input?: unknown,
  options?: AgentRunOptions,
): Promise<AgentOutput | RunnerPauseOutcome> {
  return throughAroundTurn(
    this.configuration.aroundTurnPort,
    { kind: 'resume', checkpoint, answer: input, options },
    () => this.resumeLeg(invocation, checkpoint, input, options),
    (legFailed) => finishLeg(invocation.run, legFailed),
    (failure) => this.noteAroundTurnFailed(invocation, failure),
  );
}

export async function resumeLeg(
  this: Pick<
    AgentContext,
    | 'assertIntegrityAlive'
    | 'configuration'
    | 'fileIntegrityDisposition'
    | 'finalizeResult'
    | 'native'
    | 'noteAdmittedRun'
    | 'passedTimeFor'
    | 'prepareAgentRun'
    | 'recordPendingQuestion'
    | 'runner'
    | 'timeAnswerContextOf'
  >,
  invocation: RunnerInvocation<AgentRunValues>,
  checkpoint: FlowchartCheckpoint,
  input?: unknown,
  options?: AgentRunOptions,
): Promise<AgentOutput | RunnerPauseOutcome> {
  // Taken up, before anything can refuse: from here every use of a consent
  // decision passes through the one spend a door watching this pause sees
  // (`consentRequest.ts` · `watchDecisionUse`) — so a resume that fails
  // without reaching it, refused or aborted, used nothing.
  resumeStateOf(checkpoint);
  // ── A consent gate is answered with a DECISION (8.13.0) ─────────────
  // Refused HERE, before the engine is handed the checkpoint, so nothing
  // executes and the checkpoint is unchanged — the caller can answer the same
  // one and resume again. Before this, a mis-shaped resume silently DECLINED
  // and filed `by: 'unknown'`: a consent record naming a person who was never
  // asked. Governance never silently invents a decision, for the same reason
  // it never silently drops one.
  //
  // Discriminated by the PAUSE, never by the input: a plain askHuman/pauseHere
  // answer is a value (often a string) and must stay accepted, so the only
  // sound question is "what was asked?".
  assertIdentityShape(options?.identity, 'Agent.resume');
  if (options?.redact !== undefined) assertRedactionPolicy(options.redact, 'Agent.resume');
  // The incoming request is the RESUMING caller's — never the paused one's:
  // a checkpoint carries no request, and a resume without one serves none.
  const resumeRequest = requestOf(options, 'Agent.resume');
  requireVerificationOnResume(checkpoint.sharedState ?? {}, false);
  if (this.configuration.negativeClaimsConfig !== undefined) {
    const prior = negativeCheckpointOf(checkpoint.sharedState ?? {});
    if (prior === undefined)
      throw new TypeError(
        'Negative-claims pause checkpoint is missing its private evidence carrier.',
      );
  } else if (negativeCheckpointOf(checkpoint.sharedState ?? {}) !== undefined) {
    throw new TypeError('Resume requires the negative-claims setting used by the paused agent.');
  }
  // The policy the paused run was covered by, carried in its own state
  // (`runRedaction`) — it covers this leg too, joined with any the caller
  // adds now. Read, or refused, before anything moves (`resumeRedactionOf`).
  const carriedRedaction = resumeRedactionOf(checkpoint, [
    redactionDeclaredBy(this.runner),
    options?.redact,
    conversationRedaction(),
  ]);
  Object.assign(invocation.value, privateResumeOf(checkpoint));
  // A resume's `time` (the time layer) is read or refused before anything
  // moves; it is never applied — the paused turn's clock is kept, and a
  // differing value is recorded by the ToolCalls resume door.
  const passedTime = this.passedTimeFor(options?.time, 'Agent.resume');
  options = withoutTime(options);
  // One run, one identity — refused before anything moves, and before the
  // answer is read at all: a caller this run is not for learns nothing about
  // what it is waiting on (its gate, its tool, its request). The paused run's
  // caller identity is read off the checkpoint (`callerIdentity.ts`); a call
  // naming a DIFFERENT one would give the run one person's memory namespace
  // and credentials (restored, never re-seeded) and another's `ctx.identity`,
  // principal and stored ownership. A checkpoint names who it is for; it is
  // not proof — a host that lets checkpoints leave its trust boundary signs
  // them or keeps them server-side, and passes the identity it verified here.
  const pausedFor = callerIdentityOf(checkpoint.sharedState);
  // The identity the run's memory namespace and credentials are restored
  // from, WHATEVER its source (a caller's, the session rung, the per-run
  // default). One run, one identity: a call that names an identity must
  // name exactly this one — an ownerless (derived) pause resumed by a named
  // person is refused too, and so is a checkpoint whose own fields disagree
  // (a session-rung marker on an identity that carries a person).
  const restored = restoredIdentityOf(checkpoint.sharedState);
  if (
    restored === 'malformed' ||
    (options?.identity !== undefined &&
      (restored === undefined || !sameIdentity(options.identity, restored)))
  ) {
    throw new ResumeIdentityConflictError();
  }
  const sessionId = resumeSessionOf(checkpoint);
  if (options?.sessionId !== undefined && options.sessionId !== sessionId)
    throw new ResumeIdentityConflictError('session');
  // …and the decision must be for THIS request and this exact call
  // (`core/consentRequest.ts`): refused here, before anything moves, when it
  // names no request, another request, a call the checkpoint no longer
  // holds, or — for an ask — rules this agent's chain no longer runs. The
  // dispatch loop asks again where the decision is used — and spends it
  // there, once.
  const gate = pauseDemandsDecision(checkpoint.pauseData);
  if (gate) {
    checkDecisionAgainst(
      checkpoint,
      gate,
      input,
      this.configuration.toolMiddleware.map((link) => link.name),
      // A request minted under a ledger that can prove is spent only there.
      this.configuration.decisionLedger ?? processDecisionLedger(),
    );
  }
  if (gate !== undefined)
    await refuseKnownSpentAnswer(
      this.configuration.decisionLedger ?? processDecisionLedger(),
      input,
      gate,
      options?.signal,
      options?.env?.signal,
    );
  // Typed data collection is not consent. Validate before changing any run state.
  const awaitingInput = gate === undefined ? readAwaitingInput(checkpoint.pauseData) : undefined;
  let answeredAsk: AnsweredAsk | undefined;
  if (awaitingInput !== undefined) {
    const answered = applyInputResponse(
      awaitingInput,
      input,
      this.timeAnswerContextOf(checkpoint.sharedState),
    );
    if ('cancel' in answered) {
      throw new TypeError(
        '[input request] Cancel a hosted request through its host, or abandonPause() before starting another run.',
      );
    }
    if (answered.missing.length > 0) {
      const copy = structuredClone(checkpoint);
      const pauseData = {
        ...(copy.pauseData as Record<string, unknown>),
        awaitingInput: answered,
      };
      const outcome: RunnerPauseOutcome = {
        paused: true,
        checkpoint: { ...copy, pauseData },
        pauseData,
        awaitingInput: answered,
      };
      this.recordPendingQuestion(invocation.value, outcome);
      return outcome;
    }
    answeredAsk = {
      id: answered.id,
      requestId: answered.requestId,
      count: (awaitingInput.repeat?.count ?? 0) + 1,
    };
    input = {
      status: 'input_received',
      requestId: answered.requestId,
      values: answered.supplied,
      origins: answered.origins,
      origin: answered.origin,
      ...(answered.context !== undefined && { context: answered.context }),
    };
  }
  // And the answer must be about the thing that was asked. Checked HERE, at
  // the same door and before any state moves, because a resume that has begun
  // is a resume that has already used the value.
  assertDecisionIsNotStale(checkpoint.pauseData, input);
  if (gate === undefined && awaitingInput === undefined)
    refuseMissingPlainAnswer(checkpoint, input);
  // A native-admitted answer settles the old question even if its leg fails.
  // The outer pause-ownership boundary restores pre-origin refusals; named
  // unanswered refusals after origin are restored below.
  const questionBefore = invocation.previous?.value.pendingQuestion;
  // Capture this paused conversation's identity before native origin; selected readers
  // on a shared instance can belong to another conversation (`callerIdentity.ts`).
  invocation.value.identity = options?.identity ?? pausedFor;
  // Resume retains the paused transport session; an override was checked equal above.
  const sessionResumeOptions: AgentRunOptions | undefined =
    sessionId !== undefined && options?.sessionId === undefined
      ? { ...options, sessionId }
      : options;
  // The leg's policy — the carried one, the caller's, and the paused leg's
  // marks — comes back from the emitter and goes to THIS leg's executor
  // (native setup → `prepareRunRedaction`); nothing per-run is held on the instance.
  const resumeLeg = this.native.emitPauseResume(
    checkpoint,
    input,
    unionRedactionPolicies(carriedRedaction, sessionResumeOptions?.redact),
  );
  const resumeOptions: AgentRunOptions | undefined =
    resumeLeg === sessionResumeOptions?.redact
      ? sessionResumeOptions
      : { ...sessionResumeOptions, redact: resumeLeg };
  // Fresh native execution restores its checkpoint; no paused executor is retained.
  // Each resumed native leg files its own recording when it completes.
  const recording = startRunRecording(this.runner, invocation, {
    artifactStore: this.configuration.artifactStore,
    artifactRecordings: this.configuration.artifactRecordings,
  });
  invocation.value.answeredAsk = answeredAsk;
  const prepared = this.prepareAgentRun(invocation, resumeOptions, resumeRequest);
  // The leg's WHOLE policy rides its own state too (`runRedaction`), so a
  // later pause carries what this leg was covered by — names the resume
  // added included — and a third leg is never less covered than this one.
  // `createExecutor` opened this executor's run; one it did not is refused
  // before anything is held or runs — a leg whose policy nothing knows must
  // not start.
  const legCoverage = invocation.value.redaction?.coverage;
  if (legCoverage === undefined) throw new ResumeRedactionError('unreadable');
  if (legCoverage.state === 'unknown') throw new ResumeRedactionError('unreadable');
  const leg = { policy: policyOfCoverage(legCoverage) };
  // A resumed turn is two runs, and each keeps its own ledger — exactly
  // the recording's terms one comment up.
  invocation.value.answer = undefined;
  const resumedMessage = checkpoint.sharedState.userMessage;
  invocation.value.checkpointTracker =
    typeof resumedMessage === 'string'
      ? {
          get runId() {
            return invocation.context().runId;
          },
          originalInput: { message: resumedMessage },
          history: [],
          lastCompletedIteration: 0,
        }
      : undefined;
  // One run can never raise on another run's consent block.
  invocation.value.consentOutstanding.clear();
  // Beside the `try` whose `finally` clears it (the fresh-run path's terms).
  invocation.value.resumePassedTime = passedTime;
  const legCheckpoint: FlowchartCheckpoint =
    leg.policy === undefined
      ? checkpoint
      : {
          ...checkpoint,
          sharedState: {
            ...checkpoint.sharedState,
            runRedaction: carriedRunPolicy(leg.policy),
          },
        };
  // The native resumed leg owns its signal and deadline.
  try {
    const result = await invocation.execute(
      { kind: 'resume', mode: 'fresh', checkpoint: legCheckpoint, input, options: resumeOptions },
      prepared.setup,
      prepared.binding,
    );
    const finalized = this.finalizeResult(invocation, result);
    if (typeof finalized === 'string') invocation.value.answer = finalized;
    // The question this resume answered is settled; a resume that paused
    // AGAIN has asked a new one, and that one is outstanding from here.
    this.recordPendingQuestion(invocation.value, finalized);
    // Same liveness gate the fresh-run path applies (9.60.0).
    this.assertIntegrityAlive(invocation);
    recording?.complete(finalized);
    return finalized;
  } finally {
    if (invocation.value.resources?.answer.consumed === true) {
      if (invocation.previous !== undefined) invocation.previous.value.pendingQuestion = undefined;
    } else {
      invocation.value.pendingQuestion = questionBefore;
      if (invocation.previous !== undefined)
        invocation.previous.value.pendingQuestion = questionBefore;
    }
    // A resume's passed `time` ends with the resume (the fresh-run path's terms).
    invocation.value.resumePassedTime = undefined;
    // Same terms as the fresh-run path: rows on every exit, before the
    // recording stops (9.60.0).
    this.fileIntegrityDisposition(invocation);
    this.noteAdmittedRun(invocation);
  }
}
