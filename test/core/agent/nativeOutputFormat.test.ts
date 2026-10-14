/**
 * `nativeOutputFormat` — the ONE builder of the wire schema a
 * `strategy: 'native'` agent sends as `output_config.format`.
 *
 * Test types: Contract (objects closed; supported keywords kept; unsupported
 * constraints moved into the description on the WIRE copy only; `oneOf` sent
 * as `anyOf`) · Refusal (recursion, external `$ref`, complex enum, a typeless
 * node, an open-keyed map — each by the node's path) · Law (the input is never
 * edited; the result is frozen) · Findings (armed: the root gains `_findings`
 * with exactly `previous`; the author's own `_findings` wins; a non-object root
 * is refused; unarmed: no `_findings`).
 */

import { describe, expect, it } from 'vitest';

import {
  nativeOutputFormat,
  NativeOutputSchemaError,
} from '../../../src/core/agent/nativeOutputFormat.js';

type Json = Record<string, unknown>;
const schemaOf = (input: Json, findings = false): Json =>
  nativeOutputFormat(input, { findings }).schema as Json;

describe('nativeOutputFormat — the wire copy', () => {
  it('closes every object and keeps what the API takes', () => {
    const out = schemaOf({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok', 'err'], description: 'the verdict' },
        when: { type: 'string', format: 'date-time' },
        items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } },
        kind: { const: 'a' },
      },
      required: ['status'],
      additionalProperties: true,
    });
    expect(out).toEqual({
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok', 'err'], description: 'the verdict' },
        when: { type: 'string', format: 'date-time' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' } },
            additionalProperties: false,
          },
        },
        kind: { const: 'a' },
      },
      required: ['status'],
      additionalProperties: false,
    });
  });

  it('moves the constraints the API does not take into the description', () => {
    const out = schemaOf({
      type: 'object',
      properties: {
        n: { type: 'integer', minimum: 1, maximum: 9, description: 'a count' },
        s: { type: 'string', minLength: 2, maxLength: 5, format: 'int64' },
        a: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 4 },
        p: { type: 'string', pattern: '^(\\w)\\1$' },
        q: { type: 'string', pattern: '^[a-z]+$' },
      },
    }).properties as Json;
    expect(out.n).toEqual({
      type: 'integer',
      description: 'a count\n\n{minimum: 1, maximum: 9}',
    });
    expect(out.s).toEqual({
      type: 'string',
      description: '{minLength: 2, maxLength: 5, format: "int64"}',
    });
    expect(out.a).toEqual({
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      description: '{minItems: 3, maxItems: 4}',
    });
    expect(out.p).toEqual({ type: 'string', description: '{pattern: "^(\\\\w)\\\\1$"}' });
    expect(out.q).toEqual({ type: 'string', pattern: '^[a-z]+$' });
  });

  it('sends oneOf as anyOf and keeps a local $ref as it stands', () => {
    const out = schemaOf({
      type: 'object',
      $defs: { Id: { type: 'string', maxLength: 8 } },
      properties: {
        id: { $ref: '#/$defs/Id', description: 'dropped beside a ref' },
        v: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      },
    });
    expect(out.$defs).toEqual({ Id: { type: 'string', description: '{maxLength: 8}' } });
    expect((out.properties as Json).id).toEqual({ $ref: '#/$defs/Id' });
    expect((out.properties as Json).v).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
  });

  it('never edits its input, and freezes what it returns', () => {
    const input = {
      type: 'object',
      properties: { n: { type: 'integer', minimum: 1 } },
    };
    const before = JSON.stringify(input);
    const format = nativeOutputFormat(input, { findings: false });
    expect(JSON.stringify(input)).toBe(before);
    expect(format.type).toBe('json_schema');
    expect(Object.isFrozen(format.schema)).toBe(true);
    expect(Object.isFrozen((format.schema.properties as Json).n)).toBe(true);
  });
});

describe('nativeOutputFormat — refused by name', () => {
  const refusal = (input: Json, findings = false): NativeOutputSchemaError => {
    try {
      nativeOutputFormat(input, { findings });
    } catch (err) {
      expect(err).toBeInstanceOf(NativeOutputSchemaError);
      return err as NativeOutputSchemaError;
    }
    throw new Error('expected a refusal');
  };

  it('a recursive schema', () => {
    const err = refusal({
      type: 'object',
      $defs: {
        Node: {
          type: 'object',
          properties: { child: { $ref: '#/$defs/Node' } },
        },
      },
      properties: { root: { $ref: '#/$defs/Node' } },
    });
    expect(err.message).toMatch(/recursive/);
    expect(err.message).toMatch(/strategy: 'instruct'/);
  });

  it('a root that refers to itself', () => {
    expect(refusal({ type: 'object', properties: { next: { $ref: '#' } } }).message).toMatch(
      /recursive/,
    );
  });

  it('an external $ref', () => {
    const err = refusal({
      type: 'object',
      properties: { a: { $ref: 'https://example.com/a.json' } },
    });
    expect(err.message).toMatch(/external reference/);
    expect(err.path).toBe('#/properties/a');
  });

  it('a complex enum', () => {
    expect(
      refusal({ type: 'object', properties: { e: { enum: [{ a: 1 }, 'b'] } } }).message,
    ).toMatch(/enum holds an object or an array/);
  });

  it('a node with no type', () => {
    const err = refusal({ type: 'object', properties: { anything: {} } });
    expect(err.message).toMatch(/has no type/);
    expect(err.path).toBe('#/properties/anything');
  });

  it('an object with open keys (a record)', () => {
    expect(
      refusal({
        type: 'object',
        properties: { tags: { type: 'object', additionalProperties: { type: 'string' } } },
      }).message,
    ).toMatch(/open keys/);
  });
});

