/**
 * recordingEnvelope — the versioned, serialized contract around a recording.
 *
 * `recordRun` already freezes a run into `{ events, snapshot, structure }`, and
 * that shape is exactly right for handing to a viewer in the same process. What
 * it is NOT is a thing you can put on disk and read back next quarter: it
 * carries no format marker, no producer version, no statement of which run it
 * is, and no statement of whether it is the WHOLE run. So every consumer that
 * wanted to archive one, attach one to a bug report, or feed one to an analysis
 * tool invented its own wrapper — and each wrapper made a different guess about
 * the same missing facts.
 *
 * This is the producer-owned answer: one envelope, one format string, and every
 * field either a fact the library can prove or a fact the caller stated.
 *
 *   import { persistRecording, fileRecordingSink } from 'agentfootprint/observe';
 *
 *   const recorder = recordRun(agent);
 *   await agent.run({ message });
 *   await persistRecording(recorder, {
 *     sink: fileRecordingSink({ directory: './run-archive' }),
 *     run: { complete: true },
 *   });
 *
 * ## The rule this file exists to keep: never stamp a fact you had to guess
 *
 * An envelope is read by people and tools that were not there when the run
 * happened. That makes every field a claim, and a claim that turns out to be a
 * guess is worse than a missing field — a missing field sends the reader to
 * look, a wrong field stops them looking. So each one has a stated source:
 *
 *   runId, sessionId,      derived from the EVENT META, which is the only
 *   principal, tenant      place these are recorded, or stated by the caller.
 *                          Never synthesized. See "identity" below.
 *   startedAt / endedAt    derived from event wall clocks, but only where the
 *                          stream can honestly supply them (see below).
 *   complete               CALLER INPUT, always. Nothing in a finished
 *                          recording says whether the run reached its end.
 *   droppedEvents          read off the live recorder, which counts them; a
 *                          bare recording carries no count, so it is asked for
 *                          rather than assumed to be 0.
 *   configuration          lifted from the run's own `run_configured` event —
 *                          the manifest, which is names-and-ids only by law.
 *   producer               read from the package manifests at runtime.
 *
 * Where a fact is neither derivable nor supplied, this REFUSES
 * ({@link IndeterminateRunFactError}) instead of filling in a plausible value.
 *
 * ## Identity is never invented
 *
 * `principal` and `tenant` come from `EventMeta`, and `EventMeta`'s own law
 * (see src/events/types.ts) is that they are stamped ONLY from an explicit
 * `run(input, { identity })` — never from the run's internal identity, and
 * never from a session id, because "a conversation id is not an actor". By
 * sourcing them from the meta and nowhere else, this envelope inherits that
 * guarantee whole: an anonymous run produces an envelope with no `principal`
 * key at all, not a placeholder and not a session id wearing an actor's name.
 *
 * ## `runId` has two namespaces, and this one is deliberate
 *
 * A footprintjs snapshot carries its OWN engine-level `runId`
 * (`<timestamp>-<padded counter>`, minted per `executor.run()`), while the
 * agentfootprint events carry `run-<timestamp>-<seq>` from `makeRunId()`. They
 * are different ids for different layers and they do not match. This envelope
 * uses the EVENT-meta one exclusively, because that is the id `sessionId`,
 * `principal` and `tenant` ride beside and the one every typed-event consumer
 * correlates on. When the events cannot supply it, this refuses rather than
 * falling back to the snapshot's — quietly substituting an id from another
 * namespace would make two envelopes look comparable when they are not.
 */

import type { AgentfootprintEvent } from '../../events/registry.js';
import { manifestFromEvents } from '../../lib/context-bisect/arms/manifest.js';
import type { RunManifestLike } from '../../lib/context-bisect/arms/types.js';
import type { CapturedEventLike } from '../../lib/context-bisect/types.js';
import { engineVersion, libraryVersion } from '../../lib/libraryVersion.js';
import type { Recording, RunRecorder } from './recordRun.js';

/**
 * The format marker. Bumped only for a change an older reader could not
 * survive — a reader that does not recognise the string must refuse the file,
 * never half-read it.
 */
export const RECORDING_ENVELOPE_FORMAT = 'agentfootprint.recording.v1';

/**
 * The privacy policy id a `'full'` envelope carries when the caller names none.
 * A stable string so a retention rule can match on it rather than on prose.
 */
