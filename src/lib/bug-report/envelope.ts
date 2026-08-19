/**
 * stampConversation — put the bundle's evidence in the archive contract, or
 * say in one sentence why it could not be.
 *
 * The repo has ONE archive contract (`RecordingEnvelope`) and several
 * presentations over it. This bundle used to be an exception: it packed a bare
 * `recording.json` plus an `environment.json` that repeated the producer facts
 * the envelope already stamps, so the same two versions were written by two
 * different pieces of code with no relationship between them. This is the fold
 * — the envelope is BUILT here, never re-implemented, so every rule it enforces
 * (identity is never invented, `droppedEvents` is proven or refused, an
 * incomplete recording gets no `endedAt`) arrives whole.
 *
 * ## Why a refusal is a return value here, not a throw
 *
 * `persistRecording` throws when a run fact is indeterminate, and it is right
 * to: its caller asked for an ARCHIVE, and an archive stamped with a guess is
 * worse than none. A bug report's caller asked for something else — the
 * evidence, in a zip, so a maintainer can open it. Throwing would leave that
 * person with no bundle at all because the library could not name a start time.
 *
 * So the refusal travels instead of stopping the export: this returns the
 * REASON, the bundle carries the bare recording under its own honest name, and
 * the manifest states which fact was missing and the one line that supplies it.
 * Nothing is stamped that was not known — which is the rule the throw exists to
 * keep — and the report still gets filed.
 *
 * @internal Not a public export; `exportBugReport` is the door.
 */

import {
  buildRecordingEnvelope,
  IndeterminateRunFactError,
  type RecordingEnvelope,
  type RecordingSource,
} from '../../recorders/observability/recordingEnvelope.js';
import type { BugReportRunFacts } from './types.js';

/**
 * One recording, plus the one thing only the CALL SITE knows about it: whether
 * the thing we were handed can count its own dropped events.
 */
export interface EnvelopeSource {
  /** What `buildRecordingEnvelope` reads: a live handle, or a bare recording. */
  readonly source: RecordingSource;
  /**
   * `true` for a live `recordRun` handle — it counts what the `maxEvents` cap
   * discarded, so nothing the caller states may override it.
   */
  readonly countsDrops: boolean;
}

/**
 * The result for ONE conversation: every recording enveloped, or none of them
 * and the reason.
 *
 * All-or-nothing on purpose. A conversation file holding two envelopes and one
 * bare recording would need a reader to check each entry's shape before it
 * could read any of them, and a file whose shape depends on its contents is the
 * kind of archive this program exists to stop producing.
 */
export interface StampedConversation {
  /** In the recordings' own order. Absent when {@link refusal} is present. */
  readonly envelopes?: readonly RecordingEnvelope[];
  /** One sentence naming the missing fact and how to supply it. */
  readonly refusal?: string;
  /**
   * The envelope field that could not be determined — `'complete'` when the
   * reporter stated no run facts at all.
   *
   * The caller needs it to know whether the fix is even available at this door:
   * `complete` and `droppedEvents` are stated HERE, while `startedAt` and the
   * identity fields are read from the recording's own events, so a refusal
   * naming one of those has to be fixed at recording time.
   */
  readonly field?: string;
}

/**
 * Envelope every recording of one conversation.
 *
 * @param sources  the conversation's recordings, in order, each with whether it
 *                 can prove its own drop count.
 * @param facts    what the reporter stated. `undefined` — the default, since
 *                 `run` is optional on both entry points — is itself a refusal
 *                 reason, and a named one.
 */
export function stampConversation(
  sources: readonly EnvelopeSource[],
  facts: BugReportRunFacts | undefined,
): StampedConversation {
  if (facts === undefined || typeof facts.complete !== 'boolean') {
    return {
      field: 'complete',
      refusal:
        'run.complete was not stated. Nothing in a frozen recording says whether it captured ' +
        'the run through to its end — a crash-handler snapshot and a finished run look ' +
        'identical — so the library asks rather than guessing, and defaulting it would make ' +
        'every partial recording claim to be whole. Pass run: { complete: true } (or false) ' +
        'to exportBugReport.',
    };
  }

  const envelopes: RecordingEnvelope[] = [];
  for (const entry of sources) {
    try {
      envelopes.push(
        buildRecordingEnvelope(entry.source, {
          run: {
            complete: facts.complete,
            // A count the library can CHECK is never overridden by one it
            // cannot: a live handle knows what the cap discarded, so a stated
            // number is only offered for the sources that carry no count.
            ...(!entry.countsDrops &&
              facts.droppedEvents !== undefined && { droppedEvents: facts.droppedEvents }),
          },
        }),
      );
    } catch (error) {
      if (error instanceof IndeterminateRunFactError) {
        return { refusal: error.message, field: error.field };
      }
      throw error;
    }
  }
  return { envelopes };
}
