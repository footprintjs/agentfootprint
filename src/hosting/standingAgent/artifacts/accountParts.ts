/**
 * The `answer-account` op for a recording saved IN PARTS (`recording/run-index`).
 *
 * An account is explained from the WHOLE recording, read back with
 * `openSavedRecording(…).readWhole()`: bounded, all or nothing, and equal to
 * the recording filed whole by construction. Not from the base part alone: the
 * account's omission witness locates each model call through
 * `time-travel/epochs.ts · epochLocations`, which under
 * `reactMode: 'dynamic-grouped'` finds the call (and its tool selection) only
 * inside `subflowResults`. A base-only account would there be less cautious
 * than the whole recording's, for the same run.
 *
 * The same order as the whole path (`wire.ts · explainAnswer`):
 *
 *  1. **Open silently** — the index is read and verified ONCE per request,
 *     through a binding with no fact sink.
 *  2. **Every part present** — a silent `head` of the base and of each part,
 *     its kind, bytes, digest and run checked against the index (no byte
 *     read), BEFORE the cache: a recording that is no longer whole in the
 *     store is "not available" even while its account is cached, and its
 *     cache entry is dropped. A hit therefore costs N + 2 calls: the index's
 *     `head` and `get`, and one `head` per part (base included), and no other
 *     `get`.
 *  3. **The ceiling on the whole** — `maxRecordingBytes` bounds the whole
 *     recording's plain bytes, as it does a whole recording's. When the
 *     index's stored totals already pass it, the named 413 comes before any
 *     part is read; a packed part that would expand past what is left is
 *     refused before it expands (the reader's cumulative bound).
 *  4. **The cache, then single-flight**, keyed exactly as the whole path.
 *  5. **Door facts** — on a miss, every part's `get` goes through the sinked
 *     binding: one `artifacts.resolved` (`via: 'get'`) per part read, naming
 *     THE PART'S ref, never the index ref the caller asked for. None on a hit,
 *     none for a refusal decided before any read.
 *
 * The reasons, mapped onto the op's own vocabulary (no new refusal): every
 * open or part refusal (`not-found`, `not-a-recording`, `too-large` index,
 * `invalid-index`, `part-missing`, `part-changed`, `not-recorded`) →
 * `ArtifactNotFoundError`, the op's one "cannot be explained", never a partial
 * account; the whole over the ceiling → `RecordingTooLargeForAccountError`.
 * An index past its own cap is not a recording over `maxRecordingBytes`, so
 * it is not answered with that ceiling.
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
 * session's sinked binding; only the parts' `get`s on a miss go through it.
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
  const ceiling = service.maxRecordingBytes;
  const opened = await openSavedRecording(
    { head: (asked) => silent.head(asked), get: (asked) => reading.get(asked) },
    ref,
    { maxRootBytes: ceiling, maxPartBytes: ceiling },
  );
  if (opened.status !== 'ready' || opened.layout !== 'parts') return { status: 'not-found' };

  const key = service.keyFor(scope, ref);
  const present = await opened.checkParts();
  if (present.status !== 'ready') {
    service.drop(key);
    return { status: 'not-found' };
  }
  // Provable from the index alone: the stored parts already pass the ceiling.
  if (opened.sizes.storedBytes - (opened.sizes.index ?? 0) > ceiling)
    return { status: 'too-large' };

  const answer =
    service.cached(key) ??
    (await service.compute(key, async () => {
      reading = bound;
      const whole = await opened.readWhole({ maxBytes: ceiling });
      if (whole.status === 'ready') {
        return {
          data: whole.recording,
          ...(opened.runId !== undefined && { runId: opened.runId }),
        };
      }
      // Past the ceiling once expanded: the op's named 413, as a packed whole
      // recording gets — thrown, so joined waiters share it.
      if (whole.reason === 'too-large') throw new RecordingTooLargeForAccountError(ceiling);
      return null;
    }));
  return answer === null ? { status: 'not-found' } : { status: 'answered', answer };
}
