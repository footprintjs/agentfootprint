/**
 * Anthropic replay policy, shared by every Messages transport.
 *
 * A local consistency check, NOT signature authentication. Unknown provenance
 * passes through. Known unsafe active-tool replay is refused; eligible completed
 * turns lose thinking explicitly, with one report per block. No beta policy is
 * enabled and switching models alone never removes thinking.
 *
 * Contract (2026-10-10):
 * https://platform.claude.com/docs/en/build-with-claude/thinking#preserving-thinking-blocks
 * https://platform.claude.com/docs/en/build-with-claude/preserved-thinking
 */
import type { LLMMessage, LLMRequest } from '../../provider-contract/types.js';
import type {
  MessageReplay,
  ReplayPreparation,
  ThinkingReplayReason,
} from '../../thinking/replay.js';
import { UnsafeThinkingReplayError } from '../../thinking/replay.js';
import { replayMessageFingerprint } from '../../thinking/replayHistory.js';
import { canonicalJson } from '../../lib/canonicalJson.js';
import type { AnthropicMessagesBody, AnthropicMessageParam } from './anthropicMessagesWire.js';
import { toAnthropicMessages, toAnthropicTool } from './anthropicMessageProjection.js';
import {
  omitAnthropicThinking,
  replayDigest,
  restoreAnthropicReplay,
} from './anthropicReplayLayout.js';
import { anthropicModelFacts, anthropicModelFamily } from './anthropicModels.js';

type Binding = NonNullable<MessageReplay['binding']>;

/** Cache annotations are ignored only at wire-owned positions, never in args. */
function withoutCache(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const { cache_control: _cache, ...rest } = value as Record<string, unknown>;
  return rest;
}

function systemOf(system: unknown): unknown {
  if (!Array.isArray(system)) return system ?? '';
  const blocks = system.map(withoutCache);
  if (
    blocks.every(
      (b) => typeof b === 'object' && b !== null && 'type' in b && b.type === 'text' && 'text' in b,
    )
  ) {
    return blocks.map((b) => (b as { text: string }).text).join('');
  }
  return blocks;
}

function toolsOf(tools: readonly unknown[] | undefined): readonly unknown[] {
  return (tools ?? [])
    .map(withoutCache)
    .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
}

function messagesWithoutThinking(messages: readonly AnthropicMessageParam[]): unknown {
  const kept: unknown[] = [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      kept.push(m);
      continue;
    }
    const content = m.content
      .filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking')
      .map(withoutCache);
    if (content.length > 0) kept.push({ role: m.role, content });
  }
  return kept;
}

function thinkingSequence(messages: readonly AnthropicMessageParam[]): string[] {
  return messages.flatMap((m) =>
    typeof m.content === 'string'
      ? []
      : m.content.flatMap((b) =>
          b.type === 'thinking' || b.type === 'redacted_thinking'
            ? [
                replayDigest(
                  b.type === 'thinking' ? [b.type, b.signature] : [b.type, b.data],
                  'thinking-sequence-v1',
                ),
              ]
            : [],
        ),
  );
}

/** Capture actual serialized request values BEFORE awaiting transport. */
export function thinkingReplayBinding(
  body: AnthropicMessagesBody,
  model: string,
): (id: string) => Binding {
  const system = canonicalJson(systemOf(body.system));
  const tools = canonicalJson(toolsOf(body.tools));
  const messages = canonicalJson(messagesWithoutThinking(body.messages));
  const priorThinking = thinkingSequence(body.messages);
  return (id) => ({
    model,
    salt: id,
    system: replayDigest(system, id),
    tools: replayDigest(tools, id),
    messages: replayDigest(messages, id),
    priorThinking: [...priorThinking],
  });
}

/** A supplied tool result is not completion. Only a witnessed end_turn is. */
function completedThrough(messages: readonly LLMMessage[]): number {
  const pending = new Set<string>();
  let completed = -1;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'assistant') {
      for (const tool of m.toolCalls ?? []) pending.add(tool.id);
      if (
        m.replay?.version === 1 &&
        m.replay.protocol === 'anthropic-messages' &&
        typeof m.replay.id === 'string' &&
        m.replay.id.length > 0 &&
        m.replay.stopReason === 'end_turn' &&
        pending.size === 0 &&
        !m.toolCalls?.length
      )
        completed = i;
    } else if (m.role === 'tool' && m.toolCallId !== undefined) pending.delete(m.toolCallId);
  }
  return completed;
}

