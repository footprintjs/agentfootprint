/**
 * bug-report — the types a bug report is made of.
 *
 * Two of them are the point of the whole sub-library:
 *
 *   {@link BugReportUnit}     the SELECTABLE piece. A reporter consents to
 *                             units, not to a blob.
 *   {@link BugReportManifest} the honest statement of what a bundle contains
 *                             AND what it deliberately leaves out.
 */

import type { Recording, RunRecorder } from '../../recorders/observability/recordRun.js';
import type { Runner } from '../../core/runner.js';

/**
 * Anything a bug report can be built from.
 *
 * - a {@link Recording} — the canon `{ snapshot, events, structure }`, live or
 *   parsed back from JSON. **The complete source.**
 * - a {@link RunRecorder} — the handle `recordRun()` returns; frozen for you.
 * - a {@link Runner} — an agent / composition / pattern. Honest but PARTIAL:
 *   a finished runner can hand over its snapshot and its chart, and it cannot
 *   hand over the event stream, because the dispatcher drops events that
 *   nobody subscribed to rather than queuing them. The manifest says so in a
 *   note instead of shipping a silent gap.
 */
export type BugReportSource = Recording | RunRecorder | Runner;

/** One source, or several — several runs of one session are one conversation. */
export type BugReportInput = BugReportSource | readonly BugReportSource[];

/** What the reporter says happened. The prose half of the report. */
export interface BugReportFields {
  /** One line, as it will read in the issue title. */
  readonly title: string;
  /** How to get there. Free text; numbered lines read best. */
  readonly stepsToReproduce: string;
  /** What should have happened. */
  readonly expected: string;
  /** What happened instead. */
  readonly actual: string;
  /** The reporting APPLICATION's version, when it has one (not this library's
   *  — that is read from the package and cannot be mistyped). */
  readonly appVersion?: string;
}

/**
 * A selectable piece of the bundle.
 *
 * Two kinds, and the difference is what a reporter is deciding:
 *
 *   `conversation` — one conversation's evidence (its recordings, its slice of
 *                    the transcript and of the narrative). Keyed by session id
 *                    when the run was session-bound, else by run id.
 *   `file`         — one derived file that is not per-conversation: the
 *                    readable transcript, the narrative, the environment block.
 *
 * `manifest.json` is not a unit: it is the statement of the selection, and a
 * bundle that could omit its own statement is not an honest bundle.
 */
export interface BugReportUnit {
  /** Stable within one manifest — `conv-1`, `file-narrative`. Selection is by
   *  this id, and the oversize trim hints name these ids. */
  readonly id: string;
  readonly kind: 'conversation' | 'file';
  /** One line a human reads in a consent dialog. */
  readonly label: string;
  /** Bytes this unit contributes to the bundle, uncompressed. */
  readonly bytes: number;
  /** Typed events in this conversation. Conversation units only. */
  readonly eventCount?: number;
  /** Agent turns derived from those events. Conversation units only. */
  readonly turnCount?: number;
  /** Runs folded into this conversation. Conversation units only. */
  readonly runCount?: number;
  /** The hosting session id, when the runs carried one. */
  readonly sessionId?: string;
  /**
   * Conversation units only. `true` when this conversation's evidence rides as
   * a `RecordingEnvelope` — the archive contract, with the recording under its
   * `recording` field; `false` when the envelope's run facts were not available
   * and it rides as the bare recording instead.
   *
   * Stated per unit rather than per bundle because a bundle can be mixed: a
   * live `recordRun` handle proves its own dropped-event count and a bare
   * `Recording` alongside it cannot, so one conversation can be stamped while
   * its neighbour is not. The manifest's notes name the missing fact.
   */
  readonly enveloped?: boolean;
  /** Files this unit puts in the bundle (a `file` unit has exactly one). */
  readonly files: readonly string[];
}

/** One file in the bundle, as the manifest reports it. */
export interface BugReportFileSummary {
  /** Path inside the zip. */
  readonly name: string;
  readonly bytes: number;
  /** The unit that produced it, when one did. `manifest.json` has none. */
  readonly unitId?: string;
  readonly eventCount?: number;
  readonly turnCount?: number;
}

