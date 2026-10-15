/**
 * Lossless layout of the Messages content this adapter actually understands.
 * The carrier stores indices/lengths, inert metadata and digests, never a second content copy.
 * Replay policy lives elsewhere: undefined here means no fidelity proof.
 */
import type { LLMMessage } from '../../provider-contract/types.js';
import type { MessageReplay, ReplayPart } from '../../thinking/replay.js';
import { canonicalJson } from '../../lib/canonicalJson.js';
import { sha256Hex } from '../../lib/sha256.js';
import type { AnthropicContentBlock } from './anthropicMessagesWire.js';

/** One domain-separated digest owner for response fidelity and request binding. */
export function replayDigest(value: unknown, salt: string): string {
  return sha256Hex(`agentfootprint/anthropic-replay/1\u0000${salt}\u0000${canonicalJson(value)}`);
}

/** Capture only a complete, representable response; unknown fields are not silently lost. */
export function captureAnthropicReplay(
  content: readonly AnthropicContentBlock[],
  id: string,
  stopReason: string,
  binding?: MessageReplay['binding'],
): MessageReplay | undefined {
  if (typeof id !== 'string' || id.length === 0 || typeof stopReason !== 'string') return undefined;
  const layout: ReplayPart[] = [];
  let thinking = 0;
  let tools = 0;
  for (const block of content) {
    if (!isSupportedBlock(block)) return undefined;
    switch (block.type) {
      case 'text':
        layout.push({ type: 'text', length: block.text.length, ...textMetadata(block) });
        break;
      case 'thinking':
      case 'redacted_thinking':
        layout.push({ type: 'thinking', index: thinking++ });
        break;
      case 'tool_use':
        layout.push({ type: 'tool', index: tools++, ...toolMetadata(block) });
        break;
    }
  }
  try {
    return {
      version: 1,
      protocol: 'anthropic-messages',
      id,
      layout,
      stopReason,
      contentDigest: replayDigest(content, binding?.salt ?? id),
      ...(binding !== undefined && { binding }),
    };
  } catch {
    // Non-JSON tool arguments cannot supply an exact saved-response proof.
    return undefined;
  }
}

/** Durable negative evidence, without retaining unsupported response values. */
export function lossyAnthropicReplay(
  content: readonly AnthropicContentBlock[],
  id: string,
  stopReason: string,
  binding?: MessageReplay['binding'],
  observedThinking = false,
): MessageReplay {
  let thinking = 0;
  const layout = content.flatMap((block): ReplayPart[] =>
    block.type === 'thinking' || block.type === 'redacted_thinking'
      ? [{ type: 'thinking', index: thinking++ }]
      : [],
  );
  // An orphan delta witnesses thinking even when no block can be recovered.
  // This negative marker states presence only, not a reconstructed value/count.
  if (layout.length === 0 && observedThinking) layout.push({ type: 'thinking', index: 0 });
  return {
    version: 1,
    protocol: 'anthropic-messages',
    id: typeof id === 'string' ? id : '',
    // Even a block normalization could not keep must remain known to policy.
    layout,
    stopReason: typeof stopReason === 'string' ? stopReason : '',
    contentDigest: '',
    lossy: true,
    ...(binding !== undefined && { binding }),
  };
}

/** Missing identities on old text-only mocks are unknown, not known content loss. */
export function captureAnthropicResponseReplay(
  content: readonly AnthropicContentBlock[],
  id: string,
  stopReason: string,
  binding?: MessageReplay['binding'],
): MessageReplay | undefined {
  const captured = captureAnthropicReplay(content, id, stopReason, binding);
  if (captured !== undefined) return captured;
  if (
    !id &&
    content.every(
      (block) =>
        isSupportedBlock(block) && block.type !== 'thinking' && block.type !== 'redacted_thinking',
    )
  ) {
    try {
      canonicalJson(content);
      return undefined;
    } catch {
      /* A non-JSON value is known loss, not a missing identity. */
    }
  }
  return lossyAnthropicReplay(content, id, stopReason, binding);
}

/** Reassemble current fields only; no stored original values can be recovered. */
function reconstructCurrentLayout(message: LLMMessage): AnthropicContentBlock[] | undefined {
  const replay = message.replay;
  if (
    replay?.version !== 1 ||
    replay.protocol !== 'anthropic-messages' ||
    replay.lossy === true ||
    message.toolCalls?.some((call) => call.argumentsFailure !== undefined) ||
    typeof replay.id !== 'string' ||
    replay.id.length === 0 ||
    !Array.isArray(replay.layout) ||
    (replay.thinkingRetired === true && (message.thinkingBlocks?.length ?? 0) > 0) ||
    typeof message.content !== 'string'
  )
    return undefined;
  const blocks: AnthropicContentBlock[] = [];
  const thinking = message.thinkingBlocks ?? [];
  const tools = message.toolCalls ?? [];
  let textOffset = 0;
  let thinkingIndex = 0;
  let toolIndex = 0;
  for (const part of replay.layout) {
    if (part === null || typeof part !== 'object') return undefined;
    if (part.type === 'text') {
      const metadata = textMetadata(part);
      if (
        metadata === undefined ||
        !hasOnlyFields(part, ['type', 'length', 'citations']) ||
        !Number.isSafeInteger(part.length) ||
        part.length < 0 ||
        part.length > message.content.length - textOffset
      )
        return undefined;
      blocks.push({
        type: 'text',
        text: message.content.slice(textOffset, textOffset + part.length),
        ...metadata,
      });
      textOffset += part.length;
    } else if (part.type === 'thinking') {
      if (part.index !== thinkingIndex || !hasOnlyFields(part, ['type', 'index'])) return undefined;
      const block = thinking[thinkingIndex++];
      if (!block || typeof block.content !== 'string') return undefined;
      if (block.type === 'redacted_thinking') {
        if (block.content !== '' || typeof block.signature !== 'string') return undefined;
        blocks.push({ type: 'redacted_thinking', data: block.signature });
      } else if (block.type === 'thinking') {
        if (block.signature !== undefined && typeof block.signature !== 'string') return undefined;
        blocks.push({
          type: 'thinking',
          thinking: block.content,
          ...(block.signature !== undefined && { signature: block.signature }),
        });
      } else return undefined;
    } else if (part.type === 'tool') {
      const metadata = toolMetadata(part);
      if (
        metadata === undefined ||
        part.index !== toolIndex ||
        !hasOnlyFields(part, ['type', 'index', 'caller', 'toolset_name'])
      )
        return undefined;
      const tool = tools[toolIndex++];
      if (
        !tool ||
        typeof tool.id !== 'string' ||
        typeof tool.name !== 'string' ||
        tool.args === null ||
        typeof tool.args !== 'object' ||
        Array.isArray(tool.args)
      )
        return undefined;
      blocks.push({
        type: 'tool_use',
        id: tool.id,
        name: tool.name,
        input: { ...tool.args },
        ...metadata,
      });
    } else return undefined;
  }
  if (
    textOffset !== message.content.length ||
    thinkingIndex !== thinking.length ||
    toolIndex !== tools.length
  )
    return undefined;
  return blocks;
}

