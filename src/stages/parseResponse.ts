/**
 * ParseResponse stage — extract ParsedResponse from AdapterResult.
 * Also appends assistant message to conversation history.
 */

import type { ScopeFacade } from 'footprintjs/advanced';
import { assistantMessage } from '../types';
import { AgentScope } from '../scope';
import { appendMessage } from '../memory';

export function parseResponseStage(scope: ScopeFacade): void {
  const result = AgentScope.getAdapterResult(scope);

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

  AgentScope.setParsedResponse(scope, parsed);

  // Append assistant message to conversation
  const messages = AgentScope.getMessages(scope);
  const asstMsg = assistantMessage(
    result.content,
    result.type === 'tools' ? result.toolCalls : undefined,
  );
  AgentScope.setMessages(scope, appendMessage(messages, asstMsg));
}
