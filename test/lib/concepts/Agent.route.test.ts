/**
 * Tests for Agent.route({ branches }) — user-defined routing branches.
 *
 * Tiers:
 * - unit:     predicate matches → user runner fires; predicate misses → default routing
 * - scenario: ordering — first matching branch wins
 * - boundary: predicate throws (fail-open to default)
 */

import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../../src/lib/concepts/Agent';
import type { LLMProvider, LLMResponse } from '../../../src/types';
import type { RunnerLike } from '../../../src/types/multiAgent';

function mockProvider(responses: LLMResponse[]): LLMProvider {
  let i = 0;
  return {
    chat: vi.fn(async () => responses[Math.min(i++, responses.length - 1)]),
  };
}

// Minimal RunnerLike that records what it was called with.
function makeCountingRunner(tag: string): RunnerLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async run(input: string) {
      calls.push(input);
      return { content: `${tag}-handled: ${input}`, messages: [] };
    },
  } as RunnerLike & { calls: string[] };
}

describe('Agent.route — unit', () => {
  it('fires user branch when predicate matches, skipping default routing', async () => {
    const escalation = makeCountingRunner('escalate');
    const provider = mockProvider([{ content: '[ESCALATE] needs human review' }]);

    const agent = Agent.create({ provider })
      .route({
        branches: [
          {
            id: 'escalate',
            when: (s) =>
              typeof s.parsedResponse?.content === 'string' &&
              s.parsedResponse.content.includes('[ESCALATE]'),
            runner: escalation,
          },
        ],
      })
      .build();

    await agent.run('help me');

    // Branch ran exactly once with the user's input message.
    expect(escalation.calls).toHaveLength(1);
  });

  it('falls through to default final branch when no predicate matches', async () => {
    const escalation = makeCountingRunner('escalate');
    const provider = mockProvider([{ content: 'normal reply' }]);

    const agent = Agent.create({ provider })
      .route({
        branches: [
          {
            id: 'escalate',
            when: (s) => String(s.parsedResponse?.content ?? '').includes('[ESCALATE]'),
            runner: escalation,
          },
        ],
      })
      .build();

    const result = await agent.run('hi');

    expect(escalation.calls).toHaveLength(0);
    expect(result.content).toBe('normal reply');
  });

  it('first matching branch wins when multiple predicates match', async () => {
    const first = makeCountingRunner('first');
    const second = makeCountingRunner('second');
    const provider = mockProvider([{ content: 'SHARED keyword' }]);

    const agent = Agent.create({ provider })
      .route({
        branches: [
          {
            id: 'first',
            when: (s) => String(s.parsedResponse?.content ?? '').includes('SHARED'),
            runner: first,
          },
          {
            id: 'second',
            when: (s) => String(s.parsedResponse?.content ?? '').includes('SHARED'),
            runner: second,
          },
        ],
      })
      .build();

    await agent.run('go');

    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
  });

  it('predicate throwing falls through to default (fail-open)', async () => {
    const bad = makeCountingRunner('bad');
    const provider = mockProvider([{ content: 'fine' }]);

    const agent = Agent.create({ provider })
      .route({
        branches: [
          {
            id: 'bad',
            when: () => {
              throw new Error('predicate bug');
            },
            runner: bad,
          },
        ],
      })
      .build();

    const result = await agent.run('go');

    expect(bad.calls).toHaveLength(0);
    expect(result.content).toBe('fine');
  });
});
