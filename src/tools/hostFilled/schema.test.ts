import { describe, expect, it } from 'vitest';

import type { Tool } from '../tools.js';
import { declaresAtRoot, mentionsElsewhere, refuseNested, withoutFields } from './schema.js';

const FIELD = 'token';
const property = { properties: { token: { type: 'string' } } };
const required = { required: ['token'] };

/** Preserve the distinction between a call argument and a field inside another argument. */
const positions: readonly [string, unknown, boolean, boolean][] = [
  ['the root property and required list', { ...property, ...required }, false, false],
  [
    'the root field own schema is not walked',
    { properties: { token: { ...property, ...required, dependencies: { token: [] } } } },
    false,
    false,
  ],
  ['another argument properties', { properties: { cursor: property } }, true, false],
  ['another argument required list', { properties: { cursor: required } }, true, false],
  ['allOf properties', { allOf: [{ type: 'object' }, property] }, true, true],
  ['anyOf required', { anyOf: [required] }, true, true],
  ['oneOf properties', { oneOf: [property] }, true, true],
  ['not properties', { not: property }, true, true],
  ['if required', { if: required }, true, true],
  ['then properties', { then: property }, true, true],
  ['else required', { else: required }, true, true],
  ['$defs schema values', { $defs: { arguments: property } }, true, true],
  ['definitions schema values', { definitions: { arguments: required } }, true, true],
  ['dependentRequired key', { dependentRequired: { token: ['name'] } }, true, true],
  ['dependencies key', { dependencies: { token: { required: ['name'] } } }, true, true],
  ['dependentSchemas key', { dependentSchemas: { token: { type: 'object' } } }, true, true],
  ['dependentRequired list member', { dependentRequired: { name: ['token'] } }, true, false],
  ['dependencies list member', { dependencies: { name: ['token'] } }, true, false],
  ['dependentSchemas nested value', { dependentSchemas: { name: property } }, true, false],
  ['a reference string is not resolved', { $ref: '#/$defs/token' }, false, false],
];

describe('schema field positions', () => {
  it.each(positions)('%s', (_name, schema, elsewhere, atRoot) => {
    expect(mentionsElsewhere(schema, FIELD)).toBe(elsewhere);
    expect(declaresAtRoot(schema, FIELD)).toBe(atRoot);
  });

  it('non-object schema values name no field', () => {
    for (const schema of [undefined, null, true, false, 0, 'token']) {
      expect(mentionsElsewhere(schema, FIELD)).toBe(false);
      expect(declaresAtRoot(schema, FIELD)).toBe(false);
    }
  });

  it('inherited property names do not declare an argument', () => {
    const inherited = Object.create({ token: { type: 'string' } });
    const schema = { allOf: [{ properties: inherited }] };
    expect(mentionsElsewhere(schema, FIELD)).toBe(false);
    expect(declaresAtRoot(schema, FIELD)).toBe(false);
    expect(mentionsElsewhere({ allOf: [{ properties: {} }] }, 'toString')).toBe(false);
    expect(declaresAtRoot({ allOf: [{ properties: {} }] }, 'toString')).toBe(false);
  });

  it('an own property with an Object.prototype name is still a declaration', () => {
    const schema = { allOf: [{ properties: { constructor: { type: 'string' } } }] };
    expect(mentionsElsewhere(schema, 'constructor')).toBe(true);
    expect(declaresAtRoot(schema, 'constructor')).toBe(true);
  });

  it('cycles with no matching field terminate without changing the graph', () => {
    const schema: Record<string, unknown> = {};
    const branches: unknown[] = [schema];
    schema.allOf = branches;
    Object.freeze(branches);
    Object.freeze(schema);
    expect(mentionsElsewhere(schema, FIELD)).toBe(false);
    expect(declaresAtRoot(schema, FIELD)).toBe(false);
    expect(schema.allOf).toBe(branches);
    expect(branches[0]).toBe(schema);
  });

  it('a cycle does not hide a matching later sibling', () => {
    const schema: Record<string, unknown> = {};
    schema.allOf = [schema, { anyOf: [property] }];
    expect(mentionsElsewhere(schema, FIELD)).toBe(true);
    expect(declaresAtRoot(schema, FIELD)).toBe(true);
  });
});

