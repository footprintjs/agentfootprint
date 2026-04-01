/**
 * PrepareMemory subflow — load history from store + apply MessageStrategy.
 *
 * Flowchart (2 stages):
 *   LoadHistory → ApplyStrategy
 *
 * LoadHistory: calls store.load(conversationId), merges stored history with
 *   the current turn's message (added by SeedScope), writes merged history
 *   to scope as `memory_storedHistory`.
 *
 * ApplyStrategy: applies the configured MessageStrategy to the merged history
 *   (trim, window, summarize). Writes prepared messages to scope as
 *   `memory_preparedMessages`. If no strategy, passes merged history through.
 *
 * The subflow is mounted via addSubFlowChartNext in Agent.ts:
 *   inputMapper  — copies current messages from parent scope into subflow
 *   outputMapper — copies prepared messages back to parent scope's `messages`
 *
 * No-op behavior:
 *   - No store:    LoadHistory writes current messages as-is (no DB hit)
 *   - No strategy: ApplyStrategy writes merged history as-is (no trimming)
 *   Both stages are always present in the flowchart for narrative visibility.
 */

import { flowChart } from 'footprintjs';
import type { ScopeFacade } from 'footprintjs/advanced';
import type { ConversationStore } from '../adapters/memory/types';
import type { MessageStrategy, MessageContext } from '../core/providers';
import type { Message } from '../types/messages';
import { MEMORY_PATHS } from '../scope/AgentScope';

// ── Config ───────────────────────────────────────────────────

/**
 * Subset of MemoryConfig with all fields optional for subflow flexibility.
 *
 * Relationship to MemoryConfig:
 *   - MemoryConfig: `store` + `conversationId` are required — used at Agent.memory() call site.
 *   - PrepareMemoryConfig: all optional — enables no-op path (no store, no strategy).
 *
 * If MemoryConfig gains new fields (e.g. ttl, namespace), mirror them here.
 */
export interface PrepareMemoryConfig {
  readonly store?: ConversationStore;
  readonly conversationId?: string;
  readonly strategy?: MessageStrategy;
}

// ── Subflow factory ───────────────────────────────────────────

/**
 * Build the PrepareMemory subflow.
 *
 * Mount this with addSubFlowChartNext after SeedScope:
 * ```typescript
 * .addSubFlowChartNext('sf-prepare-memory', createPrepareMemorySubflow(config), 'PrepareMemory', {
 *   inputMapper: (parent) => ({
 *     currentMessages: AgentScope.getMessages(parent),
 *   }),
 *   // outputMapper: (sfOutput, _parent) => ({...sfOutput}) returns values to write to parent.
 *   // sfOutput is the subflow's final sharedState (plain Record), NOT a ScopeFacade.
 *   outputMapper: (sfOutput) => ({
 *     [MEMORY_PATHS.PREPARED_MESSAGES]: sfOutput[MEMORY_PATHS.PREPARED_MESSAGES],
 *     [MEMORY_PATHS.STORED_HISTORY]: sfOutput[MEMORY_PATHS.STORED_HISTORY],
 *   }),
 * })
 * ```
 */
export function createPrepareMemorySubflow(config: PrepareMemoryConfig) {
  // ── Stage 1: LoadHistory ─────────────────────────────────

  const loadHistory = async (scope: ScopeFacade) => {
    const current = (scope.getValue('currentMessages') as Message[]) ?? [];

    if (!config.store || !config.conversationId) {
      // No store configured — pass current messages through unchanged
      scope.setValue(MEMORY_PATHS.STORED_HISTORY, current);
      return;
    }

    // Null-safe: store.load() may return null for backends that don't have a record.
    const stored = (await config.store.load(config.conversationId)) ?? [];

    // Merge strategy: stored history first, then new messages from this turn.
    // currentMessages contains only the new messages for this turn (e.g. [user('question')]).
    // Append unconditionally — the store holds all prior turns.
    const merged = stored.length > 0 ? [...stored, ...current] : current;

    scope.setValue(MEMORY_PATHS.STORED_HISTORY, merged);
  };

  // ── Stage 2: ApplyStrategy ───────────────────────────────

  const applyStrategy = async (scope: ScopeFacade) => {
    const merged = (scope.getValue(MEMORY_PATHS.STORED_HISTORY) as Message[]) ?? [];

    if (!config.strategy) {
      // No strategy — pass through as-is
      scope.setValue(MEMORY_PATHS.PREPARED_MESSAGES, merged);
      return;
    }

    // Build a minimal MessageContext. Turn number and loop iteration are
    // not available here; strategies that need them (rare) can derive from
    // the message array length.
    const ctx: MessageContext = {
      message: '',
      turnNumber: 0,
      loopIteration: 0,
    };

    const prepared = await config.strategy.prepare(merged, ctx);
    scope.setValue(MEMORY_PATHS.PREPARED_MESSAGES, prepared);
  };

  return flowChart('LoadHistory', loadHistory, 'load-history')
    .addFunction('ApplyStrategy', applyStrategy, 'apply-strategy')
    .build();
}
