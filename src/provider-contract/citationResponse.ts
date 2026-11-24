import type { CallOccurrenceKey } from '../lib/callOccurrence.js';
import type { LLMResponse } from './types.js';

export interface CitedResultBlock {
  readonly occurrence: CallOccurrenceKey;
  readonly resultId: string;
  readonly bodyDigest: string;
  readonly slot: number;
}

/** The JSON receipt the accepting stage may retain. No request or response body. */
export interface SubmittedCitationOffer {
  readonly offer: string;
  readonly results: readonly CitedResultBlock[];
}

interface Receipt {
  readonly owner: object;
  readonly text: string;
  readonly offer: SubmittedCitationOffer;
}

// Response wrappers may carry this private association through an owned copy.
// It is never an enumerable field on data handed to policies or observers.
const responseOffers = new WeakMap<LLMResponse, Receipt>();

function responseText(response: LLMResponse): string | undefined {
  const field = Object.getOwnPropertyDescriptor(response, 'content');
  return typeof field?.value === 'string' ? field.value : undefined;
}

export function createCitationResponseOwner() {
  const owner = {};
  return {
    record(response: LLMResponse, offer: SubmittedCitationOffer): void {
      const text = responseText(response);
      if (text !== undefined && !responseOffers.has(response))
        responseOffers.set(response, { owner, text, offer });
    },
    read(response: LLMResponse): SubmittedCitationOffer | undefined {
      const proof = responseOffers.get(response);
      if (proof?.owner === owner && proof.text === responseText(response)) return proof.offer;
      return undefined;
    },
  };
}

/** An owned metadata rewrite may keep the proof while the answer text is byte-identical. */
export function carryCitationResponse(from: LLMResponse, to: LLMResponse): LLMResponse {
  const proof = responseOffers.get(from);
  if (proof !== undefined && proof.text === responseText(from) && proof.text === responseText(to))
    responseOffers.set(to, proof);
  return to;
}
