/** Request-local structural identity, not assertion truth or a second findings ledger. */
import type { LLMMessage, LLMRequest } from '../../../provider-contract/types.js';
import { parseMaybeJson } from '../emptiness.js';
import { readPlacement, type IssuedPairs } from '../placedTickets.js';
import type { FindingsDeclaration } from './types.js';
import { isCollapsedToolResult } from './ticket.js';
import { callOccurrenceField, type CallOccurrenceKey } from '../../../lib/callOccurrence.js';

export type ReferenceReason =
  | 'not-served'
  | 'ambiguous'
  | 'not-a-result'
  | 'missing-request'
  | 'capture-limit';
export interface ReferenceObservation {
  readonly identified: boolean;
  readonly execution: 'result' | 'not-dispatched' | 'unknown';
  readonly visibility: 'body' | 'ticket' | 'unknown';
  readonly reason?: ReferenceReason;
  readonly toolName?: string;
  readonly ref?: string;
  readonly callOccurrenceKey?: CallOccurrenceKey;
}
export interface FindingsRequest {
  readonly version: 1;
  readonly iteration: number;
  readonly complete: boolean;
  readonly results: readonly ({ readonly toolCallId: string } & ReferenceObservation)[];
}
const SOURCE_LIMIT = 4096;
const ID_CHAR_LIMIT = 65536;

/** Capture before transport; source origin is read before framework markers are stripped. */
export function captureFindingsRequest(
  request: LLMRequest,
  origins: readonly LLMMessage[],
  iteration: number,
  issued?: IssuedPairs,
): FindingsRequest {
  const sources = new Map<string, LLMMessage[]>();
  const sent = new Map<string, LLMMessage[]>();
  let characters = 0;
  for (const [messages, index] of [
    [origins, sources],
    [request.messages, sent],
  ] as const) {
    for (const message of messages) {
      if (message.role !== 'tool' || !message.toolCallId) continue;
      characters += message.toolCallId.length;
      if (index.size >= SOURCE_LIMIT || characters > ID_CHAR_LIMIT)
        return { version: 1, iteration, complete: false, results: [] };
      const entries = index.get(message.toolCallId) ?? [];
      entries.push(message);
      index.set(message.toolCallId, entries);
      // Repeated occurrences need no content copy, and are always ambiguous.
      if (entries.length > 2) entries.pop();
    }
  }
  const results = [...sent].map(([toolCallId, messages]) => {
    const original = sources.get(toolCallId);
    const source = original?.[0];
    const reason: ReferenceReason | undefined =
      messages.length !== 1 || (original?.length ?? 0) > 1
        ? 'ambiguous'
        : source === undefined
        ? 'not-served'
        : source.notDispatched !== undefined || source.toolResultOrigin !== undefined
        ? 'not-a-result'
        : undefined;
    const message = messages[0];
    const visibility =
      reason === undefined && source !== undefined && message !== undefined
        ? resultVisibility(toolCallId, message, source, issued)
        : { visibility: 'unknown' as const };
    return {
      toolCallId,
      identified: reason === undefined || reason === 'not-a-result',
      execution:
        reason === undefined
          ? ('result' as const)
          : reason === 'not-a-result' &&
            (source?.notDispatched !== undefined || source?.toolResultOrigin === 'not-entered')
          ? ('not-dispatched' as const)
          : ('unknown' as const),
      ...visibility,
      ...(reason !== undefined && { reason }),
      ...(reason === undefined && source?.toolName !== undefined && { toolName: source.toolName }),
      ...(reason === undefined && callOccurrenceField(source?.callOccurrenceKey)),
    };
  });
  return { version: 1, iteration, complete: true, results };
}

/** Use the receipt for a placement, even when the request left its bytes intact. */
function resultVisibility(
  toolCallId: string,
  sent: LLMMessage,
  source: LLMMessage,
  issued: IssuedPairs | undefined,
): Pick<ReferenceObservation, 'visibility' | 'ref'> {
  const placement = readPlacement(toolCallId, sent.content, issued);
  if (placement?.issued === true) return { visibility: 'ticket', ref: placement.ticket.ref };
  if (placement?.issued === false) return { visibility: 'unknown' };
  if (sent.content === source.content) return { visibility: 'body' };

  // The findings collapse can carry a ref only from the committed
  // receipt-backed placement it summarizes.
  const collapsed = parseMaybeJson(sent.content);
  if (!isCollapsedToolResult(collapsed) || collapsed.toolCallId !== toolCallId)
    return { visibility: 'unknown' };
  if (collapsed.ref === undefined) return { visibility: 'ticket' };
  if (typeof collapsed.ref !== 'string') return { visibility: 'unknown' };
  const original = readPlacement(toolCallId, source.content, issued);
  return original?.issued === true && original.ticket.ref === collapsed.ref
    ? { visibility: 'ticket', ref: collapsed.ref }
    : { visibility: 'ticket' };
}

/** No receipt/hash, current ledger or future batch result can fill a missing boundary. */
export function referenceObservation(
  request: FindingsRequest | undefined,
  iteration: number,
  id: string,
): ReferenceObservation {
  const unknown = (reason: ReferenceReason): ReferenceObservation => ({
    identified: false,
    execution: 'unknown',
    visibility: 'unknown',
    reason,
  });
  if (request?.version !== 1 || request.iteration !== iteration) return unknown('missing-request');
  if (request.complete !== true) return unknown('capture-limit');
  if (!Array.isArray(request.results) || request.results.length > SOURCE_LIMIT)
    return unknown('missing-request');
  const matches = request.results.filter(
    (entry) => entry !== null && typeof entry === 'object' && entry.toolCallId === id,
  );
  if (matches.length > 1) return unknown('ambiguous');
  const entry = matches[0];
  if (entry === undefined) return unknown('not-served');
  if (
    typeof entry.identified !== 'boolean' ||
    !['result', 'not-dispatched', 'unknown'].includes(entry.execution) ||
    !['body', 'ticket', 'unknown'].includes(entry.visibility) ||
    (entry.toolName !== undefined && typeof entry.toolName !== 'string') ||
    (entry.ref !== undefined && typeof entry.ref !== 'string')
  )
    return unknown('missing-request');
  return entry;
}

/** Fixed teaching words contain no untrusted IDs or foreign-run existence signal. */
export function findingsReferenceRefusal(
  declaration: FindingsDeclaration | undefined,
  request: FindingsRequest | undefined,
  iteration: number,
  malformed = 0,
): string | undefined {
  const observations = (declaration?.previous ?? []).map((entry) =>
    referenceObservation(request, iteration, entry.toolCallId),
  );
  const refused = observations.filter(
    (entry) => !entry.identified || entry.execution !== 'result',
  ).length;
  const notDispatched = observations.some((entry) => entry.execution === 'not-dispatched');
  const notice = observations.some((entry) => entry.identified && entry.reason === 'not-a-result');
  if (refused === 0 && malformed === 0) return undefined;
  return JSON.stringify({
    refused: 'findings-reference',
    count: refused + malformed,
    reason:
      malformed > 0
        ? 'The reserved findings metadata was malformed.'
        : notDispatched
        ? 'A referenced notice was shown, but its tool was not dispatched; it is not executed-result evidence.'
        : notice
        ? 'A referenced notice was shown, but it is not a completed tool result.'
        : 'A findings reference could not be identified in the request that produced this response.',
    instruction:
      'Copy an unambiguous tool_result id served to this response, or read the source again on a later call. No tool was invoked for this refused proposal.',
  });
}
