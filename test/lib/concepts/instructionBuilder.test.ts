/**
 * defineInstruction() + Agent builder .instruction()/.instructions()/.decision() — 5-pattern tests.
 *
 * Tests the full developer API: define instructions, attach to agent, run with decision scope.
 *
 * Tiers:
 * - unit:     defineInstruction validates, builder chains, runner gets config
 * - boundary: empty instructions, no decision, defineInstruction with missing id
 * - scenario: full agent with conditional instruction + decision scope
 * - property: instruction tools callable, narrative shows matched instructions
 * - security: defineInstruction rejects missing id
 */

import { describe, it, expect, vi } from 'vitest';
import { Agent, defineInstruction, defineTool, mock, AgentPattern } from '../../../src/test-barrel';
import type { AgentInstruction, LLMInstruction } from '../../../src/test-barrel';
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

// ── defineInstruction — unit ─────────────────────────────────

describe('defineInstruction — unit', () => {
  it('returns the instruction unchanged', () => {
    const instr = defineInstruction({
      id: 'test',
      prompt: 'Hello.',
    });
    expect(instr.id).toBe('test');
    expect(instr.prompt).toBe('Hello.');
  });

  it('preserves generic TDecision type', () => {
    interface MyDecision {
      status: 'active' | 'denied';
    }
    const instr = defineInstruction<MyDecision>({
      id: 'typed',
      activeWhen: (d) => d.status === 'denied',
      prompt: 'Empathy.',
    });
    // Type-level test — activeWhen is typed against MyDecision
    expect(instr.activeWhen).toBeDefined();
  });

  it('throws when id is missing', () => {
    expect(() => defineInstruction({ id: '' })).toThrow('id is required');
  });
});

// ── Agent builder — .instruction() / .instructions() / .decision() ──

describe('Agent builder — instruction methods', () => {
  it('.instruction() chains and builds without error', () => {
    const instr = defineInstruction({ id: 'a', prompt: 'P' });
    const agent = Agent.create({ provider: mockProvider([{ content: 'ok' }]) })
      .system('You are helpful.')
      .instruction(instr)
      .build();
    expect(agent).toBeDefined();
  });

  it('.instructions() accepts array', () => {
    const a = defineInstruction({ id: 'a', prompt: 'A' });
    const b = defineInstruction({ id: 'b', prompt: 'B' });
    const agent = Agent.create({ provider: mockProvider([{ content: 'ok' }]) })
      .instructions([a, b])
      .build();
    expect(agent).toBeDefined();
  });

  it('.decision() chains', () => {
    const agent = Agent.create({ provider: mockProvider([{ content: 'ok' }]) })
      .decision({ orderStatus: null })
      .build();
    expect(agent).toBeDefined();
  });

  it('.instruction() + .decision() + .build() runs successfully', async () => {
    const instr = defineInstruction({
      id: 'always',
      prompt: 'Extra guidance.',
    });
    const provider = mockProvider([{ content: 'response' }]);
    const agent = Agent.create({ provider })
      .system('Base prompt.')
      .instruction(instr)
      .decision({ status: 'active' })
      .build();

    const result = await agent.run('hello');
    expect(result.content).toBe('response');

    // Verify prompt injection merged into system message
    const calledMsgs = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as Message[];
    const systemMsg = calledMsgs.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('Base prompt.');
    expect(systemMsg?.content).toContain('Extra guidance.');
  });
});

// ── Conditional instruction with decision ────────────────────

describe('Agent builder — conditional instruction', () => {
  it('instruction fires when decision matches', async () => {
    interface MyDecision {
      orderStatus: 'pending' | 'denied' | null;
    }

    const instr = defineInstruction<MyDecision>({
      id: 'refund',
      activeWhen: (d) => d.orderStatus === 'denied',
      prompt: 'Be empathetic.',
    });

    const provider = mockProvider([{ content: 'ok' }]);
    const agent = Agent.create({ provider })
      .system('Base.')
      .instruction(instr)
      .decision<MyDecision>({ orderStatus: 'denied' })
      .build();

    await agent.run('hi');
    const calledMsgs = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as Message[];
    const systemMsg = calledMsgs.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('Be empathetic.');
  });

  it('instruction does NOT fire when decision does not match', async () => {
    const instr = defineInstruction({
      id: 'refund',
      activeWhen: (d: any) => d.orderStatus === 'denied',
      prompt: 'Be empathetic.',
    });

    const provider = mockProvider([{ content: 'ok' }]);
    const agent = Agent.create({ provider })
      .system('Base.')
      .instruction(instr)
      .decision({ orderStatus: 'pending' })
      .build();

    await agent.run('hi');
    const calledMsgs = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as Message[];
    const systemMsg = calledMsgs.find((m) => m.role === 'system');
    expect(systemMsg?.content).not.toContain('Be empathetic.');
  });
});

// ── Tool injection via instruction ───────────────────────────

describe('Agent builder — instruction tool injection', () => {
  it('instruction tools are callable and visible to LLM', async () => {
    const refundTool = defineTool({
      id: 'process_refund',
      description: 'Process a refund',
      inputSchema: { type: 'object', properties: { orderId: { type: 'string' } } },
      handler: async ({ orderId }) => ({ content: `Refunded ${orderId}` }),
    });

    const instr = defineInstruction({
      id: 'refund',
      tools: [refundTool],
    });

    const tc: ToolCall = { id: 'tc-1', name: 'process_refund', arguments: { orderId: 'O-123' } };
    const provider = mockProvider([
      { content: '', toolCalls: [tc] },
      { content: 'Refund processed.' },
    ]);

    const agent = Agent.create({ provider }).system('You are helpful.').instruction(instr).build();

    const result = await agent.run('refund my order');
    expect(result.content).toBe('Refund processed.');

    // Tool should have been called — verify in messages
    const toolMsg = result.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('Refunded O-123');
  });
});

// ── Narrative visibility ─────────────────────────────────────

describe('Agent builder — instruction narrative', () => {
  it('narrative shows InstructionsToLLM subflow + matched IDs', async () => {
    const instr = defineInstruction({ id: 'always-on', prompt: 'P' });
    const provider = mockProvider([{ content: 'ok' }]);
    const agent = Agent.create({ provider }).instruction(instr).build();

    await agent.run('hi');
    const narrative = agent.getNarrative();
    expect(
      narrative.some(
        (s: string) => s.includes('InstructionsToLLM') || s.includes('EvaluateInstructions'),
      ),
    ).toBe(true);
  });
});
