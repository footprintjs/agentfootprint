/**
 * System-Prompt slot subflow builder
 *
 * Pattern: Builder (returns a FlowChart mountable via addSubFlowChartNext).
 * Role:    Layer-3 context engineering; inside Layer-5 primitives
 *          (LLMCall, Agent). Ported from v1's buildSystemPromptSubflow
 *          to InjectionRecord + SlotComposition shape.
 * Emits:   None directly. Writes to conventional scope keys; ContextRecorder
 *          observes and emits context.* events.
 *
 * Minimal scope for Phase 3e: static prompt string OR a dynamic function
 * of the input. Full SystemPromptProvider / Skill / RAG integration
 * arrives in Phase 5.
 */

import { flowChart } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import { INJECTION_KEYS } from '../../conventions.js';
import type { InjectionRecord } from '../../recorders/core/types.js';
import { COMPOSITION_KEYS } from '../../recorders/core/types.js';
import type { ActiveInjection } from '../../lib/injection-engine/types.js';
import { composeSlot, fnv1a, formatOverflowWarning, slotOverflow, truncate } from './helpers.js';

/**
 * Function that produces the system prompt string given runtime scope
 * context. Receives the subflow's $getArgs() payload.
 */
export type SystemPromptFn = (args: SystemPromptSlotArgs) => string | Promise<string>;

/**
 * What the slot's `$getArgs()` carries. `instructions` is present only when
 * the Agent's `.configure()` resolved a per-run system prompt — the mount's
 * inputMapper omits the key entirely otherwise, so an unconfigured agent
 * seeds this subflow with exactly the state it always did.
 */
export interface SystemPromptSlotArgs {
  readonly userMessage?: string;
  readonly iteration?: number;
  readonly instructions?: string;
}

export interface SystemPromptSlotConfig {
  /** Static string OR a function. Empty string → no injection, empty slot. */
  readonly prompt: string | SystemPromptFn;
  /** Budget cap (chars). Default: 4000. Set from the public door as
   *  `contextBudget.systemPrompt` on `AgentOptions` / `LLMCallOptions`. */
  readonly budgetCap?: number;
  /**
   * Where this prompt originated, recorded on the base InjectionRecord
   * (e.g. `"agent.system()"`). A function when the origin depends on the
   * run — an Agent with `.configure()` reports `Agent.configure()` on the
   * runs that actually overrode the prompt and `Agent.system()` on the rest,
   * so the context record names the real author rather than a build-time
   * guess.
   */
  readonly reason?: string | ((args: SystemPromptSlotArgs) => string);
}

/**
 * Internal subflow state — kept minimal. Convention keys
 * (systemPromptInjections, slotCompositions) are written via $setValue
 * because their keys are dynamic across slots.
 */
interface SystemPromptSubflowState {
  [k: string]: unknown;
}

/**
 * Build the System-Prompt slot subflow.
 *
 * Mount with:
 *   builder.addSubFlowChartNext(SUBFLOW_IDS.SYSTEM_PROMPT, buildSystemPromptSlot(cfg), 'System Prompt', {
 *     inputMapper: (parent) => ({ userMessage: parent.userMessage, iteration: parent.iteration }),
 *     outputMapper: (sf) => ({ systemPromptInjections: sf.systemPromptInjections }),
 *   })
 */
export function buildSystemPromptSlot(config: SystemPromptSlotConfig): FlowChart {
  const budgetCap = config.budgetCap ?? 4000;
  const reasonSource = config.reason ?? 'static system prompt';
  const promptSource = config.prompt;
  // Dedup latch for the human-facing overflow warning (see buildToolsSlot).
  let warnedOverflow = false;

  return flowChart<SystemPromptSubflowState>(
    'Compose',
    async (scope: TypedScope<SystemPromptSubflowState>) => {
      const args = scope.$getArgs<SystemPromptSlotArgs>();
      const resolved = typeof promptSource === 'function' ? await promptSource(args) : promptSource;
      const reason = typeof reasonSource === 'function' ? reasonSource(args) : reasonSource;

      const injections: InjectionRecord[] = [];

      // Base prompt — `source: 'base'`. Configured at build time via
      // Agent.create({...}).system('...') OR LLMCall config. Baseline
      // LLM API flow, not context engineering. The InjectionEngine
      // subflow (mounted before this one) writes activeInjections[]
      // to scope; this slot reads them and appends Injection-derived
      // InjectionRecords below.
      if (resolved && resolved.length > 0) {
        injections.push({
          contentSummary: truncate(resolved, 80),
          contentHash: fnv1a(`sp:${resolved}`),
          slot: 'system-prompt',
          source: 'base',
          reason,
          rawContent: resolved,
        });
      }

      // Active Injections targeting the system-prompt slot — the
      // InjectionEngine subflow (mounted before this slot) wrote
      // `activeInjections` to scope. We filter by `inject.systemPrompt`
      // and append one InjectionRecord per active injection, tagged
      // with the Injection's `flavor` (skill / steering / instructions /
      // fact / etc.). ContextRecorder picks up zero-change.
      const activeInjections =
        (scope.$getValue('activeInjections') as readonly ActiveInjection[] | undefined) ?? [];
      for (const inj of activeInjections) {
        const promptContent = inj.inject.systemPrompt;
        if (!promptContent || promptContent.length === 0) continue;
        // Block C — per-mode dispatch. Skills with surfaceMode='tool-only'
        // do NOT land in the system slot; their body is delivered via
        // the read_skill tool result instead. Other modes (system-prompt,
        // both, auto, or absent) keep the current v2.4 path: body lands
        // here. 'both' lands here AND in the tool result; the duplication
        // is intentional belt-and-suspenders for high-stakes skills.
        if (inj.flavor === 'skill' && inj.surfaceMode === 'tool-only') continue;
        injections.push({
          contentSummary: truncate(promptContent, 80),
          contentHash: fnv1a(`sp:${inj.flavor}:${inj.id}:${promptContent}`),
          slot: 'system-prompt',
          source: inj.flavor,
          sourceId: inj.id,
          reason: inj.description ?? `${inj.flavor} '${inj.id}' active`,
          rawContent: promptContent,
          // Retrieval provenance (8.8.0) — present only when a retrieval
          // produced this injection. These are the payload's declared
          // `retrievalScore` / `rankPosition` / `threshold`, written for
          // the first time; before the recall was split per chunk there
          // was no single score a record could honestly carry.
          ...(inj.retrieval !== undefined && {
            retrievalScore: inj.retrieval.score,
            rankPosition: inj.retrieval.rank,
            ...(inj.retrieval.threshold !== undefined && { threshold: inj.retrieval.threshold }),
          }),
        });
      }

      scope.$setValue(INJECTION_KEYS.SYSTEM_PROMPT, injections);
      const composition = composeSlot('system-prompt', args.iteration ?? 1, injections, budgetCap);
      scope.$setValue(COMPOSITION_KEYS.SLOT_COMPOSED, composition);

      // Overflow is LOUD — nothing here truncates (see buildToolsSlot).
      const pressure = slotOverflow(composition);
      if (pressure) {
        scope.$setValue(COMPOSITION_KEYS.BUDGET_PRESSURE, [pressure]);
        if (!warnedOverflow) {
          warnedOverflow = true;
          console.warn(
            formatOverflowWarning({
              pressure,
              itemCount: injections.length,
              itemNoun: 'prompt fragment',
              contentNoun: 'fragments',
              remedy:
                'Raise contextBudget.systemPrompt on the agent, or shorten the system prompt.',
            }),
          );
        }
      }
    },
    'compose',
    { description: 'Compose system-prompt slot' },
  ).build();
}