describe('removing host-filled fields from a schema', () => {
  it('copies the root and properties, retaining other schema references and leaving the input unchanged', () => {
    const token = Object.freeze({ type: 'string' });
    const name = Object.freeze({ type: 'string', minLength: 1 });
    const properties = Object.freeze({ token, name });
    const requiredNames = Object.freeze(['name', 'token']);
    const definitions = Object.freeze({ name });
    const schema = Object.freeze({
      type: 'object',
      properties,
      required: requiredNames,
      $defs: definitions,
      additionalProperties: false,
    });
    const out = withoutFields(schema, ['token']);
    expect(out).toEqual({
      type: 'object',
      properties: { name },
      required: ['name'],
      $defs: definitions,
      additionalProperties: false,
    });
    expect(out).not.toBe(schema);
    expect(out.properties).not.toBe(properties);
    expect(out.required).not.toBe(requiredNames);
    expect((out.properties as Record<string, unknown>).name).toBe(name);
    expect(out.$defs).toBe(definitions);
    expect(schema.properties).toEqual({ token, name });
    expect(schema.required).toEqual(['name', 'token']);
  });

  it('removes the required keyword when no required names remain', () => {
    const schema = { properties: { token: {} }, required: ['token', 'token'] };
    expect(withoutFields(schema, ['token'])).toEqual({ properties: {} });
    expect(schema.required).toEqual(['token', 'token']);
  });

  it('removes several fields while preserving remaining property and required order', () => {
    const schema = {
      properties: { first: {}, token: {}, middle: {}, account: {}, last: {} },
      required: ['account', 'last', 'token', 'first', 'last'],
    };
    const out = withoutFields(schema, ['token', 'account', 'missing']);
    expect(Object.keys(out.properties as object)).toEqual(['first', 'middle', 'last']);
    expect(out.required).toEqual(['last', 'first', 'last']);
  });

  it('retains non-string required members rather than adding schema validation', () => {
    const other = { named: 'token' };
    const schema = { properties: { token: {} }, required: ['token', 1, null, other] };
    const out = withoutFields(schema, ['token']);
    expect(out.required).toEqual([1, null, other]);
    expect((out.required as unknown[])[2]).toBe(other);
    expect(schema.required).toEqual(['token', 1, null, other]);
  });

  it('an absent properties map becomes an empty map and absent required stays absent', () => {
    const schema = { type: 'object', title: 'Arguments' };
    expect(withoutFields(schema, ['token'])).toEqual({ ...schema, properties: {} });
    expect(schema).not.toHaveProperty('properties');
  });

  it('a non-array required value is retained unchanged', () => {
    const requiredValue = { token: true };
    const out = withoutFields({ properties: { token: {} }, required: requiredValue }, ['token']);
    expect(out.properties).toEqual({});
    expect(out.required).toBe(requiredValue);
  });

  it('an empty removal list still returns shallow copies and retains nested field schemas', () => {
    const token = { type: 'string' };
    const schema = { properties: { token }, required: ['token'] };
    const out = withoutFields(schema, []);
    expect(out).toEqual(schema);
    expect(out).not.toBe(schema);
    expect(out.properties).not.toBe(schema.properties);
    expect(out.required).not.toBe(schema.required);
    expect((out.properties as Record<string, unknown>).token).toBe(token);
  });
});

describe('the existing nested-schema refusal', () => {
  it('throws TypeError with the exact tool, field and current guidance', () => {
    const tool: Tool = {
      schema: {
        name: 'lookup_record',
        description: 'Look up a record',
        inputSchema: { type: 'object' },
      },
      execute: async () => undefined,
    };
    const expected =
      "hostFilled: tool 'lookup_record' names 'token' inside a nested schema or a " +
      'combinator (allOf/anyOf/oneOf, $defs, dependentRequired …), where it cannot be removed ' +
      'from what the model reads — declare it as a top-level property, or wrap the tool yourself.';
    expect(() => refuseNested(tool, 'token')).toThrow(TypeError);
    expect(() => refuseNested(tool, 'token')).toThrowError(new TypeError(expected));
  });
});