describe('nativeOutputFormat — the reserved _findings key', () => {
  const base = {
    type: 'object',
    properties: { status: { type: 'string' } },
    required: ['status'],
  };

  it('unarmed: the schema is the author’s alone', () => {
    expect((schemaOf(base).properties as Json)._findings).toBeUndefined();
  });

  it('armed: the root gains an optional _findings carrying exactly `previous`', () => {
    const out = schemaOf(base, true);
    const findings = (out.properties as Json)._findings as Json;
    expect(out.required).toEqual(['status']);
    expect(findings.type).toBe('object');
    expect(findings.additionalProperties).toBe(false);
    expect(Object.keys(findings.properties as Json)).toEqual(['previous']);
    const item = ((findings.properties as Json).previous as Json).items as Json;
    expect(item.required).toEqual(['toolCallId', 'standing']);
    expect(item.additionalProperties).toBe(false);
    const assertion = ((item.properties as Json).assertions as Json).items as Json;
    // The one wire narrowing: an untyped value becomes a scalar union.
    expect((assertion.properties as Json).value).toEqual({
      anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }],
    });
  });

  it("the author's own _findings wins", () => {
    const own = { type: 'string' };
    const out = schemaOf({ ...base, properties: { ...base.properties, _findings: own } }, true);
    expect((out.properties as Json)._findings).toEqual(own);
  });

  it('armed with a root that cannot carry it: refused', () => {
    expect(() =>
      nativeOutputFormat({ type: 'array', items: { type: 'string' } }, { findings: true }),
    ).toThrow(/_findings/);
  });
});

describe('nativeOutputFormat — review round 1', () => {
  const refused = (input: Record<string, unknown>, findings = false): string => {
    try {
      nativeOutputFormat(input, { findings });
    } catch (err) {
      expect(err).toBeInstanceOf(NativeOutputSchemaError);
      return (err as Error).message;
    }
    throw new Error('expected a refusal');
  };

  it('an open map is refused however it is spelled: {}, true, or a bare object', () => {
    for (const map of [
      { type: 'object', additionalProperties: {} },
      { type: 'object', additionalProperties: true },
      { type: 'object' },
    ]) {
      expect(refused({ type: 'object', properties: { m: map } })).toMatch(/open keys/);
    }
    // An explicitly closed empty object is fine, and a loose object with named keys is closed.
    const out = nativeOutputFormat(
      {
        type: 'object',
        properties: {
          empty: { type: 'object', properties: {}, additionalProperties: false },
          loose: {
            type: 'object',
            properties: { a: { type: 'string' } },
            additionalProperties: {},
          },
        },
      },
      { findings: false },
    ).schema as { properties: Record<string, { additionalProperties?: unknown }> };
    expect(out.properties.loose.additionalProperties).toBe(false);
  });

  it('a root $ref keeps the definitions it points into', () => {
    const out = nativeOutputFormat(
      {
        $ref: '#/definitions/Verdict',
        definitions: {
          Verdict: { type: 'object', properties: { s: { type: 'string', maxLength: 3 } } },
        },
      },
      { findings: false },
    ).schema as Record<string, unknown>;
    expect(out.$ref).toBe('#/definitions/Verdict');
    expect(out.definitions).toEqual({
      Verdict: {
        type: 'object',
        properties: { s: { type: 'string', description: '{maxLength: 3}' } },
        additionalProperties: false,
      },
    });
  });

  it('a reference the wire copy would leave dangling is refused', () => {
    expect(
      refused({
        type: 'object',
        properties: {
          v: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          w: { $ref: '#/properties/v/oneOf/0' },
        },
      }),
    ).toMatch(/wire copy does not keep/);
  });

  it('a const object, a malformed reference, and findings over a $ref root are refused', () => {
    expect(refused({ type: 'object', properties: { c: { const: { a: 1 } } } })).toMatch(/const/);
    expect(refused({ type: 'object', properties: { r: { $ref: '#/%E0%A4%A' } } })).toMatch(
      /points at nothing/,
    );
    expect(
      refused(
        {
          $ref: '#/$defs/V',
          $defs: { V: { type: 'object', properties: { a: { type: 'string' } } } },
        },
        true,
      ),
    ).toMatch(/_findings/);
  });
});
