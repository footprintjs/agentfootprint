/**
 * The `answer-account` op for a recording saved IN PARTS (`recording/run-index`).
 *
 * An account reads only the recording's base: its events, shared and initial
 * state and recorder rows, never `snapshot.subflowResults` (nothing under
 * `answer-account/` reads it). So a parts recording is explained from its
 * base part alone, read through `openSavedRecording`, and answers exactly what
 * the same run filed whole answers.
 *
 * The same order as the whole path (`wire.ts · explainAnswer`), with the index
 * standing in for the ticket:
 *
 *  1. **Open silently** — the index is read through a binding with no fact
 *     sink, so a cache hit, a refusal or a made-up ref emits nothing.
 *  2. **Size from the index** — the reader is opened with `maxRootBytes` =
 *     `maxRecordingBytes`, so it refuses a base whose `bytes` in the index are
 *     over the ceiling before any part is read, and a packed base whose plain
 *     form is over it before it expands: the named 413, as a whole recording
 *     over the ceiling gets. (A ceiling is per host, so the cache can never
 *     hold an account for such a base.)
 *  3. **The cache, then single-flight**, keyed exactly as the whole path.
 *  4. **One door fact** — on a miss the base part's `get` goes through the
 *     sinked binding: one `artifacts.resolved` (`via: 'get'`) naming the part
 *     the account was read from.
 *
 * The reasons, mapped onto the op's own vocabulary (no new refusal):
 *   `not-found`, `not-a-recording`, `invalid-index` (open) and `part-missing`,
 *   `part-changed`, `not-recorded` (the base) → `ArtifactNotFoundError`, the
 *   op's one "cannot be explained" answer; `too-large` (an index past its cap,
 *   or a base whose plain form is over the ceiling) and a base over the ceiling
 *   by the index → `RecordingTooLargeForAccountError`.
 *
 * `complete: false` is still answered: it says the tree and the subflow
 * results disagree, which the account never reads.
 */

import { bindArtifacts } from '../../../artifacts/capability.js';
import type { ArtifactScope, ArtifactStore } from '../../../artifacts/types.js';
import { openSavedRecording } from '../../../recorders/observability/recordingParts/open.js';
import type { AnswerAccountWireBody } from '../../artifactWire.js';
import type { AnswerAccounts } from '../../answerAccounts.js';
import { RecordingTooLargeForAccountError } from '../../errors.js';

/** What explaining a parts recording came to: an answer, or which refusal to send. */
export type PartsAccountOutcome =
  | { readonly status: 'answered'; readonly answer: AnswerAccountWireBody }
  | { readonly status: 'not-found' }
  | { readonly status: 'too-large' };

/**
 * Explain the parts recording `ref` names, under `scope`. `bound` is the
 * session's sinked binding; only the base part's `get` goes through it.
 */
export async function explainPartsRecording(
  service: AnswerAccounts,
  store: ArtifactStore,
  scope: ArtifactScope,
  ref: string,
  bound: ReturnType<typeof bindArtifacts>,
): Promise<PartsAccountOutcome> {
  const silent = bindArtifacts(store, scope);
  let reading: Pick<ReturnType<typeof bindArtifacts>, 'get'> = silent;
  const opened = await openSavedRecording(
    { head: (asked) => silent.head(asked), get: (asked) => reading.get(asked) },
    ref,
    { maxRootBytes: service.maxRecordingBytes },
  );
  if (opened.status !== 'ready') {
    return opened.reason === 'too-large' ? { status: 'too-large' } : { status: 'not-found' };
  }
  if (opened.layout !== 'parts') return { status: 'not-found' };

  const key = service.keyFor(scope, ref);
  const answer =
    service.cached(key) ??
    (await service.compute(key, async () => {
      reading = bound;
      const root = await opened.readRoot();
      if (root.status === 'ready') {
        return { data: root.recording, ...(opened.runId !== undefined && { runId: opened.runId }) };
      }
      // A base whose plain form is over the ceiling: the op's named 413, as a
      // packed whole recording gets — thrown, so joined waiters share it.
      if (root.reason === 'too-large') {
        throw new RecordingTooLargeForAccountError(service.maxRecordingBytes);
      }
      return null;
    }));
  return answer === null ? { status: 'not-found' } : { status: 'answered', answer };
}
