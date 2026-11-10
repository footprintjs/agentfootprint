import type { ArtifactScope } from '../../../../artifacts/types.js';
import { recordingPutInput } from '../../../../artifacts/recordingArtifact.js';
import { eventBelongsToRun } from '../../../../bridge/eventMeta.js';
import { recordRunWhere, type RunRecorder } from '../../../../recorders/observability/recordRun.js';
import { packRecording } from '../../../../recorders/observability/recordingPack.js';
import { isPaused, type RunnerPauseOutcome } from '../../../pause.js';
import type { Runner } from '../../../runner.js';
import type { RunnerInvocation } from '../../../runnerExecution.js';
import type { AgentRunValues } from '../../runValues.js';
import type { AgentOutput, AgentState } from '../../types.js';

import type { AgentConfiguration } from '../configuration/types.js';

/**
 * Start recording this run — or do nothing at all (9.26.0).
 *
 * Zero-cost when unused is not a claim here, it is the control flow: with
 * `recordings` unset this returns `undefined` before touching the agent, so
 * no listener is subscribed, no boundary recorder is attached, and the run
 * is byte-identical to every earlier release.
 *
 * It is deliberately the SAME recorder a consumer would call by hand
 * (`recordRun`'s own body, `recordRunWhere`). Nothing about this feature is a
 * second recording implementation — the three connections that a
 * hand-rolled version gets wrong (attach, subscribe, getCommitCount) are
 * wired in exactly one place in this package, and this is a caller of it.
 * The one difference is the timeline's filter: a recording filed FOR a
 * person keeps only the events of that person's run.
 */
export function startRunRecording(
  runner: Runner,
  invocation: RunnerInvocation<AgentRunValues>,
  config: Pick<AgentConfiguration, 'artifactStore' | 'artifactRecordings'>,
): { complete(outcome: AgentOutput | RunnerPauseOutcome): void } | undefined {
  if (config.artifactRecordings === undefined || config.artifactStore === undefined)
    return undefined;
  // Only THIS run's events: on an instance serving several sessions, the
  // hosting door emits facts for other sessions while this run is in flight,
  // and a recording is redeemable by the person it was filed for.
  const recording = recordRunWhere(
    runner,
    (event) =>
      invocation.run.origin !== undefined && eventBelongsToRun(event.meta, invocation.context()),
  );
  let outcome: AgentOutput | RunnerPauseOutcome | undefined;
  // Registered before component setup. Native reverse finalization joins
  // resource cleanup first, then files this recording, then detaches it.
  invocation.run.onFinalize(() => recording.stop());
  invocation.run.onFinalize(async () => {
    if (outcome !== undefined)
      await fileRunRecording(runner, config, invocation, recording, outcome);
  });
  return {
    complete(value) {
      outcome = value;
    },
  };
}

/**
 * File the finished recording into the artifact store.
 *
 * ── When ────────────────────────────────────────────────────────────────
 * After the answer and joined component resource cleanup, only for a run that COMPLETED. A pause
 * is not a finished run (the turn continues, and the resume mints its own);
 * a throw never reaches here at all.
 *
 * ── Why it is awaited ───────────────────────────────────────────────────
 * The answer is final before this begins and this cannot change it — but
 * `run()` does return after the write rather than before, and that is a
 * choice rather than an oversight. A fire-and-forget write is a recording
 * lost whenever the process exits with the reply, which is precisely the
 * serverless deployment that wants recordings most. The cost is one store
 * write per turn, stated on the option.
 *
 * ── Why it can never fail the run ───────────────────────────────────────
 * A full store, an unserializable snapshot, a bucket that 500s — none of
 * them are facts about the ANSWER, which is already correct and already
 * paid for. Turning "your recording was not filed" into "your request
 * failed" would be the library deciding that its observability matters more
 * than the user's turn. So every failure degrades to today's path: the
 * answer is returned unchanged and the reason lands on the record as
 * `agentfootprint.artifacts.refused`, where a sink can count it.
 *
 * The recording is FROZEN before the mint, so it can never contain the
 * `artifacts.minted` event describing itself.
 */
async function fileRunRecording(
  runner: Runner,
  config: Pick<AgentConfiguration, 'artifactStore' | 'artifactRecordings'>,
  invocation: RunnerInvocation<AgentRunValues>,
  recorder: RunRecorder | undefined,
  outcome: AgentOutput | RunnerPauseOutcome,
): Promise<void> {
  const store = config.artifactStore;
  if (recorder === undefined || store === undefined || config.artifactRecordings === undefined) {
    return;
  }
  if (isPaused(outcome)) return;
  const runId = invocation.context().runId;
  let input;
  try {
    const recording = recorder.toRecording();
    input = recordingPutInput(
      config.artifactRecordings.packed === true ? packRecording(recording) : recording,
      {
        ...(runId !== undefined && { runId }),
        ...(config.artifactRecordings.label !== undefined && {
          label: config.artifactRecordings.label,
        }),
      },
    );
  } catch (err) {
    reportRecordingRefused(runner, err, 'invalid-input');
    return;
  }
  try {
    const result = await store.put(runArtifactScope(invocation), input);
    // Sweeps ride the put result, so retention that evicted an older
    // recording to make room says so on the record — the same law a tool's
    // own mint follows.
    for (const swept of result.swept) {
      runner.emit('agentfootprint.artifacts.expired', {
        ref: swept.ref,
        reason: swept.reason,
        kind: swept.kind,
        bytes: swept.bytes,
      });
    }
    runner.emit('agentfootprint.artifacts.minted', {
      ref: result.meta.ref,
      kind: result.meta.kind,
      mediaType: result.meta.mediaType,
      bytes: result.meta.bytes,
      ...(result.meta.label !== undefined && { label: result.meta.label }),
      ...(result.meta.expiresAt !== undefined && { expiresAt: result.meta.expiresAt }),
      ...(result.meta.origin !== undefined && { origin: result.meta.origin }),
    });
  } catch (err) {
    reportRecordingRefused(runner, err, 'invalid-input');
  }
}

/** One refusal fact for a recording that could not be filed. The message is
 *  the store's own, which never carries a payload — only what went wrong. */
function reportRecordingRefused(runner: Runner, err: unknown, reason: 'invalid-input'): void {
  runner.emit('agentfootprint.artifacts.refused', {
    op: 'put',
    reason,
    detail: err instanceof Error ? err.message : String(err),
  });
}

/**
 * The run's artifact scope, read from the finished run's own state.
 *
 * The SAME tuple `ctx.artifacts` bound during the run (`scope.runIdentity`,
 * composed by seed from the caller's identity or derived from the session).
 * Read rather than recomposed: a second derivation here could disagree with
 * the one the run's tools used, and a recording filed in a different scope
 * from the artifacts it describes is a recording nobody can find.
 */
function runArtifactScope(invocation: RunnerInvocation<AgentRunValues>): ArtifactScope {
  const identity = (invocation.view.snapshot()?.sharedState as Partial<AgentState> | undefined)
    ?.runIdentity;
  if (identity === undefined) {
    // No state to read means no run happened, which this path cannot reach —
    // but a scope is required and inventing a tenant would be worse than a
    // conversation id that names the run itself.
    return { conversationId: invocation.context().runId };
  }
  return {
    conversationId: identity.conversationId,
    ...(identity.tenant !== undefined && { tenant: identity.tenant }),
    ...(identity.principal !== undefined && { principal: identity.principal }),
  };
}
