/**
 * Instruction integration — 5-pattern tests.
 *
 * End-to-end: agent with tools that have instructions → instructions
 * appear in tool result messages → LLM sees guidance in recency window.
 */
import { describe, it, expect } from 'vitest';
import { Agent, mock, defineTool, quickBind } from '../../../src';
import type { LLMInstruction, InstructedToolDefinition } from '../../../src';

// ── Tools with instructions ─────────────────────────────────────

const orderTool = defineTool({
  id: 'check_order',
  description: 'Check order status',
  inputSchema: { type: 'object', properties: { orderId: { type: 'string' } } },
  handler: async ({ orderId }) => {
    if (orderId === 'cancelled') {
      return { content: JSON.stringify({ status: 'cancelled', orderId }) };
    }
    if (orderId === 'shipped') {
      return { content: JSON.stringify({ status: 'shipped', orderId, trackingId: 'PKG_123' }) };
    }
    return { content: JSON.stringify({ status: 'active', orderId }) };
  },
  instructions: [
    {
      id: 'cancelled',
      when: (ctx) => (ctx.content as any)?.status === 'cancelled',
      text: 'Order is cancelled. Be empathetic. Offer alternatives.',
    },
    {
      id: 'shipped',
      when: (ctx) => (ctx.content as any)?.status === 'shipped',
      text: 'Order shipped.',
      followUp: quickBind('track_package', 'trackingId', {
        description: 'Track package delivery',
        condition: 'User asks about delivery status',
      }),
    },
  ],
} as InstructedToolDefinition) as any;

const trackTool = defineTool({
  id: 'track_package',
  description: 'Track a package',
  inputSchema: { type: 'object', properties: { trackingId: { type: 'string' } } },
  handler: async ({ trackingId }) => ({ content: `Package ${trackingId}: In transit` }),
});

// Tool with runtime instructions
const runtimeTool = defineTool({
  id: 'check_service',
  description: 'Check service status',
  inputSchema: { type: 'object' },
  handler: async () => ({
    content: JSON.stringify({ status: 'degraded' }),
    instructions: ['Service is degraded. Set user expectations.'],
    followUps: [{
      toolId: 'status_page',
      params: { region: 'us' },
      description: 'Check service status page',
      condition: 'User asks for more details about the outage',
    }],
  }),
});

const statusTool = defineTool({
  id: 'status_page',
  description: 'Get service status page',
  inputSchema: { type: 'object', properties: { region: { type: 'string' } } },
  handler: async () => ({ content: 'All systems operational in us-east-1' }),
});

// ── Unit ────────────────────────────────────────────────────────

describe('Instruction integration — unit', () => {
  it('instruction text appears in tool result when predicate matches', async () => {
    const agent = Agent.create({
      provider: mock([
        {
          content: 'Let me check that order.',
          toolCalls: [{ id: 'tc1', name: 'check_order', arguments: { orderId: 'cancelled' } }],
        },
        { content: 'I see the order was cancelled.' },
      ]),
    })
      .tool(orderTool)
      .tool(trackTool)
      .build();

    const result = await agent.run('Check order cancelled');

    // The LLM's final response should reflect the instruction guidance
    // (mock doesn't actually follow instructions, but we can verify the
    // instruction was injected into the message history)
    const toolMessages = result.messages.filter((m: any) => m.role === 'tool');
    expect(toolMessages.length).toBeGreaterThanOrEqual(1);

    // The tool result content should contain the injected instruction
    const toolContent = toolMessages[0].content as string;
    expect(toolContent).toContain('[INSTRUCTION] Order is cancelled. Be empathetic.');
  });

  it('no instruction injected when predicate does not match', async () => {
    const agent = Agent.create({
      provider: mock([
        {
          content: 'Checking.',
          toolCalls: [{ id: 'tc1', name: 'check_order', arguments: { orderId: 'active-123' } }],
        },
        { content: 'Order is active.' },
      ]),
    })
      .tool(orderTool)
      .tool(trackTool)
      .build();

    const result = await agent.run('Check my order');
    const toolMessages = result.messages.filter((m: any) => m.role === 'tool');
    const toolContent = toolMessages[0].content as string;

    // No instruction injected — order is active, no matching predicate
    expect(toolContent).not.toContain('[INSTRUCTION]');
    expect(toolContent).not.toContain('[AVAILABLE ACTION]');
  });
});

