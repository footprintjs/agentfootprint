/**
 * Sample 17: Instructions — Conditional Context Injection
 *
 * Shows how defineInstruction() injects into all 3 LLM API positions
 * (system prompt, tools, tool-result recency window) based on Decision Scope.
 *
 * The decide() field bridges tool results to decision variables,
 * which activate/deactivate instructions on the next iteration.
 */
import { describe, it, expect, vi } from 'vitest';
import { Agent, defineInstruction, defineTool, AgentPattern } from '../../src';
import type { AgentInstruction, LLMResponse, ToolCall, Message } from '../../src';

// ── Mock provider ────────────────────────────────────────────

function mockProvider(responses: LLMResponse[]) {
  let i = 0;
  return {
    chat: vi.fn(async () => {
      const r = responses[i] ?? responses[responses.length - 1];
      i++;
      return r;
    }),
  };
}

// ── Tools ────────────────────────────────────────────────────

const lookupOrder = defineTool({
  id: 'lookup_order',
  description: 'Look up order by ID',
  inputSchema: { type: 'object', properties: { orderId: { type: 'string' } } },
  handler: async ({ orderId }) => ({
    content: JSON.stringify({ orderId, status: 'denied', amount: 5000 }),
  }),
});

const processRefund = defineTool({
  id: 'process_refund',
  description: 'Process a refund',
  inputSchema: { type: 'object', properties: { orderId: { type: 'string' } } },
  handler: async ({ orderId }) => ({
    content: JSON.stringify({ refundId: 'REF-001', orderId, status: 'processed' }),
  }),
});

// ── Instructions ─────────────────────────────────────────────

interface OrderDecision {
  orderStatus: 'pending' | 'denied' | null;
}

const classifyInstruction = defineInstruction<OrderDecision>({
  id: 'classify-order',
  onToolResult: [{
    id: 'classify',
    decide: (decision, ctx) => {
      const content = ctx.content as { status?: string };
      if (content?.status) {
        decision.orderStatus = content.status as 'denied';
      }
    },
  }],
});

const refundInstruction = defineInstruction<OrderDecision>({
  id: 'refund-handling',
  activeWhen: (d) => d.orderStatus === 'denied',
  prompt: 'Handle denied orders with empathy. Follow refund policy.',
  tools: [processRefund],
  onToolResult: [{ id: 'empathy', text: 'Do NOT promise reversal.' }],
});

// ── Tests ────────────────────────────────────────────────────

describe('Sample 17: Instructions', () => {
  it('unconditional instruction injects prompt', async () => {
    const provider = mockProvider([{ content: 'ok' }]);
    const always = defineInstruction({ id: 'always', prompt: 'Be professional.' });

    const agent = Agent.create({ provider })
      .system('Base prompt.')
      .instruction(always)
      .build();

    await agent.run('hello');
    const msgs = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as Message[];
    const sys = msgs.find((m) => m.role === 'system');
    expect(sys?.content).toContain('Base prompt.');
    expect(sys?.content).toContain('Be professional.');
  });

  it('conditional instruction only fires when decision matches', async () => {
    const provider = mockProvider([{ content: 'ok' }]);

    const agent = Agent.create({ provider })
      .system('Base.')
      .instruction(refundInstruction as AgentInstruction)
      .decision<OrderDecision>({ orderStatus: null })
      .build();

    await agent.run('check');
    const msgs = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as Message[];
    const sys = msgs.find((m) => m.role === 'system');
    // orderStatus is null → refund instruction should NOT fire
    expect(sys?.content).not.toContain('empathy');
  });

  it('decide() updates decision scope → activates instruction on next iteration', async () => {
    const tc: ToolCall = { id: 'tc-1', name: 'lookup_order', arguments: { orderId: 'ORD-1' } };
    const provider = mockProvider([
      { content: '', toolCalls: [tc] },
      { content: 'Order was denied. Let me help.' },
    ]);

    const agent = Agent.create({ provider })
      .system('Support agent.')
      .tool(lookupOrder)
      .instruction(classifyInstruction as AgentInstruction)
      .instruction(refundInstruction as AgentInstruction)
      .decision<OrderDecision>({ orderStatus: null })
      .pattern(AgentPattern.Dynamic)
      .build();

    const result = await agent.run('Check order ORD-1');
    expect(result.content).toContain('denied');

    // Decision scope should be updated
    const state = agent.getSnapshot()?.sharedState as Record<string, unknown>;
    expect(state.decision).toEqual({ orderStatus: 'denied' });

    // 2nd LLM call should have the refund prompt injected
    const calls = (provider.chat as ReturnType<typeof vi.fn>).mock.calls;
    const turn2Sys = (calls[1][0] as Message[]).find((m) => m.role === 'system');
    expect(turn2Sys?.content).toContain('Handle denied orders with empathy');
  });

  it('instruction tools are callable', async () => {
    const tc: ToolCall = { id: 'tc-1', name: 'process_refund', arguments: { orderId: 'ORD-1' } };
    const provider = mockProvider([
      { content: '', toolCalls: [tc] },
      { content: 'Refund processed.' },
    ]);

    const agent = Agent.create({ provider })
      .system('Help.')
      .instruction(refundInstruction as AgentInstruction)
      .decision<OrderDecision>({ orderStatus: 'denied' })
      .build();

    const result = await agent.run('refund');
    expect(result.content).toBe('Refund processed.');

    // Tool result should contain refund data
    const toolMsg = result.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('REF-001');
  });

  it('narrative shows matched instructions', async () => {
    const provider = mockProvider([{ content: 'ok' }]);

    const agent = Agent.create({ provider })
      .system('Help.')
      .instruction(defineInstruction({ id: 'a', prompt: 'A' }))
      .instruction(defineInstruction({ id: 'b', prompt: 'B' }))
      .build();

    await agent.run('hi');
    const state = agent.getSnapshot()?.sharedState as any;
    expect(state.matchedInstructions).toBe('2 matched: a, b');
  });
});