function suffixOf(current: readonly string[], original: readonly string[]): boolean {
  return (
    current.length <= original.length &&
    current.every((value, i) => value === original[original.length - current.length + i])
  );
}

function inconsistency(
  request: LLMRequest,
  index: number,
  model: string,
): ThinkingReplayReason | undefined {
  const message = request.messages[index];
  const blocks = message.thinkingBlocks ?? [];
  if (blocks.some((b) => typeof b.signature !== 'string' || b.signature.length === 0))
    return 'missing-signature';
  const replay = message.replay;
  if (replay?.version !== 1 || replay.protocol !== 'anthropic-messages') return undefined;
  if (replay.thinkingRetired) return blocks.length > 0 ? 'thinking-retired' : undefined;
  if (replay.lossy) return 'content-changed';
  if (restoreAnthropicReplay(message) === undefined) return 'content-changed';
  const binding = replay.binding;
  // Cross-model signatures are server-owned. Locally assert the prefix rule
  // only for a documented bound family replaying its own blocks; unknown
  // aliases, legacy models and cross-family/account compatibility stay unknown.
  if (
    binding === undefined ||
    anthropicModelFacts(model)?.thinkingPrefixBinding !== true ||
    anthropicModelFamily(model) !== anthropicModelFamily(binding.model)
  )
    return undefined;
  const before = toAnthropicMessages(request.messages.slice(0, index));
  if (
    replayDigest(canonicalJson(systemOf(request.systemPrompt)), binding.salt) !== binding.system ||
    replayDigest(canonicalJson(toolsOf(request.tools?.map(toAnthropicTool))), binding.salt) !==
      binding.tools ||
    replayDigest(canonicalJson(messagesWithoutThinking(before)), binding.salt) !== binding.messages
  )
    return 'prefix-changed';
  if (!suffixOf(thinkingSequence(before), binding.priorThinking)) return 'sequence-changed';
  return undefined;
}

/** Pure and idempotent. No caller mutation; all refusals precede any report. */
export function prepareAnthropicReplay(
  request: LLMRequest,
  model: string,
  provider: string,
): ReplayPreparation {
  const completed = completedThrough(request.messages);
  let prepared = request;
  const omissions: ReplayPreparation['omissions'][number][] = [];
  let retiredThrough = -1;
  const retire = (index: number, reason: ThinkingReplayReason): void => {
    const message = prepared.messages[index];
    if (message.role !== 'assistant' || !message.thinkingBlocks?.length) return;
    const fingerprint = replayMessageFingerprint(message);
    for (let b = 0; b < message.thinkingBlocks.length; b++)
      omissions.push({
        messageIndex: index,
        blockIndex: b,
        reason,
        ...(message.replay?.id && { replayId: message.replay.id }),
        messageFingerprint: fingerprint,
      });
    const messages = [...prepared.messages];
    messages[index] = omitAnthropicThinking(message);
    prepared = { ...prepared, messages };
  };
  for (let i = 0; i < request.messages.length; i++) {
    const message = prepared.messages[i];
    if (message.role !== 'assistant') continue;
    const hadThinking =
      message.replay?.version === 1 &&
      message.replay.protocol === 'anthropic-messages' &&
      message.replay.thinkingRetired !== true &&
      Array.isArray(message.replay.layout) &&
      message.replay.layout.some((part) => part.type === 'thinking');
    if (!message.thinkingBlocks?.length && !hadThinking) continue;
    const reason = inconsistency(prepared, i, model);
    if (reason === undefined) continue;
    // Unknown terminal status is not invented from a user nudge or tool result.
    if (i > completed) throw new UnsafeThinkingReplayError(provider, model, i, reason);
    // The caller already removed everything from this completed turn. We
    // remove nothing and must not claim an omission or rewrite its evidence.
    if (!message.thinkingBlocks?.length) continue;
    // Never create a middle gap, even if later blocks predate local evidence.
    // For bound models, extend a permitted removal BACK to the oldest prefix,
    // not forward into an active turn. Every extra removal is reported. All
    // these earlier indices are <= completed; later exact content is retained.
    if (anthropicModelFacts(model)?.thinkingPrefixBinding === true) {
      for (let earlier = retiredThrough + 1; earlier < i; earlier++)
        retire(earlier, 'sequence-changed');
      retiredThrough = i;
    }
    retire(i, reason);
  }
  return { provider, model, request: prepared, omissions };
}
