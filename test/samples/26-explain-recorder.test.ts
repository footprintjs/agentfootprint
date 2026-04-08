/**
 * Sample 26: ExplainRecorder — Collect Grounding Evidence During Traversal
 *
 * ExplainRecorder captures sources (tool results), claims (LLM responses),
 * and decisions (tool calls) as they happen. No post-processing.
 *
 * Core principle: collect during traversal, never post-process.
 */
import { describe, it, expect } from 'vitest';
import { Agent, mock, defineTool } from '../../src/test-barrel';
import { ExplainRecorder } from '../../src/recorders/ExplainRecorder';

const lookupOrder = defineTool({
  id: 'lookup_order',
  description: 'Look up an order',
  inputSchema: {
    type: 'object',
    properties: { orderId: { type: 'string' } },
    required: ['orderId'],
  },
  handler: async ({ orderId }: { orderId: string }) => ({
    content: JSON.stringify({ orderId, status: 'shipped', amount: 299 }),
  }),
});

describe('Sample 26: ExplainRecorder', () => {
  it('captures sources, claims, and decisions from tool-using agent', async () => {
    const explain = new ExplainRecorder();

    const agent = Agent.create({
      provider: mock([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'lookup_order', arguments: { orderId: 'ORD-1003' } }],
        },
        { content: 'Your order ORD-1003 has shipped. Total: $299.' },
      ]),
    })
      .system('You are a support agent.')
      .tool(lookupOrder)
      .recorder(explain)
      .build();

    await agent.run('Check order ORD-1003');

    // Sources = tool results (ground truth)
    const sources = explain.getSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].toolName).toBe('lookup_order');
    expect(sources[0].result).toContain('shipped');

    // Claims = LLM responses (to verify)
    const claims = explain.getClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0].content).toContain('shipped');

    // Decisions = tool calls the LLM made
    const decisions = explain.getDecisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0].toolName).toBe('lookup_order');
    expect(decisions[0].args).toEqual({ orderId: 'ORD-1003' });
  });

  it('explain() returns structured summary', async () => {
    const explain = new ExplainRecorder();

    const agent = Agent.create({
      provider: mock([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'lookup_order', arguments: { orderId: 'ORD-1' } }],
        },
        { content: 'Shipped!' },
      ]),
    })
      .tool(lookupOrder)
      .recorder(explain)
      .build();

    await agent.run('Check ORD-1');

    const explanation = explain.explain();
    expect(explanation.sources).toHaveLength(1);
    expect(explanation.claims).toHaveLength(1);
    expect(explanation.decisions).toHaveLength(1);
    expect(explanation.summary).toContain('lookup_order');
    expect(explanation.summary).toContain('1 call');
  });

  it('agent with no tool calls — summary says "without calling tools"', async () => {
    const explain = new ExplainRecorder();

    const agent = Agent.create({
      provider: mock([{ content: 'Hello!' }]),
    })
      .recorder(explain)
      .build();

    await agent.run('Hi');

    expect(explain.getSources()).toHaveLength(0);
    expect(explain.getClaims()).toHaveLength(1);
    expect(explain.explain().summary).toContain('without calling tools');
  });

  it('clear() resets all state', async () => {
    const explain = new ExplainRecorder();

    const agent = Agent.create({
      provider: mock([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'lookup_order', arguments: { orderId: 'ORD-1' } }],
        },
        { content: 'Done' },
      ]),
    })
      .tool(lookupOrder)
      .recorder(explain)
      .build();

    await agent.run('Check');
    expect(explain.getSources()).toHaveLength(1);

    explain.clear();
    expect(explain.getSources()).toHaveLength(0);
    expect(explain.getClaims()).toHaveLength(0);
    expect(explain.getDecisions()).toHaveLength(0);
  });

  it('args are shallow-cloned (mutation safe)', async () => {
    const explain = new ExplainRecorder();

    const agent = Agent.create({
      provider: mock([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'lookup_order', arguments: { orderId: 'ORD-1' } }],
        },
        { content: 'Done' },
      ]),
    })
      .tool(lookupOrder)
      .recorder(explain)
      .build();

    await agent.run('Check');

    const args = explain.getDecisions()[0].args;
    // Mutating the returned args should not affect the recorder's copy
    (args as any).orderId = 'MUTATED';
    expect(explain.getDecisions()[0].args.orderId).toBe('ORD-1');
  });
});
