/**
 * Object membership is an own-property rule in the shared schema walker.
 * Both entry points must agree: tool dispatch and declared/answered argument
 * values cannot each implement a different interpretation of an object.
 */
import { describe, expect, it } from 'vitest';

import {
  validatePropertyValue,
  validateToolArgs,
} from '../../../src/core/agent/toolArgsValidation.js';

const prototypeNames = ['constructor', 'toString', '__proto__', 'hasOwnProperty'];

for (const [name, validate] of [
  ['validateToolArgs', validateToolArgs],
  ['validatePropertyValue', validatePropertyValue],
] as const) {
  describe(`${name} — own object properties`, () => {
    it('closes an object even when properties is omitted', () => {
      const schema = { type: 'object', additionalProperties: false };
      expect(validate({}, schema)).toEqual({ ok: true, issues: [] });
      expect(validate({ extra: 1 }, schema)).toEqual({
        ok: false,
        issues: [{ path: 'extra', expected: 'no additional properties', got: 'number' }],
      });
    });

    it('applies object keywords without requiring an explicit object type', () => {
      expect(validate({ extra: true }, { additionalProperties: false })).toEqual({
        ok: false,
        issues: [{ path: 'extra', expected: 'no additional properties', got: 'boolean' }],
      });
      expect(validate('unchanged', { additionalProperties: false }).ok).toBe(true);
    });

    it('treats an explicit empty properties map as having no declared keys', () => {
      expect(validate({ extra: 1 }, { properties: {}, additionalProperties: false })).toEqual({
        ok: false,
        issues: [{ path: 'extra', expected: 'no additional properties', got: 'number' }],
      });
    });

    it.each(prototypeNames)('refuses an undeclared own key named %s', (key) => {
      // A computed key creates an own data property even for __proto__.
      expect(
        validate({ [key]: 'supplied' }, { properties: {}, additionalProperties: false }),
      ).toEqual({
        ok: false,
        issues: [{ path: key, expected: 'no additional properties', got: 'string' }],
      });
    });

    it.each(prototypeNames)('accepts and type-checks an explicitly declared %s', (key) => {
      const schema = {
        type: 'object',
        properties: { [key]: { type: 'string' } },
        required: [key],
        additionalProperties: false,
      };
      expect(validate({ [key]: 'own value' }, schema)).toEqual({ ok: true, issues: [] });
      expect(validate({ [key]: 12 }, schema)).toEqual({
        ok: false,
        issues: [{ path: key, expected: 'string', got: 'number' }],
      });
    });

    it('does not let prototype names satisfy required fields on an empty object', () => {
      const schema = {
        properties: Object.fromEntries(prototypeNames.map((key) => [key, { type: 'string' }])),
        required: prototypeNames,
      };
      expect(validate({}, schema)).toEqual({
        ok: false,
        issues: prototypeNames.map((path) => ({ path, expected: 'required', got: 'missing' })),
      });
    });

    it('does not let inherited application values satisfy required fields', () => {
      const args = Object.create({ city: 'Reno' }) as Record<string, unknown>;
      const schema = { properties: { city: { type: 'string' } }, required: ['city'] };
      expect(validate(args, schema)).toEqual({
        ok: false,
        issues: [{ path: 'city', expected: 'required', got: 'missing' }],
      });
      args.city = 'own city';
      expect(validate(args, schema)).toEqual({ ok: true, issues: [] });
    });

    it('does not validate inherited optional values', () => {
      const args = Object.create({ city: 12 }) as Record<string, unknown>;
      expect(validate(args, { properties: { city: { type: 'string' } } })).toEqual({
        ok: true,
        issues: [],
      });
    });

    it('does not read an inherited optional getter', () => {
      const args = Object.create({
        get city() {
          throw new Error('an absent own argument must not read the prototype');
        },
      }) as Record<string, unknown>;
      expect(validate(args, { properties: { city: { type: 'string' } } })).toEqual({
        ok: true,
        issues: [],
      });
    });

    it('does not treat inherited entries in properties as declarations', () => {
      const properties = Object.create({ city: { type: 'string' } }) as Record<string, unknown>;
      expect(validate({ city: 'Reno' }, { properties, additionalProperties: false })).toEqual({
        ok: false,
        issues: [{ path: 'city', expected: 'no additional properties', got: 'string' }],
      });
    });

    it('ignores inherited extras when the input has no own keys', () => {
      const args = Object.create({ extra: 'inherited' }) as Record<string, unknown>;
      expect(validate(args, { properties: {}, additionalProperties: false })).toEqual({
        ok: true,
        issues: [],
      });
    });

    it('supports null-prototype arguments and properties, including reserved names', () => {
      const args = Object.assign(Object.create(null), { ['__proto__']: 'own value' });
      const properties = Object.assign(Object.create(null), { ['__proto__']: { type: 'string' } });
      const schema = { properties, required: ['__proto__'], additionalProperties: false };
      expect(validate(args, schema)).toEqual({ ok: true, issues: [] });
      args.extra = true;
      expect(validate(args, schema)).toEqual({
        ok: false,
        issues: [{ path: 'extra', expected: 'no additional properties', got: 'boolean' }],
      });
    });

    it.each([
      ['omitted', {}],
      ['true', { additionalProperties: true }],
      ['schema-valued, outside the supported subset', { additionalProperties: { type: 'string' } }],
    ] as const)('keeps extras open when additionalProperties is %s', (_label, extraRule) => {
      const args = Object.fromEntries(prototypeNames.map((key) => [key, 12]));
      expect(validate(args, { type: 'object', properties: {}, ...extraRule })).toEqual({
        ok: true,
        issues: [],
      });
    });

    it.each([null, [], 'not a property map', 42])(
      'defers extra-key rejection for malformed properties %j but still checks required',
      (properties) => {
        expect(
          validate(
            { extra: true },
            { properties, required: ['missing'], additionalProperties: false },
          ),
        ).toEqual({
          ok: false,
          issues: [{ path: 'missing', expected: 'required', got: 'missing' }],
        });
      },
    );

    it.each([{ '^x': { type: 'string' } }, null, [], 'not a pattern map', 42])(
      'defers extra-key rejection for unsupported patternProperties %j, preserving known checks',
      (patternProperties) => {
        expect(
          validate(
            { known: 7, x: false, extra: true },
            {
              properties: { known: { type: 'string' } },
              required: ['missing'],
              additionalProperties: false,
              patternProperties,
            },
          ),
        ).toEqual({
          ok: false,
          issues: [
            { path: 'missing', expected: 'required', got: 'missing' },
            { path: 'known', expected: 'string', got: 'number' },
          ],
        });
      },
    );

    it('closes the object when patternProperties is an explicitly empty map', () => {
      expect(
        validate({ extra: 1 }, { patternProperties: {}, additionalProperties: false }),
      ).toEqual({
        ok: false,
        issues: [{ path: 'extra', expected: 'no additional properties', got: 'number' }],
      });
    });

    it('uses own nonenumerable arguments for required and declared-property checks', () => {
      const schema = { properties: { city: { type: 'string' } }, required: ['city'] };
      const good = Object.defineProperty({}, 'city', { value: 'Reno' });
      const bad = Object.defineProperty({}, 'city', { value: 7 });
      expect(validate(good, schema)).toEqual({ ok: true, issues: [] });
      expect(validate(bad, schema)).toEqual({
        ok: false,
        issues: [{ path: 'city', expected: 'string', got: 'number' }],
      });
    });

    it('keeps nonenumerable extra arguments outside the extra-key traversal', () => {
      const args = Object.defineProperty({}, 'extra', { value: 7 });
      expect(validate(args, { properties: {}, additionalProperties: false })).toEqual({
        ok: true,
        issues: [],
      });
    });

    it('recognizes own nonenumerable declarations without expanding schema traversal', () => {
      const properties = Object.defineProperty({}, 'city', { value: { type: 'string' } });
      expect(validate({ city: 7 }, { properties, additionalProperties: false })).toEqual({
        ok: true,
        issues: [],
      });
    });

    it('applies the same membership rule recursively through properties and array items', () => {
      const item = Object.assign(Object.create({ city: 'inherited' }), { constructor: 7 });
      const schema = {
        properties: {
          envelope: {
            properties: {
              rows: {
                type: 'array',
                items: {
                  properties: { city: { type: 'string' } },
                  required: ['city'],
                  additionalProperties: false,
                },
              },
              empty: { additionalProperties: false },
            },
          },
        },
      };
      expect(validate({ envelope: { rows: [item], empty: { extra: null } } }, schema)).toEqual({
        ok: false,
        issues: [
          { path: 'envelope.rows[0].city', expected: 'required', got: 'missing' },
          {
            path: 'envelope.rows[0].constructor',
            expected: 'no additional properties',
            got: 'number',
          },
          { path: 'envelope.empty.extra', expected: 'no additional properties', got: 'null' },
        ],
      });
    });

    it('preserves required, property declaration, then extra-key issue order', () => {
      const schema = {
        properties: { first: { type: 'string' }, second: { type: 'string' } },
        required: ['missingB', 'missingA'],
        additionalProperties: false,
      };
      expect(validate({ second: 2, first: 1, z: true, a: false }, schema).issues).toEqual([
        { path: 'missingB', expected: 'required', got: 'missing' },
        { path: 'missingA', expected: 'required', got: 'missing' },
        { path: 'first', expected: 'string', got: 'number' },
        { path: 'second', expected: 'string', got: 'number' },
        { path: 'z', expected: 'no additional properties', got: 'boolean' },
        { path: 'a', expected: 'no additional properties', got: 'boolean' },
      ]);
    });

    it('caps extras at the first ten own keys even when properties is omitted', () => {
      const entries = Array.from({ length: 20 }, (_, index) => [`extra${index}`, index] as const);
      expect(validate(Object.fromEntries(entries), { additionalProperties: false })).toEqual({
        ok: false,
        issues: entries.slice(0, 10).map(([path]) => ({
          path,
          expected: 'no additional properties',
          got: 'number',
        })),
      });
    });

    it('does not strip, copy onto, or change arguments, schemas, or their prototypes', () => {
      const prototype = Object.freeze({ city: 'inherited' });
      const args = Object.freeze(
        Object.create(prototype, Object.getOwnPropertyDescriptors({ ['__proto__']: 'own' })),
      );
      const properties = Object.freeze({ city: Object.freeze({ type: 'string' }) });
      const schema = Object.freeze({ properties, additionalProperties: false });
      const argDescriptors = Object.getOwnPropertyDescriptors(args);
      const schemaDescriptors = Object.getOwnPropertyDescriptors(schema);

      expect(validate(args, schema)).toEqual({
        ok: false,
        issues: [{ path: '__proto__', expected: 'no additional properties', got: 'string' }],
      });
      expect(Object.getOwnPropertyDescriptors(args)).toEqual(argDescriptors);
      expect(Object.getOwnPropertyDescriptors(schema)).toEqual(schemaDescriptors);
      expect(Object.getPrototypeOf(args)).toBe(prototype);
      expect(Object.getPrototypeOf(properties)).toBe(Object.prototype);
      expect(schema.properties).toBe(properties);
    });
  });
}
