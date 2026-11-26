import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../../src/core/Agent.js';
import { LLMCall } from '../../src/core/LLMCall.js';
import { Sequence } from '../../src/core-flow/Sequence.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import type { LLMProvider } from '../../src/provider-contract/types.js';
import { defineMemory, MEMORY_TYPES, MEMORY_STRATEGIES } from '../../src/memory/index.js';
import { InMemoryStore } from '../../src/memory/store/index.js';

type Outcome = 'masked' | 'blocked' | 'unknown';
const text = 'Contact [EMAIL].';
function scripted(outcome: Outcome) {
  const complete = vi.fn(async () => ({
    content: text,
    toolCalls: [],
    stopReason: 'content_filter',
    usage: { input: 2, output: 3 },
    intervention: { outcome, code: 'guardrail_intervened', filters: [] },
  }));
  const provider: LLMProvider = { name: 'scripted-intervention', complete };
  return { provider, complete };
}

describe('provider intervention at the admitted native response', () => {
  for (const mode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
    for (const outcome of ['masked', 'blocked', 'unknown'] as const) {
      it(`${mode}: ${outcome} has its own terminal and memory behavior`, async () => {
        const { provider, complete } = scripted(outcome);
        const store = new InMemoryStore();
        const memory = defineMemory({
          id: 'turns',
          type: MEMORY_TYPES.EPISODIC,
          strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
          store,
        });
        const agent = Agent.create({ provider, model: 'scripted', reactMode: mode })
          .memory(memory)
          .build();
        const identity = { conversationId: `intervention-${mode}-${outcome}` };
        if (outcome === 'masked') {
          await expect(agent.run({ message: 'hello', identity })).resolves.toBe(text);
          const saved = await store.list(identity);
          expect(saved.entries).toHaveLength(2);
          expect(JSON.stringify(saved.entries)).toContain(text);
        } else {
          await expect(agent.run({ message: 'hello', identity })).rejects.toMatchObject({
            code:
              outcome === 'blocked' ? 'ERR_PROVIDER_BLOCKED' : 'ERR_PROVIDER_INTERVENTION_UNKNOWN',
            intervention: { outcome, code: 'guardrail_intervened' },
          });
          expect((await store.list(identity)).entries).toHaveLength(0);
        }
        expect(complete).toHaveBeenCalledTimes(1);
      });
    }
  }

  for (const outcome of ['blocked', 'unknown'] as const) {
    for (const composed of [false, true]) {
      it(`LLMCall ${outcome} stays terminal (composed=${composed})`, async () => {
        const { provider, complete } = scripted(outcome);
        const leaf = LLMCall.create({ provider, model: 'scripted' }).build();
        const next = vi.fn(async () => ({
          content: 'not reached',
          toolCalls: [],
          usage: { input: 0, output: 0 },
          stopReason: 'stop',
        }));
        const tail = LLMCall.create({
          provider: { name: 'tail', complete: next },
          model: 'x',
        }).build();
        const runner = composed
          ? Sequence.create().step('guarded', leaf).step('tail', tail).build()
          : leaf;
        await expect(runner.run({ message: 'hello' })).rejects.toMatchObject({
          code:
            outcome === 'blocked' ? 'ERR_PROVIDER_BLOCKED' : 'ERR_PROVIDER_INTERVENTION_UNKNOWN',
        });
        expect(complete).toHaveBeenCalledTimes(1);
        expect(next).not.toHaveBeenCalled();
      });
    }
    it(`core reliability cannot validate or resend ${outcome}`, async () => {
      const { provider, complete } = scripted(outcome);
      const validate = vi.fn(() => {
        throw new Error('must not validate refusal');
      });
      const agent = Agent.create({ provider, model: 'scripted' })
        .outputSchema({ parse: validate })
        .reliability({ postDecide: [{ when: () => true, then: 'retry', kind: 'retry-all' }] })
        .build();
      await expect(agent.run('hello')).rejects.toMatchObject({
        code: outcome === 'blocked' ? 'ERR_PROVIDER_BLOCKED' : 'ERR_PROVIDER_INTERVENTION_UNKNOWN',
      });
      expect(validate).not.toHaveBeenCalled();
      expect(complete).toHaveBeenCalledTimes(1);
    });
  }

  it('mock retains intervention instead of turning a scripted refusal into success', async () => {
    const data = { outcome: 'unknown' as const, code: 'guardrail_intervened', filters: [] };
    const reply = { content: '', intervention: data };
    const result = await mock({ replies: [reply] }).complete({ model: 'mock', messages: [] });
    expect(result).toHaveProperty('intervention', data);
  });
});
