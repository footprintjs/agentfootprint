/**
 * Sample 24: Structured Output
 *
 * Request JSON output matching a schema with .outputSchema().
 * Accepts JSON Schema or Zod schema (auto-converted).
 *
 *   - OpenAI: native response_format
 *   - Anthropic: schema injected into prompt (system or user)
 *   - Zod: duck-typed, auto-converted to JSON Schema
 */
import { describe, it, expect } from 'vitest';
import { Agent, mock } from '../../src/test-barrel';
import { zodToJsonSchema, isZodSchema } from '../../src/tools/zodToJsonSchema';

describe('Sample 24: Structured Output', () => {
  // ── zodToJsonSchema ────────────────────────────────────────

  it('converts Zod-like object to JSON Schema', () => {
    // Simulate a Zod schema (duck-typed — no zod dependency)
    const mockZod = {
      _def: { typeName: 'ZodObject' },
      safeParse: () => {},
      shape: {
        city: { _def: { typeName: 'ZodString', description: 'City name' }, safeParse: () => {} },
        temp: { _def: { typeName: 'ZodNumber' }, safeParse: () => {} },
        unit: {
          _def: { typeName: 'ZodEnum', values: ['celsius', 'fahrenheit'] },
          safeParse: () => {},
        },
      },
    };

    const schema = zodToJsonSchema(mockZod);

    expect(schema.type).toBe('object');
    expect(schema.properties).toBeDefined();
    const props = schema.properties as Record<string, any>;
    expect(props.city.type).toBe('string');
    expect(props.city.description).toBe('City name');
    expect(props.temp.type).toBe('number');
    expect(props.unit.enum).toEqual(['celsius', 'fahrenheit']);
    expect(schema.required).toEqual(['city', 'temp', 'unit']);
  });

  it('handles optional fields (not in required)', () => {
    const mockZod = {
      _def: { typeName: 'ZodObject' },
      safeParse: () => {},
      shape: {
        name: { _def: { typeName: 'ZodString' }, safeParse: () => {} },
        nickname: {
          _def: {
            typeName: 'ZodOptional',
            innerType: { _def: { typeName: 'ZodString' }, safeParse: () => {} },
          },
          safeParse: () => {},
        },
      },
    };

    const schema = zodToJsonSchema(mockZod);
    expect(schema.required).toEqual(['name']); // nickname not required
  });

  it('handles nullable fields', () => {
    const mockZod = {
      _def: {
        typeName: 'ZodNullable',
        innerType: { _def: { typeName: 'ZodString' }, safeParse: () => {} },
      },
      safeParse: () => {},
    };

    const schema = zodToJsonSchema(mockZod);
    expect(schema.type).toBe('string');
    expect(schema.nullable).toBe(true);
  });

  it('handles literal values', () => {
    const mockZod = {
      _def: { typeName: 'ZodLiteral', value: 'fixed-value' },
      safeParse: () => {},
    };

    const schema = zodToJsonSchema(mockZod);
    expect((schema as any).const).toBe('fixed-value');
  });

  it('handles arrays', () => {
    const mockZod = {
      _def: {
        typeName: 'ZodArray',
        type: { _def: { typeName: 'ZodNumber' }, safeParse: () => {} },
      },
      safeParse: () => {},
    };

    const schema = zodToJsonSchema(mockZod);
    expect(schema.type).toBe('array');
    expect((schema.items as any).type).toBe('number');
  });

  // ── isZodSchema ────────────────────────────────────────────

  it('isZodSchema detects Zod-like objects', () => {
    expect(isZodSchema({ _def: {}, safeParse: () => {} })).toBe(true);
    expect(isZodSchema({ type: 'object' })).toBe(false);
    expect(isZodSchema(null)).toBe(false);
    expect(isZodSchema('string')).toBe(false);
  });

  // ── Agent outputSchema ─────────────────────────────────────

  it('outputSchema with JSON Schema — agent runs with responseFormat', async () => {
    const agent = Agent.create({
      provider: mock([{ content: '{"city":"Paris","temp":72}' }]),
    })
      .system('Extract city and temp.')
      .outputSchema({
        type: 'object',
        properties: { city: { type: 'string' }, temp: { type: 'number' } },
      })
      .build();

    const result = await agent.run('It is 72°F in Paris.');
    const parsed = JSON.parse(result.content);
    expect(parsed.city).toBe('Paris');
    expect(parsed.temp).toBe(72);
  });
});
