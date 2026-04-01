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
import type { FlowChart } from 'footprintjs';
import type { ScopeFacade } from 'footprintjs/advanced';
import type { ToolContext } from '../../../core';
import { AgentScope } from '../../../scope';
import { findLastUserMessage, extractTextContent } from '../helpers';
import type { ToolsSlotConfig } from './types';

/**
 * Build a ToolContext from the current scope state.
 */
function buildToolContext(scope: ScopeFacade): ToolContext {
  const messages = AgentScope.getMessages(scope);
  const loopCount = AgentScope.getLoopCount(scope);

  const lastUserMsg = findLastUserMessage(messages);
  const message = lastUserMsg ? extractTextContent(lastUserMsg) : '';

  return {
    message,
    turnNumber: loopCount,
    loopIteration: loopCount,
    messages,
    signal: scope.getEnv()?.signal,
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

  return flowChart(
    'ResolveTools',
    async (scope: ScopeFacade) => {
      const ctx = buildToolContext(scope);
      const tools = await config.provider.resolve(ctx);
      AgentScope.setToolDescriptions(scope, tools);
    },
    'resolve-tools',
    undefined,
    'Resolve available tools using the configured provider strategy',
  ).build();
}
