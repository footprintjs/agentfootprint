/**
 * runbook/recording — the inner chart's own recording, filed beside the walk.
 *
 * Pattern: one pure assembler (`chartRecordingOf`) + one guarded side effect
 *          (`mintChartRecording`, which files the artifact and NEVER fails the
 *          answer) — `walk.ts`'s shape, deliberately, because it is the same
 *          law about a different payload.
 * Role:    core/runbook. Opt-in via `walk: { recording }`.
 * Emits:   nothing (the artifact capability emits its own `artifacts.*`).
 *
 * WHY THIS EXISTS AT ALL
 * ──────────────────────
 * The walk is a ROW PROJECTION — eight declared columns per execution step,
 * values off by construction. It is the right thing to hand a model and the
 * wrong thing to hand a renderer: a step graph cannot be inferred from
 * sentences about steps, and a consumer that tried would be guessing at edges.
 * The one piece that makes a walk drawable is `structure`, the chart's
 * build-time graph, which a finished run does not leave behind and no snapshot
 * carries. That is the whole gap this closes, and it closes it with the shape
 * the viewer side has consumed since 8.x: `{ snapshot, events, structure }`.
 *
 * THREE LAWS, and each one is a refusal somewhere
 * ───────────────────────────────────────────────
 *   REDACTED AT THE SOURCE. The snapshot comes from `getSnapshot({ redact:
 *     true })` — the parallel redacted mirror — never the raw working memory.
 *     Whatever `redact` means for the walk means the same here, because it is
 *     the same policy read at the same moment; with no policy configured the
 *     flag is a documented no-op and costs nothing.
 *   REFUSED, NEVER TRUNCATED. Over the byte ceiling the mint does not happen
 *     and the descriptor says so with both numbers. A walk can be projected
 *     because its rows are independently meaningful; a recording is one
 *     bundle, and half of one draws a picture nobody can check.
 *   THE ABSENCE IS SPOKEN. No store, an over-size refusal, an unserializable
 *     snapshot, a store that 500s — every one of them costs the REF and
 *     returns a `recording_note` naming the reason. A failed mint has never
 *     been allowed to cost the answer, and this is not the feature that
 *     changes that.
 *
 * `events` IS EMPTY, BY CONSTRUCTION AND ON PURPOSE
 * ────────────────────────────────────────────────
 * `events` is the typed *agentfootprint* stream, and it is fired by an Agent
 * turn. What ran here is a footprintjs chart on its own executor: it fires no
 * agentfootprint events, so there are none to record and an empty array is the
 * honest count rather than a shortfall. The three keys are all present, which
 * is what `observeRecording()` reads; the walk's own story rides `snapshot`,
 * where the narrative recorder's data already lives. The note says this out
 * loud so nobody reads the empty array as a dropped stream.
 */

import type { Recording } from '../../recorders/observability/recordRun.js';
import { RECORDING_ARTIFACT_KIND, recordingPutInput } from '../../artifacts/recordingArtifact.js';
import { measureArtifactBytes } from '../../artifacts/payload.js';
import type { ToolExecutionContext } from '../tools.js';

/**
 * The default size ceiling for a filed chart recording — 5,000,000 bytes.
 *
 * Chosen against measured sizes rather than taste. A walk of a real triage run
 * is tens of kilobytes; this package's own field measurement of a full
 * `recordRun` bundle (one retrieval turn, vectors included) was 2.76 MB. Five
 * million bytes clears the realistic runbook by more than an order of
 * magnitude and still refuses the pathological one — a fleet sweep whose
 * commit log carries a row per subject per stage — BEFORE it lands in somebody
 * else's store under a retention budget they sized for tickets.
 *
 * It is a declared number, not a magic one: it is named on the option, printed
 * in the refusal, and raised by whoever decides the whole bundle is worth it.
 */
export const DEFAULT_RECORDING_MAX_BYTES = 5_000_000;

/** The resolved recording policy — what `walk: { recording }` normalizes to. */
export interface ResolvedRecordingPolicy {
  readonly maxBytes: number;
  readonly label?: string;
}

/** What the recording mint needs from the call. */
export interface ChartRecordingMintFacts {
  /** The runbook tool's name — names the default label. */
  readonly toolName: string;
  /** The OUTER tool call — `origin.toolCallId`, the join a consumer uses to
   *  pair this recording with the tool call that produced it (and with the
   *  walk minted beside it, which carries the same key). */
  readonly toolCallId: string;
  /** The outer run, when there is one — `origin.runId`. */
  readonly runId?: string;
  /** The resolved policy from `walk: { recording }`. */
  readonly policy: ResolvedRecordingPolicy;
}

/**
 * The recording fields spread onto the `WalkDescriptor`. `recording_note` is
 * always present — this type exists to make "the absence is stated" a thing
 * the compiler enforces rather than a thing a reviewer has to notice.
 */
export interface RecordingDescriptorFields {
  readonly recording_ref?: string;
  readonly recording_kind?: string;
  readonly recording_bytes?: number;
  readonly recording_note: string;
}

