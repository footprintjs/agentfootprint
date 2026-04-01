/**
 * Messages slot — builds a subflow that prepares conversation history.
 *
 * Always a subflow because:
 *   - Config determines complexity: 1 stage (in-memory) or 3 stages (persistent)
 *   - Parent chart never changes when memory backend grows
 *   - BehindTheScenes drill-down shows exactly how messages were prepared
 *
 * Internal key convention:
 *   Input:  `currentMessages` — set by inputMapper from parent's `messages`
 *   Output: `MEMORY_PATHS.PREPARED_MESSAGES` — read by outputMapper, copied to parent's `messages`
 *   Output: `MEMORY_PATHS.STORED_HISTORY` — (persistent only) for CommitMemory reconstruction
 *
 * In-memory mode (no store):
 *   [ApplyStrategy]
 *
 * Persistent mode (with store):
 *   [LoadHistory → ApplyStrategy → TrackPrepared]
 */

import { flowChart } from 'footprintjs';
import type { FlowChart } from 'footprintjs';
import type { ScopeFacade } from 'footprintjs/advanced';
import type { MessageContext, MessageStrategy } from '../../../core';
import type { Message } from '../../../types/messages';
import type { ConversationStore } from '../../../adapters/memory/types';
import { MEMORY_PATHS } from '../../../scope/AgentScope';
import { findLastUserMessage, extractTextContent } from '../helpers';
import type { MessagesSlotConfig } from './types';

/** Internal key for messages passed in from parent via inputMapper. */
const INPUT_MESSAGES = 'currentMessages';
/** Internal key for loop count passed in from parent. */
const INPUT_LOOP_COUNT = 'loopCount';

/**
 * Build a MessageContext from scope state.
 */
function buildMessageContext(scope: ScopeFacade, messages: Message[]): MessageContext {
  const loopCount = (scope.getValue(INPUT_LOOP_COUNT) as number) ?? 0;

  const lastUserMsg = findLastUserMessage(messages);
  const message = lastUserMsg ? extractTextContent(lastUserMsg) : '';

  return {
    message,
    turnNumber: loopCount,
    loopIteration: loopCount,
    signal: scope.getEnv()?.signal,
  };
}

/**
 * Build the Messages slot subflow from config.
 *
 * Mount with:
 * ```typescript
 * builder.addSubFlowChartNext('sf-messages', buildMessagesSubflow(config), 'Messages', {
 *   inputMapper: (parent) => ({
 *     currentMessages: parent[AGENT_PATHS.MESSAGES] ?? [],
 *     loopCount: parent[AGENT_PATHS.LOOP_COUNT] ?? 0,
 *   }),
 *   outputMapper: (sfOutput) => ({
 *     [MEMORY_PATHS.PREPARED_MESSAGES]: sfOutput[MEMORY_PATHS.PREPARED_MESSAGES],
 *     [MEMORY_PATHS.STORED_HISTORY]: sfOutput[MEMORY_PATHS.STORED_HISTORY],
 *   }),
 * })
 * ```
 */
export function buildMessagesSubflow(config: MessagesSlotConfig): FlowChart {
  if (!config.strategy) {
    throw new Error('MessagesSlotConfig: strategy is required');
  }
  if (config.store && !config.conversationId) {
    throw new Error('MessagesSlotConfig: conversationId is required when store is provided');
  }

  if (config.store && config.conversationId) {
    return buildPersistentSubflow(config.strategy, config.store, config.conversationId);
  }
  return buildInMemorySubflow(config.strategy);
}

/**
 * In-memory mode: single stage that applies strategy to currentMessages.
 * Writes result to PREPARED_MESSAGES (outputMapper copies to parent's messages).
 */
function buildInMemorySubflow(strategy: MessageStrategy): FlowChart {
  return flowChart(
    'ApplyStrategy',
    async (scope: ScopeFacade) => {
      const messages = (scope.getValue(INPUT_MESSAGES) as Message[]) ?? [];
      const ctx = buildMessageContext(scope, messages);
      const prepared = await strategy.prepare(messages, ctx);
      scope.setValue(MEMORY_PATHS.PREPARED_MESSAGES, prepared);
    },
    'apply-strategy',
    undefined,
    'Apply message strategy to conversation history',
  ).build();
}

/**
 * Persistent mode: load from store → apply strategy → track for CommitMemory.
 * No non-null assertions — store and conversationId are guaranteed by caller.
 */
function buildPersistentSubflow(
  strategy: MessageStrategy,
  store: ConversationStore,
  conversationId: string,
): FlowChart {
  // Stage 1: Load stored history + merge with current turn messages
  const loadHistory = async (scope: ScopeFacade) => {
    const currentMessages = (scope.getValue(INPUT_MESSAGES) as Message[]) ?? [];

    const stored = (await store.load(conversationId)) ?? [];
    const merged = stored.length > 0
      ? [...stored, ...currentMessages]
      : currentMessages;

    // Track full merged history for CommitMemory reconstruction
    scope.setValue(MEMORY_PATHS.STORED_HISTORY, merged);
  };

  // Stage 2: Apply the message strategy (window, trim, summarize)
  const applyStrategy = async (scope: ScopeFacade) => {
    const merged = (scope.getValue(MEMORY_PATHS.STORED_HISTORY) as Message[]) ?? [];
    const ctx = buildMessageContext(scope, merged);
    const prepared = await strategy.prepare(merged, ctx);
    scope.setValue(MEMORY_PATHS.PREPARED_MESSAGES, prepared);
  };

  // Stage 3: Narrative checkpoint (values already in scope for CommitMemory)
  const trackPrepared = (scope: ScopeFacade) => {
    const stored = (scope.getValue(MEMORY_PATHS.STORED_HISTORY) as Message[]) ?? [];
    const prepared = (scope.getValue(MEMORY_PATHS.PREPARED_MESSAGES) as Message[]) ?? [];
    void stored.length;
    void prepared.length;
  };

  return flowChart('LoadHistory', loadHistory, 'load-history', undefined, 'Load conversation history from store')
    .addFunction('ApplyStrategy', applyStrategy, 'apply-strategy', 'Apply message strategy to history')
    .addFunction('TrackPrepared', trackPrepared, 'track-prepared', 'Track prepared messages for commit')
    .build();
}
