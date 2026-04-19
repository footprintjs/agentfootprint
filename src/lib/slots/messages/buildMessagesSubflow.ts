/**
 * Messages slot — builds a subflow that prepares conversation history.
 *
 * Always a subflow so BehindTheScenes drill-down shows exactly how
 * messages were reshaped (windowed, summarized, composited) before the
 * LLM call. Single stage:
 *
 *   [ApplyStrategy]
 *
 * Durable persistence across turns is handled by the memory pipeline
 * (`agentfootprint/memory`), NOT this slot.
 *
 * State key convention (typed via MessagesSubflowState):
 *   Input:  `currentMessages` — set by inputMapper from parent's `messages`
 *   Output: `memory_preparedMessages` — read by outputMapper, copied to parent's `messages`
 */

import { flowChart } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import type { MessageContext, MessageStrategy } from '../../../core';
import type { Message } from '../../../types/messages';
import type { MessagesSubflowState } from '../../../scope/types';
import { findLastUserMessage, extractTextContent } from '../helpers';
import type { MessagesSlotConfig } from './types';

/** Build a MessageContext from scope state. */
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
 *     messages: sfOutput.memory_preparedMessages,
 *     memory_preparedMessages: sfOutput.memory_preparedMessages,
 *   }),
 * })
 * ```
 */
export function buildMessagesSubflow(config: MessagesSlotConfig): FlowChart {
  if (!config.strategy) {
    throw new Error('MessagesSlotConfig: strategy is required');
  }
  return buildStrategyOnlySubflow(config.strategy);
}

/**
 * Single stage that applies strategy to currentMessages. Result lands
 * on `memory_preparedMessages` (outputMapper copies to parent's messages).
 */
function buildStrategyOnlySubflow(strategy: MessageStrategy): FlowChart {
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
