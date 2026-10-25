import { describe, expect, it } from 'vitest';
import { Agent } from '../../src/index.js';
import {
  nativeOutputFormat,
  NativeOutputSchemaError,
} from '../../src/core/agent/nativeOutputFormat.js';
import type { LLMProvider, LLMRequest } from '../../src/provider-contract/types.js';

const left = {
  type: 'object',
  properties: { left: { type: 'string' } },
  required: ['left'],
};
const right = {
  type: 'object',
  properties: { right: { type: 'string' } },
  required: ['right'],
};
const intersection = { allOf: [left, right] };
const value = { left: 'one', right: 'two' };
const parser = {
  parse(input: unknown) {
    const answer = input as Partial<typeof value> | null;
    if (answer === null || typeof answer?.left !== 'string' || typeof answer?.right !== 'string')
      throw new Error('Both strings are required.');
    return { left: answer.left, right: answer.right };
  },
};

describe('native output object intersections', () => {
  it.each([
    ['separate branches', intersection],
    ['parent and branch', { ...left, allOf: [right] }],
    ['object alternative', { allOf: [{ anyOf: [left, { type: 'null' }] }, right] }],
  ])('refuses %s rather than closing away another required key', (_name, schema) => {
    // Each original object admits the other branch's extra key. Closing both
    // would reject this valid intersection member on every possible branch.
    expect(parser.parse(value)).toEqual(value);
    expect(() => nativeOutputFormat(schema as typeof intersection, { findings: false })).toThrow(
      /allOf with object schemas cannot be safely closed/,
    );
  });

  it('names the nested node that cannot be lowered', () => {
    try {
      nativeOutputFormat(
        { type: 'object', properties: { pair: intersection } },
        { findings: false },
      );
      expect.fail('Expected the intersection to be refused.');
    } catch (error) {
      expect(error).toBeInstanceOf(NativeOutputSchemaError);
      expect((error as NativeOutputSchemaError).path).toBe('#/properties/pair');
    }
  });

  it('preserves scalar intersections', () => {
    const scalar = { allOf: [{ type: 'string' }, { enum: ['one', 'two'] }] };
    expect(nativeOutputFormat(scalar, { findings: false }).schema).toEqual(scalar);
  });

  for (const reactMode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
    it(`auto retains local validation and a checked guarantee (${reactMode})`, async () => {
      const requests: LLMRequest[] = [];
      const provider: LLMProvider = {
        name: 'intersection-fixture',
        carriesNativeOutputSchema: true,
        async complete(request) {
          requests.push(request);
          return {
            content: JSON.stringify(value),
            toolCalls: [],
            usage: { input: 1, output: 1 },
          };
        },
      };
      const agent = Agent.create({ provider, model: 'model', reactMode })
        .outputSchema(parser, { jsonSchema: intersection })
        .build();
      await expect(agent.runTyped('Return both strings.')).resolves.toEqual(value);
      expect(requests).toHaveLength(1);
      expect(requests[0].outputFormat).toBeUndefined();
      expect(agent.getSnapshot()?.sharedState.answerGuarantee).toBe('checked');
      expect(agent.outputContractUnmet()).toBeUndefined();
      expect(() =>
        Agent.create({ provider, model: 'model', reactMode })
          .outputSchema(parser, { strategy: 'native', jsonSchema: intersection })
          .build(),
      ).toThrow(/node at #.*allOf with object schemas/);
      expect(requests).toHaveLength(1);
    });
  }
});
