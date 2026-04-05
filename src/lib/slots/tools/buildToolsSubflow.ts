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
      const decision = await config.provider.resolve(ctx);

      // Merge tool injections from InstructionsToLLM (if any)
      // Deduplicate by name — base tools take precedence over injected.
      // Note: dedup compares injected `name` (converted from ToolDefinition.id)
      // against base tool `name`. Works when base ToolProvider uses id as name.
      const injections = scope.toolInjections;
      const baseNames = new Set(decision.value.map((t) => t.name));
      const newTools = injections?.length
        ? injections.filter((t) => !baseNames.has(t.name))
        : [];
      const allTools = newTools.length
        ? [...decision.value, ...newTools]
        : decision.value;

      scope.toolDescriptions = allTools;

      // Narrative enrichment — decision + tool summary for BTS visibility
      scope.toolDecision = decision.chosen !== 'static'
        ? `${decision.chosen}${decision.rationale ? ` (${decision.rationale})` : ''}`
        : undefined;
      const injectionNote = newTools.length > 0 ? ` (+${newTools.length} from instructions)` : '';
      const names = allTools.map((t) => t.name ?? '?');
      scope.resolvedTools = `${allTools.length} tools: ${names.join(', ')}${injectionNote}`;
    },
    'resolve-tools',
    undefined,
    'Resolve available tools using the configured provider strategy',
  ).build();
}
