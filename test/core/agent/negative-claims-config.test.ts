import { describe, expect, it, vi } from 'vitest';
import { Agent, defineTool, type NegativeClaimsOptions } from '../../../src/index.js';
import { mock } from '../../../src/adapters/llm/MockProvider.js';
import {
  assertNegativeClaimsTools,
  negativeClaimsInstruction,
  negativeClaimsSchema,
  NEGATIVE_HANDLE_PATTERN,
  resolveNegativeClaims,
} from '../../../src/core/agent/negativeClaims/config.js';

const options: NegativeClaimsOptions = { field: 'negatives', tools: ['lookup'] };
const config = resolveNegativeClaims(options);
const schema = () => ({
  type: 'object',
  properties: {
    summary: { type: 'string' },
    negatives: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['none', 'not-found', 'complete'] },
          about: { type: 'string' },
          restsOn: { type: 'array', items: { type: 'string' } },
        },
        required: ['kind', 'about', 'restsOn'],
      },
    },
  },
  required: ['summary', 'negatives'],
});
const lookup = defineTool({
  name: 'lookup',
  description: 'Lookup an entity',
  inputSchema: { type: 'object', properties: {} },
  execute: () => 'unused',
});
const parser = { parse: (value: unknown) => value };
const builder = () => Agent.create({ provider: mock({ reply: '{}' }), model: 'mock' });

describe('negativeClaims configuration', () => {
  it('defaults to withhold and detaches its tool list', () => {
    const tools = ['lookup'];
    const resolved = resolveNegativeClaims({ field: 'negatives', tools });
    tools.push('later');
    expect(resolved).toEqual({ field: 'negatives', tools: ['lookup'], unestablished: 'withhold' });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.tools)).toBe(true);
  });

  it.each(['strictProse', 'prose', 'enforceProse'])(
    'refuses deferred %s even when false',
    (key) => {
      expect(() => resolveNegativeClaims({ ...options, [key]: false })).toThrow(/not available/);
    },
  );

  it.each([
    [{ ...options, tools: [] }, /non-empty/],
    [{ ...options, tools: ['lookup', 'lookup'] }, /repeat/],
    [{ ...options, field: 'nested.negatives' }, /top-level/],
    [{ ...options, field: '_findings' }, /_findings/],
    [{ ...options, unestablished: 'pass' }, /unestablished/],
    [{ ...options, typo: true }, /only field/],
  ])('rejects an incoherent configuration %#', (input, message) => {
    expect(() => resolveNegativeClaims(input as NegativeClaimsOptions)).toThrow(message as RegExp);
  });

  it('requires a registered local tool but permits runtime among results without search', () => {
    expect(() => assertNegativeClaimsTools(config, [lookup])).not.toThrow();
    expect(() => assertNegativeClaimsTools(config, [])).toThrow(/not registered locally/);
    expect(() => assertNegativeClaimsTools(config, [{ ...lookup, source: 'remote' }])).toThrow(
      /remote/,
    );
  });
});

