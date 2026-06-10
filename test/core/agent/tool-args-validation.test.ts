/**
 * #9 — tool-args validation (pure validator unit tests).
 *
 * Covers: the honest subset (type/union, required, properties recursion,
 * items recursion, enum primitives, explicit additionalProperties:false),
 * permissiveness on everything outside it (never false-reject, never throw),
 * the MAX_ISSUES flood cap, and the security contract: issues/messages name
 * paths and TYPES, never the supplied values.
 */
import { describe, expect, it } from 'vitest';

import {
  formatToolArgIssues,
  validateToolArgs,
} from '../../../src/core/agent/toolArgsValidation.js';

const weatherSchema = {
  type: 'object',
  properties: {
    city: { type: 'string' },
    units: { type: 'string', enum: ['celsius', 'fahrenheit'] },
    days: { type: 'integer' },
  },
  required: ['city'],
} as const;

describe('#9 validateToolArgs — honest subset', () => {
  it('accepts conforming args', () => {
    const result = validateToolArgs({ city: 'Reno', units: 'celsius', days: 3 }, weatherSchema);
    expect(result).toEqual({ ok: true, issues: [] });
  });

  it('rejects a missing required field, naming the path', () => {
    const result = validateToolArgs({ units: 'celsius' }, weatherSchema);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({ path: 'city', expected: 'required', got: 'missing' });
  });

  it('rejects type mismatches with type names only', () => {
    const result = validateToolArgs({ city: 42 }, weatherSchema);
    expect(result.issues).toContainEqual({ path: 'city', expected: 'string', got: 'number' });
  });

  it('integer rejects floats; number accepts them', () => {
    expect(validateToolArgs({ city: 'x', days: 1.5 }, weatherSchema).ok).toBe(false);
    expect(
      validateToolArgs({ n: 1.5 }, { type: 'object', properties: { n: { type: 'number' } } }).ok,
    ).toBe(true);
  });

  it('union types accept any member, reject non-members', () => {
    const schema = { type: 'object', properties: { v: { type: ['string', 'null'] } } };
    expect(validateToolArgs({ v: null }, schema).ok).toBe(true);
    expect(validateToolArgs({ v: 'x' }, schema).ok).toBe(true);
    const bad = validateToolArgs({ v: 7 }, schema);
    expect(bad.issues).toContainEqual({ path: 'v', expected: 'string | null', got: 'number' });
  });

  it('enum (primitives) enforces membership; expectation echoes SCHEMA values only', () => {
    const result = validateToolArgs({ city: 'x', units: 'kelvin' }, weatherSchema);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((entry) => entry.path === 'units');
    expect(issue?.expected).toBe('one of "celsius", "fahrenheit"');
    expect(issue?.got).toBe('string'); // never the supplied 'kelvin'
  });

  it('recurses into nested properties and array items with bracket paths', () => {
    const schema = {
      type: 'object',
      properties: {
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: { field: { type: 'string' } },
            required: ['field'],
          },
        },
      },
    };
    const result = validateToolArgs({ filters: [{ field: 'ok' }, { nope: 1 }] }, schema);
    expect(result.issues).toContainEqual({
      path: 'filters[1].field',
      expected: 'required',
      got: 'missing',
    });
  });

  it('additionalProperties: false rejects extras ONLY when explicitly set', () => {
    const open = validateToolArgs({ city: 'x', extra: 1 }, weatherSchema);
    expect(open.ok).toBe(true); // not set → extras tolerated

    const strict = validateToolArgs(
      { city: 'x', extra: 1 },
      { ...weatherSchema, additionalProperties: false },
    );
    expect(strict.issues).toContainEqual({
      path: 'extra',
      expected: 'no additional properties',
      got: 'number',
    });
  });

  it('non-object args against an object schema reject at the root', () => {
    const result = validateToolArgs('not-an-object', weatherSchema);
    expect(result.issues).toContainEqual({ path: '', expected: 'object', got: 'string' });
  });

  it('undefined args validate as {} (no-arg tools with empty schema pass)', () => {
    expect(validateToolArgs(undefined, { type: 'object', properties: {} }).ok).toBe(true);
    expect(validateToolArgs(undefined, weatherSchema).ok).toBe(false); // required city
  });
});

describe('#9 validateToolArgs — permissive outside the subset', () => {
  it('ignores unsupported keywords (pattern, minimum, oneOf, format)', () => {
    const schema = {
      type: 'object',
      properties: {
        email: { type: 'string', pattern: '^x$', format: 'email' },
        count: { type: 'number', minimum: 100 },
        mix: { oneOf: [{ type: 'string' }] },
      },
    };
    // Violates pattern/minimum/oneOf — but those are out of subset → pass.
    expect(validateToolArgs({ email: 'whatever', count: 1, mix: 42 }, schema).ok).toBe(true);
  });

  it('ignores object-valued enums and tuple-form items', () => {
    const schema = {
      type: 'object',
      properties: {
        obj: { enum: [{ a: 1 }] },
        tuple: { type: 'array', items: [{ type: 'string' }] },
      },
    };
    expect(validateToolArgs({ obj: { b: 2 }, tuple: [99] }, schema).ok).toBe(true);
  });

  it('never throws on malformed schemas (total function)', () => {
    const malformed = [
      { type: 42 },
      { type: 'object', required: 'city' },
      { type: 'object', properties: 'nope' },
      { type: 'object', properties: { x: null } },
      { enum: 'not-an-array' },
      {},
    ];
    for (const schema of malformed) {
      expect(() => validateToolArgs({ anything: true }, schema as never)).not.toThrow();
    }
    expect(validateToolArgs({ x: 1 }, undefined).ok).toBe(true);
  });

  it('property fuzz: arbitrary value shapes never throw', () => {
    const values: unknown[] = [
      null,
      undefined,
      0,
      -1.5,
      NaN,
      '',
      'str',
      true,
      [],
      [[[]]],
      { a: { b: { c: [1, 'x', null, { d: true }] } } },
      Symbol('s'),
      () => {},
      new Map(),
      BigInt(7),
    ];
    for (const value of values) {
      expect(() => validateToolArgs(value, weatherSchema)).not.toThrow();
      expect(() => validateToolArgs({ city: value }, weatherSchema)).not.toThrow();
    }
  });
});

describe('#9 — flood cap + security contract', () => {
  it('caps issues at 10 for pathological inputs', () => {
    const schema = {
      type: 'object',
      properties: { list: { type: 'array', items: { type: 'string' } } },
    };
    const result = validateToolArgs({ list: Array.from({ length: 500 }, () => 9) }, schema);
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeLessThanOrEqual(10);
  });

  it('NEVER echoes supplied values in issues or the formatted message', () => {
    const sentinel = 'SECRET_VALUE_XYZ_4242';
    const result = validateToolArgs(
      { city: 99, units: sentinel, extra: sentinel },
      { ...weatherSchema, additionalProperties: false },
    );
    expect(result.ok).toBe(false);
    const serialized = JSON.stringify(result.issues);
    expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain('99');

    const message = formatToolArgIssues('weather', result.issues);
    expect(message).not.toContain(sentinel);
    expect(message).toContain("Invalid arguments for tool 'weather'");
    expect(message).toContain('not executed');
    expect(message).toContain('call it again');
  });

  it('formats required-vs-mismatch lines distinctly', () => {
    const message = formatToolArgIssues('t', [
      { path: 'city', expected: 'required', got: 'missing' },
      { path: 'days', expected: 'integer', got: 'string' },
    ]);
    expect(message).toContain("- 'city' is required but missing");
    expect(message).toContain("- 'days': expected integer, got string");
  });
});
