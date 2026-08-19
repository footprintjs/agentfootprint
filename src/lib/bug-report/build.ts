/**
 * exportBugReport / describeBugReport — a bug report IS the evidence.
 *
 * The usual bug report is a person's memory of a run: "it said the wrong
 * thing, I think it called the search tool twice". The run itself — the
 * timeline, the state, the chart, the narrative — is sitting right there in
 * the process and never leaves it. This turns that around: the report is the
 * run, packaged, with the prose attached.
 *
 * ## Two calls, because consent needs two
 *
 *   1. {@link describeBugReport} — "here is what would be sent." A manifest of
 *      SELECTABLE UNITS: each conversation with its event and turn counts and
 *      its size, each derived file, the redacted keys by name, the total, and
 *      a loud warning with trim hints if it is too big.
 *   2. {@link exportBugReport} — "send exactly these." The reporter's ticked
 *      unit ids come back as `include`, and the bundle carries only those.
 *
 * One call does work for a server-side reporter that has no human in front of
 * it; the two-call shape is what makes a browser consent dialog possible at
 * all, because a dialog cannot ask about a blob it has not measured.
 *
 * ## What is in the bundle (layout 2 — `manifest.manifestVersion`)
 *
 * | file | what it is |
 * |---|---|
 * | `manifest.json` | this manifest — always present, never a selectable unit |
 * | `envelope.json` | the run as a `RecordingEnvelope`: the archive contract, with the canon `{ snapshot, events, structure }` under `recording` |
 * | `recording.json` | the bare recording — ONLY when the envelope's run facts were not available, with the manifest naming the missing one |
 * | `conversations/<id>.json` | one file per conversation, when there is more than one run |
 * | `conversation.json` | the readable transcript, derived from the events |
 * | `narrative.txt` | the narrative recorder's lines, when one was attached |
 * | `environment.json` | the HOST that ran it + the reporter's prose |
 *
 * The evidence file is named for what it is, and there is never more than one
 * of it: a bundle carrying both an envelope and a copy of the recording it
 * already contains would double the biggest file in the archive — and the
 * archive is store-only, so doubling is real bytes, against a ceiling a
 * reporter has to fit under.
 *
 * `environment.json` is the host and NOTHING that identifies a machine: Node
 * version, platform, architecture. **No username, no hostname, no working
 * directory, no environment variables, no file paths.** A bug report should not
 * be the way an internal directory layout leaves a company. The producer
 * versions it used to repeat now live where the archive contract stamps them,
 * in `envelope.json`'s `producer` — one fact, one place. (The manifest's own
 * `environment` block still prints both for the human reading the issue; it is
 * a summary, not a second archive.)
 *
 * ## Redaction is already done, and the manifest proves it
 *
 * The recording arrives ALREADY redacted: footprintjs scrubs at commit time
 * under the run's `RedactionPolicy`, so a redacted value was never in the
 * snapshot this reads. Nothing here scrubs anything — it would be too late to
 * matter and a second policy could only disagree with the first. What this
 * does do is LIST the redacted keys by name, derived from the placeholders
 * actually present in the evidence, so a human consenting to the bundle can
 * see which secrets were protected. A key that is not on that list was not
 * redacted, and the honest reading of an empty list is "no policy was set" —
 * which the manifest says in a note.
 *
 * @example  The consent flow
 * ```ts
 * const manifest = describeBugReport(recording);
 * // …show manifest.units to the human; they tick some…
 * const report = exportBugReport(recording, {
 *   include: ['conv-1', 'file-narrative', 'file-environment'],
 *   title: 'Agent answered with a stale price',
 *   stepsToReproduce: '1. ask for the price\n2. update it\n3. ask again',
 *   expected: 'the new price',
 *   actual: 'the old one',
 * });
 * fs.writeFileSync(report.filename, report.zip);
 * ```
 */

import type { Recording, RunRecorder } from '../../recorders/observability/recordRun.js';
import { narrativeFrom } from '../trace-toolpack/openRecording.js';
import { engineVersion, libraryVersion } from '../libraryVersion.js';
import { stampConversation, type EnvelopeSource } from './envelope.js';
import { deriveTranscript, type Transcript } from './transcript.js';
import { zipStore } from './zip.js';
import type {
  BugReport,
  BugReportEnvironment,
  BugReportFile,
  BugReportFileSummary,
  BugReportInput,
  BugReportManifest,
  BugReportRunFacts,
  BugReportSource,
  BugReportUnit,
  DescribeBugReportOptions,
  ExportBugReportOptions,
} from './types.js';