export const FULL_PRIVACY_POLICY_ID = 'agentfootprint.privacy.full.v1';

/**
 * What a caller may ASK for. Only `'full'` is implemented in v1; the other two
 * are named here so the refusal can name them back, and so a consumer writing
 * against a future version gets a compile-time hint rather than a typo.
 */
export type RecordingPrivacyMode = 'full' | 'structure-only' | 'redacted';

/** Versions of the two libraries that produced the bytes. */
export interface RecordingProducer {
  /** This library's version, or `'unknown'` when the manifest is unreadable. */
  readonly agentfootprintVersion: string;
  /** The engine underneath it, or `'unknown'`. */
  readonly footprintjsVersion: string;
}

/**
 * WHICH run this is, and how much of it this is.
 *
 * Every field is either derived from the recording's own events or stated by
 * the caller — see the module header for the per-field source.
 */
export interface RecordingRun {
  /** From `EventMeta.runId` — the agentfootprint run id, not the engine's. */
  readonly runId: string;
  /** Present only when the run was session-bound. Never invented. */
  readonly sessionId?: string;
  /** The actor the caller NAMED. Absent for an anonymous run. */
  readonly principal?: string;
  /** The tenant boundary the caller NAMED. Absent for a single-tenant run. */
  readonly tenant?: string;
  /** ISO 8601. The first recorded event's wall clock, unless the caller said. */
  readonly startedAt: string;
  /**
   * ISO 8601. Absent when the recording is not `complete` and the caller named
   * no end — a run that had not finished has no end time to report.
   */
  readonly endedAt?: string;
  /**
   * Did this recording capture the run through to its end?
   *
   * ALWAYS the caller's statement. A frozen recording looks identical whether
   * it was taken after the run or from a crash handler mid-run, and there is no
   * run-terminal event in the registry to check, so the library cannot know.
   * Defaulting it to `true` would make every crash dump claim to be whole.
   */
  readonly complete: boolean;
  /**
   * Events discarded to stay under the recorder's `maxEvents` cap. `0` means
   * "none were dropped", proven — never "we did not look".
   */
  readonly droppedEvents: number;
  /**
   * The ORIGINAL stream position of the first retained event (9.60.0) — the
   * envelope's events are stream positions
   * `[firstRetainedEventIndex, firstRetainedEventIndex + events.length)`.
   * A drop COUNT says how much is gone; this says WHERE the kept window
   * starts, which is what lets a reader align this tail against another
   * record of the same run. Present exactly when the source could prove it
   * (the live recordRun handle, or the caller's own statement beside
   * `droppedEvents`); absent means "not proven", never 0-by-assumption.
   */
  readonly firstRetainedEventIndex?: number;
}

/** What the agent was configured as — names and ids only, no values. */
export interface RecordingConfiguration {
  readonly agentId?: string;
  /**
   * The run manifest, as the run itself declared it in
   * `agentfootprint.agent.run_configured`.
   *
   * Safe to archive by construction: the manifest's own law is NAMES AND IDS
   * ONLY — no endpoints, directories, connection strings or keys — precisely
   * because it was built to ride into recordings and shared traces.
   */
  readonly manifest?: RunManifestLike;
}

/** What was done to the bytes before they were stored. */
export interface RecordingPrivacy {
  /**
   * `'full'` — the recording is exactly what `recordRun` captured, unredacted.
   *
   * A v1 envelope can say nothing else: the redacting modes are not built, and
   * this refuses to produce a label it cannot honour.
   */
  readonly mode: 'full';
  /** Names the policy the producer applied. See {@link FULL_PRIVACY_POLICY_ID}. */
  readonly policyId: string;
}

/**
 * One archived run: the recording, plus everything a reader needs to know what
 * they are holding.
 *
 * Plain JSON by construction — no Dates, no Maps, no live handles — so
 * `JSON.parse(JSON.stringify(envelope))` is the same envelope. Absent optional
 * fields are absent KEYS rather than keys with `undefined`, which is what makes
 * that round trip exact.
 */
export interface RecordingEnvelope {
  readonly format: typeof RECORDING_ENVELOPE_FORMAT;
  readonly producer: RecordingProducer;
  readonly run: RecordingRun;
  readonly configuration?: RecordingConfiguration;
  readonly privacy: RecordingPrivacy;
  /** The recording itself, unmodified — `{ snapshot, events, structure }`. */
  readonly recording: Recording;
}

