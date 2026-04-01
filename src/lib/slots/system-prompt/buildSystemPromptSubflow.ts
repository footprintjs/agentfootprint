/**
 * SystemPrompt slot — builds a subflow that resolves the system prompt.
 *
 * Always a subflow (never a plain stage) because:
 *   - Subflow with 1 stage = zero overhead, but gives drill-down + narrative for free
 *   - Config determines internal stages (1 for static, 3+ for RAG-augmented)
 *   - Parent chart never changes when strategy complexity grows
 *
 * The subflow writes the resolved prompt to scope via AgentScope.setSystemPrompt().
 * Providers are trusted — they receive raw message history and their output is
 * stored as-is. Sanitization is the provider's responsibility.
 *
 * Flowchart:
 *   [ResolvePrompt]  (single stage for simple providers)
 */

import { flowChart } from 'footprintjs';
import type { FlowChart } from 'footprintjs';
import type { ScopeFacade } from 'footprintjs/advanced';
import type { PromptContext } from '../../../core';
import { AgentScope } from '../../../scope';
import { findLastUserMessage, extractTextContent } from '../helpers';
import type { SystemPromptSlotConfig } from './types';

/**
 * Build a PromptContext from the current scope state.
 */
function buildPromptContext(scope: ScopeFacade): PromptContext {
  const messages = AgentScope.getMessages(scope);
  const loopCount = AgentScope.getLoopCount(scope);

  const lastUserMsg = findLastUserMessage(messages);
  const message = lastUserMsg ? extractTextContent(lastUserMsg) : '';

  return {
    message,
    turnNumber: loopCount,
    history: messages,
    signal: scope.getEnv()?.signal,
  };
}

/**
 * Build the SystemPrompt slot subflow from config.
 *
 * Returns a FlowChart that can be mounted with addSubFlowChartNext:
 * ```typescript
 * builder.addSubFlowChartNext('sf-system-prompt', buildSystemPromptSubflow(config), 'SystemPrompt', { ... })
 * ```
 */
export function buildSystemPromptSubflow(config: SystemPromptSlotConfig): FlowChart {
  if (!config.provider) {
    throw new Error('SystemPromptSlotConfig: provider is required');
  }

  return flowChart(
    'ResolvePrompt',
    async (scope: ScopeFacade) => {
      const ctx = buildPromptContext(scope);
      const prompt = await config.provider.resolve(ctx);
      AgentScope.setSystemPrompt(scope, prompt);
    },
    'resolve-prompt',
    undefined,
    'Resolve the system prompt using the configured provider strategy',
  ).build();
}