/** What the reporter chose to leave out — stated, never silently absent. */
export interface BugReportExcluded {
  readonly conversations: number;
  readonly files: number;
  readonly events: number;
  readonly turns: number;
  /** The unit ids that were offered and not included. */
  readonly unitIds: readonly string[];
}

/**
 * Versions, and deliberately nothing that identifies a machine or a person.
 *
 * This is the MANIFEST's summary block — the one a consent dialog and the issue
 * body print. The bundled `environment.json` is deliberately NARROWER: since
 * the bundle carries a {@link BugReportManifest.manifestVersion} 2 envelope,
 * the producer versions are stamped there (`envelope.json` → `producer`) and
 * the file keeps only the host half. One archive fact, one stamping place.
 */
export interface BugReportEnvironment {
  /** This library's version, read from its own package manifest. */
  readonly agentfootprint: string;
  /** The engine underneath it. */
  readonly footprintjs: string;
  /** `process.version`, e.g. `v20.11.0`. `'unknown'` off Node. */
  readonly node: string;
  /** `process.platform` / `process.arch` — a platform is not an identity. */
  readonly platform: string;
  readonly arch: string;
  /** The reporting application's own version, when it told us. */
  readonly appVersion?: string;
}

/**
 * The run facts an archive envelope needs and a frozen recording cannot supply.
 *
 * The bundle's evidence rides as a `RecordingEnvelope` — the one archive
 * contract this repo has — and that envelope refuses to stamp a fact it had to
 * guess. Two of its fields have no derivation:
 *
 *   `complete`       nothing in a frozen recording says whether it reached the
 *                    run's end; a crash-handler snapshot and a finished run
 *                    look identical. Stated, or the envelope is not built.
 *   `droppedEvents`  only the live `recordRun` handle counts what the
 *                    `maxEvents` cap discarded.
 *
 * Everything else the envelope needs — `runId`, `sessionId`, `principal`,
 * `tenant`, `startedAt`, `endedAt` — is derived per recording from that
 * recording's OWN events, and is deliberately not settable here: a bundle may
 * carry several runs, and one run id stated once cannot be true of all of them.
 */
export interface BugReportRunFacts {
  /**
   * Did each recording in this bundle capture its run through to the end?
   *
   * Say `false` for a recording frozen from a crash handler, a timeout or
   * mid-stream. Leave the whole `run` option off and the bundle still carries
   * the evidence — as the bare recording, with the manifest stating in a note
   * which fact was missing and how to supply it.
   */
  readonly complete: boolean;
  /**
   * Events lost to the recorder's `maxEvents` cap, for sources that cannot
   * prove their own count.
   *
   * A live `recordRun` handle counts them, and that PROVEN count wins over
   * anything stated here — a number the library can check is never overridden
   * by a number it cannot. State this when the bundle is built from bare
   * `Recording` objects, whose shape carries no count.
   */
  readonly droppedEvents?: number;
}

/** The oversize verdict, with hints that name real, droppable unit ids. */
export interface BugReportOversize {
  readonly totalBytes: number;
  readonly limitBytes: number;
  /** Sentences naming unit ids and what dropping each one saves. */
  readonly trimHints: readonly string[];
}

/**
 * The honest summary of a bundle — what a human reads BEFORE consenting, and
 * what rides inside the zip as `manifest.json` afterwards.
 *
 * `describeBugReport` returns one with every unit selected and no reporter
 * prose. `exportBugReport` returns one that reflects the SELECTION, carries
 * the reporter's fields, and states the exclusions.
 */
