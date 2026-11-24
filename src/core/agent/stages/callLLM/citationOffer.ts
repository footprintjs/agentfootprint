import { BINDING_LIMITS, boundedResultId } from '../../../../integrity/claim-binding/scope.js';
import { readCallOccurrenceKey, type CallOccurrenceKey } from '../../../../lib/callOccurrence.js';
import { matchesPreparedData } from '../../../../lib/matchesPreparedData.js';
import { utf8Length } from '../../../../lib/utf8.js';
import { citationTextDigest } from '../../citations/accepted.js';
import {
  createCitationResponseOwner,
  type CitedResultBlock,
} from '../../../../provider-contract/citationResponse.js';
import {
  observeCitationOffers,
  type CitationWireBody,
} from '../../../../provider-contract/requestObserver.js';
import type { LLMCallHooks, LLMMessage } from '../../../../provider-contract/types.js';

export interface CitationSource {
  readonly callOccurrenceKey: CallOccurrenceKey;
  readonly resultId: string;
  readonly projected: LLMMessage;
  /** The eligible committed body as paired with a detached request row, before foreign code. */
  readonly body: string;
}

const MAX_WIRE_BLOCKS = 4096;
const OFFER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Only this call's selected response may consume an offer sent by its transport. */
export function citationOfferForCall(
  sources: ReadonlyMap<LLMMessage, CitationSource>,
  nextOfferId: () => string,
) {
  const response = createCitationResponseOwner();
  const used = new Set<string>();
  return {
    attach(hooks: LLMCallHooks): LLMCallHooks {
      if (sources.size === 0 || sources.size > BINDING_LIMITS.results) return hooks;
      return observeCitationOffers(hooks, (rows) => {
        const proved = proveSubmittedBodies(rows, sources);
        if (proved === undefined || proved.length === 0 || used.size === BINDING_LIMITS.results)
          return undefined;
        const offer = nextOfferId();
        if (!OFFER_ID.test(offer) || used.has(offer)) return undefined;
        used.add(offer);
        const results: CitedResultBlock[] = proved.map((row, index) => ({
          occurrence: [...row.source.callOccurrenceKey],
          resultId: row.source.resultId,
          bodyDigest: row.bodyDigest,
          slot: index + 1,
        }));
        const instruction = [
          'Use a citation marker before the ending punctuation of a sentence or list item only when the named tool result supports it.',
          ...proved.map(
            (row, index) =>
              `[c:${offer}:${index + 1}] refers to submitted tool result block ${row.blockNumber}.`,
          ),
        ].join('\n');
        return { instruction, accept: (answer) => response.record(answer, { offer, results }) };
      });
    },
    accepted: response.read,
  };
}

function proveSubmittedBodies(
  rows: readonly CitationWireBody[],
  sources: ReadonlyMap<LLMMessage, CitationSource>,
):
  | readonly {
      readonly source: CitationSource;
      readonly blockNumber: number;
      readonly bodyDigest: string;
    }[]
  | undefined {
  if (rows.length > MAX_WIRE_BLOCKS) return undefined;
  const occurrences = new Set<string>();
  const resultIds = new Set<string>();
  const results: { source: CitationSource; blockNumber: number; bodyDigest: string }[] = [];
  let previousBlock = 0;
  let bytes = 0;
  for (const row of rows) {
    if (!Number.isSafeInteger(row.blockNumber) || row.blockNumber <= previousBlock)
      return undefined;
    previousBlock = row.blockNumber;
    const source = sources.get(row.source);
    if (
      source === undefined ||
      row.body !== source.body ||
      !matchesPreparedData(source.projected, row.source)
    )
      continue;
    const occurrence = readCallOccurrenceKey(source);
    if (
      typeof occurrence !== 'string' ||
      occurrences.has(occurrence) ||
      !boundedResultId(source.resultId) ||
      resultIds.has(source.resultId)
    )
      return undefined;
    if (source.body.length > BINDING_LIMITS.resultBytes) return undefined;
    const encoded = JSON.stringify(source.body);
    const bodyBytes = utf8Length(encoded);
    bytes += bodyBytes;
    if (bodyBytes > BINDING_LIMITS.resultBytes || bytes > BINDING_LIMITS.snapshotBytes)
      return undefined;
    occurrences.add(occurrence);
    resultIds.add(source.resultId);
    results.push({
      source,
      blockNumber: row.blockNumber,
      bodyDigest: citationTextDigest(source.body),
    });
  }
  return results;
}