describe('negativeClaims model citation schema', () => {
  it('serves bounded handles and required about while preserving unrelated fields and the authored schema', () => {
    const input = schema();
    const before = structuredClone(input);
    const output = negativeClaimsSchema(config, input);
    expect(output).toMatchObject({
      properties: {
        summary: { type: 'string' },
        negatives: {
          maxItems: 32,
          items: {
            additionalProperties: false,
            required: ['kind', 'about', 'restsOn'],
            properties: {
              about: { minLength: 1, maxLength: 256 },
              restsOn: { minItems: 1, maxItems: 16, items: { pattern: NEGATIVE_HANDLE_PATTERN } },
            },
          },
        },
      },
    });
    expect(input).toEqual(before);
    expect(Object.isFrozen(output)).toBe(true);
    const instruction = negativeClaimsInstruction(config, output);
    expect(instruction).toContain(NEGATIVE_HANDLE_PATTERN);
    expect(instruction).toContain('The library writes the delivered statement');
  });

  it('never guesses the field from a parse function or an absent property', () => {
    expect(() => negativeClaimsSchema(config, undefined)).toThrow(/jsonSchema/);
    const input = schema();
    expect(() => negativeClaimsSchema({ ...config, field: 'missing' }, input)).toThrow(
      /not declared/,
    );
    input.required = ['summary'];
    expect(() => negativeClaimsSchema(config, input)).toThrow(/must be required/);
  });

  it('requires about and refuses delivered fields in the model contract', () => {
    const input = schema();
    input.properties.negatives.items.required = ['kind', 'restsOn'];
    expect(() => negativeClaimsSchema(config, input)).toThrow(/require kind, about and restsOn/);
    const delivered = schema();
    Object.assign(delivered.properties.negatives.items.properties, {
      statement: { type: 'string' },
    });
    expect(() => negativeClaimsSchema(config, delivered)).toThrow(/library-owned/);
  });

  it('does not silently reinterpret nullable about, references, or another citation grammar', () => {
    const nullable = schema();
    Object.assign(nullable.properties.negatives.items.properties.about, {
      type: ['string', 'null'],
    });
    expect(() => negativeClaimsSchema(config, nullable)).toThrow(/never null/);
    const ref = schema();
    Object.assign(ref.properties.negatives, { items: { $ref: '#/$defs/Citation' } });
    expect(() => negativeClaimsSchema(config, ref)).toThrow(/citation objects/);
    const other = schema();
    Object.assign(other.properties.negatives.items.properties.restsOn.items, { pattern: '^call-' });
    expect(() => negativeClaimsSchema(config, other)).toThrow(/handles must use pattern/);
  });

  it('keeps tighter limits and refuses an impossible handle array', () => {
    const tighter = schema();
    Object.assign(tighter.properties.negatives, { maxItems: 3 });
    expect(negativeClaimsSchema(config, tighter)).toMatchObject({
      properties: { negatives: { maxItems: 3 } },
    });
    Object.assign(tighter.properties.negatives.items.properties.restsOn, { maxItems: 0 });
    expect(() => negativeClaimsSchema(config, tighter)).toThrow(/at least one handle/);
  });
});

describe('AgentBuilder.negativeClaims', () => {
  it('allows either declaration order without executing the parser at build', () => {
    const parse = vi.fn((value: unknown) => value);
    expect(() =>
      builder()
        .tool(lookup)
        .negativeClaims(options)
        .outputSchema({ parse }, { jsonSchema: schema() })
        .build(),
    ).not.toThrow();
    expect(() =>
      builder()
        .tool(lookup)
        .outputSchema({ parse }, { jsonSchema: schema() })
        .negativeClaims(options)
        .build(),
    ).not.toThrow();
    expect(parse).not.toHaveBeenCalled();
  });

  it('accepts an explicit toJsonSchema and refuses a missing schema, duplicate arm, and unavailable tool', () => {
    expect(() =>
      builder()
        .tool(lookup)
        .outputSchema({ ...parser, toJsonSchema: schema } as typeof parser)
        .negativeClaims(options)
        .build(),
    ).not.toThrow();
    expect(() => builder().negativeClaims(options).build()).toThrow(/outputSchema/);
    expect(() =>
      builder().tool(lookup).outputSchema(parser).negativeClaims(options).build(),
    ).toThrow(/jsonSchema/);
    expect(() => builder().negativeClaims(options).negativeClaims(options)).toThrow(
      /already configured/,
    );
    expect(() =>
      builder().outputSchema(parser, { jsonSchema: schema() }).negativeClaims(options).build(),
    ).toThrow(/not registered locally/);
  });

  it('refuses a listed negative check without an arm and incompatible answer rewriting', () => {
    expect(() =>
      builder()
        .outputSchema(parser)
        .answerValidation({
          id: 'v',
          version: '1',
          agentChecks: ['negative-claims'],
          validate: () => ({ checks: [] }),
        })
        .build(),
    ).toThrow(/requires .negativeClaims/);
    expect(() =>
      builder()
        .tool(lookup)
        .outputSchema(parser, { jsonSchema: schema() })
        .negativeClaims(options)
        .limitsTravelWithTheAnswer()
        .build(),
    ).toThrow(/does not support/);
  });
});
