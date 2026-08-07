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
 * ── What this slot is, and is not ───────────────────────────────────
 * It is the OBSERVABILITY PROJECTION of the conversation: one
 * InjectionRecord per message, with the source, reason, role and
 * recency a consumer needs to see what the turn was made of. It is not
 * the wire. The request's message list comes from `scope.history`
 * directly (`stages/callLLM.ts`), because the projection flattens away
 * the LLM-protocol shape a provider needs — an assistant turn's
 * `toolCalls[]`, a tool turn's `toolCallId`.
 *
 * Nothing enters the conversation HERE, and that is the point. Two stages
 * upstream edit `scope.history` before this one reads it: the window
 * strategy takes messages out (`stages/window.ts`, 7.16–7.17) and the
 * delivery stage lets declared ones in (`stages/deliver.ts`, 7.21). Both run
 * at the loop head, before the slots, so the projection and the wire always
 * describe the same past.
 *
 * That is why this file no longer walks `activeInjections` looking for
 * `inject.messages`. Until 7.19.1 it did, and it produced a record — an
 * emitted `context.injected` — for content the request never carried, which
 * is the exact bug the wire-truth test now guards. A delivered injection is
 * IN the window by the time this runs, so it is projected like any other
 * message and attributed to its injection by the `injectedBy` marker the
 * delivery stage stamped. One wire message, one record, one name.
 */

import { flowChart } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import { INJECTION_KEYS } from '../../conventions.js';
import type { ContextRecency, ContextRole, ContextSource } from '../../events/types.js';
import type { InjectionRecord } from '../../recorders/core/types.js';
import { COMPOSITION_KEYS } from '../../recorders/core/types.js';
import { composeSlot, fnv1a, formatOverflowWarning, slotOverflow, truncate } from './helpers.js';

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
  /** Set by the delivery stage on a message an Injection put here — the
   *  marker this slot attributes by. Mirrors `LLMMessage.injectedBy`. */
  readonly injectedBy?: {
    readonly injectionId: string;
    readonly flavor: ContextSource;
    readonly reason?: string;
    readonly iteration: number;
  };
}

export interface MessagesSlotConfig {
  /** Budget cap (chars). Default: 10000. Set from the public door as
   *  `contextBudget.messages` on `AgentOptions` / `LLMCallOptions`. */
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
  // Dedup latch for the human-facing overflow warning (see buildToolsSlot).
  let warnedOverflow = false;

  return flowChart<MessagesSubflowState>(
    'Compose',
    (scope: TypedScope<MessagesSubflowState>) => {
      const args = scope.$getArgs<{
        messages?: readonly InputMessage[];
        iteration?: number;
      }>();
      const messages = args.messages ?? [];
      const iteration = args.iteration ?? 1;

      // ONE record per message on the wire. Every message in the window gets
      // exactly one, and the only question is who to credit: a message the
      // Deliver stage let in carries `injectedBy`, so it is attributed to its
      // injection (flavor / id / description); everything else is baseline
      // conversation flow, attributed by role.
      //
      // The content hash is the SAME formula for both, deliberately. The
      // window stage reports an eviction under `${role}:${index}:${content}`,
      // so an injected message and the eviction that later removes it name
      // one piece of context by one name — which they would not if a
      // delivered message got its own hash scheme.
      const injections: InjectionRecord[] = messages.map((m, i) => {
        const by = m.injectedBy;
        return {
          contentSummary: truncate(m.content, 80),
          contentHash: fnv1a(`${m.role}:${i}:${m.content}`),
          slot: 'messages',
          source: by ? by.flavor : inferSource(m.role),
          reason: by
            ? by.reason ?? `${by.flavor} '${by.injectionId}' delivered at iteration ${by.iteration}`
            : `conversation history [${i}]`,
          rawContent: m.content,
          asRole: m.role,
          asRecency: (i === messages.length - 1 ? 'latest' : 'earlier') as ContextRecency,
          position: i,
          ...(by !== undefined && { sourceId: by.injectionId }),
          ...(by === undefined && m.toolCallId !== undefined && { sourceId: m.toolCallId }),
        };
      });

      scope.$setValue(INJECTION_KEYS.MESSAGES, injections);
      const composition = composeSlot(
        'messages',
        iteration,
        injections,
        budgetCap,
        'history-order',
      );
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
              itemNoun: 'message',
              contentNoun: 'messages',
              remedy:
                'Raise contextBudget.messages on the agent, or trim the conversation history.',
            }),
          );
        }
      }
    },
    'compose',
    { description: 'Compose messages slot' },
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
