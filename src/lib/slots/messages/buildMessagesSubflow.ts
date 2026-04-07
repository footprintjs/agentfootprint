/**
 * Messages slot — builds a subflow that prepares conversation history.
 *
 * Always a subflow because:
 *   - Config determines complexity: 1 stage (in-memory) or 3 stages (persistent)
 *   - Parent chart never changes when memory backend grows
 *   - BehindTheScenes drill-down shows exactly how messages were prepared
 *
 * State key convention (typed via MessagesSubflowState):
 *   Input:  `currentMessages` — set by inputMapper from parent's `messages`
 *   Output: `memory_preparedMessages` — read by outputMapper, copied to parent's `messages`
 *   Output: `memory_storedHistory` — (persistent only) for CommitMemory reconstruction
 *
 * In-memory mode (no store):
 *   [ApplyStrategy]
 *
 * Persistent mode (with store):
 *   [LoadHistory → ApplyStrategy → TrackPrepared]
 */

import { flowChart } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import type { MessageContext, MessageStrategy } from '../../../core';
import type { Message } from '../../../types/messages';
import type { ConversationStore } from '../../../adapters/memory/types';
import type { MessagesSubflowState } from '../../../scope/types';
import { findLastUserMessage, extractTextContent } from '../helpers';
import type { MessagesSlotConfig } from './types';

/**
 * Build a MessageContext from scope state.
 */
function buildMessageContext(
  scope: TypedScope<MessagesSubflowState>,
  messages: Message[],
): MessageContext {
  const loopCount = scope.loopCount ?? 0;

  const lastUserMsg = findLastUserMessage(messages);
  const message = lastUserMsg ? extractTextContent(lastUserMsg) : '';

  return {
    message,
    turnNumber: loopCount,
    loopIteration: loopCount,
    signal: scope.$getEnv()?.signal,
  };
}

/**
 * Build the Messages slot subflow from config.
 *
 * Mount with:
 * ```typescript
 * builder.addSubFlowChartNext('sf-messages', buildMessagesSubflow(config), 'Messages', {
 *   inputMapper: (parent) => ({
 *     currentMessages: parent.messages ?? [],
 *     loopCount: parent.loopCount ?? 0,
 *   }),
 *   outputMapper: (sfOutput) => ({
 *     memory_preparedMessages: sfOutput.memory_preparedMessages,
 *     memory_storedHistory: sfOutput.memory_storedHistory,
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
 * Writes result to memory_preparedMessages (outputMapper copies to parent's messages).
 */
function buildInMemorySubflow(strategy: MessageStrategy): FlowChart {
  return flowChart<MessagesSubflowState>(
    'ApplyStrategy',
    async (scope) => {
      const messages = scope.currentMessages ?? [];
      const ctx = buildMessageContext(scope, messages);
      const decision = await strategy.prepare(messages, ctx);
      scope.memory_preparedMessages = decision.value;
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
  return flowChart<MessagesSubflowState>(
    'LoadHistory',
    async (scope) => {
      // Stage 1: Load stored history + merge with current turn messages
      const currentMessages = scope.currentMessages ?? [];

      const stored = (await store.load(conversationId)) ?? [];
      const merged = stored.length > 0 ? [...stored, ...currentMessages] : currentMessages;

      // Track full merged history for CommitMemory reconstruction
      scope.memory_storedHistory = merged;
    },
    'load-history',
    undefined,
    'Load conversation history from store',
  )
    .addFunction(
      'ApplyStrategy',
      async (scope) => {
        // Stage 2: Apply the message strategy (window, trim, summarize)
        const merged = scope.memory_storedHistory ?? [];
        const ctx = buildMessageContext(scope, merged);
        const decision = await strategy.prepare(merged, ctx);
        scope.memory_preparedMessages = decision.value;
      },
      'apply-strategy',
      'Apply message strategy to history',
    )
    .addFunction(
      'TrackPrepared',
      (scope) => {
        // Stage 3: Narrative checkpoint (values already in scope for CommitMemory)
        const stored = scope.memory_storedHistory ?? [];
        const prepared = scope.memory_preparedMessages ?? [];
        void stored.length;
        void prepared.length;
      },
      'track-prepared',
      'Track prepared messages for commit',
    )
    .build();
}
