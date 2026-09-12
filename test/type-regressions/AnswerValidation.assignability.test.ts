import { describe, expect, it } from 'vitest';
import {
  Agent,
  type AnswerValidationOptions,
  type AnswerEvidenceResolver,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';

describe('answer validation public contract', () => {
  it('types the candidate and exposes a read-only, scope-bound evidence capability', () => {
    const options: AnswerValidationOptions<{ total: number }> = {
      id: 'synthetic-total',
      version: '1',
      validate(candidate, context) {
        const total: number = candidate.total;
        const resolver: AnswerEvidenceResolver = context.artifacts;
        if (total < 0) {
          // @ts-expect-error The callback cannot mutate the candidate.
          candidate.total = 10;
          // @ts-expect-error The callback cannot put or replace evidence.
          resolver.put({ data: total });
          // @ts-expect-error The callback cannot enumerate other artifacts.
          resolver.list();
          // @ts-expect-error The callback cannot choose another conversation.
          resolver.resolve('ref', { kind: 'summary', conversationId: 'another' });
        }
        return {
          checks: [{ id: 'total', disposition: total === 3 ? 'checked-pass' : 'checked-fail' }],
        };
      },
    };
    const agent = Agent.create({ provider: mock({ reply: '{"total":3}' }), model: 'mock' })
      .outputSchema({ parse: (value: unknown) => value })
      .answerValidation(options)
      .build();
    expect(agent.answerValidation()).toBeUndefined();
  });
});
