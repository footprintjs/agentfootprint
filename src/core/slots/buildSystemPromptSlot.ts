/**
 * System-Prompt slot subflow builder — v2.
 *
 * Pattern: Builder (returns a FlowChart mountable via addSubFlowChartNext).
 * Role:    Layer-3 context engineering; inside Layer-5 primitives
 *          (LLMCall, Agent). Ported from v1's buildSystemPromptSubflow
 *          to v2's InjectionRecord + SlotComposition shape.
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
import { composeSlot, fnv1a, truncate } from './helpers.js';

/**
 * Function that produces the system prompt string given runtime scope
 * context. Receives the subflow's $getArgs() payload.
 */
export type SystemPromptFn = (args: {
  readonly userMessage?: string;
  readonly iteration?: number;
}) => string | Promise<string>;

export interface SystemPromptSlotConfig {
  /** Static string OR a function. Empty string → no injection, empty slot. */
  readonly prompt: string | SystemPromptFn;
  /** Budget cap (chars). Default: 4000. */
  readonly budgetCap?: number;
  /** Optional description — where this prompt originated (e.g. "agent.system()"). */
  readonly reason?: string;
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
  const reason = config.reason ?? 'static system prompt';
  const promptSource = config.prompt;

  return flowChart<SystemPromptSubflowState>(
    'Compose',
    async (scope: TypedScope<SystemPromptSubflowState>) => {
      const args = scope.$getArgs<{ userMessage?: string; iteration?: number }>();
      const resolved =
        typeof promptSource === 'function' ? await promptSource(args) : promptSource;

      const injections: InjectionRecord[] = [];
      if (resolved && resolved.length > 0) {
        // `source: 'base'` — this is the static system prompt configured
        // at build time via `.system('...')`. It's baseline API flow,
        // NOT context engineering. An Instructions system that injects
        // a dynamic rule-based system-prompt addition tags with
        // `source: 'instruction'` instead.
        injections.push({
          contentSummary: truncate(resolved, 80),
          contentHash: fnv1a(`sp:${resolved}`),
          slot: 'system-prompt',
          source: 'base',
          reason,
          rawContent: resolved,
        });
      }

      scope.$setValue(INJECTION_KEYS.SYSTEM_PROMPT, injections);
      scope.$setValue(
        COMPOSITION_KEYS.SLOT_COMPOSED,
        composeSlot('system-prompt', args.iteration ?? 1, injections, budgetCap),
      );
    },
    'compose',
    undefined,
    'Compose system-prompt slot',
  ).build();
}