/** A timestamp a caller may state, in any of the three obvious spellings. */
export type RecordingTimestamp = string | number | Date;

/** The run facts a caller states — the half the library cannot derive. */
export interface RecordingRunFacts {
  /**
   * Did the recording capture the run through to its end?
   *
   * Required, and deliberately so: this is the one field with no derivation and
   * no safe default, so the API asks rather than guesses. Say `false` for a
   * recording frozen from a crash handler, a timeout, or mid-stream.
   */
  readonly complete: boolean;
  /** Override the event-derived run id, or supply it when events cannot. */
  readonly runId?: string;
  readonly sessionId?: string;
  readonly principal?: string;
  readonly tenant?: string;
  readonly startedAt?: RecordingTimestamp;
  readonly endedAt?: RecordingTimestamp;
  /**
   * Events lost to the recorder's cap. Read off a live `recordRun` handle
   * automatically; state it when persisting a bare `Recording`, whose shape
   * carries no count.
   */
  readonly droppedEvents?: number;
  /**
   * Where the kept event window starts in the original stream. Read off a
   * live handle automatically; state it only when persisting a bare
   * `Recording` AND you can prove it. Refused if negative or fractional.
   */
  readonly firstRetainedEventIndex?: number;
}

/**
 * Where an envelope goes. One method, so a destination is a few lines: a
 * directory, an object store, a table, an HTTP endpoint.
 */
export interface RecordingSink {
  /**
   * Store one envelope.
   *
   * @returns `id`   the sink's own handle for what it just stored.
   *          `uri`  where it landed, when the sink has a meaningful address.
   */
  write(envelope: RecordingEnvelope): Promise<{ id: string; uri?: string }>;
}

/** Options for {@link persistRecording}. */
export interface PersistRecordingOptions {
  readonly sink: RecordingSink;
  /**
   * The run facts. Required because {@link RecordingRunFacts.complete} is:
   * an envelope that did not state whether it holds a whole run is an envelope
   * whose reader has to guess.
   */
  readonly run: RecordingRunFacts;
  /** Override the manifest lifted from the run's own `run_configured` event. */
  readonly configuration?: RecordingConfiguration;
  readonly privacy?: { readonly mode?: RecordingPrivacyMode; readonly policyId?: string };
}

/** Options for {@link buildRecordingEnvelope}. */
export type BuildRecordingEnvelopeOptions = Omit<PersistRecordingOptions, 'sink'>;

/** A recording to envelope, or the live handle that is still collecting one. */
export type RecordingSource = Recording | RunRecorder;

// ─── Refusals ────────────────────────────────────────────────────────

/**
 * Raised when a privacy mode is asked for that this version cannot honour.
 *
 * Its own class because the answer is never "retry": a caller catching this has
 * to change what they store or how they store it.
 */
export class UnsupportedPrivacyModeError extends Error {
  readonly code = 'ERR_UNSUPPORTED_PRIVACY_MODE' as const;
  readonly mode: string;

  constructor(mode: string) {
    super(
      `[recording-envelope] privacy mode '${mode}' is not implemented. ` +
        `${RECORDING_ENVELOPE_FORMAT} can produce 'full' envelopes only — the bytes exactly ` +
        `as recordRun captured them.\n\n` +
        `This refuses rather than approximating because the label is what downstream readers ` +
        `act on: an archive browser decides what to show, a retention rule decides how long to ` +
        `keep it, and a triage tool decides who may open it — all from this field. An envelope ` +
        `stamped '${mode}' over un-redacted bytes would be handled with LESS care than one ` +
        `that admits it is raw, so silently storing the raw bytes under that label is the ` +
        `worse outcome, not the convenient one.\n\n` +
        `Either persist with privacy: { mode: 'full' } and hold the result under the rules raw ` +
        `run data needs, or redact BEFORE persisting — recordRun(agent, { boundaryDetail: ` +
        `'lean' }) captures no payloads in the first place, and serializeTrace/redactContent ` +
        `redact at the serialize boundary.`,
    );
    this.name = 'UnsupportedPrivacyModeError';
    this.mode = mode;
  }
}

/**
 * Raised when a required run fact is neither derivable from the recording nor
 * stated by the caller.
 *
 * Carries the `field` so a caller can catch it and supply exactly that one.
 */
export class IndeterminateRunFactError extends Error {
  readonly code = 'ERR_INDETERMINATE_RUN_FACT' as const;
  readonly field: string;