/** 20 MB. Past this a bundle stops being something a person reviews. */
const DEFAULT_WARN_OVER_BYTES = 20 * 1024 * 1024;

const encoder = new TextEncoder();

// ─── Input normalization: three shapes, one honest answer ────────────

/** One recording plus what we learned about where it came from. */
interface NormalizedRecording {
  readonly recording: Recording;
  /** Absent unless the run was session-bound. */
  readonly sessionId?: string;
  readonly runId?: string;
  /** Honesty notes this source forced (a runner cannot hand over events). */
  readonly notes: readonly string[];
  /**
   * What the archive envelope is built FROM.
   *
   * The live `recordRun` handle where the caller gave us one — not the
   * recording we pulled out of it — because the handle is the only thing that
   * counts what the `maxEvents` cap discarded, and a count that can be read is
   * never a count that gets stated.
   */
  readonly envelope: EnvelopeSource;
}

/** What `withIds` can learn: the recording and the ids on its events. */
type IdentifiedRecording = Pick<NormalizedRecording, 'recording' | 'runId' | 'sessionId'>;

const isFn = (value: unknown): value is (...args: never[]) => unknown =>
  typeof value === 'function';

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;

/**
 * Turn whatever the caller had into recordings.
 *
 * The interesting arm is the runner: a finished runner can give up its
 * snapshot and its chart but NOT its events, because the dispatcher drops
 * events nobody subscribed to. Rather than ship a recording with a silently
 * empty timeline, that arm produces a note the manifest carries and the issue
 * body prints. The fix is one line at the call site (`recordRun(agent)` before
 * the run), and saying so is worth more than a blank panel.
 */
function normalizeOne(source: BugReportSource, index: number): NormalizedRecording {
  const candidate = asRecord(source);
  if (!candidate) {
    throw new TypeError(
      `exportBugReport: source #${index + 1} is ${typeof source}, not a recording. Pass a ` +
        `Recording ({ snapshot, events, structure }), the handle from recordRun(agent), or a ` +
        `runner.`,
    );
  }

  // A RunRecorder — the happy path, already wired. The HANDLE rides on to the
  // envelope builder: it is the only source that can prove its drop count.
  if (isFn(candidate.toRecording)) {
    const recording = (candidate.toRecording as () => Recording)();
    return {
      ...withIds(recording),
      notes: [],
      envelope: { source: source as RunRecorder, countsDrops: true },
    };
  }

  // A Runner — two of the three pieces, honestly labelled.
  if (isFn(candidate.getLastSnapshot) && isFn(candidate.getSpec)) {
    const snapshot = (candidate.getLastSnapshot as () => unknown)();
    if (snapshot === undefined) {
      throw new TypeError(
        `exportBugReport: source #${index + 1} is a runner that has not run yet — there is ` +
          `no snapshot to report. Run it, then export; or pass the recording from ` +
          `recordRun(agent).`,
      );
    }
    const spec = (candidate.getSpec as () => unknown)();
    const recording: Recording = {
      snapshot,
      events: [],
      structure: asRecord(spec)?.buildTimeStructure,
    };
    return {
      ...withIds(recording),
      envelope: { source: recording, countsDrops: false },
      notes: [
        'Exported from a runner AFTER its run, so this bundle has the state and the chart ' +
          'but NO event timeline and no transcript: events are delivered live and dropped ' +
          'when nothing is listening. For the complete three-part recording, call ' +
          'recordRun(agent) before run() and export the recording it returns.',
      ],
    };
  }

  // A Recording, live or parsed back from JSON.
  if ('snapshot' in candidate || 'events' in candidate || 'structure' in candidate) {
    const recording: Recording = {
      snapshot: candidate.snapshot,
      events: Array.isArray(candidate.events) ? (candidate.events as Recording['events']) : [],
      structure: candidate.structure,
    };
    const notes =
      Array.isArray(candidate.events) && candidate.events.length > 0
        ? []
        : [
            'This recording carries no events, so the bundle has no timeline and no ' +
              'transcript. Events are collected as a run happens — call recordRun(agent) ' +
              'BEFORE run(), then export what it gives you.',
          ];
    return { ...withIds(recording), notes, envelope: { source: recording, countsDrops: false } };
  }

  throw new TypeError(
    `exportBugReport: source #${index + 1} is not a recording, a recordRun handle, or a ` +
      `runner. A recording is { snapshot, events, structure } — the shape recordRun(agent)` +
      `.toRecording() returns.`,
  );
}

