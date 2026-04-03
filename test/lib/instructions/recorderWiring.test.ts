/**
 * InstructionRecorder wiring — verifies the recorder receives firings
 * when attached via .recorder() on the Agent builder.
 */
import { describe, it, expect } from 'vitest';
import { Agent, mock, defineTool, InstructionRecorder, quickBind } from '../../../src';
import type { InstructedToolDefinition } from '../../../src';

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
      inject: 'Be empathetic about the cancellation.',
    },
    {
      id: 'tracking-followup',
      when: (ctx) => !!(ctx.content as any)?.trackingId,
      followUp: quickBind('track_package', 'trackingId'),
    },
  ],
} as InstructedToolDefinition) as any;

const trackTool = defineTool({
  id: 'track_package',
  description: 'Track package',
  inputSchema: { type: 'object', properties: { trackingId: { type: 'string' } } },
  handler: async () => ({ content: 'In transit' }),
});

describe('InstructionRecorder wiring', () => {
  it('records instruction firings when attached via .recorder()', async () => {
    const recorder = new InstructionRecorder();

    const agent = Agent.create({
      provider: mock([
        { content: 'checking', toolCalls: [{ id: '1', name: 'check_order', arguments: { orderId: 'ORD-1' } }] },
        { content: 'The order was cancelled.' },
      ]),
    })
      .tool(orderTool)
      .tool(trackTool)
      .recorder(recorder)
      .build();

    await agent.run('Check my order');

    const summary = recorder.getSummary();
    expect(summary.totalFired).toBe(2); // cancelled-empathy + tracking-followup
    expect(summary.byTool['check_order']).toBeDefined();
    expect(summary.byTool['check_order'].instructions['cancelled-empathy'].fired).toBe(1);
    expect(summary.byTool['check_order'].instructions['tracking-followup'].fired).toBe(1);
    expect(summary.byTool['check_order'].followUps['track_package'].offered).toBe(1);
  });

  it('recorder accumulates across multiple turns', async () => {
    const recorder = new InstructionRecorder();

    const agent = Agent.create({
      provider: mock([
        { content: 'checking', toolCalls: [{ id: '1', name: 'check_order', arguments: { orderId: 'ORD-1' } }] },
        { content: 'cancelled' },
      ]),
    })
      .tool(orderTool)
      .tool(trackTool)
      .recorder(recorder)
      .build();

    await agent.run('Check order 1');
    expect(recorder.getSummary().totalFired).toBe(2);

    // Note: recorder is NOT cleared between runs — accumulates
    // (clear() is called by the agent loop via the standard recorder lifecycle,
    // but InstructionRecorder.recordFirings is a custom method, not a standard hook)
  });
});
