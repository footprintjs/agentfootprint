import type { CallOccurrenceKey } from '../../../lib/callOccurrence.js';

/** The accepted proposal's position within this batch. A saved resolution
 * predating occurrence keys can still name a call by its provider ID. */
export type BatchAddress = number | string;

export function batchAddress(toolCallId: string, occurrence?: CallOccurrenceKey): BatchAddress {
  return occurrence?.[4] ?? toolCallId;
}
