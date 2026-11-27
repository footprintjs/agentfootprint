import type { TypedScope } from 'footprintjs';
import { BINDING_LIMITS } from '../../../../integrity/claim-binding/scope.js';
import { readCallOccurrenceKey } from '../../../../lib/callOccurrence.js';
import { toolBytesOf } from '../../../../lib/toolBytes.js';
import type { LLMMessage } from '../../../../provider-contract/types.js';
import { MAX_CITATION_HISTORY_ROWS, matchesCitationBody } from '../../citations/accepted.js';
import type { AgentState } from '../../types.js';
import { citationOfferForCall, type CitationSource } from './citationOffer.js';

/** Pair the retained occurrence with the row in our own position-preserving clone. */
export function prepareCitationProjection(
  scope: TypedScope<AgentState>,
  enabled: boolean,
  committed: readonly LLMMessage[],
  prepared: readonly LLMMessage[],
  detached: readonly LLMMessage[],
) {
  if (
    !enabled ||
    committed.length > MAX_CITATION_HISTORY_ROWS ||
    prepared.length !== detached.length
  )
    return undefined;
  const admitted = scope.citationSources;
  if (admitted === undefined || admitted.length === 0 || admitted.length > BINDING_LIMITS.results)
    return undefined;
  const byOccurrence = new Map<string, (typeof admitted)[number]>();
  for (const source of admitted) {
    const key = readCallOccurrenceKey(source);
    if (typeof key !== 'string' || byOccurrence.has(key)) return undefined;
    byOccurrence.set(key, source);
  }

  const sources = new Map<LLMMessage, CitationSource>();
  for (let index = 0; index < committed.length; index++) {
    const original = committed[index];
    const projected = prepared[index];
    const copy = detached[index];
    if (original?.role !== 'tool' || projected?.role !== 'tool' || copy?.role !== 'tool') continue;
    const key = readCallOccurrenceKey(original);
    const source = typeof key === 'string' ? byOccurrence.get(key) : undefined;
    if (source === undefined || original.content !== projected.content) continue;
    if (!matchesCitationBody(toolBytesOf(original), source.bodyDigest)) continue;
    sources.set(copy, {
      callOccurrenceKey: source.callOccurrenceKey,
      resultId: source.resultId,
      body: original.content,
      projected,
    });
  }
  return citationOfferForCall(sources, () => globalThis.crypto.randomUUID());
}
