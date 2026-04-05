/**
 * decide() field on LLMInstruction — 5-pattern tests.
 *
 * Tests the Decision Scope mutation pipeline: tool returns result →
 * instruction matches → decide() mutates decision → next iteration
 * InstructionsToLLM reads updated decision → different instructions fire.
 *
 * Tiers:
 * - unit:     decide mutates decision object, decide skipped when instruction doesn't match
 * - boundary: decide throws → fail-open, decide with no other fields (decide-only instruction)
 * - scenario: multi-turn: decide sets orderStatus → refund instruction activates next iteration
 * - property: decide runs for both per-tool and agent-level instructions
 * - security: decide errors don't crash tool execution
 */

import { describe, it, expect, vi } from 'vitest';
import {
  Agent,
  defineInstruction,
  defineTool,
  AgentPattern,
} from '../../../src';
import type { LLMInstruction } from '../../../src';
import type { LLMResponse, Message, ToolCall } from '../../../src/types';

// ── Helpers ──────────────────────────────────────────────────

function mockProvider(responses: LLMResponse[]) {
  let callIndex = 0;
  return {
    chat: vi.fn(async () => {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return response;
    }),
  };
}

const lookupTool = defineTool({
  id: 'lookup_order',
  description: 'Look up an order',
  inputSchema: { type: 'object', properties: { orderId: { type: 'string' } } },
  handler: async ({ orderId }) => ({
    content: JSON.stringify({ orderId, status: 'denied', amount: 5000 }),
  }),
});

// ── Unit ───────────────────────────────────────────────────────

describe('decide field — unit', () => {
  it('decide mutates decision scope after tool execution', async () => {
    const decideSpy = vi.fn((decision: Record<string, unknown>, ctx: any) => {
      decision.orderStatus = ctx.content.status;
    });

    const classifyRule: LLMInstruction = {
      id: 'classify',
      decide: decideSpy,
    };

    const tc: ToolCall = { id: 'tc-1', name: 'lookup_order', arguments: { orderId: 'O-1' } };
    const provider = mockProvider([
      { content: '', toolCalls: [tc] },
      { content: 'Done.' },
    ]);

    const instr = defineInstruction({
      id: 'classifier',
      onToolResult: [classifyRule],
    });

    const agent = Agent.create({ provider })
      .system('You are helpful.')
      .tool(lookupTool)
      .instruction(instr)
      .decision({ orderStatus: null })
      .build();

    const result = await agent.run('check order O-1');
    expect(result.content).toBe('Done.');
    expect(decideSpy).toHaveBeenCalledOnce();

    // Verify decision was updated in scope
    const state = agent.getSnapshot()?.sharedState as Record<string, unknown>;
    expect(state.decision).toEqual({ orderStatus: 'denied' });
  });

  it('decide skipped when instruction when() does not match', async () => {
    const decideSpy = vi.fn();

    const rule: LLMInstruction = {
      id: 'only-errors',
      when: (ctx) => !!ctx.error,
      decide: decideSpy,
    };

    const tc: ToolCall = { id: 'tc-1', name: 'lookup_order', arguments: { orderId: 'O-1' } };
    const provider = mockProvider([
      { content: '', toolCalls: [tc] },
      { content: 'Done.' },
    ]);

    const agent = Agent.create({ provider })
      .system('Help.')
      .tool(lookupTool)
      .instruction(defineInstruction({ id: 'i', onToolResult: [rule] }))
      .decision({ status: null })
      .build();

    await agent.run('check');
    expect(decideSpy).not.toHaveBeenCalled();
  });
});

// ── Boundary ──────────────────────────────────────────────────