/** Read the run / session ids off the first event that carries them. */
function withIds(recording: Recording): IdentifiedRecording {
  for (const event of recording.events ?? []) {
    const meta = asRecord(asRecord(event)?.meta);
    if (!meta) continue;
    const runId = typeof meta.runId === 'string' ? meta.runId : undefined;
    const sessionId = typeof meta.sessionId === 'string' ? meta.sessionId : undefined;
    if (runId !== undefined || sessionId !== undefined) {
      return { recording, ...(runId && { runId }), ...(sessionId && { sessionId }) };
    }
  }
  // No events: the snapshot's own run id is the next best key.
  const runId = asRecord(recording.snapshot)?.runId;
  return { recording, ...(typeof runId === 'string' && { runId }) };
}

// ─── Conversations: the selectable unit ──────────────────────────────

interface Conversation {
  readonly id: string;
  readonly sessionId?: string;
  readonly runIds: readonly string[];
  readonly recordings: readonly Recording[];
  /** Parallel to {@link recordings} — what each one's envelope is built from. */
  readonly sources: readonly EnvelopeSource[];
  readonly events: readonly unknown[];
  readonly transcript?: Transcript;
}

/**
 * Group recordings into conversations.
 *
 * A `runId` is per `run()`; a session outlives it. So several runs of one
 * session are ONE conversation — which is what a human means by "the chat that
 * went wrong", and therefore the right unit to consent to. Runs with no session
 * stand alone under their own run id.
 */
function groupConversations(sources: readonly NormalizedRecording[]): Conversation[] {
  const order: string[] = [];
  const byKey = new Map<string, NormalizedRecording[]>();

  sources.forEach((source, index) => {
    const key = source.sessionId ?? source.runId ?? `run-${index + 1}`;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(source);
  });

  return order.map((key, index) => {
    const group = byKey.get(key)!;
    const events = group.flatMap((entry) => [...(entry.recording.events ?? [])]);
    const runIds = group.map((entry) => entry.runId).filter((id): id is string => Boolean(id));
    const sessionId = group[0]?.sessionId;
    const transcript = deriveTranscript(events);
    return {
      id: `conv-${index + 1}`,
      ...(sessionId !== undefined && { sessionId }),
      runIds,
      recordings: group.map((entry) => entry.recording),
      sources: group.map((entry) => entry.envelope),
      events,
      ...(transcript !== undefined && { transcript }),
    };
  });
}

// ─── Redaction: names only, read off the evidence itself ─────────────

/** What footprintjs writes in place of a value the run's policy covered. */
const REDACTION_PLACEHOLDERS = new Set(['[REDACTED]', 'REDACTED']);
/** A bundle is a tree of JSON; this bounds the walk rather than trusting it. */
const MAX_SCAN_DEPTH = 24;

/**
 * Collect the KEY NAMES whose value is a redaction placeholder.
 *
 * Names only, never paths with values attached, and never the values (there
 * are none — they were scrubbed upstream). This is what lets a human consent
 * knowingly: "apiKey and customerSsn were protected; everything else in here
 * is real."
 */
function collectRedactedKeys(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > MAX_SCAN_DEPTH || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectRedactedKeys(item, into, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === 'string' && REDACTION_PLACEHOLDERS.has(child)) into.add(key);
    else collectRedactedKeys(child, into, depth + 1);
  }
}

// ─── The bundle ──────────────────────────────────────────────────────

