import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../../src/core/Agent.js';
import type { LLMProvider, LLMResponse } from '../../src/provider-contract/types.js';

describe('the accepted provider intervention is captured once', () => {
  for (const outcome of ['blocked', 'unknown'] as const) {
    it(`${outcome} cannot become masked on a later descriptor read`, async () => {
      let interventionReads = 0;
      let contentReads = 0;
      let toolReads = 0;
      const response = new Proxy(
        {
          get content() {
            contentReads++;
            throw new Error('private content must not be read');
          },
          get toolCalls() {
            toolReads++;
            throw new Error('private tools must not be read');
          },
          usage: { input: 2, output: 3 },
          stopReason: 'content_filter',
        },
        {
          getOwnPropertyDescriptor(target, key) {
            if (key === 'intervention') {
              interventionReads++;
              return {
                configurable: true,
                enumerable: true,
                writable: true,
                value: {
                  outcome: interventionReads === 1 ? outcome : 'masked',
                  code: 'guardrail_intervened',
                  filters: [],
                },
              };
            }
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
        },
      );
      const complete = vi.fn(async () => response as unknown as LLMResponse);
      const provider: LLMProvider = { name: 'owned-intervention', complete };
      const agent = Agent.create({ provider, model: 'scripted' }).build();
      const settled = await agent.run('hello').then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error }),
      );
      expect(settled.error).toMatchObject({
        code: outcome === 'blocked' ? 'ERR_PROVIDER_BLOCKED' : 'ERR_PROVIDER_INTERVENTION_UNKNOWN',
        intervention: { outcome, code: 'guardrail_intervened' },
      });
      expect(interventionReads).toBe(1);
      expect(contentReads).toBe(0);
      expect(toolReads).toBe(0);
      expect(complete).toHaveBeenCalledTimes(1);
    });
  }
});