describe('decide field — boundary', () => {
  it('decide throws → fail-open, tool execution continues', async () => {
    const rule: LLMInstruction = {
      id: 'broken-decide',
      decide: () => { throw new Error('decide bug'); },
    };

    const tc: ToolCall = { id: 'tc-1', name: 'lookup_order', arguments: { orderId: 'O-1' } };
    const provider = mockProvider([
      { content: '', toolCalls: [tc] },
      { content: 'Still works.' },
    ]);

    const agent = Agent.create({ provider })
      .system('Help.')
      .tool(lookupTool)
      .instruction(defineInstruction({ id: 'i', onToolResult: [rule] }))
      .decision({ status: null })
      .build();

    // Should NOT throw — decide error is swallowed
    const result = await agent.run('check');
    expect(result.content).toBe('Still works.');
  });

  it('decide-only instruction (no text, no followUp) still runs decide', async () => {
    const decideSpy = vi.fn((d: Record<string, unknown>, ctx: any) => {
      d.processed = true;
    });

    const rule: LLMInstruction = { id: 'decide-only', decide: decideSpy };
    const tc: ToolCall = { id: 'tc-1', name: 'lookup_order', arguments: {} };
    const provider = mockProvider([
      { content: '', toolCalls: [tc] },
      { content: 'ok' },
    ]);

    const agent = Agent.create({ provider })
      .system('Help.')
      .tool(lookupTool)
      .instruction(defineInstruction({ id: 'i', onToolResult: [rule] }))
      .decision({})
      .build();

    await agent.run('go');
    expect(decideSpy).toHaveBeenCalledOnce();
    const state = agent.getSnapshot()?.sharedState as any;
    expect(state.decision.processed).toBe(true);
  });
});

// ── Scenario: Multi-turn decision-driven activation ───────────

describe('decide field — multi-turn scenario', () => {
  it('decide sets orderStatus → refund instruction activates on next iteration (Dynamic)', async () => {
    // Turn 1: lookup_order returns denied → decide sets orderStatus = 'denied'
    // Turn 2: InstructionsToLLM re-evaluates → refund instruction activates → empathy prompt injected
    const classifyRule: LLMInstruction = {
      id: 'classify',
      decide: (decision, ctx) => {
        decision.orderStatus = (ctx.content as any).status;
      },
    };

    const refundInstruction = defineInstruction({
      id: 'refund-handling',
      activeWhen: (d: any) => d.orderStatus === 'denied',
      prompt: 'Be empathetic. Follow refund policy.',
    });

    const classifyInstruction = defineInstruction({
      id: 'classifier',
      onToolResult: [classifyRule],
    });

    const tc: ToolCall = { id: 'tc-1', name: 'lookup_order', arguments: { orderId: 'O-1' } };
    const provider = mockProvider([
      { content: '', toolCalls: [tc] },     // Turn 1: call lookup_order
      { content: 'I see your order was denied. Let me help with a refund.' }, // Turn 2: final
    ]);

    const agent = Agent.create({ provider })
      .system('You are a support agent.')
      .tool(lookupTool)
      .instruction(classifyInstruction)
      .instruction(refundInstruction)
      .decision({ orderStatus: null })
      .pattern(AgentPattern.Dynamic)
      .build();

    const result = await agent.run('check order O-1');

    // Verify: 2 LLM calls (1st returns tool_use, 2nd is final)
    const calls = (provider.chat as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2);

    // Decision scope should reflect the decide() update
    const state = agent.getSnapshot()?.sharedState as any;
    expect(state.decision.orderStatus).toBe('denied');

    // The 2nd LLM call should have the refund prompt injected into system message
    // (Dynamic pattern re-evaluates InstructionsToLLM → refund-handling now matches)
    const turn2Msgs = calls[1][0] as Message[];
    const systemMsg = turn2Msgs.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('Be empathetic. Follow refund policy.');
  });
});

// ── Per-tool instructions with decide ─────────────────────────

describe('decide field — per-tool instructions', () => {
  it('decide on tool-level (co-located) instruction also updates decision', async () => {
    const toolWithDecide = defineTool({
      id: 'check_inventory',
      description: 'Check inventory',
      inputSchema: { type: 'object' },
      handler: async () => ({ content: JSON.stringify({ inStock: false }) }),
      instructions: [
        {
          id: 'stock-check',
          decide: (decision: Record<string, unknown>, ctx: any) => {
            decision.outOfStock = !(ctx.content as any).inStock;
          },
          text: 'Item checked.',
        },
      ],
    } as any);

    const tc: ToolCall = { id: 'tc-1', name: 'check_inventory', arguments: {} };
    const provider = mockProvider([
      { content: '', toolCalls: [tc] },
      { content: 'Out of stock.' },
    ]);

    const agent = Agent.create({ provider })
      .system('Help.')
      .tool(toolWithDecide)
      .instruction(defineInstruction({ id: 'placeholder' }))
      .decision({ outOfStock: false })
      .build();

    await agent.run('check');
    const state = agent.getSnapshot()?.sharedState as any;
    expect(state.decision.outOfStock).toBe(true);
  });
});
