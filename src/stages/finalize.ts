/**
 * Finalize stage — extract the final response from conversation.
 */

import type { ScopeFacade } from 'footprintjs';
import { getTextContent } from '../types/content';
import { AgentScope } from '../scope';
import { lastAssistantMessage } from '../memory';

export function finalizeStage(scope: ScopeFacade): void {
  const messages = AgentScope.getMessages(scope);
  const lastAsst = lastAssistantMessage(messages);

  const result = lastAsst ? getTextContent(lastAsst.content) : '';
  AgentScope.setResult(scope, result);
}