  constructor(field: string, detail: string) {
    super(`[recording-envelope] cannot determine run.${field}: ${detail}`);
    this.name = 'IndeterminateRunFactError';
    this.field = field;
  }
}

// ─── Reading the recording ───────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFn = (value: unknown): value is (...args: never[]) => unknown =>
  typeof value === 'function';

/** A live `recordRun` handle is the one that can also report its drop count. */
function asRunRecorder(source: RecordingSource): RunRecorder | undefined {
  return isRecord(source) && isFn((source as Record<string, unknown>).toRecording)
    ? (source as RunRecorder)
    : undefined;
}

/**
 * Every DISTINCT defined value of one `meta` field across the stream.
 *
 * Distinct rather than first-wins on purpose. One recording is meant to be one
 * run, but a recorder left attached across `run()` and then `resume()` sees two
 * run ids, and a stream carrying two principals is two actors. Collapsing
 * either to "the first one" is how an archive ends up labelled with the wrong
 * actor — so the caller is made to say which, rather than being told a guess.
 */
function distinctMetaValues(events: readonly AgentfootprintEvent[], field: string): string[] {
  const seen = new Set<string>();
  for (const event of events) {
    const meta = isRecord(event) ? (event as Record<string, unknown>).meta : undefined;
    if (!isRecord(meta)) continue;
    const value = meta[field];
    if (typeof value === 'string' && value !== '') seen.add(value);
  }
  return [...seen];
}

/** The wall clock of the first / last event that carries one, in epoch ms. */
function edgeWallClock(
  events: readonly AgentfootprintEvent[],
  edge: 'first' | 'last',
): number | undefined {
  const ordered = edge === 'first' ? events : [...events].reverse();
  for (const event of ordered) {
    const meta = isRecord(event) ? (event as Record<string, unknown>).meta : undefined;
    if (!isRecord(meta)) continue;
    const ms = meta.wallClockMs;
    if (typeof ms === 'number' && Number.isFinite(ms)) return ms;
  }
  return undefined;
}

/**
 * One optional identity field, derived under the never-invent rule.
 *
 * @returns the single value, or `undefined` meaning ABSENT — which is a real
 *          answer here ("this run named no tenant"), not a missing one.
 */
function soleIdentity(
  events: readonly AgentfootprintEvent[],
  field: 'sessionId' | 'principal' | 'tenant',
  stated: string | undefined,
): string | undefined {
  if (stated !== undefined) return stated;
  const found = distinctMetaValues(events, field);
  if (found.length === 0) return undefined;
  if (found.length === 1) return found[0];
  throw new IndeterminateRunFactError(
    field,
    `the recording's events carry ${String(found.length)} different values ` +
      `(${found.map((v) => JSON.stringify(v)).join(', ')}), so there is no single one to ` +
      `stamp. Naming one of them here would put a value in the envelope that is wrong for ` +
      `some of the events inside it. Split the recording per ${field}, or state the intended ` +
      `one explicitly as run.${field}.`,
  );
}

/** Normalize a caller timestamp to ISO 8601, refusing anything unreadable. */
function toIso(value: RecordingTimestamp, field: string): string {
  const date =
    value instanceof Date ? value : typeof value === 'number' ? new Date(value) : new Date(value);
  const ms = date.getTime();
  if (Number.isNaN(ms)) {
    throw new IndeterminateRunFactError(
      field,
      `${JSON.stringify(String(value))} is not a readable date. Pass an ISO 8601 string, epoch ` +
        `milliseconds, or a Date.`,
    );
  }
  return date.toISOString();
}

// ─── Building ────────────────────────────────────────────────────────

/** `'full'`, or a named refusal. Never a silent downgrade. */
function resolvePrivacy(privacy: PersistRecordingOptions['privacy']): RecordingPrivacy {
  const mode = privacy?.mode ?? 'full';
  if (mode !== 'full') throw new UnsupportedPrivacyModeError(String(mode));
  return { mode: 'full', policyId: privacy?.policyId ?? FULL_PRIVACY_POLICY_ID };
}

/**
 * Where the kept window starts — proven, stated, or honestly ABSENT.
 *
 * Unlike `droppedEvents` (whose absence would make the envelope's timeline
 * claim unverifiable, so a bare Recording is REFUSED there), the offset is
 * an alignment aid: an envelope without it is still honest — it says
 * "window start unproven" by omission — so a bare Recording resolves to
 * `undefined` rather than a refusal.
 */
