/** Request-local structural identity, not assertion truth or a second findings ledger. */
import type { LLMMessage, LLMRequest } from '../../../provider-contract/types.js';
import { isPlacedToolResult } from '../../../artifacts/placement.js';
import type { FindingsDeclaration } from './types.js';
import { isCollapsedToolResult } from './ticket.js';

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
    const message = messages[0]!;
    let ref: string | undefined;
    let ticket = false;
    // Equal recorded bytes are body data. A tool may legitimately return a
    // JSON object that resembles a library ticket; parsing that must not
    // invent placement, hide its body or import a non-string payload ref.
    if (message.content !== source?.content) {
      try {
        const parsed: unknown = JSON.parse(message.content);
        if (isPlacedToolResult(parsed)) {
          ref = parsed.ref;
          ticket = true;
        } else if (
          isCollapsedToolResult(parsed) &&
          parsed.toolCallId === toolCallId &&
          (parsed.ref === undefined || typeof parsed.ref === 'string')
        ) {
          ref = parsed.ref;
          ticket = true;
        }
      } catch {
        /* Other changed text has unknown visibility. */
      }
    }
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
      visibility:
        reason !== undefined
          ? ('unknown' as const)
          : ticket
          ? ('ticket' as const)
          : message.content === source?.content
          ? ('body' as const)
          : ('unknown' as const),
      ...(reason !== undefined && { reason }),
      ...(reason === undefined && source?.toolName !== undefined && { toolName: source.toolName }),
      ...(reason === undefined && ref !== undefined && { ref }),
    };
  });
  return { version: 1, iteration, complete: true, results };
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
