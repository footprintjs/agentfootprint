/**
 * agentThinkingTrace — builds an AgentThinkingUI `Trace` from a run.
 *
 * Functional test: a real agent reads a skill, calls a data tool, then answers —
 * and we assert the beat list (prompt → ask/return(instruction) → ask/return(data)
 * → answer) plus the data-vs-instruction classification.
 */

import { describe, it, expect } from 'vitest';
import type { LLMProvider } from 'footprintjs';
import { Agent, defineTool, defineSkill, mock } from '../../src/index.js';
import { agentThinkingTrace } from '../../src/observe.js';

describe('agentThinkingTrace — functional (real agent run)', () => {
  it('maps a skill-then-tool run to prompt → ask/return → answer beats', async () => {
    const lookup = defineTool({
      name: 'lookup',
      description: 'returns a value',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      execute: async () => ({ value: 'found-it' }),
    });
    const triage = defineSkill({
      id: 'triage',
      description: 'investigation procedure',
      body: 'Call lookup, then answer.',
      tools: [lookup],
    });

    let i = 0;
    const provider: LLMProvider = mock({
      respond: () => {
        i++;
        if (i === 1)
          return {
            content: 'Let me load the procedure.',
            toolCalls: [{ id: 's1', name: 'read_skill', args: { id: 'triage' } }],
            usage: { input: 20, output: 8 },
            stopReason: 'tool_use',
          };
        if (i === 2)
          return {
            content: 'Now I will look it up.',
            toolCalls: [{ id: 't1', name: 'lookup', args: { q: 'x' } }],
            usage: { input: 40, output: 10 },
            stopReason: 'tool_use',
          };
        return {
          content: 'The answer is found-it.',
          toolCalls: [],
          usage: { input: 50, output: 12 },
          stopReason: 'stop',
        };
      },
    });

    const att = agentThinkingTrace({ agent: 'Neo', model: 'mock', asker: 'oncall' });
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 5 })
      .system('')
      .skill(triage)
      .recorder(att)
      .build();

    await agent.run({ message: 'is it healthy?' });

    const trace = att.getTrace({ task: 'is it healthy?' });

    // Header
    expect(trace.agent).toBe('Neo');
    expect(trace.model).toBe('mock');
    expect(trace.asker).toBe('oncall');
    expect(trace.task).toBe('is it healthy?');

    // First beat is the prompt
    expect(trace.steps[0]).toMatchObject({ kind: 'prompt', brain: 'is it healthy?' });

    // The skill arrives as an INSTRUCTION reply
    const skillReturn = trace.steps.find(
      (s) => s.kind === 'return' && (s as { replyType?: string }).replyType === 'instruction',
    );
    expect(skillReturn, 'a read_skill return should classify as instruction').toBeTruthy();
    expect((skillReturn as { skill?: string }).skill).toBe('triage');

    // The data tool arrives as a DATA reply
    const dataReturn = trace.steps.find(
      (s) => s.kind === 'return' && (s as { toolName?: string }).toolName === 'lookup',
    );
    expect((dataReturn as { replyType?: string }).replyType).toBe('data');

    // There is an ask for the lookup tool, with the reasoning carried as brain
    const lookupAsk = trace.steps.find(
      (s) => s.kind === 'ask' && (s as { toolName?: string }).toolName === 'lookup',
    );
    expect(lookupAsk).toBeTruthy();
    expect((lookupAsk as { brain?: string }).brain).toContain('look it up');

    // The final beat is the answer
    const last = trace.steps[trace.steps.length - 1]!;
    expect(last.kind).toBe('answer');
    expect((last as { answer?: { headline?: string } }).answer?.headline).toContain('found-it');
    // tokens accrued onto the beats
    expect(trace.steps.some((s) => s.cost.tokens > 0)).toBe(true);
  });

  it('starts a fresh trace per run (run-scoped)', async () => {
    const att = agentThinkingTrace();
    const provider: LLMProvider = mock({ reply: 'hi' });
    const agent = Agent.create({ provider, model: 'mock' }).system('').recorder(att).build();
    await agent.run({ message: 'one' });
    await agent.run({ message: 'two' });
    const trace = att.getTrace({ task: 'two' });
    // Only the second run's single answer beat (plus the prompt) — no carryover.
    expect(trace.steps.filter((s) => s.kind === 'answer')).toHaveLength(1);
  });
});