function resolveFirstRetained(source: RecordingSource, stated: number | undefined): number | undefined {
  if (stated !== undefined) {
    if (!Number.isInteger(stated) || stated < 0) {
      throw new IndeterminateRunFactError(
        'firstRetainedEventIndex',
        `${JSON.stringify(stated)} is not a stream position. Pass a non-negative integer.`,
      );
    }
    return stated;
  }
  const recorder = asRunRecorder(source);
  if (recorder !== undefined) return recorder.firstRetainedEventIndex;
  return undefined;
}

/** How many events the cap discarded — proven, or asked for. */
function resolveDroppedEvents(source: RecordingSource, stated: number | undefined): number {
  if (stated !== undefined) {
    if (!Number.isInteger(stated) || stated < 0) {
      throw new IndeterminateRunFactError(
        'droppedEvents',
        `${JSON.stringify(stated)} is not a count. Pass a non-negative integer.`,
      );
    }
    return stated;
  }
  const recorder = asRunRecorder(source);
  if (recorder !== undefined) return recorder.droppedEvents;
  throw new IndeterminateRunFactError(
    'droppedEvents',
    `a bare Recording carries no drop count — only the live recordRun handle counts what the ` +
      `maxEvents cap discarded, and that handle is gone by the time a recording is a plain ` +
      `object. Reporting 0 here would turn "we did not look" into "none were dropped", which ` +
      `is the difference between a timeline that starts at the run's beginning and one that ` +
      `merely appears to. Pass the handle from recordRun(agent) instead of its recording, or ` +
      `state run.droppedEvents.`,
  );
}

/**
 * Freeze a recording into an archivable envelope, without storing it.
 *
 * The half of {@link persistRecording} that has no destination — useful when
 * the envelope goes somewhere this library should not know about (a request
 * body, a queue), and the unit under test for the contract itself.
 */
