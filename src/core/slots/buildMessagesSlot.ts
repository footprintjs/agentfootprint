/**
 * Messages slot subflow builder
 *
 * Pattern: Builder (returns a FlowChart mountable via addSubFlowChartNext).
 * Role:    Layer-3 context engineering. Produces InjectionRecord[] from
 *          the current conversation history. For LLMCall, that's one
 *          user message. For Agent, it's user + assistant + tool-result
 *          messages accumulated over iterations.
 * Emits:   None directly; ContextRecorder sees the writes.
 *
 * Minimal scope for Phase 3e: pass-through of an input message history
 * array. Full MessageStrategy (windowing, summarizing) arrives in Phase 5.
 */

import { flowChart } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import { INJECTION_KEYS } from '../../conventions.js';
import type { ContextRecency, ContextRole } from '../../events/types.js';
import type { InjectionRecord } from '../../recorders/core/types.js';
import { COMPOSITION_KEYS } from '../../recorders/core/types.js';
import type { Injection } from '../../lib/injection-engine/types.js';
import { composeSlot, fnv1a, truncate } from './helpers.js';

/**
 * A single message supplied by the caller. Structurally matches the
 * LLMMessage adapter type but local-aliased to keep this file free of
 * adapter-layer coupling.
 */
export interface InputMessage {
  readonly role: ContextRole;
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
}

export interface MessagesSlotConfig {
  /** Budget cap (chars). Default: 10000. */
  readonly budgetCap?: number;
}

interface MessagesSubflowState {
  [k: string]: unknown;
}

/**
 * Build the Messages slot subflow.
 *
 * Mount with:
 *   builder.addSubFlowChartNext(SUBFLOW_IDS.MESSAGES, buildMessagesSlot(cfg), 'Messages', {
 *     inputMapper: (parent) => ({ messages: parent.messages, iteration: parent.iteration }),
 *     outputMapper: (sf) => ({ messagesInjections: sf.messagesInjections }),
 *   })
 */
export function buildMessagesSlot(config: MessagesSlotConfig = {}): FlowChart {
  const budgetCap = config.budgetCap ?? 10000;

  return flowChart<MessagesSubflowState>(
    'Compose',
    (scope: TypedScope<MessagesSubflowState>) => {
      const args = scope.$getArgs<{
        messages?: readonly InputMessage[];
        iteration?: number;
      }>();
      const messages = args.messages ?? [];
      const iteration = args.iteration ?? 1;

      const injections: InjectionRecord[] = messages.map((m, i) => ({
        contentSummary: truncate(m.content, 80),
        contentHash: fnv1a(`${m.role}:${i}:${m.content}`),
        slot: 'messages',
        source: inferSource(m.role),
        reason: `conversation history [${i}]`,
        rawContent: m.content,
        asRole: m.role,
        asRecency: (i === messages.length - 1 ? 'latest' : 'earlier') as ContextRecency,
        position: i,
        ...(m.toolCallId !== undefined && { sourceId: m.toolCallId }),
      }));

      // Active Injections targeting the messages slot. Used by `defineFact`
      // with `slot: 'messages'`, future RAG / Memory factories, etc.
      const activeInjections =
        (scope.$getValue('activeInjections') as readonly Injection[] | undefined) ?? [];
      let position = injections.length;
      for (const inj of activeInjections) {
        const injMessages = inj.inject.messages;
        if (!injMessages || injMessages.length === 0) continue;
        for (const msg of injMessages) {
          injections.push({
            contentSummary: truncate(msg.content, 80),
            contentHash: fnv1a(`msg:${inj.flavor}:${inj.id}:${position}:${msg.content}`),
            slot: 'messages',
            source: inj.flavor,
            sourceId: inj.id,
            reason:
              inj.description ?? `${inj.flavor} '${inj.id}' active (trigger: ${inj.trigger.kind})`,
            rawContent: msg.content,
            asRole: msg.role,
            asRecency: 'latest',
            position,
          });
          position++;
        }
      }

      scope.$setValue(INJECTION_KEYS.MESSAGES, injections);
      scope.$setValue(
        COMPOSITION_KEYS.SLOT_COMPOSED,
        composeSlot('messages', iteration, injections, budgetCap, 'history-order'),
      );
    },
    'compose',
    undefined,
    'Compose messages slot',
  ).build();
}

/**
 * Map a ROLE to a baseline source tag. These represent regular LLM-API
 * conversation flow — NOT context engineering:
 *
 *   - `user`      → source 'user' (the user's message, current or history replay)
 *   - `tool`      → source 'tool-result' (tool return, current or history replay)
 *   - `assistant` → source 'assistant' (prior LLM output replayed as history)
 *   - `system`    → source 'base' (static system-prompt content replayed)
 *
 * If a memory strategy / RAG retriever re-injects a message with
 * engineered intent, it must set its OWN source (`'memory'` / `'rag'`
 * / etc.) at the injection site — NOT rely on role inference here.
 * Role-based inference is the baseline fallback.
 */
function inferSource(role: ContextRole): InjectionRecord['source'] {
  switch (role) {
    case 'user':
      return 'user';
    case 'tool':
      return 'tool-result';
    case 'assistant':
      return 'assistant';
    case 'system':
      return 'base';
    default:
      return 'custom';
  }
}
