/**
 * ParseResponse stage — extract ParsedResponse from AdapterResult.
 * Also appends assistant message to conversation history.
 */

import type { TypedScope } from 'footprintjs';
import { assistantMessage } from '../types';
import type { AdapterResult } from '../types/adapter';
import type { BaseLLMState } from '../scope/types';
import { appendMessage } from '../memory';

export function parseResponseStage(scope: TypedScope<BaseLLMState>): void {
  const result = scope.adapterResult as AdapterResult | undefined;

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

  const messages = scope.messages ?? [];
  const asstMsg = assistantMessage(
    result.content,
    result.type === 'tools' ? result.toolCalls : undefined,
  );
  scope.messages = appendMessage(messages, asstMsg);
}
