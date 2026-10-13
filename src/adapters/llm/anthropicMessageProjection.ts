/** Pure Messages projection shared by body construction and replay checks. */
import type { LLMMessage, LLMToolSchema } from '../types.js';
import type {
  AnthropicMessageParam,
  AnthropicContentBlock,
  AnthropicTool,
} from './anthropicMessagesWire.js';
import { restoreAnthropicReplay } from './anthropicReplayLayout.js';

/**
 * Framework messages → Anthropic messages.
 *
 * `role: 'system'` is DROPPED: this wire takes the system prompt as a separate
 * top-level field (`LLMRequest.systemPrompt`). That is why every adapter on it
 * carries only `['user', 'assistant']` in messages. A `role: 'tool'` result
 * becomes a `tool_result` block on a user turn, coalesced with the results of
 * the same batch. An `assistant` turn with no thinking blocks, no text and no
 * tool calls is DROPPED too — the API refuses empty content anywhere but a
 * final prefill.
 *
 * ONE owner: `anthropic()`, `browserAnthropic()` and `invokeModelGateway()`
 * all build their messages here.
 */
export function toAnthropicMessages(
  messages: readonly LLMMessage[],
  indexMap?: number[],
): AnthropicMessageParam[] {
  const result: AnthropicMessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      indexMap?.push(-1);
      continue;
    }
    if (m.role === 'user') {
      indexMap?.push(result.length);
      result.push({ role: 'user', content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const replayed = restoreAnthropicReplay(m);
      if (replayed !== undefined && replayed.length > 0) {
        indexMap?.push(result.length);
        result.push({ role: 'assistant', content: replayed });
        continue;
      }
      const blocks: AnthropicContentBlock[] = [];
      // v2.14 — thinking blocks come FIRST per Anthropic's wire format
      // ordering rule. Out-of-order = HTTP 400. Signature passes through
      // BYTE-EXACT — no String() coercion, no JSON-roundtrip, no trim.
      if (m.thinkingBlocks && m.thinkingBlocks.length > 0) {
        for (const tb of m.thinkingBlocks) {
          if (tb.type === 'redacted_thinking') {
            // The encrypted payload rides `signature` on the normalized
            // block (the handler puts it there); Anthropic takes it as `data`.
            blocks.push({ type: 'redacted_thinking', data: tb.signature ?? '' });
          } else {
            blocks.push({
              type: 'thinking',
              thinking: tb.content,
              ...(tb.signature !== undefined && { signature: tb.signature }),
            });
          }
        }
      }
      if (m.content) blocks.push({ type: 'text', text: m.content });
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          if (tc.argumentsFailure !== undefined) {
            blocks.push({
              type: 'text',
              text: `Tool request '${tc.name}' (${tc.id}) had ${tc.argumentsFailure.reason} streamed arguments and was not executed. Its invalid input is not replayed; issue a new call with complete JSON arguments.`,
            });
            continue;
          }
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: { ...tc.args } });
        }
      }
      // A turn with no thinking, no text and no tool calls has nothing to
      // say, and the wire refuses it: `content: ''` is accepted only on a
      // FINAL assistant message (a prefill), so one mid-history fails the
      // whole request with a 400 that no retry can mend. Dropped like a
      // system message (`-1` — a cache marker cannot land on it). The turns
      // either side may now share a role; the Messages API combines
      // consecutive same-role turns, and a dropped system message has always
      // left the same adjacency. The library sends no prefill, and an empty
      // one would prefill nothing.
      if (blocks.length === 0) {
        indexMap?.push(-1);
        continue;
      }
      indexMap?.push(result.length);
      result.push({ role: 'assistant', content: blocks });
      continue;
    }
    if (m.role === 'tool') {
      if (m.toolArgumentsFailure !== undefined) {
        const last = result[result.length - 1];
        if (last?.role === 'user' && Array.isArray(last.content)) {
          indexMap?.push(result.length - 1);
          last.content.push({ type: 'text', text: m.content });
        } else {
          indexMap?.push(result.length);
          result.push({ role: 'user', content: [{ type: 'text', text: m.content }] });
        }
        continue;
      }
      const block: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: m.toolCallId ?? '',
        content: m.content,
      };
      const last = result[result.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        // Coalesced into the user turn already open — several request messages
        // share one body index.
        indexMap?.push(result.length - 1);
        // Anthropic requires real tool results before text in the coalesced
        // user turn, including recovery text from an earlier refused sibling.
        const firstText = last.content.findIndex((part) => part.type !== 'tool_result');
        if (firstText < 0) last.content.push(block);
        else last.content.splice(firstText, 0, block);
      } else {
        indexMap?.push(result.length);
        result.push({ role: 'user', content: [block] });
      }
      continue;
    }
  }
  return result;
}

export function toAnthropicTool(schema: LLMToolSchema): AnthropicTool {
  return {
    name: schema.name,
    description: schema.description,
    input_schema: { ...schema.inputSchema },
  };
}