export function buildRecordingEnvelope(
  source: RecordingSource,
  options: BuildRecordingEnvelopeOptions,
): RecordingEnvelope {
  if (!isRecord(source)) {
    throw new TypeError(
      `[recording-envelope] expected a Recording ({ snapshot, events, structure }) or the ` +
        `handle from recordRun(agent); received ${typeof source}.`,
    );
  }
  const facts = options.run;
  if (!isRecord(facts) || typeof facts.complete !== 'boolean') {
    throw new TypeError(
      `[recording-envelope] run.complete must be stated as true or false. Nothing in a frozen ` +
        `recording says whether it reached the run's end — a crash-handler snapshot and a ` +
        `finished run look identical — so this is asked for rather than guessed. Defaulting it ` +
        `would make every partial recording claim to be whole.`,
    );
  }

  // Resolve privacy FIRST: an unsupported mode must refuse before any work is
  // done that a caller could mistake for progress toward a stored file.
  const privacy = resolvePrivacy(options.privacy);

  const recorder = asRunRecorder(source);
  const recording: Recording = recorder ? recorder.toRecording() : (source as Recording);
  const events: readonly AgentfootprintEvent[] = Array.isArray(recording.events)
    ? recording.events
    : [];

  const droppedEvents = resolveDroppedEvents(source, facts.droppedEvents);
  const firstRetainedEventIndex = resolveFirstRetained(source, facts.firstRetainedEventIndex);

  // ── runId ──
  let runId: string;
  if (facts.runId !== undefined) {
    runId = facts.runId;
  } else {
    const found = distinctMetaValues(events, 'runId');
    if (found.length === 1) {
      runId = found[0] as string;
    } else if (found.length === 0) {
      throw new IndeterminateRunFactError(
        'runId',
        `no event in this recording carries meta.runId${
          events.length === 0 ? ' (the recording holds no events at all)' : ''
        }. The snapshot's own runId is deliberately NOT used as a fallback: it is the ` +
          `footprintjs engine's id for the run, a different namespace from the ` +
          `agentfootprint run id the events carry, so substituting it would make two ` +
          `envelopes look comparable when they are not. Record with recordRun(agent) BEFORE ` +
          `run(), or state run.runId.`,
      );
    } else {
      throw new IndeterminateRunFactError(
        'runId',
        `this recording spans ${String(found.length)} runs (${found
          .map((v) => JSON.stringify(v))
          .join(', ')}). A fresh run id is minted per run() AND per resume(), so a recorder ` +
          `left attached across both sees two. An envelope names ONE run — split the ` +
          `recording, or state which run.runId this archive is filed under.`,
      );
    }
  }

  const sessionId = soleIdentity(events, 'sessionId', facts.sessionId);
  const principal = soleIdentity(events, 'principal', facts.principal);
  const tenant = soleIdentity(events, 'tenant', facts.tenant);

  // ── startedAt ──
  let startedAt: string;
  if (facts.startedAt !== undefined) {
    startedAt = toIso(facts.startedAt, 'startedAt');
  } else if (droppedEvents > 0) {
    // The cap drops the OLDEST events, so the earliest event still held is not
    // the one the run started with. Reading a start time off it would be off by
    // however much of the run was discarded, silently.
    throw new IndeterminateRunFactError(
      'startedAt',
      `${String(droppedEvents)} event(s) were dropped from the head of this stream, so the ` +
        `earliest retained event is NOT the run's first — deriving a start time from it would ` +
        `report the moment recording overflowed, not the moment the run began. State ` +
        `run.startedAt, or record with a larger maxEvents.`,
    );
  } else {
    const first = edgeWallClock(events, 'first');
    if (first === undefined) {
      throw new IndeterminateRunFactError(
        'startedAt',
        `no event in this recording carries a wall clock to read a start time from. State ` +
          `run.startedAt.`,
      );
    }
    startedAt = new Date(first).toISOString();
  }

  // ── endedAt ──
  // Only a recording the caller calls COMPLETE gets an end time derived for it.
  // In an incomplete recording the last retained event is just where watching
  // stopped; the run has no end yet, and absent is the honest answer.
  let endedAt: string | undefined;
  if (facts.endedAt !== undefined) {
    endedAt = toIso(facts.endedAt, 'endedAt');
  } else if (facts.complete) {
    const last = edgeWallClock(events, 'last');
    if (last !== undefined) endedAt = new Date(last).toISOString();
  }

  // ── configuration ──
  const manifest =
    options.configuration?.manifest ??
    manifestFromEvents(events as unknown as readonly CapturedEventLike[]);
  const agentId = options.configuration?.agentId ?? manifest?.agentId;
  const configuration: RecordingConfiguration | undefined =
    agentId === undefined && manifest === undefined
      ? undefined
      : { ...(agentId !== undefined && { agentId }), ...(manifest !== undefined && { manifest }) };

  // Conditional spreads, not `undefined` values: an absent optional must be an
  // absent KEY, or JSON.stringify drops it and the round trip stops being exact.
  return {
    format: RECORDING_ENVELOPE_FORMAT,
    producer: {
      agentfootprintVersion: libraryVersion(),
      footprintjsVersion: engineVersion(),
    },
    run: {
      runId,
      ...(sessionId !== undefined && { sessionId }),
      ...(principal !== undefined && { principal }),
      ...(tenant !== undefined && { tenant }),
      startedAt,
      ...(endedAt !== undefined && { endedAt }),
      complete: facts.complete,
      droppedEvents,
      ...(firstRetainedEventIndex !== undefined && { firstRetainedEventIndex }),
    },
    ...(configuration !== undefined && { configuration }),
    privacy,
    recording,
  };
}

/**
 * Build the envelope and hand it to a sink.
 *
 * @param source   the handle from `recordRun(agent)`, or the recording it made.
 *                 Prefer the handle: it is the only thing that knows how many
 *                 events the cap discarded.
 * @param options  the destination, the run facts, and the privacy statement.
 *
 * @example
 * ```ts
 * const recorder = recordRun(agent);
 * await agent.run({ message: 'Weather in San Francisco?' });
 *
 * const { uri } = await persistRecording(recorder, {
 *   sink: fileRecordingSink({ directory: './run-archive' }),
 *   run: { complete: true },
 * });
 * recorder.stop();
 * ```
 */
export async function persistRecording(
  source: RecordingSource,
  options: PersistRecordingOptions,
): Promise<{ id: string; uri?: string }> {
  const sink = options.sink;
  if (!isRecord(sink) || !isFn((sink as Record<string, unknown>).write)) {
    throw new TypeError(
      `[recording-envelope] persistRecording needs a sink with a write(envelope) method — ` +
        `e.g. fileRecordingSink({ directory: './run-archive' }).`,
    );
  }
  return sink.write(buildRecordingEnvelope(source, options));
}