// ── Boundary ────────────────────────────────────────────────────

describe('Instruction integration — boundary', () => {
  it('follow-up binding appears in tool result with resolved params', async () => {
    const agent = Agent.create({
      provider: mock([
        {
          content: 'Checking.',
          toolCalls: [{ id: 'tc1', name: 'check_order', arguments: { orderId: 'shipped' } }],
        },
        { content: 'Your order has shipped.' },
      ]),
    })
      .tool(orderTool)
      .tool(trackTool)
      .build();

    const result = await agent.run('Where is my order?');
    const toolMessages = result.messages.filter((m: any) => m.role === 'tool');
    const toolContent = toolMessages[0].content as string;

    expect(toolContent).toContain('[AVAILABLE ACTION]');
    expect(toolContent).toContain('Tool: track_package');
    expect(toolContent).toContain('"trackingId":"PKG_123"');
    expect(toolContent).toContain('Track package delivery');
  });

  it('tool without instructions works normally', async () => {
    const simpleTool = defineTool({
      id: 'simple',
      description: 'Simple tool',
      inputSchema: { type: 'object' },
      handler: async () => ({ content: 'simple result' }),
    });

    const agent = Agent.create({
      provider: mock([
        { content: 'calling', toolCalls: [{ id: '1', name: 'simple', arguments: {} }] },
        { content: 'done' },
      ]),
    })
      .tool(simpleTool)
      .build();

    const result = await agent.run('test');
    expect(result.content).toBe('done');
    const toolContent = result.messages.filter((m: any) => m.role === 'tool')[0]?.content as string;
    expect(toolContent).toBe('simple result');
    expect(toolContent).not.toContain('[INSTRUCTION]');
  });
});

// ── Scenario ────────────────────────────────────────────────────

describe('Instruction integration — scenario', () => {
  it('runtime instructions from handler appear in tool result', async () => {
    const agent = Agent.create({
      provider: mock([
        { content: 'checking', toolCalls: [{ id: '1', name: 'check_service', arguments: {} }] },
        { content: 'Service is experiencing issues.' },
      ]),
    })
      .tool(runtimeTool)
      .tool(statusTool)
      .build();

    const result = await agent.run('Is the service working?');
    const toolMessages = result.messages.filter((m: any) => m.role === 'tool');
    const toolContent = toolMessages[0].content as string;

    // Runtime instruction injected
    expect(toolContent).toContain('[INSTRUCTION] Service is degraded.');
    // Runtime follow-up injected
    expect(toolContent).toContain('[AVAILABLE ACTION]');
    expect(toolContent).toContain('Tool: status_page');
    expect(toolContent).toContain('"region":"us"');
  });
});

// ── Property ────────────────────────────────────────────────────

describe('Instruction integration — property', () => {
  it('agent still produces correct final answer with instructions active', async () => {
    const agent = Agent.create({
      provider: mock([
        { content: 'checking', toolCalls: [{ id: '1', name: 'check_order', arguments: { orderId: 'cancelled' } }] },
        { content: 'The order was cancelled. I can suggest alternatives.' },
      ]),
    })
      .tool(orderTool)
      .tool(trackTool)
      .build();

    const result = await agent.run('Check order cancelled');
    // Agent still works — instructions don't break execution
    expect(result.content).toBe('The order was cancelled. I can suggest alternatives.');
    expect(result.iterations).toBe(1);
  });
});

// ── Security ────────────────────────────────────────────────────

describe('Instruction integration — security', () => {
  it('instructions only fire for matching tool — not cross-tool leakage', async () => {
    const agent = Agent.create({
      provider: mock([
        { content: 'tracking', toolCalls: [{ id: '1', name: 'track_package', arguments: { trackingId: 'PKG' } }] },
        { content: 'Package is in transit.' },
      ]),
    })
      .tool(orderTool)
      .tool(trackTool)
      .build();

    const result = await agent.run('Track my package');
    const toolMessages = result.messages.filter((m: any) => m.role === 'tool');
    const toolContent = toolMessages[0].content as string;

    // track_package has no instructions — no injection
    expect(toolContent).not.toContain('[INSTRUCTION]');
    // order tool's instructions did NOT fire for track_package
    expect(toolContent).not.toContain('cancelled');
    expect(toolContent).not.toContain('empathetic');
  });
});
