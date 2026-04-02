/**
 * ParseResponse stage — extract ParsedResponse from AdapterResult.
 *
 * Also appends the assistant message to conversation history.
 *
 * Reads from scope:
 *   - adapterResult (set by CallLLM)
 *
 * Writes to scope:
 *   - parsedResponse (hasToolCalls, toolCalls[], content)
 *   - messages (appends assistant message)
 *   - responseType (narrative summary of the response)
 */

import type { TypedScope } from 'footprintjs';
import type { AgentLoopState } from '../../scope/types';
import { assistantMessage } from '../../types';
import { appendMessage } from '../../memory';

/**
 * ParseResponse stage function.
 * Stateless — no factory needed.
 */
export function parseResponseStage(scope: TypedScope<AgentLoopState>): void {
  const result = scope.adapterResult;

  if (!result) {
    throw new Error('ParseResponse: no adapter result in scope');
  }

  if (result.type === 'error') {
    throw new Error(`LLM call failed: [${result.code}] ${result.message}`);
  }

  const parsed = {
    hasToolCalls: result.type === 'tools',
    toolCalls: result.type === 'tools' ? result.toolCalls : [],
    content: result.content,
  };

  scope.parsedResponse = parsed;

  // Append assistant message to conversation
  const messages = scope.messages ?? [];
  const asstMsg = assistantMessage(
    result.content,
    result.type === 'tools' ? result.toolCalls : undefined,
  );
  scope.messages = appendMessage(messages, asstMsg);

  // Write summary for narrative visibility
  if (parsed.hasToolCalls) {
    const toolNames = parsed.toolCalls.map((tc) => tc.name).join(', ');
    scope.responseType = `tool_calls: [${toolNames}]`;
  } else {
    const preview = result.content.length > 80 ? result.content.slice(0, 80) + '...' : result.content;
    scope.responseType = `final: "${preview}"`;
  }
}
