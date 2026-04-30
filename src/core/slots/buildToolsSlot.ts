/**
 * Tools slot subflow builder
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
import type { Injection } from '../../lib/injection-engine/types.js';
import type { ToolProvider, ToolDispatchContext } from '../../tool-providers/types.js';
import { composeSlot, fnv1a, truncate } from './helpers.js';

export interface ToolsSlotConfig {
  /** Tool registry exposed to the LLM. Empty → empty slot (LLMCall case). */
  readonly tools: readonly LLMToolSchema[];
  /**
   * Optional `ToolProvider` consulted PER-ITERATION (Block A5 follow-up).
   * When set, the slot calls `provider.list(ctx)` each iteration with
   * the current `{ iteration, activeSkillId, identity }`. Provider-
   * supplied tool schemas are MERGED with the static `tools` registry
   * — both flow to the LLM. This is what makes Dynamic ReAct's tool
   * list reshape per iteration.
   */
  readonly toolProvider?: ToolProvider;
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
  const toolProvider = config.toolProvider;

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
        // injections with their flavor below.
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

      // Block A5/Neo follow-up: when an external `ToolProvider` is
      // configured, consult it per iteration. Closure-held in
      // `toolProvider` since scope can't carry functions. The provider
      // sees `{ iteration, activeSkillId, identity }` so dynamic
      // chains (`gatedTools`, `skillScopedTools`) react to the
      // current activation state.
      const providerSchemas: LLMToolSchema[] = [];
      if (toolProvider) {
        const activatedIds =
          (scope.$getValue('activatedInjectionIds') as readonly string[] | undefined) ?? [];
        const identity = scope.$getValue('runIdentity') as
          | { tenant?: string; principal?: string; conversationId: string }
          | undefined;
        const ctx: ToolDispatchContext = {
          iteration,
          ...(activatedIds.length > 0 && { activeSkillId: activatedIds[activatedIds.length - 1] }),
          ...(identity && { identity }),
        };
        const visibleTools = toolProvider.list(ctx);
        for (const t of visibleTools) {
          const schema = t.schema;
          providerSchemas.push(schema);
          const summary = `${schema.name}: ${schema.description}`;
          injections.push({
            contentSummary: truncate(summary, 80),
            contentHash: fnv1a(`tool:provider:${schema.name}`),
            slot: 'tools',
            source: 'registry',
            sourceId: schema.name,
            reason: `tool provider${toolProvider.id ? ` '${toolProvider.id}'` : ''}`,
            rawContent: summary,
            position: tools.length + providerSchemas.length - 1,
          });
        }
      }

      // Active Injections targeting the tools slot (Skills with
      // tools=[…]). Filter activeInjections by `inject.tools`.
      const activeInjections =
        (scope.$getValue('activeInjections') as readonly Injection[] | undefined) ?? [];
      const dynamicSchemas: LLMToolSchema[] = [];
      for (const inj of activeInjections) {
        const injTools = inj.inject.tools;
        if (!injTools || injTools.length === 0) continue;
        for (const tool of injTools) {
          const schema = tool.schema;
          dynamicSchemas.push(schema);
          const summary = `${schema.name}: ${schema.description}`;
          injections.push({
            contentSummary: truncate(summary, 80),
            contentHash: fnv1a(`tool:${inj.flavor}:${inj.id}:${schema.name}`),
            slot: 'tools',
            source: inj.flavor,
            sourceId: inj.id,
            reason: `${inj.flavor} '${inj.id}' unlocked tool '${schema.name}'`,
            rawContent: summary,
            position: tools.length + providerSchemas.length + dynamicSchemas.length - 1,
          });
        }
      }

      scope.$setValue(INJECTION_KEYS.TOOLS, injections);
      // Pass merged schemas (registry + provider + active injection-
      // supplied) so the Agent sends ALL of them to the LLM provider.
      scope.toolSchemas = [...tools, ...providerSchemas, ...dynamicSchemas];
      scope.$setValue(
        COMPOSITION_KEYS.SLOT_COMPOSED,
        composeSlot(
          'tools',
          iteration,
          injections,
          budgetCap,
          toolProvider ? 'registry+provider+injections' : 'registry+injections',
        ),
      );
    },
    'compose',
    undefined,
    'Compose tools slot',
  ).build();
}
