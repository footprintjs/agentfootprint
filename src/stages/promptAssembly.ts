/**
 * PromptAssembly stage — build the LLM message array.
 * Prepends system message if not already present.
 */

import type { ScopeFacade } from 'footprintjs';
import { systemMessage } from '../types';
import { AgentScope } from '../scope';

export function promptAssemblyStage(scope: ScopeFacade): void {
  const messages = AgentScope.getMessages(scope);
  const sysPrompt = AgentScope.getSystemPrompt(scope);

  // Prepend system message if configured and not already present
  if (sysPrompt && (messages.length === 0 || messages[0].role !== 'system')) {
    AgentScope.setMessages(scope, [systemMessage(sysPrompt), ...messages]);
  }
}