/** A file the bundler produced, before selection turns it into bytes. */
interface PlannedFile {
  readonly name: string;
  readonly text: string;
  readonly unitId?: string;
  readonly eventCount?: number;
  readonly turnCount?: number;
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const byteLength = (text: string): number => encoder.encode(text).length;

/** The HOST that ran it — and nothing that identifies a machine or a person. */
interface BugReportHost {
  readonly node: string;
  readonly platform: string;
  readonly arch: string;
  readonly appVersion?: string;
}

function hostOf(appVersion?: string): BugReportHost {
  const proc = (globalThis as { process?: { version?: string; platform?: string; arch?: string } })
    .process;
  return {
    node: typeof proc?.version === 'string' ? proc.version : 'unknown',
    platform: typeof proc?.platform === 'string' ? proc.platform : 'unknown',
    arch: typeof proc?.arch === 'string' ? proc.arch : 'unknown',
    ...(appVersion !== undefined && { appVersion }),
  };
}

/**
 * The manifest's environment block — the host PLUS the producer versions.
 *
 * The versions are here and not in `environment.json` because this block is a
 * SUMMARY for a human: it is what a consent dialog shows and what the issue
 * body prints, and it is the only version statement a reader gets when a
 * conversation's run facts were missing and no envelope could be stamped. The
 * archive's copy of the same two facts is stamped once, by the envelope.
 */
function environmentOf(appVersion?: string): BugReportEnvironment {
  return {
    agentfootprint: libraryVersion(),
    footprintjs: engineVersion(),
    ...hostOf(appVersion),
  };
}

/**
 * Everything both entry points share: normalize, group, plan the files.
 *
 * The derived files are BUILDERS, not baked text, and that is load-bearing:
 * `conversation.json` and `narrative.txt` cover whichever conversations are in
 * the bundle, so a conversation the reporter deselected is out of EVERY file
 * rather than out of one and quietly inside another.
 */
interface Plan {
  readonly conversations: readonly Conversation[];
  readonly units: readonly BugReportUnit[];
  /** conversation unit id → its own recording file. */
  readonly conversationFiles: ReadonlyMap<string, PlannedFile>;
  /** file unit id → build that file from the SELECTED conversations. */
  readonly derivedFiles: ReadonlyMap<
    string,
    (selected: readonly Conversation[]) => PlannedFile | undefined
  >;
  readonly notes: readonly string[];
  readonly redactedKeys: readonly string[];
}

function plan(
  input: BugReportInput,
  fields?: ExportBugReportOptions,
  runFacts?: BugReportRunFacts,
): Plan {
  // `describeBugReport` has no `fields` to carry them on, so the facts are their
  // own parameter — but an export passes both, and reading only the parameter
  // would silently drop a caller's `run` if a future call site forgot to thread
  // it. Prefer the explicit one, fall back to the options object.
  const facts = runFacts ?? fields?.run;
  const sources = (Array.isArray(input) ? input : [input]) as readonly BugReportSource[];
  if (sources.length === 0) {
    throw new TypeError(
      'exportBugReport: no run to report. Pass a recording, a recordRun handle, a runner, or ' +
        'an array of them — a bug report with no evidence is the thing this exists to replace.',
    );
  }
  const normalized = sources.map(normalizeOne);
  const conversations = groupConversations(normalized);

  const notes = [...new Set(normalized.flatMap((entry) => entry.notes))];

  const redacted = new Set<string>();
  for (const conversation of conversations) {
    for (const recording of conversation.recordings) collectRedactedKeys(recording, redacted);
  }
  const redactedKeys = [...redacted].sort();
  if (redactedKeys.length === 0) {
    notes.push(
      'No redaction placeholders are present, which means the run had no RedactionPolicy (or ' +
        'nothing it covered was written). Everything in this bundle is the real value.',
    );
  }

  // ── Conversation units ───────────────────────────────────────────
  const single = conversations.length === 1 && conversations[0]!.recordings.length === 1;
  const conversationFiles = new Map<string, PlannedFile>();
  const derivedFiles = new Map<
    string,
    (selected: readonly Conversation[]) => PlannedFile | undefined
  >();
  const units: BugReportUnit[] = [];

  // Refusals are collected by REASON: three conversations that all lack the
  // same stated fact are one note naming three ids, not three notes. One reason
  // means one refused field, so the field rides along with the ids.
  const refusals = new Map<string, { ids: string[]; field?: string }>();

  for (const conversation of conversations) {
    const stamped = stampConversation(conversation.sources, facts);
    if (stamped.refusal !== undefined) {
      const named = refusals.get(stamped.refusal) ?? {
        ids: [],
        ...(stamped.field !== undefined && { field: stamped.field }),
      };
      named.ids.push(conversation.id);
      refusals.set(stamped.refusal, named);
    }

    // One run, one conversation → one file at the root of the bundle, named for
    // what is actually in it: the archive envelope, or the bare recording when
    // the envelope's run facts were not available.
    const name = single
      ? stamped.envelopes
        ? 'envelope.json'
        : 'recording.json'
      : `conversations/${conversation.id}.json`;
    const body = single
      ? stamped.envelopes
        ? stamped.envelopes[0]
        : conversation.recordings[0]
      : {
          id: conversation.id,
          ...(conversation.sessionId !== undefined && { sessionId: conversation.sessionId }),
          runIds: conversation.runIds,
          // One key or the other, never both: the envelope already holds the
          // recording, and a store-only zip pays for every duplicated byte.
          ...(stamped.envelopes
            ? { envelopes: stamped.envelopes }
            : { recordings: conversation.recordings }),
        };
    const text = json(body);
    const turnCount = conversation.transcript?.turns.length ?? 0;
    const file: PlannedFile = {
      name,
      text,
      unitId: conversation.id,
      eventCount: conversation.events.length,
      turnCount,
    };
    conversationFiles.set(conversation.id, file);
    units.push({
      id: conversation.id,
      kind: 'conversation',
      label: conversationLabel(conversation, turnCount),
      bytes: byteLength(text),
      eventCount: conversation.events.length,
      turnCount,
      runCount: conversation.recordings.length,
      ...(conversation.sessionId !== undefined && { sessionId: conversation.sessionId }),
      enveloped: stamped.envelopes !== undefined,
      files: [name],
    });
  }

  // A conversation that could not be enveloped is still in the bundle, whole —
  // what it lost is the archive contract around it, and losing that quietly is
  // exactly the drift this fold exists to end. So the reason is stated, by
  // conversation id, with the one line that supplies the missing fact.
  for (const [reason, { ids, field }] of refusals) {
    // Only two of the envelope's facts can be stated at THIS door. When the
    // refusal names any of the others, the builder's "state run.startedAt"
    // advice is addressed to persistRecording, not to a bug reporter — saying
    // so beats sending them looking for an option that is not there.
    const settableHere = field === 'complete' || field === 'droppedEvents';
    notes.push(
      `${ids.join(', ')} ride${ids.length === 1 ? 's' : ''} as the bare recording rather than ` +
        `an archive envelope: ${reason}` +
        (settableHere
          ? ''
          : ' — of these, exportBugReport can state only run.complete and run.droppedEvents; ' +
            "every other envelope fact is read from the recording's own events, so this one is " +
            'fixed at recording time, not at export time.'),
    );
  }

  // ── Derived file units ───────────────────────────────────────────
  const buildTranscript = (selected: readonly Conversation[]): PlannedFile | undefined => {
    const withTranscripts = selected.filter((conversation) => conversation.transcript);
    if (withTranscripts.length === 0) return undefined;
    return {
      name: 'conversation.json',
      unitId: 'file-conversation',
      text: json({
        conversations: withTranscripts.map((conversation) => ({
          id: conversation.id,
          ...(conversation.sessionId !== undefined && { sessionId: conversation.sessionId }),
          turns: conversation.transcript!.turns,
        })),
      }),
    };
  };
  const wholeTranscript = buildTranscript(conversations);
  if (wholeTranscript) {
    derivedFiles.set('file-conversation', buildTranscript);
    units.push({
      id: 'file-conversation',
      kind: 'file',
      label: 'conversation.json — the readable transcript (prompts, model replies, tool calls)',
      bytes: byteLength(wholeTranscript.text),
      files: ['conversation.json'],
    });
  } else {
    notes.push(
      'No transcript: these events carry no turn, LLM or tool activity to read back, so ' +
        'conversation.json is not in the bundle.',
    );
  }

  const buildNarrative = (selected: readonly Conversation[]): PlannedFile | undefined => {
    const lines = selected.flatMap((conversation) =>
      conversation.recordings.flatMap((recording) => {
        const snapshot = (asRecord(recording.snapshot) ?? {}) as Parameters<
          typeof narrativeFrom
        >[0];
        const said = narrativeFrom(snapshot);
        return said ? [`── ${conversation.id} ──`, ...said] : [];
      }),
    );
    if (lines.length === 0) return undefined;
    return { name: 'narrative.txt', unitId: 'file-narrative', text: `${lines.join('\n')}\n` };
  };
  const wholeNarrative = buildNarrative(conversations);
  if (wholeNarrative) {
    derivedFiles.set('file-narrative', buildNarrative);
    units.push({
      id: 'file-narrative',
      kind: 'file',
      label: 'narrative.txt — the run in sentences, from the attached narrative recorder',
      bytes: byteLength(wholeNarrative.text),
      files: ['narrative.txt'],
    });
  } else {
    notes.push(
      'No narrative.txt: no narrative recorder was attached to this run. Attach ' +
        "footprintjs's narrative() before running to get the run in sentences.",
    );
  }

  // The host is the same whichever conversations ride along. What is NOT here
  // any more: `agentfootprint` and `footprintjs`. Those are producer facts, and
  // the archive contract stamps them in `envelope.json` — a second copy in a
  // second file is a second thing to keep in step, which is how the two shapes
  // drifted in the first place.
  const environmentFile: PlannedFile = {
    name: 'environment.json',
    unitId: 'file-environment',
    text: json({
      ...hostOf(fields?.appVersion),
      ...(fields && {
        report: {
          title: fields.title,
          stepsToReproduce: fields.stepsToReproduce,
          expected: fields.expected,
          actual: fields.actual,
          ...(fields.appVersion !== undefined && { appVersion: fields.appVersion }),
        },
      }),
    }),
  };
  derivedFiles.set('file-environment', () => environmentFile);
  units.push({
    id: 'file-environment',
    kind: 'file',
    label:
      'environment.json — the host that ran it: Node, platform, architecture ' +
      '(no machine identity; the library versions are stamped in the envelope)',
    bytes: byteLength(environmentFile.text),
    files: ['environment.json'],
  });

  return { conversations, units, conversationFiles, derivedFiles, notes, redactedKeys };
}

function conversationLabel(conversation: Conversation, turnCount: number): string {
  const who = conversation.sessionId
    ? `session ${conversation.sessionId}`
    : conversation.runIds[0] ?? 'one run';
  const runs = conversation.recordings.length;
  return (
    `${conversation.id} — ${who}: ${runs} run${runs === 1 ? '' : 's'}, ` +
    `${turnCount} turn${turnCount === 1 ? '' : 's'}, ${conversation.events.length} events`
  );
}

/** Assemble the manifest for a given selection. */
function manifestFor(args: {
  readonly plan: Plan;
  readonly selected: readonly string[];
  readonly files: readonly BugReportFileSummary[];
  readonly createdAt: Date;
  readonly limitBytes: number;
  readonly fields?: ExportBugReportOptions;
}): BugReportManifest {
  const { plan: planned, selected, files, createdAt, limitBytes, fields } = args;
  const selectedSet = new Set(selected);
  const excludedUnits = planned.units.filter((unit) => !selectedSet.has(unit.id));
  const includedConversations = planned.conversations.filter((conversation) =>
    selectedSet.has(conversation.id),
  );

  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const warnings: string[] = [];
  const notes = [...planned.notes];

  const excludedConversationUnits = excludedUnits.filter((unit) => unit.kind === 'conversation');
  if (excludedConversationUnits.length > 0) {
    // Stated, loudly: a maintainer reading turn 4 must know turns 1-3 were not
    // withheld by accident.
    warnings.push(
      `The reporter deliberately excluded ${excludedConversationUnits.length} of ` +
        `${planned.units.filter((unit) => unit.kind === 'conversation').length} ` +
        `conversations from this bundle. What is here is a SUBSET of what the run produced.`,
    );
  }
  const excludedFileUnits = excludedUnits.filter((unit) => unit.kind === 'file');
  if (excludedFileUnits.length > 0) {
    notes.push(
      `Excluded by the reporter: ${excludedFileUnits
        .map((unit) => unit.files.join(', '))
        .join(', ')}.`,
    );
  }

  const oversize =
    totalBytes > limitBytes
      ? {
          totalBytes,
          limitBytes,
          trimHints: trimHints(planned.units, selectedSet, totalBytes, limitBytes),
        }
      : undefined;
  if (oversize) {
    warnings.push(
      `This bundle is ${formatBytes(totalBytes)}, over the ${formatBytes(limitBytes)} ceiling. ` +
        `Trim it by leaving units out: ${oversize.trimHints.join(' ')}`,
    );
  }

  return {
    manifestVersion: 2,
    createdAt: createdAt.toISOString(),
    ...(fields && {
      report: {
        title: fields.title,
        stepsToReproduce: fields.stepsToReproduce,
        expected: fields.expected,
        actual: fields.actual,
        ...(fields.appVersion !== undefined && { appVersion: fields.appVersion }),
      },
    }),
    units: planned.units,
    selected,
    excluded: {
      conversations: excludedConversationUnits.length,
      files: excludedFileUnits.length,
      events: excludedConversationUnits.reduce((sum, unit) => sum + (unit.eventCount ?? 0), 0),
      turns: excludedConversationUnits.reduce((sum, unit) => sum + (unit.turnCount ?? 0), 0),
      unitIds: excludedUnits.map((unit) => unit.id),
    },
    files,
    counts: {
      conversations: includedConversations.length,
      runs: includedConversations.reduce(
        (sum, conversation) => sum + conversation.recordings.length,
        0,
      ),
      events: includedConversations.reduce(
        (sum, conversation) => sum + conversation.events.length,
        0,
      ),
      turns: includedConversations.reduce(
        (sum, conversation) => sum + (conversation.transcript?.turns.length ?? 0),
        0,
      ),
      files: files.length,
    },
    totalBytes,
    redactedKeys: planned.redactedKeys,
    warnings,
    notes,
    ...(oversize && { oversize }),
    environment: environmentOf(fields?.appVersion),
  };
}

/**
 * A size a human reads. KB under a megabyte, MB above it — a ceiling reported
 * as "0.0 MB" teaches nothing, and these strings are the whole content of a
 * refusal.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Name the units worth dropping, biggest first, until the bundle would fit.
 *
 * A hint that says "make it smaller" is not a hint. Each of these names a unit
 * id the caller can pass (or withhold) in `include`, and what dropping it saves.
 */
function trimHints(
  units: readonly BugReportUnit[],
  selected: ReadonlySet<string>,
  totalBytes: number,
  limitBytes: number,
): string[] {
  const droppable = units
    .filter((unit) => selected.has(unit.id) && unit.kind === 'conversation')
    .sort((left, right) => right.bytes - left.bytes);
  const hints: string[] = [];
  let remaining = totalBytes;
  for (const unit of droppable) {
    if (remaining <= limitBytes) break;
    // Never suggest dropping the last conversation: a bundle with no evidence
    // is refused at export, so a hint that leads there is a dead end.
    if (hints.length === droppable.length - 1) break;
    remaining -= unit.bytes;
    hints.push(`Drop ${unit.id} (${formatBytes(unit.bytes)}) → ${formatBytes(remaining)}.`);
  }
  if (remaining > limitBytes) {
    const others = units.filter((unit) => selected.has(unit.id) && unit.kind === 'file');
    for (const unit of others) {
      hints.push(`Drop ${unit.id} (${formatBytes(unit.bytes)}).`);
    }
    hints.push(
      'Still over: record a shorter reproduction, or attach the bundle to the issue by hand.',
    );
  }
  return hints;
}

// ─── The two entry points ────────────────────────────────────────────

/**
 * Measure a bug report before anything leaves — the consent step.
 *
 * Every unit is "selected" in the manifest this returns, because nothing has
 * been chosen yet: it is the offer, with sizes and counts attached, for a human
 * (or a policy) to narrow. Show `units` to the reporter; pass the ids they keep
 * to {@link exportBugReport} as `include`.
 *
 * Cheap enough to call on every dialog open: it serializes the files to measure
 * them, and throws them away.
 *
 * @param input   a recording, a `recordRun` handle, a runner, or an array.
 * @param options size ceiling and a fixed timestamp.
 */
export function describeBugReport(
  input: BugReportInput,
  options: DescribeBugReportOptions = {},
): BugReportManifest {
  const planned = plan(input, undefined, options.run);
  const createdAt = options.now ?? new Date();
  const limitBytes = options.warnOverBytes ?? DEFAULT_WARN_OVER_BYTES;
  const selected = planned.units.map((unit) => unit.id);
  const files = filesFor(planned, new Set(selected)).map(summaryOf);
  // The description does not count manifest.json: it is not written until the
  // export, and its size depends on the selection it will describe. The offer's
  // total is therefore a KB or two under the bundle's — stated here rather than
  // guessed at with a placeholder.
  return manifestFor({ plan: planned, selected, files, createdAt, limitBytes });
}

/**
 * The files for one selection.
 *
 * Conversation units contribute their own recording file; file units are
 * REBUILT over the selected conversations, which is what keeps a deselected
 * conversation out of the transcript and the narrative as well as out of its
 * own file.
 */
function filesFor(planned: Plan, selected: ReadonlySet<string>): readonly PlannedFile[] {
  const chosen = planned.conversations.filter((conversation) => selected.has(conversation.id));
  const out: PlannedFile[] = [];
  for (const unit of planned.units) {
    if (!selected.has(unit.id)) continue;
    if (unit.kind === 'conversation') {
      const file = planned.conversationFiles.get(unit.id);
      if (file) out.push(file);
      continue;
    }
    const file = planned.derivedFiles.get(unit.id)?.(chosen);
    if (file) out.push(file);
  }
  return out;
}

function summaryOf(file: PlannedFile): BugReportFileSummary {
  return {
    name: file.name,
    bytes: byteLength(file.text),
    ...(file.unitId !== undefined && { unitId: file.unitId }),
    ...(file.eventCount !== undefined && { eventCount: file.eventCount }),
    ...(file.turnCount !== undefined && { turnCount: file.turnCount }),
  };
}

/**
 * Build the bundle: the manifest, the named files, and a real zip of them.
 *
 * @param input   a recording, a `recordRun` handle, a runner, or an array.
 * @param options the reporter's prose, plus `include` — the ids from
 *                {@link describeBugReport} that the reporter consented to.
 *
 * @throws TypeError naming the unknown id when `include` names a unit that
 *         does not exist, and naming the available conversations when the
 *         selection would carry no evidence at all.
 */
export function exportBugReport(input: BugReportInput, options: ExportBugReportOptions): BugReport {
  if (!options || typeof options.title !== 'string' || options.title.trim() === '') {
    throw new TypeError(
      'exportBugReport: `title` is required — it becomes the issue title, and an untitled ' +
        'report is one nobody triages. `stepsToReproduce`, `expected` and `actual` are ' +
        'required with it.',
    );
  }

  const planned = plan(input, options, options.run);
  const known = new Set(planned.units.map((unit) => unit.id));
  const selected = options.include ? [...new Set(options.include)] : [...known];

  for (const id of selected) {
    if (!known.has(id)) {
      throw new TypeError(
        `exportBugReport: \`include\` names '${id}', which is not a unit of this report. ` +
          `Available: ${[...known].join(', ')}. Take these ids from ` +
          `describeBugReport(input).units — they are stable within one description, not ` +
          `across runs.`,
      );
    }
  }

  const conversationIds = planned.units
    .filter((unit) => unit.kind === 'conversation')
    .map((unit) => unit.id);
  if (!selected.some((id) => conversationIds.includes(id))) {
    throw new TypeError(
      'exportBugReport: the selection includes no conversation, so the bundle would carry ' +
        'the reporter’s prose and nothing to reproduce from — which is the ordinary bug ' +
        `report this exists to replace. Include at least one of: ${conversationIds.join(', ')}.`,
    );
  }

  const createdAt = options.now ?? new Date();
  const limitBytes = options.warnOverBytes ?? DEFAULT_WARN_OVER_BYTES;
  const selectedSet = new Set(selected);
  const planFiles = filesFor(planned, selectedSet);

  // The manifest counts itself: it is a file in the bundle, and a total that
  // omits it would be a total that lies. Two passes — measure, then restate the
  // total with the manifest's own size folded in.
  const draft = manifestFor({
    plan: planned,
    selected,
    files: planFiles.map(summaryOf),
    createdAt,
    limitBytes,
    fields: options,
  });
  const draftText = json(draft);
  const manifestSummary: BugReportFileSummary = {
    name: 'manifest.json',
    bytes: byteLength(draftText),
  };
  const manifest = manifestFor({
    plan: planned,
    selected,
    files: [manifestSummary, ...planFiles.map(summaryOf)],
    createdAt,
    limitBytes,
    fields: options,
  });

  const files: BugReportFile[] = [
    fileOf('manifest.json', json(manifest)),
    ...planFiles.map((file) => fileOf(file.name, file.text)),
  ];

  const zip = zipStore(
    files.map((file) => ({ name: file.name, data: file.bytes })),
    { modified: createdAt },
  );

  return { manifest, files, zip, filename: bundleFilename(options.title, createdAt) };
}

function fileOf(name: string, text: string): BugReportFile {
  return { name, text, bytes: encoder.encode(text) };
}

/** `2026-08-11-agent-answered-with-a-stale-price.zip`. */
export function bundleFilename(title: string, createdAt: Date): string {
  return `${createdAt.toISOString().slice(0, 10)}-${slugify(title)}.zip`;
}

/** Lower-case, ASCII, hyphenated, bounded — a filename, not a sentence. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'bug-report';
}
