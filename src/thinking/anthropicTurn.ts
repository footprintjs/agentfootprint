import type { MessageReplay } from './replay.js';

interface TurnMessage {
  readonly role: string;
  readonly toolCalls?: readonly { readonly id: string }[];
  readonly toolCallId?: string;
  readonly replay?: MessageReplay;
}

/** A supplied tool result is not completion. Only a witnessed end_turn is. */
export function completedAnthropicThrough(messages: readonly TurnMessage[]): number {
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
