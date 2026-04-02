/**
 * CommitMemory stage — persist conversation history after the turn completes.
 *
 * Behavior:
 *   - Reads `memory_shouldCommit` flag set by HandleResponse when the turn finalizes.
 *   - If true: fires `store.save(conversationId, messages)` as a non-blocking Promise
 *     (fire-and-forget), then calls scope.$break() so the loop ends.
 *   - If false (tool-call turn still in progress): no-op — loop continues normally.
 *
 * Fire-and-forget rationale:
 *   The caller receives the agent result immediately, without waiting for the DB write
 *   to complete. This matches the design goal of LangGraph vs agentfootprint: LangGraph
 *   blocks on its checkpointer; agentfootprint commits in parallel. Save errors are
 *   caught internally and surfaced via the provided `onSaveError` callback (if any).
 *
 *   Dev-mode: if `onSaveError` is omitted and save() fails, a console.warn is emitted in
 *   non-production environments so silent storage failures surface during development.
 *
 * Placement in the chart:
 *   CommitMemory is placed BEFORE `loopTo('call-llm')`. On tool-call turns it
 *   passes through (shouldCommit=false). On final turns it saves + breaks.
 *   This means every loop pass checks whether the turn is done.
 *
 * Example:
 *   SeedScope → PrepareMemory → ... → HandleResponse → CommitMemory → loopTo(CallLLM)
 */

import type { TypedScope } from 'footprintjs';
import type { ConversationStore } from '../adapters/memory/types';
import type { AgentLoopState } from '../scope/types';

export interface CommitMemoryConfig {
  readonly store: ConversationStore;
  readonly conversationId: string;
  /**
   * Called when the fire-and-forget save() rejects.
   * Optional — if omitted, save errors are silently swallowed in production.
   * In non-production environments a console.warn is emitted automatically.
   * Use this to surface storage errors in telemetry/logging.
   */
  readonly onSaveError?: (error: unknown) => void;
}

const isDevMode = () => process.env['NODE_ENV'] !== 'production';

/**
 * Build the CommitMemory stage function.
 *
 * Usage:
 * ```typescript
 * .addFunction('CommitMemory', createCommitMemoryStage(config), 'commit-memory')
 * .loopTo('call-llm')
 * ```
 */
export function createCommitMemoryStage(config: CommitMemoryConfig) {
  return async (scope: TypedScope<AgentLoopState>) => {
    const shouldCommit = scope.memory_shouldCommit === true;

    if (!shouldCommit) {
      // Tool-call turn — loop continues, nothing to save yet
      return;
    }

    // Reconstruct the full conversation history for storage.
    //
    // When a sliding window strategy is active, `messages` in scope contains only
    // the windowed context + new LLM messages — the oldest turns were trimmed.
    // We detect this by comparing storedHistory.length vs preparedMessages.length:
    // if they differ, windowing occurred and we must rebuild from storedHistory.
    //
    // Full history = storedHistory (pre-LLM, includes new user message)
    //              + newLLMMessages (messages appended by CallLLM/ParseResponse)
    //
    // PromptAssembly may inject a system message at position 0 when the windowed
    // prepared context doesn't start with one. We account for that 1-message offset.
    const messages = scope.messages ?? [];
    const storedHistory = scope.memory_storedHistory ?? [];
    const prepared = scope.memory_preparedMessages ?? [];

    let toSave: typeof messages;
    if (storedHistory.length > 0 && prepared.length < storedHistory.length) {
      // Windowing trimmed the history — reconstruct: storedHistory + newLLMMessages.
      const systemInjected =
        messages.length > 0 &&
        messages[0].role === 'system' &&
        (prepared.length === 0 || prepared[0].role !== 'system');
      const preparedEnd = systemInjected ? prepared.length + 1 : prepared.length;
      const newLLMMessages = messages.slice(preparedEnd);
      toSave = [...storedHistory, ...newLLMMessages];
    } else {
      // No windowing — messages array is the complete history.
      toSave = messages;
    }

    // Fire-and-forget: don't await the save — caller gets result immediately.
    // Use instanceof check to avoid allocating a Promise for synchronous save() returns.
    const saveResult = config.store.save(config.conversationId, toSave);
    if (saveResult instanceof Promise) {
      saveResult.catch((error: unknown) => {
        if (config.onSaveError) {
          config.onSaveError(error);
        } else if (isDevMode()) {
          // eslint-disable-next-line no-console
          console.warn(
            '[agentfootprint] CommitMemory: store.save() failed and no onSaveError handler was provided.',
            error,
          );
        }
      });
    }

    // Break the loop first — this is the real termination signal.
    scope.$break();

    // Reset the flag after breaking so CommitMemory is a no-op on any future loop
    // passes (defensive — $break() already ends the loop).
    scope.memory_shouldCommit = false;
  };
}
