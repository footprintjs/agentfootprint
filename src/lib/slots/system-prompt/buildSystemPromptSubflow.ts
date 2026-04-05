/**
 * SystemPrompt slot — builds a subflow that resolves the system prompt.
 *
 * Always a subflow (never a plain stage) because:
 *   - Subflow with 1 stage = zero overhead, but gives drill-down + narrative for free
 *   - Config determines internal stages (1 for static, 3+ for RAG-augmented)
 *   - Parent chart never changes when strategy complexity grows
 *
 * The subflow writes the resolved prompt to scope.systemPrompt.
 * Providers are trusted — they receive raw message history and their output is
 * stored as-is. Sanitization is the provider's responsibility.
 *
 * Flowchart:
 *   [ResolvePrompt]  (single stage for simple providers)
 */

import { flowChart } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import type { PromptContext } from '../../../core';
import type { SystemPromptSubflowState } from '../../../scope/types';
import { findLastUserMessage, extractTextContent } from '../helpers';
import type { SystemPromptSlotConfig } from './types';

/**
 * Build a PromptContext from the current scope state.
 */
function buildPromptContext(scope: TypedScope<SystemPromptSubflowState>): PromptContext {
  const messages = scope.messages ?? [];
  const loopCount = scope.loopCount ?? 0;

  const lastUserMsg = findLastUserMessage(messages);
  const message = lastUserMsg ? extractTextContent(lastUserMsg) : '';

  return {
    message,
    turnNumber: loopCount,
    history: messages,
    signal: scope.$getEnv()?.signal,
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

  return flowChart<SystemPromptSubflowState>(
    'ResolvePrompt',
    async (scope) => {
      const ctx = buildPromptContext(scope);
      const decision = await config.provider.resolve(ctx);

      // Merge prompt injections from InstructionsToLLM (if any)
      const injections = scope.promptInjections;
      const basePrompt = decision.value;
      const fullPrompt = injections?.length
        ? [basePrompt, ...injections].join('\n\n')
        : basePrompt;

      scope.systemPrompt = fullPrompt;

      // Narrative enrichment — decision + prompt preview for BTS visibility
      scope.promptDecision = decision.chosen !== 'static'
        ? `${decision.chosen}${decision.rationale ? ` (${decision.rationale})` : ''}`
        : undefined;
      const injectionNote = injections?.length ? ` (+${injections.length} instruction injections)` : '';
      const preview = fullPrompt.length > 60 ? fullPrompt.slice(0, 60) + '...' : fullPrompt;
      scope.promptSummary = `${fullPrompt.length} chars: "${preview}"${injectionNote}`;
    },
    'resolve-prompt',
    undefined,
    'Resolve the system prompt using the configured provider strategy',
  ).build();
}
