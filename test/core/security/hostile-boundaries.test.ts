/**
 * Security tests — hostile inputs at trust boundaries.
 *
 * Scope: external actors (LLM provider, tools, user input) are untrusted.
 * The library must not crash, hang, or leak state when they misbehave.
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';

function scripted(...responses: readonly LLMResponse[]): LLMProvider {
  let i = 0;
  return {
    name: 'mock',
    complete: async () => responses[Math.min(i++, responses.length - 1)],
  };
}

function resp(
  content: string,
  toolCalls: readonly { id: string; name: string; args: Record<string, unknown> }[] = [],
): LLMResponse {
  return {
    content,
    toolCalls,
    usage: { input: 0, output: content.length / 4 },
    stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
  };
}

describe('security — LLM provider misbehavior', () => {
  it('rejects provider that throws synchronously', async () => {
    const provider: LLMProvider = {
      name: 'bad',
      complete: () => {
        throw new Error('provider exploded');
      },
    };
    const llm = LLMCall.create({ provider, model: 'mock' }).system('').build();
    await expect(llm.run({ message: 'hi' })).rejects.toThrow(/provider exploded/);
  });

  it('rejects provider that rejects with Error', async () => {
    const provider: LLMProvider = {
      name: 'bad',
      complete: async () => {
        throw new Error('rate limit');
      },
    };
    const llm = LLMCall.create({ provider, model: 'mock' }).system('').build();
    await expect(llm.run({ message: 'hi' })).rejects.toThrow(/rate limit/);
  });

  it('Agent — provider returning malformed toolCalls field does not iterate forever', async () => {
    // Provider claims tool_use but toolCalls is empty → route becomes 'final'
    // (toolCalls.length > 0 gate). No infinite loop.
    const provider: LLMProvider = {
      name: 'bad',
      complete: async () => ({
        content: 'answer',
        toolCalls: [],
        usage: { input: 0, output: 1 },
        stopReason: 'tool_use', // misleading stopReason — library ignores it for routing
      }),
    };
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 10 }).system('').build();
    const out = await agent.run({ message: 'hi' });
    expect(out).toBe('answer');
  });

  it('Agent — provider requesting unknown tool surfaces as tool_end with error=true', async () => {
    const provider = scripted(
      resp('', [{ id: 't1', name: 'nonexistent_tool', args: {} }]),
      resp('recovered'),
    );
    const agent = Agent.create({ provider, model: 'mock' }).system('').build();

    const toolEnds: unknown[] = [];
    agent.on('agentfootprint.stream.tool_end', (e) => toolEnds.push(e.payload));

    const out = await agent.run({ message: 'go' });
    expect(out).toBe('recovered');
    expect(toolEnds).toHaveLength(1);
    expect((toolEnds[0] as { error?: boolean }).error).toBe(true);
  });
});

describe('security — tool misbehavior', () => {
  it('Agent — tool throwing does not crash the run; reports error and continues', async () => {
    const provider = scripted(
      resp('', [{ id: 't1', name: 'hostile', args: {} }]),
      resp('survived'),
    );
    const agent = Agent.create({ provider, model: 'mock' })
      .system('')
      .tool({
        schema: { name: 'hostile', description: '', inputSchema: { type: 'object' } },
        execute: () => {
          throw new Error('tool exploded');
        },
      })
      .build();

    const toolEnds: { error?: boolean; result?: unknown }[] = [];
    agent.on('agentfootprint.stream.tool_end', (e) =>
      toolEnds.push(e.payload as { error?: boolean; result?: unknown }),
    );

    const out = await agent.run({ message: 'go' });
    expect(out).toBe('survived');
    expect(toolEnds[0].error).toBe(true);
    expect(String(toolEnds[0].result)).toMatch(/tool exploded/);
  });

  it('Agent — tool returning non-serializable result is stringified without crash', async () => {
    const provider = scripted(resp('', [{ id: 't1', name: 'circular', args: {} }]), resp('done'));
    // JSON.stringify on a circular ref throws — library must either
    // handle gracefully or surface the error as a tool_end.error.
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const agent = Agent.create({ provider, model: 'mock' })
      .system('')
      .tool({
        schema: { name: 'circular', description: '', inputSchema: { type: 'object' } },
        execute: () => circular,
      })
      .build();

    // The run must complete — either with 'done' (if library catches) or
    // reject cleanly (if it surfaces as error). Never hang.
    await expect(
      Promise.race([
        agent.run({ message: 'go' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ]),
    ).resolves.not.toThrow();
  });
});

describe('security — iteration budget enforcement', () => {
  it('Agent — provider always returning tool_calls halts at maxIterations', async () => {
    // Hostile provider: every response is a tool_use, forever.
    const hostile: LLMProvider = {
      name: 'loop',
      complete: async () => ({
        content: '',
        toolCalls: [{ id: 't', name: 'noop', args: {} }],
        usage: { input: 0, output: 0 },
        stopReason: 'tool_use',
      }),
    };

    const agent = Agent.create({ provider: hostile, model: 'mock', maxIterations: 3 })
      .system('')
      .tool({
        schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
        execute: () => 'ok',
      })
      .build();

    const routes: string[] = [];
    agent.on('agentfootprint.agent.route_decided', (e) =>
      routes.push((e.payload as { chosen: string }).chosen),
    );

    // If budget enforcement fails this will never resolve.
    await agent.run({ message: 'hi' });
    // Last route must be 'final' — budget kicked in.
    expect(routes[routes.length - 1]).toBe('final');
    // maxIterations route decisions, plus the one wrap-up (9.56.0). A hostile
    // provider that ignores the withholding and asks for a tool anyway buys
    // NOTHING with it: the wrap-up is latched to once per turn, so the loop
    // still terminates in a bounded number of decisions.
    expect(routes).toEqual(['tool-calls', 'tool-calls', 'wrap-up', 'final']);
  });

  it('Agent — maxIterations of 1 forces final on the first iteration', async () => {
    const hostile: LLMProvider = {
      name: 'loop',
      complete: async () => ({
        content: 'partial',
        toolCalls: [{ id: 't', name: 'noop', args: {} }],
        usage: { input: 0, output: 0 },
        stopReason: 'tool_use',
      }),
    };
    const agent = Agent.create({ provider: hostile, model: 'mock', maxIterations: 1 })
      .system('')
      .tool({
        schema: { name: 'noop', description: '', inputSchema: { type: 'object' } },
        execute: () => 'ok',
      })
      .build();

    const routes: string[] = [];
    agent.on('agentfootprint.agent.route_decided', (e) =>
      routes.push((e.payload as { chosen: string }).chosen),
    );

    const out = await agent.run({ message: 'hi' });
    // The wrap-up call went out with no tools; this hostile provider answers
    // the same way regardless, so `'partial'` is still what comes back — and
    // the loop still stops, because the wrap-up is spent.
    expect(out).toBe('partial');
    expect(routes).toEqual(['wrap-up', 'final']);
  });
});

describe('security — user input boundary', () => {
  it('extremely long user messages do not crash seed stage', async () => {
    const huge = 'x'.repeat(100_000);
    const llm = LLMCall.create({ provider: scripted(resp('ok')), model: 'mock' })
      .system('')
      .build();
    await expect(llm.run({ message: huge })).resolves.toBe('ok');
  });

  it('empty user message is REFUSED, at the door, naming both spellings (8.18.0)', async () => {
    // It used to be "accepted". What acceptance meant was two different things
    // in two runners: LLMCall dropped the turn and called the model with an
    // EMPTY conversation (an answer to nothing, returned as though it worked),
    // while Agent sent a `content: ''` turn — which a real provider wire
    // rejects. Neither is a shorter question, so neither is accepted.
    const llm = LLMCall.create({ provider: scripted(resp('ok')), model: 'mock' })
      .system('')
      .build();
    await expect(llm.run({ message: '' })).rejects.toThrow(/a run needs something to answer/);
    await expect(llm.run({ message: '   ' })).rejects.toThrow(/whitespace-only/);
  });
});
