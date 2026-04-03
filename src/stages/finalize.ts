/**
 * Finalize stage — extract the final response from conversation.
 */

import type { TypedScope } from 'footprintjs';
import { getTextContent } from '../types/content';
import type { BaseLLMState } from '../scope/types';
import { lastAssistantMessage } from '../memory';

export function finalizeStage(scope: TypedScope<BaseLLMState>): void {
  const messages = scope.messages ?? [];
  const lastAsst = lastAssistantMessage(messages);

  const result = lastAsst ? getTextContent(lastAsst.content) : '';
  scope.result = result;
}
