/**
 * Tools slot — builds a subflow that resolves available tools.
 *
 * Always a subflow because:
 *   - Config determines complexity: 1 stage (static) or 2+ (gated/dynamic)
 *   - Parent chart never changes when tool resolution grows
 *   - BehindTheScenes shows exactly which tools were resolved and why
 *
 * Providers are trusted — their output is stored as-is.
 * Providers receive raw message history for context-dependent resolution.
 *
 * Flowchart:
 *   [ResolveTools]  (single stage — ToolProvider.resolve() handles all complexity)
 */

import { flowChart } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import type { ToolContext } from '../../../core';
import type { ToolsSubflowState } from '../../../scope/types';
import { findLastUserMessage, extractTextContent } from '../helpers';
import type { ToolsSlotConfig } from './types';

/**
 * Build a ToolContext from the current scope state.
 */
function buildToolContext(scope: TypedScope<ToolsSubflowState>): ToolContext {
  const messages = scope.messages ?? [];
  const loopCount = scope.loopCount ?? 0;

  const lastUserMsg = findLastUserMessage(messages);
  const message = lastUserMsg ? extractTextContent(lastUserMsg) : '';

  return {
    message,
    turnNumber: loopCount,
    loopIteration: loopCount,
    messages,
    signal: scope.$getEnv()?.signal,
  };
}

/**
 * Build the Tools slot subflow from config.
 *
 * Returns a FlowChart mountable with addSubFlowChartNext.
 */
export function buildToolsSubflow(config: ToolsSlotConfig): FlowChart {
  if (!config.provider) {
    throw new Error('ToolsSlotConfig: provider is required');
  }

  return flowChart<ToolsSubflowState>(
    'ResolveTools',
    async (scope) => {
      const ctx = buildToolContext(scope);
      const tools = await config.provider.resolve(ctx);
      scope.toolDescriptions = tools;

      // Narrative enrichment — summarize resolved tools for BTS visibility
      const names = tools.map((t) => t.name ?? '?');
      scope.resolvedTools = `${tools.length} tools: ${names.join(', ')}`;
    },
    'resolve-tools',
    undefined,
    'Resolve available tools using the configured provider strategy',
  ).build();
}
