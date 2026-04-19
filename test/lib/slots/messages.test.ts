/**
 * Tests for the Messages slot subflow.
 *
 * The slot applies a single `MessageStrategy` (sliding window, summary,
 * composite, etc.) to trim / reshape history before the LLM call.
 * Durable persistence across runs is owned by the memory pipeline
 * (`agentfootprint/memory`) — NOT this slot.
 *
 * Tiers:
 * - unit:     strategy is applied
 * - boundary: empty history, system messages preserved by sliding window
 * - scenario: sliding window trims to cap
 * - property: strategy always receives the full input history
 * - security: missing strategy / throwing strategy surface cleanly
 */

import { describe, it, expect, vi } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { buildMessagesSubflow } from '../../../src/lib/slots/messages';
import { slidingWindow } from '../../../src/providers/messages/slidingWindow';
import type { MessageStrategy } from '../../../src/core/providers';
import type { Message } from '../../../src/types/messages';
import type { MessagesSlotConfig } from '../../../src/lib/slots/messages/types';
import type { MessagesSubflowState } from '../../../src/scope/types';

// ── Helpers ──────────────────────────────────────────────────

const user = (text: string): Message => ({ role: 'user', content: text });
const assistant = (text: string): Message => ({ role: 'assistant', content: text });
const system = (text: string): Message => ({ role: 'system', content: text });

const fullHistory: MessageStrategy = { prepare: (history) => ({ value: history, chosen: 'test' }) };

async function runSubflow(
  config: MessagesSlotConfig,
  currentMessages: Message[] = [user('hello')],
): Promise<Record<string, unknown>> {
  const subflow = buildMessagesSubflow(config);

  const wrapper = flowChart<MessagesSubflowState>(
    'Seed',
    (scope) => {
      scope.currentMessages = currentMessages;
      scope.loopCount = 0;
    },
    'test-seed',
  )
    .addSubFlowChartNext('sf-messages', subflow, 'Messages', {
      inputMapper: (parent: Record<string, unknown>) => ({
        currentMessages: (parent.currentMessages as Message[]) ?? [],
        loopCount: (parent.loopCount as number) ?? 0,
      }),
      outputMapper: (sfOutput: Record<string, unknown>) => ({
        memory_preparedMessages: sfOutput.memory_preparedMessages,
      }),
    })
    .addFunction(
      'ApplyPreparedMessages',
      (scope) => {
        const prepared = scope.memory_preparedMessages;
        if (prepared) scope.currentMessages = prepared;
      },
      'apply-prepared-messages',
    )
    .build();

  const executor = new FlowChartExecutor(wrapper);
  await executor.run();
  return executor.getSnapshot()?.sharedState ?? {};
}

// ── Unit ─────────────────────────────────────────────────────

describe('Messages slot — unit', () => {
  it('applies the configured strategy to the current messages', async () => {
    const state = await runSubflow({ strategy: slidingWindow({ maxMessages: 2 }) }, [
      user('a'),
      assistant('b'),
      user('c'),
      assistant('d'),
      user('e'),
    ]);
    const messages = state.currentMessages as Message[];
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('d');
    expect(messages[1].content).toBe('e');
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('Messages slot — boundary', () => {
  it('handles empty message history', async () => {
    const state = await runSubflow({ strategy: fullHistory }, []);
    const messages = state.currentMessages as Message[];
    expect(messages).toHaveLength(0);
  });

  it('preserves system messages through sliding window', async () => {
    const state = await runSubflow({ strategy: slidingWindow({ maxMessages: 2 }) }, [
      system('sys'),
      user('a'),
      assistant('b'),
      user('c'),
      assistant('d'),
      user('e'),
    ]);
    const messages = state.currentMessages as Message[];
    expect(messages[0].role).toBe('system');
    expect(messages).toHaveLength(3); // system + 2 most recent
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('Messages slot — scenario', () => {
  it('sliding window trims to configured cap', async () => {
    const state = await runSubflow({ strategy: slidingWindow({ maxMessages: 3 }) }, [
      user('a'),
      assistant('b'),
      user('c'),
      assistant('d'),
      user('e'),
    ]);
    const messages = state.currentMessages as Message[];
    expect(messages).toHaveLength(3);
    expect(messages.map((m) => m.content)).toEqual(['c', 'd', 'e']);
  });
});

// ── Property ────────────────────────────────────────────────

describe('Messages slot — property', () => {
  it('output messages is always an array', async () => {
    const state = await runSubflow({ strategy: fullHistory }, []);
    expect(Array.isArray(state.currentMessages)).toBe(true);
  });

  it('strategy receives the full input history before trimming', async () => {
    const spy = vi.fn((history: Message[]) => ({ value: history, chosen: 'test' }));
    const strategy: MessageStrategy = { prepare: spy };
    const msgs = [user('a'), user('b'), user('c')];

    await runSubflow({ strategy }, msgs);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toHaveLength(3);
  });
});

// ── Security ────────────────────────────────────────────────

describe('Messages slot — security', () => {
  it('throws at build time when strategy is missing', () => {
    expect(() => buildMessagesSubflow({ strategy: undefined as never })).toThrow(
      'strategy is required',
    );
  });

  it('strategy.prepare() throwing propagates as error', async () => {
    const failStrategy: MessageStrategy = {
      prepare: () => {
        throw new Error('strategy crashed');
      },
    } as never;
    await expect(runSubflow({ strategy: failStrategy }, [user('hi')])).rejects.toThrow(
      'strategy crashed',
    );
  });
});
