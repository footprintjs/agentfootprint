import { isResultMessage } from '../../../findings/offer.js';
import { toolBytesOf } from '../../../../../lib/toolBytes.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import type { ProducedResult } from '../../../../../integrity/empty-lookup/check.js';

/**
 * The empty-lookup check's PRODUCER CORPUS (9.77.0) — every `role: 'tool'`
 * RESULT in `history` from a tool the judged one names in `argumentsFrom`,
 * as the run served it. The caller hands the history the judged call was
 * served (the call itself is pushed after it), so a producer called earlier in
 * the same batch is already in it — which is right: the model can only have
 * taken a value from a result it had already been served.
 *
 * A message the batch settlement wrote (9.113.0) is no result: its ground
 * never ran, so it produced nothing to take a value from. Read off the marker
 * (`../findings/offer.ts` · `isResultMessage`), never the sentence.
 *
 * Each result is read as the TOOL's own bytes (`lib/toolBytes.ts` ·
 * `toolBytesOf`): the note the inputs layer appends after a filled call's
 * result carries the value the library filled, and a value only that note
 * carries is not one the run's producer served.
 *
 * Exported for its unit test (`test/integrity/emptyLookup.test.ts`).
 */
export function producerCorpusOf(
  history: readonly LLMMessage[],
  argumentsFrom: readonly string[],
): ProducedResult[] {
  const produced: ProducedResult[] = [];
  for (const message of history) {
    if (!isResultMessage(message)) continue;
    const name = message.toolName;
    if (typeof name !== 'string' || !argumentsFrom.includes(name)) continue;
    produced.push({ toolName: name, text: toolBytesOf(message) });
  }
  return produced;
}
