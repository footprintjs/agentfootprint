/**
 * AgentBuilder ergonomics — .maxIterations() + .recorder() + .instructions()
 *
 * Block-B-tail / Neo follow-up. These three small builder methods round
 * out the v2.5 fluent API so consumers don't have to mix
 * `Agent.create({ maxIterations })` constructor opts with builder
 * setters or call `agent.attach(rec)` separately.
 */

import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineInstruction,
  mock,
  type AgentfootprintEvent,
} from '../../src/index.js';

// ─── 1. .maxIterations() ──────────────────────────────────────────

describe('AgentBuilder.maxIterations', () => {
  it('chainable + overrides ctor opt', async () => {
    let calls = 0;
    const provider = mock({
      respond: () => {
        calls++;
        return {
          content: '',
          toolCalls: [{ id: `c${calls}`, name: 'noop', args: {} }],
        };
      },
    });
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 50 })
      .system('s')
      .tool({
        schema: { name: 'noop', description: 'n', inputSchema: { type: 'object' } },
        execute: async () => 'ok',
      })
      .maxIterations(2) // override
      .build();
    await agent.run({ message: 'go' });
    // With maxIterations=2, the loop stops after 2 LLM calls
    expect(calls).toBeLessThanOrEqual(2);
  });

  it('throws on non-positive integer', () => {
    const provider = mock({ respond: () => ({ content: 'ok', toolCalls: [] }) });
    const builder = Agent.create({ provider, model: 'mock' }).system('s');
    expect(() => builder.maxIterations(0)).toThrow(/positive integer/);
    expect(() => builder.maxIterations(-1)).toThrow(/positive integer/);
    expect(() => builder.maxIterations(1.5)).toThrow(/positive integer/);
  });
});

// ─── 2. .recorder() ──────────────────────────────────────────────

describe('AgentBuilder.recorder', () => {
  it('attaches at build time so the recorder sees the first run', async () => {
    const events: string[] = [];
    const recorder = {
      id: 'test-recorder',
      onEmit: (e: AgentfootprintEvent) => {
        events.push(e.type);
      },
    };
    const provider = mock({ respond: () => ({ content: 'final', toolCalls: [] }) });
    const agent = Agent.create({ provider, model: 'mock' })
      .system('s')
      .recorder(recorder)
      .build();
    await agent.run({ message: 'go' });
    expect(events.length).toBeGreaterThan(0);
  });

  it('multiple recorders all receive events', async () => {
    const counters = { a: 0, b: 0 };
    const recA = {
      id: 'rec-a',
      onEmit: () => {
        counters.a++;
      },
    };
    const recB = {
      id: 'rec-b',
      onEmit: () => {
        counters.b++;
      },
    };
    const provider = mock({ respond: () => ({ content: 'final', toolCalls: [] }) });
    const agent = Agent.create({ provider, model: 'mock' })
      .system('s')
      .recorder(recA)
      .recorder(recB)
      .build();
    await agent.run({ message: 'go' });
    expect(counters.a).toBeGreaterThan(0);
    expect(counters.b).toBeGreaterThan(0);
    // Both recorders saw events from the same run
    expect(counters.a).toBe(counters.b);
  });
});

// ─── 3. .instructions() (plural) ─────────────────────────────────

describe('AgentBuilder.instructions (plural)', () => {
  it('registers all entries from an array', async () => {
    let observedSystem = '';
    const provider = mock({
      respond: (req: { systemPrompt?: string }) => {
        observedSystem = req.systemPrompt ?? '';
        return { content: 'final', toolCalls: [] };
      },
    });

    const a = defineInstruction({
      id: 'rule-a',
      activeWhen: () => true,
      prompt: 'RULE_A_TEXT',
    });
    const b = defineInstruction({
      id: 'rule-b',
      activeWhen: () => true,
      prompt: 'RULE_B_TEXT',
    });

    const agent = Agent.create({ provider, model: 'mock' })
      .system('s')
      .instructions([a, b])
      .build();
    await agent.run({ message: 'go' });

    expect(observedSystem).toContain('RULE_A_TEXT');
    expect(observedSystem).toContain('RULE_B_TEXT');
  });
});
