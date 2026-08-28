/**
 * artifacts/recordingArtifact — a finished run, checked into the store like any
 * other payload.
 *
 * `recordRun` has produced `{ snapshot, events, structure }` since 8.x and the
 * lens family has consumed exactly that shape since. What nobody shipped was
 * the boring half in between: WHERE a completed run's recording goes so a
 * screen can ask for it later. Every deployment that wanted the Lens over the
 * wire wrote the same twenty lines — record the run, serialize it, put it
 * somewhere with a key, hand the key to the frontend — and each one wrote a
 * slightly different, slightly wrong version of retention and scoping.
 *
 * All four of those problems already have an answer in this package: the
 * artifact store IS a keyed payload store with scope isolation, retention and
 * a read-only wire. So a recording is simply an artifact of kind
 * `'recording/run'`, and the wire ops that already redeem claim tickets serve
 * it with **zero new operations** — `{ op: 'artifact-get', ref }` returns the
 * recording, and the frontend does what it always did with the bytes.
 *
 * ── Why the payload is TEXT and not an object ───────────────────────────────
 * The recording is minted as its JSON text — the same bytes
 * `JSON.stringify(recorder.toRecording())` produces, which is precisely what
 * `observeRecording(JSON.parse(text))` consumes on the viewer side. Two
 * reasons, and both are about not lying:
 *
 *   • `recordRun` states that `snapshot` and `structure` are the runner's OWN
 *     objects, held by reference. An in-process store handed those would keep
 *     a live view into a finished run's state — the artifact would silently
 *     change if anything touched it. Serializing detaches it, once, here.
 *   • A recording that cannot be serialized cannot be delivered over any wire
 *     either, so failing at the mint is failing at the honest moment rather
 *     than at whatever reads it next.
 */

import type { PutArtifactInput } from './types.js';

/** The consumer vocabulary a run recording is stored under. One kind, exact
 *  match — the same rule every `wants` declaration is judged by. */
export const RECORDING_ARTIFACT_KIND = 'recording/run';

/**
 * The consumer vocabulary a chart WALK is stored under (9.76.0) — one row per
 * execution step of a runbook's inner chart, with the decider evidence
 * sentences in the `condition` rows. Namespaced by what it IS (`recording/…`,
 * beside `recording/run`), never by what produced it: a walk is a recording
 * projection, not a dataset that happens to mention stages.
 */
export const CHART_WALK_ARTIFACT_KIND = 'recording/chart-walk';

/** The media type a recording is minted with. */
export const RECORDING_MEDIA_TYPE = 'application/json';

/** What a recording mint needs to know beyond the recording itself. */
export interface RecordingMintFacts {
  /** The run this recording is OF — stamped on `origin.runId`, which is the
   *  join back to the trace. */
  readonly runId?: string;
  /**
   * The operator's label, when they set one.
   *
   * Used VERBATIM when present: an operator who named their recordings meant
   * that name, and a library that decorated it would be overruling them. The
   * consequence is worth stating — a static label repeats on every run, and
   * what distinguishes two recordings is the ref and `origin.runId`, never the
   * label. With no label the composed one names the run, which is the most
   * useful honest sentence available at mint time.
   */
  readonly label?: string;
}

/**
 * Raised when a recording could not be turned into bytes.
 *
 * Its own class because the CALLER's answer differs from every other mint
 * failure: a full store is retryable and a cyclic snapshot is not.
 */
export class UnserializableRecordingError extends Error {
  readonly code = 'ERR_UNSERIALIZABLE_RECORDING' as const;

  constructor(detail: string) {
    super(
      `[artifacts] the run recording could not be serialized (${detail}), so it was not ` +
        `stored. A recording that JSON cannot carry could not be delivered over any wire ` +
        `either — this fails at the mint rather than at whatever tried to read it. The run ` +
        `itself is unaffected: its answer was already composed before this was attempted.`,
    );
    this.name = 'UnserializableRecordingError';
  }
}

/**
 * Turn one finished recording into the `put` input that stores it.
 *
 * Pure: no store, no events, no agent. The caller owns WHEN this happens (after
 * the answer is composed) and what to do when it fails.
 *
 * @throws UnserializableRecordingError when the recording cannot be
 *   JSON-serialized — a cyclic object in a snapshot, most likely.
 */
export function recordingPutInput(
  recording: unknown,
  facts: RecordingMintFacts = {},
): PutArtifactInput {
  let text: string;
  try {
    text = JSON.stringify(recording) ?? '';
  } catch (err) {
    throw new UnserializableRecordingError(err instanceof Error ? err.message : String(err));
  }
  if (text === '') {
    throw new UnserializableRecordingError('it serializes to nothing');
  }
  return {
    kind: RECORDING_ARTIFACT_KIND,
    mediaType: RECORDING_MEDIA_TYPE,
    data: text,
    label: facts.label ?? (facts.runId !== undefined ? `run ${facts.runId}` : 'run recording'),
    ...(facts.runId !== undefined && { origin: { runId: facts.runId } }),
  };
}

/** What a chart-walk mint needs to know beyond the rows themselves. */
export interface ChartWalkMintFacts {
  /** The tool whose inner chart walked — names the default label. */
  readonly toolName?: string;
  /** The outer tool call the walk belongs to — stamped on `origin.toolCallId`,
   *  the join back to the call that produced it. */
  readonly toolCallId?: string;
  /** The outer run, when there is one — `origin.runId`. */
  readonly runId?: string;
  /** The operator's label, verbatim when present (the `recordingPutInput`
   *  law: a name somebody chose is not the library's to decorate). */
  readonly label?: string;
}

/**
 * Turn one chart walk into the `put` input that stores it under
 * {@link CHART_WALK_ARTIFACT_KIND}.
 *
 * Pure, and serialized to JSON TEXT at the mint for exactly the reasons the
 * run recording is (see the file header): a walk row must never be a live
 * view into engine memory, and a walk JSON cannot carry could not cross any
 * wire either.
 *
 * @throws UnserializableRecordingError when the rows cannot be
 *   JSON-serialized. Walk rows are projected to plain data upstream, so this
 *   firing means the projection let a live value through — fail at the mint,
 *   loudly.
 */
export function chartWalkPutInput(
  rows: readonly unknown[],
  facts: ChartWalkMintFacts = {},
): PutArtifactInput {
  let text: string;
  try {
    text = JSON.stringify(rows) ?? '';
  } catch (err) {
    throw new UnserializableRecordingError(err instanceof Error ? err.message : String(err));
  }
  if (text === '') {
    throw new UnserializableRecordingError('it serializes to nothing');
  }
  const origin = {
    ...(facts.runId !== undefined && { runId: facts.runId }),
    ...(facts.toolCallId !== undefined && { toolCallId: facts.toolCallId }),
  };
  return {
    kind: CHART_WALK_ARTIFACT_KIND,
    mediaType: RECORDING_MEDIA_TYPE,
    data: text,
    label: facts.label ?? (facts.toolName !== undefined ? `${facts.toolName} walk` : 'chart walk'),
    ...(Object.keys(origin).length > 0 && { origin }),
  };
}