export interface BugReportManifest {
  /**
   * The BUNDLE LAYOUT version — bumped when the file set or this manifest's own
   * shape changes, so a reader can tell which archive it is holding instead of
   * inferring it from which names happen to be present.
   *
   *   1 — the evidence rode as a bare `recording.json`, and `environment.json`
   *       repeated the producer versions the archive contract stamps.
   *   2 — the evidence rides as `envelope.json`, a full `RecordingEnvelope`;
   *       `environment.json` keeps only the host facts the envelope does not
   *       hold. A conversation whose run facts could not be stamped falls back
   *       to `recording.json` and the manifest says which fact was missing.
   */
  readonly manifestVersion: 2;
  /** ISO 8601, UTC. Also the timestamp stamped on every zip entry. */
  readonly createdAt: string;
  /** Present on an export manifest; absent on a description. */
  readonly report?: BugReportFields;
  /** Everything on offer, selected or not. */
  readonly units: readonly BugReportUnit[];
  /** The unit ids actually in this bundle. */
  readonly selected: readonly string[];
  readonly excluded: BugReportExcluded;
  readonly files: readonly BugReportFileSummary[];
  readonly counts: {
    readonly conversations: number;
    readonly runs: number;
    readonly events: number;
    readonly turns: number;
    readonly files: number;
  };
  /** Sum of every file in the bundle, uncompressed (the zip is stored). */
  readonly totalBytes: number;
  /**
   * The state keys whose values arrived already scrubbed, BY NAME ONLY.
   *
   * Redaction happens upstream at commit time (footprintjs `RedactionPolicy`),
   * so a bundle never carries the values. This list is derived from the
   * evidence itself — the placeholders that are actually in it — so a human
   * can see WHICH secrets were protected and consent knowing it.
   */
  readonly redactedKeys: readonly string[];
  /** Loud, human-readable problems: oversize, a missing timeline, an empty run. */
  readonly warnings: readonly string[];
  /** Quiet, true facts about how the bundle was assembled. */
  readonly notes: readonly string[];
  /** Present when the bundle is over the size ceiling. */
  readonly oversize?: BugReportOversize;
  readonly environment: BugReportEnvironment;
}

/** One file, as bytes, ready to write or to zip. */
export interface BugReportFile {
  /** Path inside the bundle, `/`-separated and relative. */
  readonly name: string;
  /** The bytes. UTF-8 for every file this library produces. */
  readonly bytes: Uint8Array;
  /** The same content as text, for a consumer that would only decode it again. */
  readonly text: string;
}

/** The finished bundle. */
export interface BugReport {
  /** The manifest, reflecting the selection. Also `manifest.json` inside the zip. */
  readonly manifest: BugReportManifest;
  /** The pieces, named. `files[0]` is always `manifest.json`. */
  readonly files: readonly BugReportFile[];
  /** A real, stored (uncompressed) zip of exactly those files. */
  readonly zip: Uint8Array;
  /** `<yyyy-mm-dd>-<slug>.zip` — a reporter may override it. */
  readonly filename: string;
}

export interface ExportBugReportOptions extends BugReportFields {
  /**
   * Unit ids to bundle. Default: all of them.
   *
   * This is the consent seam: show `describeBugReport(input).units` to the
   * reporter, take back the ids they ticked, pass them here. Anything left out
   * is COUNTED in `manifest.excluded` — the maintainer learns that a subset
   * was sent rather than wondering why turn 4 refers to a turn 3 that is not
   * there.
   */
  readonly include?: readonly string[];
  /**
   * Byte ceiling that flips `oversize` and the loud warning. Default 20 MB —
   * comfortably under what an issue tracker will take, and the point at which
   * a bundle stops being reviewable by a person.
   */
  readonly warnOverBytes?: number;
  /** Override the timestamp — the only thing that makes the zip deterministic. */
  readonly now?: Date;
  /**
   * The two run facts the archive envelope cannot derive. Supply them and the
   * bundle's evidence rides as `envelope.json`; leave them off and it rides as
   * the bare `recording.json`, with the manifest naming the missing fact.
   */
  readonly run?: BugReportRunFacts;
}

/** `describeBugReport` takes nothing but the input, and the same dials. */
export interface DescribeBugReportOptions {
  readonly warnOverBytes?: number;
  readonly now?: Date;
  /**
   * The same run facts {@link ExportBugReportOptions.run} takes — pass the same
   * value to both calls. The offer measures the files the export will write, so
   * stating the facts to one call and not the other would size the bundle from
   * a different set of files than the one that leaves.
   */
  readonly run?: BugReportRunFacts;
}
