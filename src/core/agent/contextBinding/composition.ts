/**
 * A request's context as the comparison sees it: the system prompt piece by
 * piece, the tools by name, the messages one fingerprint each.
 *
 * Fingerprints, never values: what is kept is a short hash per piece, tool
 * and message, plus the NAMES that let a difference be attributed (a piece's
 * source and id, a tool's name and the party that put it forward, a message's
 * role). Thinking blocks and replay metadata are left out of a message's
 * fingerprint, because removing reasoning is not an edit of the context.
 */
import { canonicalJson } from '../../../lib/canonicalJson.js';
import { sha256Hex } from '../../../lib/sha256.js';
import type { LLMMessage, LLMToolSchema } from '../../../provider-contract/types.js';
import type { InjectionRecord } from '../../../recorders/core/types.js';
import type { ToolParty } from '../../../tools/toolParty.js';
import type { ContextSource } from '../../../events/types.js';

export interface PieceEntry {
  /** Source + id + occurrence: stable across requests for the same piece. */
  readonly key: string;
  readonly hash: string;
  readonly source: ContextSource;
  readonly id?: string;
}

export interface ToolEntry {
  readonly name: string;
  readonly hash: string;
  readonly party?: { readonly channel: ToolParty['channel']; readonly id?: string };
}

export interface MessageEntry {
  readonly hash: string;
  readonly role: string;
}

/** The request a signed response's reasoning was written under. */
export interface ContextBaseline {
  /** The provider response that carried that reasoning. */
  readonly replayId: string;
  /** The model that wrote it, as the adapter recorded it (`replay.binding.model`). */
  readonly writer?: string;
  readonly systemText: string;
  readonly system: readonly PieceEntry[];
  readonly tools: readonly ToolEntry[];
  readonly messages: readonly MessageEntry[];
}

/** A system prompt piece as the call stage holds it: a full record, or a library piece. */
export type SystemPiece = Pick<InjectionRecord, 'source' | 'sourceId' | 'rawContent'> &
  Partial<Pick<InjectionRecord, 'contentHash' | 'contentSummary'>>;

/** What one request is composed of, as the call stage holds it. */
export interface RequestComposition {
  readonly systemText: string;
  readonly systemPieces: readonly SystemPiece[];
  readonly tools: readonly LLMToolSchema[];
  /** The messages as they go on the wire. */
  readonly wire: readonly LLMMessage[];
  /** This epoch's winning party per tool name, when the tools slot recorded it. */
  readonly parties?: ReadonlyMap<string, ToolParty | null>;
}

const short = (text: string): string => sha256Hex(text).slice(0, 24);

/** Messages are often the same objects request after request. */
const messageHashes = new WeakMap<LLMMessage, string>();

/** The fields a provider wire carries for a message; thinking and replay are not among them. */
export function messageHash(message: LLMMessage): string {
  const held = messageHashes.get(message);
  if (held !== undefined) return held;
  // The fields a provider wire carries, and only those: what the adapter's own
  // guard compares (`messagesWithoutThinking`). Thinking blocks and replay
  // metadata are left out — the library's retirement of a finished turn's
  // thinking rewrites both, and removing reasoning is not an edit of the context.
  const hash = short(
    canonicalJson({
      role: message.role,
      content: message.content,
      toolCallId: message.toolCallId ?? null,
      toolCalls: (message.toolCalls ?? []).map((call) => [call.id, call.name, call.args]),
    }),
  );
  messageHashes.set(message, hash);
  return hash;
}

export function pieceEntries(pieces: readonly SystemPiece[]): PieceEntry[] {
  const seen = new Map<string, number>();
  return pieces.map((piece) => {
    const base = `${piece.source}\u0000${piece.sourceId ?? ''}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return {
      key: `${base}\u0000${occurrence}`,
      hash: short(
        `${piece.contentHash ?? ''}\u0000${piece.rawContent ?? piece.contentSummary ?? ''}`,
      ),
      source: piece.source,
      ...(piece.sourceId !== undefined && { id: piece.sourceId }),
    };
  });
}

export function toolEntries(
  tools: readonly LLMToolSchema[],
  parties?: ReadonlyMap<string, ToolParty | null>,
): ToolEntry[] {
  return tools.map((tool) => {
    const party = parties?.get(tool.name) ?? undefined;
    return {
      name: tool.name,
      hash: short(
        canonicalJson({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema ?? null,
        }),
      ),
      ...(party !== undefined && {
        party: { channel: party.channel, ...(party.id !== undefined && { id: party.id }) },
      }),
    };
  });
}

export function messageEntries(messages: readonly LLMMessage[]): MessageEntry[] {
  return messages.map((message) => ({ hash: messageHash(message), role: message.role }));
}

/** Freeze one request as the baseline its signed response is checked against. */
export function baselineOf(
  replayId: string,
  writer: string | undefined,
  request: RequestComposition,
): ContextBaseline {
  return {
    replayId,
    ...(writer !== undefined && { writer }),
    systemText: short(request.systemText),
    system: pieceEntries(request.systemPieces),
    tools: toolEntries(request.tools, request.parties),
    messages: messageEntries(request.wire),
  };
}

export const systemTextHash = short;
