import type { ArtifactScope } from '../../../../artifacts/types.js';
import { isArtifactRef } from '../../../../artifacts/naming.js';
import { recordingPutInput } from '../../../../artifacts/recordingArtifact.js';
import { eventBelongsToRun } from '../../../../bridge/eventMeta.js';
import { recordRunWhere, type RunRecorder } from '../../../../recorders/observability/recordRun.js';
import { packRecording } from '../../../../recorders/observability/recordingPack.js';
import { fileRecordingParts } from '../../../../recorders/observability/recordingParts/file.js';
import type { ArtifactMeta, SweptArtifact } from '../../../../artifacts/types.js';
import type { AgentRecordingsOptions } from '../../types/artifacts.js';
import type { TrustBoundaryRecorder } from '../../../../trust-boundaries/types.js';
import { isPaused, type RunnerPauseOutcome } from '../../../pause.js';
import type { Runner } from '../../../runner.js';
import type { RunnerInvocation } from '../../../runnerExecution.js';
import type { AgentRunValues } from '../../runValues.js';
import type { AgentOutput, AgentState } from '../../types.js';

import type { AgentConfiguration } from '../configuration/types.js';

let usedTrustRecorders: WeakSet<TrustBoundaryRecorder> | undefined;

function openTrustRecorder(factory: () => TrustBoundaryRecorder): TrustBoundaryRecorder {
  const recorder = factory();
  if (
    recorder === null ||
    typeof recorder !== 'object' ||
    typeof recorder.id !== 'string' ||
    typeof recorder.subscribe !== 'function' ||
    typeof recorder.toSnapshot !== 'function'
  ) {
    throw new TypeError('Agent artifacts.recordings.trustBoundaries must return a recorder.');
  }
  const used = (usedTrustRecorders ??= new WeakSet());
  if (used.has(recorder) || recorder.counters?.observed !== 0)
    throw new TypeError('Agent artifacts.recordings.trustBoundaries must return a fresh recorder.');
  used.add(recorder);
  return recorder;
}

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
  const createTrust = config.artifactRecordings.trustBoundaries;
  // Only THIS run's events: on an instance serving several sessions, the
  // hosting door emits facts for other sessions while this run is in flight,
  // and a recording is redeemable by the person it was filed for.
  const recording = recordRunWhere(
    runner,
    (event) =>
      invocation.run.origin !== undefined && eventBelongsToRun(event.meta, invocation.context()),
    {},
    createTrust === undefined ? undefined : openTrustRecorder(createTrust),
    // Unattributed consumer facts may remain on the timeline but do not prove
    // a trust decision by this invocation.
    (event) => event.meta.runId === invocation.run.origin?.runId,
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
  if (config.artifactRecordings.layout === 'parts') {
    await fileInParts(runner, store, invocation, recorder, config.artifactRecordings, runId);
    return;
  }
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
    const scope = Object.freeze(runArtifactScope(invocation));
    const result = await store.put(scope, input);
    const { ref, bytes } = result.meta;
    if (isArtifactRef(ref) && Number.isSafeInteger(bytes) && bytes >= 0) {
      invocation.value.recording = { scope, receipt: Object.freeze({ ref, bytes }) };
    }
    // Sweeps ride the put result, so retention that evicted an older
    // recording to make room says so on the record — the same law a tool's
    // own mint follows.
    reportSwept(runner, result.swept);
    reportMinted(runner, result.meta);
  } catch (err) {
    reportRecordingRefused(runner, err, 'invalid-input');
  }
}

/**
 * File the recording in parts (`recordings: { layout: 'parts' }`): every part
 * first, the index last, the receipt naming the index. The sequencing and its
 * undo belong to `recordingParts/file.ts · fileRecordingParts`; this puts its
 * facts on the record. Real sweeps are reported whether or not the filing
 * finished; a filing that stopped is ONE refusal, with what it wrote deleted.
 */
async function fileInParts(
  runner: Runner,
  store: NonNullable<AgentConfiguration['artifactStore']>,
  invocation: RunnerInvocation<AgentRunValues>,
  recorder: RunRecorder,
  options: AgentRecordingsOptions,
  runId: string | undefined,
): Promise<void> {
  let recording;
  try {
    recording = recorder.toRecording();
  } catch (err) {
    reportRecordingRefused(runner, err, 'invalid-input');
    return;
  }
  const scope = Object.freeze(runArtifactScope(invocation));
  const filed = await fileRecordingParts(store, scope, recording, {
    ...(runId !== undefined && { runId }),
    ...(options.label !== undefined && { label: options.label }),
    packed: options.packed === true,
  });
  reportSwept(runner, filed.swept);
  if (filed.status === 'refused') {
    runner.emit('agentfootprint.artifacts.refused', {
      op: 'put',
      reason: 'invalid-input',
      detail: filed.detail,
    });
    return;
  }
  const { ref, bytes } = filed.index;
  if (isArtifactRef(ref) && Number.isSafeInteger(bytes) && bytes >= 0) {
    invocation.value.recording = { scope, receipt: Object.freeze({ ref, bytes }) };
  }
  for (const part of filed.parts) reportMinted(runner, part);
  reportMinted(runner, filed.index);
}

/** One expiry fact per artifact retention swept to admit a put. */
function reportSwept(runner: Runner, swept: readonly SweptArtifact[]): void {
  for (const row of swept) {
    runner.emit('agentfootprint.artifacts.expired', {
      ref: row.ref,
      reason: row.reason,
      kind: row.kind,
      bytes: row.bytes,
    });
  }
}

/** One mint fact per stored artifact: its ticket, never its bytes. */
function reportMinted(runner: Runner, meta: ArtifactMeta): void {
  runner.emit('agentfootprint.artifacts.minted', {
    ref: meta.ref,
    kind: meta.kind,
    mediaType: meta.mediaType,
    bytes: meta.bytes,
    ...(meta.label !== undefined && { label: meta.label }),
    ...(meta.expiresAt !== undefined && { expiresAt: meta.expiresAt }),
    ...(meta.origin !== undefined && { origin: meta.origin }),
  });
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
