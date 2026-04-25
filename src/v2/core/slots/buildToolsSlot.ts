/**
 * Tools slot subflow builder — v2.
 *
 * Pattern: Builder (returns a FlowChart mountable via addSubFlowChartNext).
 * Role:    Layer-3 context engineering. Resolves the tools list the LLM
 *          sees on this iteration — one InjectionRecord per exposed tool.
 * Emits:   None directly; ContextRecorder sees the writes.
 *
 * Minimal scope for Phase 3e: static tool registry, all exposed every
 * iteration. Full permission gating / skill activation / context-aware
 * tool filtering arrives in Phase 5.
 */

import { flowChart } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import type { LLMToolSchema } from '../../adapters/types.js';
import { INJECTION_KEYS } from '../../conventions.js';
import type { InjectionRecord } from '../../recorders/core/types.js';
import { COMPOSITION_KEYS } from '../../recorders/core/types.js';
import { composeSlot, fnv1a, truncate } from './helpers.js';

export interface ToolsSlotConfig {
  /** Tool registry exposed to the LLM. Empty → empty slot (LLMCall case). */
  readonly tools: readonly LLMToolSchema[];
  /** Budget cap (chars). Default: 2000. */
  readonly budgetCap?: number;
}

interface ToolsSubflowState {
  [k: string]: unknown;
}

/**
 * Build the Tools slot subflow.
 *
 * Mount with:
 *   builder.addSubFlowChartNext(SUBFLOW_IDS.TOOLS, buildToolsSlot(cfg), 'Tools', {
 *     inputMapper: (parent) => ({ iteration: parent.iteration }),
 *     outputMapper: (sf) => ({ toolsInjections: sf.toolsInjections, toolSchemas: sf.toolSchemas }),
 *   })
 */
export function buildToolsSlot(config: ToolsSlotConfig): FlowChart {
  const budgetCap = config.budgetCap ?? 2000;
  const tools = config.tools;

  return flowChart<ToolsSubflowState>(
    'Compose',
    (scope: TypedScope<ToolsSubflowState>) => {
      const args = scope.$getArgs<{ iteration?: number }>();
      const iteration = args.iteration ?? 1;

      const injections: InjectionRecord[] = tools.map((t, i) => {
        const summary = `${t.name}: ${t.description}`;
        // `source: 'registry'` — tools configured at build time via
        // `.tool(...)` are baseline API flow (the static tool list
        // sent to the LLM), NOT context engineering. Skills /
        // Instructions that gate tools dynamically tag their
        // injections with `source: 'skill'` / `source: 'instruction'`.
        return {
          contentSummary: truncate(summary, 80),
          contentHash: fnv1a(`tool:${t.name}:${t.description}`),
          slot: 'tools',
          source: 'registry',
          sourceId: t.name,
          reason: 'tool registry',
          rawContent: summary,
          position: i,
        };
      });

      scope.$setValue(INJECTION_KEYS.TOOLS, injections);
      // Pass the actual schemas through so callers (LLMCall / Agent) can
      // hand them to the provider without re-reading config. Direct
      // property access (the Proxy intercepts) because the key is
      // hardcoded locally — no convention constant needed.
      scope.toolSchemas = tools;
      scope.$setValue(
        COMPOSITION_KEYS.SLOT_COMPOSED,
        composeSlot('tools', iteration, injections, budgetCap, 'registry-order'),
      );
    },
    'compose',
    undefined,
    'Compose tools slot',
  ).build();
}