/**
 * Normalize `walk: { recording }` into a policy, or `undefined` for OFF.
 *
 * `undefined` and `false` are both off, and off means off: the caller must not
 * take a second snapshot, measure anything, or touch the store.
 */
export function resolveRecordingPolicy(
  recording: boolean | { readonly label?: string; readonly maxBytes?: number } | undefined,
): ResolvedRecordingPolicy | undefined {
  if (recording === undefined || recording === false) return undefined;
  if (recording === true) return { maxBytes: DEFAULT_RECORDING_MAX_BYTES };
  return {
    maxBytes: recording.maxBytes ?? DEFAULT_RECORDING_MAX_BYTES,
    ...(recording.label !== undefined && { label: recording.label }),
  };
}

/**
 * Assemble the `{ snapshot, events, structure }` bundle for one inner chart
 * run. Pure — no store, no clock, no events.
 *
 * @param redactedSnapshot the run snapshot read from the REDACTED mirror
 *   (`executor.getSnapshot({ redact: true })`). Taking the raw one here would
 *   file whatever the chart wrote under a policy that was supposed to scrub
 *   it, which is the one mistake this whole module is arranged to prevent.
 * @param structure the chart's `buildTimeStructure` — the only route to a
 *   drawable graph, and the reason this bundle beats the row projection.
 */
export function chartRecordingOf(redactedSnapshot: unknown, structure: unknown): Recording {
  return { snapshot: redactedSnapshot, events: [], structure };
}

/** The standing sentence: what a FILED recording contains that the walk's row
 *  projection does not. This is the sentence that justifies the opt-in. */
const RECORDING_NOTE =
  "The inner chart's own recording — `{ snapshot, events, structure }`, the shape a viewer " +
  'mounts — so this walk can be drawn as the flowchart it actually ran. It carries what the ' +
  'row projection cannot: the chart STRUCTURE (the only route to a drawable graph; a finished ' +
  "run does not leave it behind), the run's shared state, its whole commit log, and every " +
  "attached recorder's data — that is, whatever the chart WROTE, scrubbed by this call's " +
  '`redact` policy and by nothing else. `events` is empty by construction: a chart run is not ' +
  'an agent turn and fires no agentfootprint events, so there are none to record.';

/**
 * File the inner chart's recording and describe what happened.
 *
 * Called ONLY when `walk: { recording }` asked for one, and it never throws:
 * every failure lands in `recording_note` and the answer travels unchanged.
 */
export async function mintChartRecording(
  ctx: ToolExecutionContext,
  recording: Recording,
  facts: ChartRecordingMintFacts,
): Promise<RecordingDescriptorFields> {
  if (!ctx.hasArtifacts) {
    return {
      recording_note:
        RECORDING_NOTE +
        ' No artifact store is attached to this run, so the recording was assembled but not ' +
        'filed — attach one with `Agent.create({ ..., artifacts })` to get a ref here.',
    };
  }

  // Serialize FIRST, then measure, then put: the mint is where an
  // unserializable snapshot must fail (the `recordingPutInput` law), and the
  // ceiling is judged on the bytes that would actually be stored rather than
  // on a guess about them.
  let input;
  try {
    input = recordingPutInput(recording, {
      toolCallId: facts.toolCallId,
      ...(facts.runId !== undefined && { runId: facts.runId }),
      ...(facts.policy.label !== undefined
        ? { label: facts.policy.label }
        : { label: `${facts.toolName} recording` }),
    });
  } catch (err) {
    return {
      recording_note:
        RECORDING_NOTE +
        ` This one could not be serialized (${
          err instanceof Error ? err.message : String(err)
        }), ` +
        'so it was not filed — a recording JSON cannot carry could not cross any wire either. ' +
        'The failure cost the ref, never the answer.',
    };
  }

  const bytes = measureArtifactBytes(input.data);
  if (bytes > facts.policy.maxBytes) {
    return {
      recording_bytes: bytes,
      recording_note:
        RECORDING_NOTE +
        ` This one measured ${bytes} bytes, over the declared \`walk.recording.maxBytes\` ` +
        `ceiling of ${facts.policy.maxBytes}, so it was NOT filed. It is refused rather than ` +
        'truncated on purpose: the walk can be projected because its rows are independently ' +
        'meaningful, but a recording is one bundle — half a commit log under a whole chart ' +
        'draws a picture nobody can check. Raise `walk.recording.maxBytes` if the whole thing ' +
        'is what you need. The walk above is unaffected.',
    };
  }

  try {
    const meta = await ctx.artifacts.put(input);
    return {
      recording_ref: meta.ref,
      recording_kind: RECORDING_ARTIFACT_KIND,
      recording_bytes: meta.bytes,
      recording_note: RECORDING_NOTE,
    };
  } catch (err) {
    return {
      recording_bytes: bytes,
      recording_note:
        RECORDING_NOTE +
        ` This one could not be filed (${err instanceof Error ? err.message : String(err)}) — ` +
        'the mint failure cost the ref, never the answer.',
    };
  }
}
