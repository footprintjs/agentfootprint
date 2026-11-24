import type { LLMMessage } from '../../../provider-contract/types.js';

export interface OpenAIMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON-stringified args
  };
}

/**
 * messages → OpenAI messages.
 *
 * Roles map 1:1: system/user/assistant/tool. For reasoning models the system role
 * becomes `developer` (its replacement). Assistant turns with `toolCalls` get those
 * serialized into `message.tool_calls` (args JSON-stringified per OpenAI's contract).
 * Tool messages map to `role: 'tool'` with `tool_call_id`.
 */
export function toOpenAIMessages(
  messages: readonly LLMMessage[],
  systemPrompt: string | undefined,
  reasoning: boolean,
): OpenAIMessage[] {
  const systemRole: 'system' | 'developer' = reasoning ? 'developer' : 'system';
  const result: OpenAIMessage[] = [];
  // OpenAI accepts the system/developer role IN the messages array (unlike Anthropic's
  // separate `system` field). Prepend systemPrompt as the first such message; subsequent
  // in-message system entries pass through.
  if (systemPrompt) {
    result.push({ role: systemRole, content: systemPrompt });
  }
  for (const m of messages) {
    if (m.role === 'system') {
      result.push({ role: systemRole, content: m.content });
      continue;
    }
    if (m.role === 'user') {
      result.push({ role: 'user', content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const msg: OpenAIMessage = {
        role: 'assistant',
        content: m.content || null,
      };
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          },
        }));
      }
      result.push(msg);
      continue;
    }
    if (m.role === 'tool') {
      result.push({
        role: 'tool',
        content: m.content,
        tool_call_id: m.toolCallId ?? '',
      });
      continue;
    }
  }
  return result;
}
