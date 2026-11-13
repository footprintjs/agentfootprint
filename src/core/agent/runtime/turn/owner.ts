import { startRunRecording } from '../recording/recording.js';
import type { AgentRunOptions } from '../runOptions/options.js';
import {
  evidenceRecoveryOf,
  foldedSpansOf,
  findingsLedgerOf,
} from '../conversation/checkpointParts.js';
import { runInputWith, throughAroundTurn } from '../../aroundTurn/index.js';
import type { AgentAroundTurnFailedPayload } from '../../../../events/payloads/agent.js';
import { isTerminalRunError } from '../../run/terminalRunError.js';
import { type AgentRunValues } from '../../runValues.js';
import { finishLeg, type RunnerInvocation } from '../../../runnerExecution.js';
import { type RunnerPauseOutcome } from '../../../pause.js';
import { assertRedactionPolicy } from '../../../../redaction/policy.js';
import { buildEventMeta } from '../../../../bridge/eventMeta.js';
import { assertIdentityShape } from '../../callerIdentity.js';
import {
  buildCheckpoint,
  classifyFailurePhase,
  RunCheckpointError,
  validateCheckpoint,
  type AgentRunCheckpoint,
  type RunCheckpointTracker,
} from '../../../runCheckpoint.js';
import { InvalidRunInputError, normalizeRunInput } from '../../../runInput.js';
import type { AgentInput, AgentOutput, AgentState } from '../../types.js';
import { negativeCheckpointOf } from '../../negativeClaims/checkpoint.js';
import { requestOf } from '../../../requestOfRun.js';
import { AROUND_TURN_STAGE_ID } from '../../run/eventStageIds.js';
import { withoutTime } from '../../run/withoutTime.js';
import type { AgentContext } from '../contracts.js';
import { isLiveConversation } from '../conversation/liveConversation.js';

export async function runTyped<T = unknown>(
  this: Pick<AgentContext, 'configuration' | 'native' | 'runLeg' | 'runTurn' | 'typedOutcome'>,
  input: AgentInput | string,
  options?: AgentRunOptions,
): Promise<T> {
  return this.native.runExecution().withRun(async (invocation) => {
    if (!this.configuration.outputSchemaParser) {
      throw new Error(
        `Agent.runTyped: this agent has no outputSchema. Use ` +
          `Agent.create({...}).outputSchema(parser).build() to enable typed output.`,
      );
    }
    return this.runTurn(invocation, input, options, async (turnInput) =>
      this.typedOutcome<T>(invocation, await this.runLeg(invocation, turnInput, options)),
    );
  });
}

export async function run(
  this: Pick<AgentContext, 'native' | 'runOwned'>,
  input: AgentInput | string,
  options?: AgentRunOptions,
): Promise<AgentOutput | RunnerPauseOutcome> {
  return this.native
    .runExecution()
    .withRun((invocation) => this.runOwned(invocation, input, options));
}

export function runOwned(
  this: Pick<AgentContext, 'runLeg' | 'runTurn'>,
  invocation: RunnerInvocation<AgentRunValues>,
  input: AgentInput | string,
  options?: AgentRunOptions,
): Promise<AgentOutput | RunnerPauseOutcome> {
  return this.runTurn(invocation, input, options, (turnInput) =>
    this.runLeg(invocation, turnInput, options),
  );
}

/** The funnel, for a new turn. Every top-level run enters here, inside its lease. */
export function runTurn<R>(
  this: Pick<AgentContext, 'configuration' | 'noteAroundTurnFailed'>,
  invocation: RunnerInvocation<AgentRunValues>,
  input: AgentInput | string,
  options: AgentRunOptions | undefined,
  leg: (turnInput: AgentInput | string) => Promise<R>,
): Promise<R> {
  return throughAroundTurn(
    this.configuration.aroundTurnPort,
    { kind: 'run', input, options },
    (changes) => leg(runInputWith(input, options, changes)),
    (legFailed) => finishLeg(invocation.run, legFailed),
    (failure) => this.noteAroundTurnFailed(invocation, failure),
  );
}