/** Exact replay additionally requires the original full-content digest. */
export function restoreAnthropicReplay(message: LLMMessage): AnthropicContentBlock[] | undefined {
  const blocks = reconstructCurrentLayout(message);
  const replay = message.replay;
  if (blocks === undefined || replay === undefined) return undefined;
  try {
    return replayDigest(blocks, replay.binding?.salt ?? replay.id) === replay.contentDigest
      ? blocks
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Retire thinking without changing the remaining text/tool order. Invalid or
 * edited history is projected as it is now; there is no stored text to revive.
 */
export function omitAnthropicThinking(message: LLMMessage): LLMMessage {
  // Current signatures/text may have changed, which is WHY omission is needed.
  // A valid layout still describes their order without resurrecting originals.
  // Known loss or incompatible counts never gains a replacement fidelity proof.
  const content = reconstructCurrentLayout(message);
  const { thinkingBlocks: _thinking, replay, ...rest } = message;
  void _thinking;
  if (replay === undefined) return rest;
  const retained = content?.filter(
    (block) => block.type !== 'thinking' && block.type !== 'redacted_thinking',
  );
  const replacement =
    retained === undefined
      ? undefined
      : captureAnthropicReplay(retained, replay.id, replay.stopReason, replay.binding);
  return { ...rest, replay: { ...(replacement ?? replay), thinkingRetired: true } };
}

const owns = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);
const hasOnlyFields = (value: object, fields: readonly string[]): boolean =>
  Object.keys(value).every((key) => fields.includes(key));

/** Preserve absent/null/empty distinctly. Citation contents require a different carrier. */
function textMetadata(value: {
  readonly citations?: unknown;
}): { citations?: null | readonly [] } | undefined {
  if (!owns(value, 'citations')) return {};
  if (value.citations === null) return { citations: null };
  if (
    Array.isArray(value.citations) &&
    value.citations.length === 0 &&
    Object.keys(value.citations).length === 0
  )
    return { citations: [] };
  return undefined;
}

/** Only direct calls with no named toolset are representable; never retain an open metadata bag. */
function toolMetadata(value: {
  readonly caller?: unknown;
  readonly toolset_name?: unknown;
}): { caller?: { type: 'direct' }; toolset_name?: null } | undefined {
  const metadata: { caller?: { type: 'direct' }; toolset_name?: null } = {};
  if (owns(value, 'caller')) {
    const caller = value.caller;
    if (
      caller === null ||
      typeof caller !== 'object' ||
      Array.isArray(caller) ||
      !owns(caller, 'type') ||
      !('type' in caller) ||
      caller.type !== 'direct' ||
      !hasOnlyFields(caller, ['type'])
    )
      return undefined;
    metadata.caller = { type: 'direct' };
  }
  if (owns(value, 'toolset_name')) {
    if (value.toolset_name !== null) return undefined;
    metadata.toolset_name = null;
  }
  return metadata;
}

/** Guard exact represented fields; populated citations/server-tool blocks need another carrier. */
function isSupportedBlock(block: AnthropicContentBlock): boolean {
  if (block === null || typeof block !== 'object') return false;
  let fields: readonly string[];
  switch (block.type) {
    case 'text':
      if (typeof block.text !== 'string' || textMetadata(block) === undefined) return false;
      fields = ['type', 'text', 'citations'];
      break;
    case 'thinking':
      if (
        typeof block.thinking !== 'string' ||
        (block.signature !== undefined && typeof block.signature !== 'string')
      )
        return false;
      fields = ['type', 'thinking', 'signature'];
      break;
    case 'redacted_thinking':
      if (typeof block.data !== 'string') return false;
      fields = ['type', 'data'];
      break;
    case 'tool_use':
      if (
        typeof block.id !== 'string' ||
        typeof block.name !== 'string' ||
        block.input === null ||
        typeof block.input !== 'object' ||
        Array.isArray(block.input) ||
        toolMetadata(block) === undefined
      )
        return false;
      fields = ['type', 'id', 'name', 'input', 'caller', 'toolset_name'];
      break;
    default:
      return false;
  }
  return hasOnlyFields(block, fields);
}
