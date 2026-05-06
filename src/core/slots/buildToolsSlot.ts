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
import { typedEmit } from '../../recorders/core/typedEmit.js';
import type { Tool } from '../tools.js';
import type { ToolProvider, ToolDispatchContext } from '../../tool-providers/types.js';
import { composeSlot, fnv1a, truncate } from './helpers.js';

/**
 * Mutable cache shared between `buildToolsSlot` (writer) and
 * `buildToolCallsHandler` (reader) within ONE run. The Tools slot
 * resolves the provider's tools each iteration and stashes the
 * Tool[] here; the toolCalls handler reads on dispatch — so async
 * providers pay the discovery cost once, not twice. Scoped to the
 * chart build so concurrent `agent.run()` calls each get their own
 * cache.
 */
export interface ProviderToolCache {
  current: readonly Tool[];
}

export interface ToolsSlotConfig {
  /** Tool registry exposed to the LLM. Empty → empty slot (LLMCall case). */
  readonly tools: readonly LLMToolSchema[];
  /**
   * Optional `ToolProvider` consulted PER-ITERATION (Block A5 follow-up).
   * When set, the slot calls `provider.list(ctx)` each iteration with
   * the current `{ iteration, activeSkillId, identity, signal }`.
   * Provider-supplied tool schemas are MERGED with the static `tools`
   * registry — both flow to the LLM. This is what makes Dynamic ReAct's
   * tool list reshape per iteration.
   */
  readonly toolProvider?: ToolProvider;
  /**
   * Mutable cache the slot writes to after resolving `toolProvider.list(ctx)`.
   * The same cache reference is passed to `buildToolCallsHandler` so
   * dispatch reads from this iteration's resolved Tool[] instead of
   * calling `list()` a second time. Required when `toolProvider` is set.
   */
  readonly providerToolCache?: ProviderToolCache;
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
  const providerToolCache = config.providerToolCache;

  // Stage 1 — Discover: consult the external ToolProvider (if any) and
  // resolve its Tool[] for this iteration. ALWAYS runs (even when no
  // provider) so the trace shape is consistent across agents — the
  // no-provider path early-returns in microseconds. When a provider IS
  // set, this stage owns the entire async-discovery boundary:
  //
  //   • own runtimeStageId (e.g., `sf-tools/discover#7`) so KeyedRecorder
  //     and SequenceRecorder can scope per-discovery latency / errors
  //   • own InOutRecorder boundary (entry/exit pair)
  //   • own narrative entry separating "I called the hub" from "I built
  //     the slot"
  //   • emits `tools.discovery_started`, `tools.discovery_completed` (or
  //     `tools.discovery_failed`) with timing + provider id
  //
  // Sync providers still pay zero microtask overhead — the dynamic
  // `instanceof Promise` check skips await for non-Promise returns.
  const discoverStage = async (scope: TypedScope<ToolsSubflowState>): Promise<void> => {
    if (!toolProvider) return; // No-op fast path: keeps trace shape consistent.

    const args = scope.$getArgs<{ iteration?: number }>();
    const iteration = args.iteration ?? 1;
    const env = scope.$getEnv();
    const activatedIds =
      (scope.$getValue('activatedInjectionIds') as readonly string[] | undefined) ?? [];
    const identity = scope.$getValue('runIdentity') as
      | { tenant?: string; principal?: string; conversationId: string }
      | undefined;
    const ctx: ToolDispatchContext = {
      iteration,
      ...(activatedIds.length > 0 && { activeSkillId: activatedIds[activatedIds.length - 1] }),
      ...(identity && { identity }),
      ...(env.signal && { signal: env.signal }),
    };

    typedEmit(scope, 'agentfootprint.tools.discovery_started', {
      providerId: toolProvider.id,
      iteration,
    });

    const startMs = Date.now();
    let visibleTools: readonly Tool[];
    try {
      // Dynamic check — sync providers skip the await microtask.
      const result = toolProvider.list(ctx);
      visibleTools = result instanceof Promise ? await result : result;
    } catch (err) {
      // Discovery failure is loud by design. Emit the typed event
      // with the providerId so consumers can route alerts; then
      // re-throw so a configured `reliability` rule decides whether
      // to retry / fall back / fail-fast. Silently dropping tools
      // mid-conversation creates non-deterministic agent behavior
      // harder to debug than a crash.
      const errMessage = err instanceof Error ? err.message : String(err);
      const errName = err instanceof Error ? err.name : 'Error';
      typedEmit(scope, 'agentfootprint.tools.discovery_failed', {
        providerId: toolProvider.id,
        error: errMessage,
        errorName: errName,
        iteration,
        durationMs: Date.now() - startMs,
      });
      throw err;
    }

    typedEmit(scope, 'agentfootprint.tools.discovery_completed', {
      providerId: toolProvider.id,
      iteration,
      durationMs: Date.now() - startMs,
      toolCount: visibleTools.length,
    });

    // Cache the resolved Tool[] in the closure-shared ProviderToolCache.
    // The Compose stage reads providerSchemas from here; the toolCalls
    // handler reads the executable Tool objects on dispatch. Both share
    // ONE list() call per iteration. The cache lives outside scope
    // because Tool objects carry `execute` functions that can't be
    // `structuredClone`d into the transactional memory layer.
    if (providerToolCache) providerToolCache.current = visibleTools;
  };

  // Stage 2 — Compose: merges static + provider + per-skill schemas
  // into the tool slot. Pure compute, sync, fast. Reads provider tools
  // from `providerToolCache.current` populated by the Discover stage.
  const composeStage = (scope: TypedScope<ToolsSubflowState>): void => {
    const args = scope.$getArgs<{ iteration?: number }>();
    const iteration = args.iteration ?? 1;

    const injections: InjectionRecord[] = tools.map((t, i) => {
      const summary = `${t.name}: ${t.description}`;
      // `source: 'registry'` — tools configured at build time via
      // `.tool(...)` are baseline API flow (the static tool list sent
      // to the LLM), NOT context engineering. Skills / Instructions
      // that gate tools dynamically tag their injections with their
      // flavor below.
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

    const providerSchemas: LLMToolSchema[] = [];
    if (toolProvider && providerToolCache) {
      for (const t of providerToolCache.current) {
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

    // Active Injections targeting the tools slot (Skills with tools=[…]).
    // Filter activeInjections by `inject.tools`.
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
    // Merge schemas from all three sources, deduping by tool name.
    // Order: static .tool() registry FIRST (auto-attached read_skill /
    // list_skills land here when `.skills(registry)` is wired), then
    // external `.toolProvider()` output, then per-skill inject.tools.
    // First occurrence wins.
    //
    // Why dedupe matters: Neo wires `gatedTools(staticTools([listSkills,
    // readSkill]), policy.isAllowed)` AND calls `.skills(registry)` —
    // the framework auto-attaches its own `read_skill` from the skill
    // registry, AND the consumer's toolProvider emits one too. Without
    // dedupe both reach the LLM and Anthropic rejects the request:
    // "tools: Tool names must be unique."
    const seen = new Set<string>();
    const merged: LLMToolSchema[] = [];
    for (const t of [...tools, ...providerSchemas, ...dynamicSchemas]) {
      if (seen.has(t.name)) continue;
      seen.add(t.name);
      merged.push(t);
    }
    scope.toolSchemas = merged;
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
  };

  return flowChart<ToolsSubflowState>(
    'Discover',
    discoverStage,
    'discover',
    undefined,
    'Discover provider tools',
  )
    .addFunction('Compose', composeStage, 'compose', 'Compose tools slot')
    .build();
}