/** A wrapper failed after its run: the outcome stands, and the record says so. */
export function noteAroundTurnFailed(
  this: Pick<AgentContext, 'native'>,
  invocation: RunnerInvocation<AgentRunValues>,
  payload: AgentAroundTurnFailedPayload,
): void {
  const meta = { runtimeStageId: AROUND_TURN_STAGE_ID };
  this.native.getDispatcher().dispatch({
    type: 'agentfootprint.agent.around_turn_failed',
    payload,
    meta:
      invocation.run.origin === undefined
        ? { ...this.native.minimalMeta(), ...meta }
        : buildEventMeta(meta, invocation.context()),
  });
}

export async function runLeg(
  this: Pick<
    AgentContext,
    | 'applyContinuation'
    | 'assertIntegrityAlive'
    | 'assertNoPendingQuestion'
    | 'clockDraftFor'
    | 'configuration'
    | 'continuityCursorOf'
    | 'conversationOwner'
    | 'fileIntegrityDisposition'
    | 'finalizeResult'
    | 'native'
    | 'noteAdmittedRun'
    | 'prepareAgentRun'
    | 'recordPendingQuestion'
    | 'runner'
    | 'turnNumberOf'
  >,
  invocation: RunnerInvocation<AgentRunValues>,
  input: AgentInput | string,
  options?: AgentRunOptions,
): Promise<AgentOutput | RunnerPauseOutcome> {
  invocation.value.hadAdmitted = invocation.previous?.value.hadAdmitted === true;
  // Normalize or refuse BEFORE anything is created. A bare string is the
  // message; anything that is not a message is named and refused here
  // rather than becoming `content: undefined` inside the messages slot.
  const runInput = normalizeRunInput<AgentInput>(input, 'Agent.run');
  // Who wrote the message (declared sources' one reader): one of two words,
  // or nothing — a typo would read as the person's words, so it is refused.
  const messageFrom = (runInput as { readonly messageFrom?: unknown }).messageFrom;
  if (messageFrom !== undefined && messageFrom !== 'person' && messageFrom !== 'composed') {
    throw new InvalidRunInputError({
      runner: 'Agent.run',
      received: `messageFrom: ${
        typeof messageFrom === 'string' ? JSON.stringify(messageFrom) : typeof messageFrom
      }`,
      hint: "messageFrom is 'person' (the default) or 'composed' (another runner's output)",
    });
  }
  // An identity that is not one is refused HERE, where the mistake was made —
  // not at the resume of a pause it would have made impossible to resume.
  assertIdentityShape(runInput.identity, 'Agent.run');
  assertIdentityShape(options?.identity, 'Agent.run');
  // The incoming request, sealed — refused here when `requestContext` did not build it.
  const runRequest = requestOf(options, 'Agent.run');
  // A policy handed down for this run is refused here, before anything moves,
  // by the same check `Agent.create({ redact })` gets.
  if (options?.redact !== undefined) assertRedactionPolicy(options.redact, 'Agent.run');
  // The run's clock (the time layer): read or refused HERE, before the turn
  // starts — a run with no zone anywhere runs with its zone UNKNOWN (G15),
  // never on the server's zone.
  const clockDraft = this.clockDraftFor(runInput.time ?? options?.time, 'Agent.run');
  // The engine's options; the run's signal (and its deadline) is armed just
  // before native execution, whose lifecycle releases it.
  const engineOptions = withoutTime(options);
  // Timing next, and before the executor exists: both of these refuse a call
  // that would have SUCCEEDED into corrupted per-instance state or an
  // orphaned human question. See ./conversation.ts for why they are throws.
  this.assertNoPendingQuestion('Agent.run', invocation.previous?.value);
  // A conversation handed in continues through the same side channel
  // `resumeOnError` uses — one restoration path, so the two doors cannot
  // drift about what "continue" means. This turn's message IS appended:
  // continuing a conversation adds a turn to it. Seed appends it, AFTER the
  // input middleware chain, so the entry is the chain's verdict (9.112.2).
  let continued: AgentRunCheckpoint | undefined;
  if (runInput.continueFrom !== undefined) {
    // `followUp()`'s own conversation keeps a typed answer's mark; one handed
    // in by a caller loses it (`../conversation/liveConversation.ts`).
    const fromLive = isLiveConversation(runInput.continueFrom);
    continued = validateCheckpoint(runInput.continueFrom);
    this.applyContinuation(
      invocation.value,
      continued,
      'Agent.run({ continueFrom })',
      true,
      fromLive,
    );
  }
  // Only an EXPLICIT identity is remembered for `checkpoint()`; see the
  // field's note. `input.identity` wins over `options.identity` because the
  // input bag is where a caller looks first, and both win over the stored
  // conversation's — but the conversation's is used when neither was given,
  // so a continued turn stays in the namespace it started in.
  invocation.value.identity =
    runInput.identity ?? options?.identity ?? (continued ? continued.identity : undefined);
  // Recordings-as-artifacts (9.26.0). BEFORE `createExecutor`, because
  // `attach()` collects recorders for the executor that has not been built
  // yet — a recording started one line later would be missing its
  // boundaries, which is the failure mode `recordRun` exists to prevent.
  // Returns `undefined` (and touches nothing) unless the dial is on.
  const recording = startRunRecording(this.runner, invocation, {
    artifactStore: this.configuration.artifactStore,
    artifactRecordings: this.configuration.artifactRecordings,
  });
  invocation.value.answeredAsk = undefined;
  invocation.value.resumePassedTime = undefined;
  const prepared = this.prepareAgentRun(invocation, engineOptions, runRequest);
  // One disposition ledger per run (9.60.0) — registration mirrors what
  // this agent's configuration makes applicable; dev posture runs the
  // canaries here, BEFORE any real work, so a dead check is named first.

  // Auto-checkpoint at iteration boundaries — captures the latest
  // conversation history into a per-run tracker. On error, we
  // wrap the underlying error in `RunCheckpointError` carrying
  // this checkpoint so `agent.resumeOnError(checkpoint)` can
  // continue from the last good iteration.
  const tracker: RunCheckpointTracker = {
    get runId() {
      return invocation.context().runId;
    },
    originalInput: { message: runInput.message },
    history: [],
    lastCompletedIteration: 0,
  };
  invocation.value.checkpointTracker = tracker;
  // The answer this run produces is the only place the final assistant turn
  // exists (nothing writes it back into `scope.history`), so `checkpoint()`
  // keeps it. Cleared here so a failed or paused run cannot hand back the
  // previous run's answer.
  invocation.value.answer = undefined;
  // One run can never raise on another run's consent block.
  invocation.value.consentOutstanding.clear();
  // Set here, beside the `try` whose `finally` clears it, so no exit path
  // can leave it behind for a turn this `run()` did not start.
  invocation.value.clockDraft = clockDraft;

  try {
    const result = await invocation.execute(
      {
        kind: 'run',
        options: {
          input: {
            message: runInput.message,
            ...(invocation.value.identity !== undefined && {
              identity: invocation.value.identity,
            }),
            // A composed message reaches seed only on an agent that reads it
            // (declared sources, or the time layer's reader) — every other run's
            // input is the bytes it was.
            ...(messageFrom === 'composed' &&
              (this.configuration.argumentSourcesArmed === true ||
                this.configuration.timeOptions?.reader !== undefined) && {
                messageFrom: 'composed',
              }),
          },
          // Co-engineered boundary (#16): the engine's loop-iteration limit
          // (footprintjs 9 default 1000) must never fire BELOW the agent's own
          // budget — give it headroom (×2 + 10 covers double-hop loop shapes).
          // Consumer-provided options win.
          maxIterations: this.configuration.maxIterations * 2 + 10,
          ...(engineOptions ?? {}),
        },
      },
      prepared.setup,
      prepared.binding,
    );
    const finalized = this.finalizeResult(invocation, result);
    if (typeof finalized === 'string') invocation.value.answer = finalized;
    this.recordPendingQuestion(invocation.value, finalized);
    // The answer is FINISHED before this line and cannot be changed by it.
    // The liveness theorems (9.60.0, dev posture only) — a run that would
    // return green while its registered checkers demonstrably never ran
    // fails HERE instead, before the recording is filed. A finished run is
    // itself the proof work existed: the loop cannot finish without at
    // least one model call.
    this.assertIntegrityAlive(invocation);
    // See `runtime/recording/recording.ts · fileRunRecording` for why the write is awaited rather than left
    // in flight, and why it can never fail the run.
    recording?.complete(finalized);
    return finalized;
  } catch (cause) {
    // A THROWN pause is still a pause — see `endRunToolSessions`.
    // Wrap recoverable errors with the last-known-good checkpoint.
    if (
      cause instanceof Error &&
      !isTerminalRunError(cause) &&
      !invocation.value.checkpointObservationFailed &&
      tracker.history.length > 0
    ) {
      // Observation beats the heuristic: if a bracket was open, it says
      // exactly what the run was doing. `classifyFailurePhase` only decides
      // when nothing was — a failure between brackets, where the error's own
      // text really is the best evidence available (8.14.0).
      const observed = tracker.inFlightPhase;
      const checkpoint = buildCheckpoint(
        tracker,
        {
          iteration: tracker.inFlightIteration ?? tracker.lastCompletedIteration + 1,
          phase: observed?.phase ?? classifyFailurePhase(cause),
          ...(observed !== undefined && { stage: observed.stage }),
        },
        // Read from the live snapshot rather than the tracker: the tracker
        // follows `history` through iteration_end events, and a fold's spans
        // are committed state. A crash checkpoint that carried the summary
        // in its history but not the span behind it would resume into a
        // conversation whose evidence the crash had quietly eaten.
        foldedSpansOf(this.native.liveSnapshot()?.sharedState as Partial<AgentState>),
        // A crash checkpoint is the same conversation carrier as
        // `checkpoint()`, so it carries the same two owner facts — otherwise
        // resuming after a crash would be the one path that still lost the
        // identity, and the memory written after the recovery would land
        // where nothing could read it.
        this.conversationOwner(invocation.value),
        // …and the same graph cursor (SG-C), from the same snapshot reader —
        // one reader, two carriers, so neither can lose what the other keeps.
        this.continuityCursorOf(this.native.liveSnapshot()?.sharedState as Partial<AgentState>),
        evidenceRecoveryOf(this.native.liveSnapshot()?.sharedState as Partial<AgentState>),
        // …and the findings ledger (9.101.0), from the same snapshot reader
        // `checkpoint()` uses — one reader, two carriers.
        findingsLedgerOf(this.native.liveSnapshot()?.sharedState as Partial<AgentState>),
        // …and the turn the failing run was on (honesty layers), so the
        // retry is stamped the same turn — one reader, two carriers.
        this.turnNumberOf(this.native.liveSnapshot()?.sharedState as Partial<AgentState>),
        undefined,
        this.configuration.negativeClaimsConfig === undefined
          ? undefined
          : negativeCheckpointOf(this.native.liveSnapshot()?.sharedState ?? {}),
      );
      throw new RunCheckpointError(cause, checkpoint);
    }
    throw cause;
  } finally {
    // Native admission owns deadlines, signal links and final joining.
    // The time layer's per-run inputs end with the run: a stale draft would
    // be stamped by the next seed this agent did not start (a composition
    // mounting its chart) as if the app had declared it.
    invocation.value.clockDraft = undefined;
    invocation.value.resumePassedTime = undefined;
    // The run's disposition rows, on EVERY path — success, failure, pause —
    // and BEFORE the recording stops, so a recording carries its run's
    // checker accounting (9.60.0).
    this.fileIntegrityDisposition(invocation);
    // Always released: a recording left subscribed would keep listening
    // through the next run and grow a tail nobody reads.
    this.noteAdmittedRun(invocation);
    // `seed` consumes the restored conversation on its way past. A run that
    // died BEFORE seed never did, and a history left armed here would be
    // picked up by the next run — which would then continue a conversation
    // nobody asked it to. One run, one continuation.
    invocation.value.pendingResumeHistory = undefined;
    invocation.value.pendingResumeFolded = undefined;
    invocation.value.pendingResumeFindingsLedger = undefined;
    invocation.value.pendingResumeSkillCursor = undefined;
    invocation.value.pendingEvidenceRecovery = undefined;
  }
}
