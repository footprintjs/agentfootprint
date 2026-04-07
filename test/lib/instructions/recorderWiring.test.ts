/**
 * InstructionRecorder wiring — 5-pattern tests.
 *
 * Verifies the recorder receives firings when attached via .recorder()
 * on the Agent builder, through the onInstructionsFired callback chain.
 */
import { describe, it, expect } from 'vitest';
import { Agent, mock, defineTool, InstructionRecorder, quickBind } from '../../../src/test-barrel';
import type { InstructedToolDefinition } from '../../../src/test-barrel';

const orderTool = defineTool({
  id: 'check_order',
  description: 'Check order status',
  inputSchema: { type: 'object', properties: { orderId: { type: 'string' } } },
  handler: async () => ({
    content: JSON.stringify({ status: 'cancelled', orderId: 'ORD-1', trackingId: 'TRK-1' }),
  }),
  instructions: [
    {
      id: 'cancelled-empathy',
      when: (ctx) => (ctx.content as any)?.status === 'cancelled',
      text: 'Be empathetic about the cancellation.',
    },
    {
      id: 'tracking-followup',
      when: (ctx) => !!(ctx.content as any)?.trackingId,
      followUp: quickBind('track_package', 'trackingId'),
    },
  ],
} as InstructedToolDefinition) as any;

const activeTool = defineTool({
  id: 'check_active',
  description: 'Check active order',
  inputSchema: { type: 'object' },
  handler: async () => ({
    content: JSON.stringify({ status: 'active', orderId: 'ORD-2' }),
  }),
  instructions: [
    {
      id: 'cancelled-empathy',
      when: (ctx) => (ctx.content as any)?.status === 'cancelled',
      text: 'Be empathetic.',
    },
  ],
} as InstructedToolDefinition) as any;

const trackTool = defineTool({
  id: 'track_package',
  description: 'Track package',
  inputSchema: { type: 'object', properties: { trackingId: { type: 'string' } } },
  handler: async () => ({ content: 'In transit' }),
});

// ── Unit ────────────────────────────────────────────────────

describe('InstructionRecorder wiring — unit', () => {
  it('records instruction firings when attached via .recorder()', async () => {
    const recorder = new InstructionRecorder();

    const agent = Agent.create({
      provider: mock([
        {
          content: 'checking',
          toolCalls: [{ id: '1', name: 'check_order', arguments: { orderId: 'ORD-1' } }],
        },
        { content: 'The order was cancelled.' },
      ]),
    })
      .tool(orderTool)
      .tool(trackTool)
      .recorder(recorder)
      .build();

    await agent.run('Check my order');

    const summary = recorder.getSummary();
    expect(summary.totalFired).toBe(2);
    expect(summary.byTool['check_order'].instructions['cancelled-empathy'].fired).toBe(1);
    expect(summary.byTool['check_order'].instructions['tracking-followup'].fired).toBe(1);
    expect(summary.byTool['check_order'].followUps['track_package'].offered).toBe(1);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('InstructionRecorder wiring — boundary', () => {
  it('no firings when no instructions match', async () => {
    const recorder = new InstructionRecorder();

    const agent = Agent.create({
      provider: mock([
        { content: 'checking', toolCalls: [{ id: '1', name: 'check_active', arguments: {} }] },
        { content: 'active' },
      ]),
    })
      .tool(activeTool)
      .recorder(recorder)
      .build();

    await agent.run('Check active order');

    // cancelled-empathy instruction exists but status is 'active' — no match
    expect(recorder.getSummary().totalFired).toBe(0);
  });

  it('works without InstructionRecorder (no error)', async () => {
    // Agent with no InstructionRecorder attached — callback still runs, just finds nothing
    const agent = Agent.create({
      provider: mock([
        { content: 'checking', toolCalls: [{ id: '1', name: 'check_order', arguments: {} }] },
        { content: 'done' },
      ]),
    })
      .tool(orderTool)
      .tool(trackTool)
      .build();

    // Should not throw
    const result = await agent.run('test');
    expect(result.content).toBe('done');
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('InstructionRecorder wiring — scenario', () => {
  it('tracks firings across multiple tool calls in same turn', async () => {
    const recorder = new InstructionRecorder();

    const agent = Agent.create({
      provider: mock([
        // LLM calls two tools in sequence
        { content: 'checking order', toolCalls: [{ id: '1', name: 'check_order', arguments: {} }] },
        {
          content: 'checking active',
          toolCalls: [{ id: '2', name: 'check_active', arguments: {} }],
        },
        { content: 'done' },
      ]),
    })
      .tool(orderTool)
      .tool(activeTool)
      .tool(trackTool)
      .recorder(recorder)
      .build();

    await agent.run('Check both orders');

    const summary = recorder.getSummary();
    // check_order fires 2 instructions (cancelled + tracking)
    // check_active fires 0 (status is active, not cancelled)
    expect(summary.totalFired).toBe(2);
    expect(summary.byTool['check_order']).toBeDefined();
    expect(summary.byTool['check_active']).toBeUndefined(); // no firings
  });
});

// ── Property ────────────────────────────────────────────────

describe('InstructionRecorder wiring — property', () => {
  it('safety flag propagates through the wiring', async () => {
    const safetyTool = defineTool({
      id: 'check_pii',
      description: 'Check for PII',
      inputSchema: { type: 'object' },
      handler: async () => ({ content: JSON.stringify({ hasPII: true }) }),
      instructions: [{ id: 'pii-guard', when: () => true, text: 'Contains PII.', safety: true }],
    } as InstructedToolDefinition) as any;

    const recorder = new InstructionRecorder();
    const agent = Agent.create({
      provider: mock([
        { content: 'checking', toolCalls: [{ id: '1', name: 'check_pii', arguments: {} }] },
        { content: 'done' },
      ]),
    })
      .tool(safetyTool)
      .recorder(recorder)
      .build();

    await agent.run('test');

    const summary = recorder.getSummary();
    expect(summary.byTool['check_pii'].instructions['pii-guard'].safety).toBe(true);
  });
});

// ── Security ────────────────────────────────────────────────

describe('InstructionRecorder wiring — security', () => {
  it('recorder does not store inject text — only IDs and counts', async () => {
    const recorder = new InstructionRecorder();

    const agent = Agent.create({
      provider: mock([
        { content: 'checking', toolCalls: [{ id: '1', name: 'check_order', arguments: {} }] },
        { content: 'done' },
      ]),
    })
      .tool(orderTool)
      .tool(trackTool)
      .recorder(recorder)
      .build();

    await agent.run('test');

    const summary = recorder.getSummary();
    const instrData = summary.byTool['check_order'].instructions['cancelled-empathy'];
    // Only fired count + safety flag — no inject text
    expect(instrData).toEqual({ fired: 1, safety: false });
    expect((instrData as any).inject).toBeUndefined();
  });
});
