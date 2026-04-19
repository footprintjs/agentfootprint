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

      // Merge tool injections from InstructionsToLLM (if any).
      //
      // Dedup is defensive on THREE axes — any overlap would cause the
      // LLM adapter to reject the request (Anthropic returns
      // "tools: Tool names must be unique"). First-wins in each pass:
      //   1. Base tools own their slot (ToolProvider.resolve can return
      //      the same id twice if the consumer built a static list with
      //      duplicates; normalize before merging).
      //   2. Base tools take precedence over injections on name collision.
      //   3. Injections themselves are already unique-by-id at the
      //      InstructionsToLLM layer, but we guard here too in case
      //      future callers write `scope.toolInjections` directly.
      const injections = scope.toolInjections ?? [];
      const seenNames = new Set<string>();
      const deduped: typeof decision.value = [];
      for (const t of decision.value) {
        if (seenNames.has(t.name)) continue;
        seenNames.add(t.name);
        deduped.push(t);
      }
      const newTools: typeof deduped = [];
      for (const t of injections) {
        if (seenNames.has(t.name)) continue;
        seenNames.add(t.name);
        newTools.push(t);
      }
      const allTools = newTools.length ? [...deduped, ...newTools] : deduped;

      scope.toolDescriptions = allTools;

      // Narrative enrichment — decision + tool summary for BTS visibility
      scope.toolDecision =
        decision.chosen !== 'static'
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
