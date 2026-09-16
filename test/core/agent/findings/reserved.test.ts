/**
 * findings/reserved — the reserved `_findings` argument, its decorator and
 * its two peels, as pure functions over plain JSON.
 *
 * The properties under test are REFERENCE properties: an unarmed path, a
 * schema the author already decorated, an args object without the key and an
 * answer without the key must all come back as the SAME reference (byte
 * identity by construction), and nothing here may ever mutate its input.
 * fast-check is not a dependency of this repo, so the property sections run
 * a seeded generator over random JSON shapes instead — deterministic, and the
 * seed is in the failure message.
 *
 * Sections follow Convention 3: Unit (the constants and the schema) ·
 * Functional (each function on hand-built shapes) · Property (generated
 * shapes) · Edge (malformed declarations, counted) · Model-facing (both
 * strings pass the `unprovable` gate).
 */

import { describe, expect, it } from 'vitest';
import type { LLMToolSchema } from '../../../../src/adapters/types.js';
import {
  FINDINGS_ARGUMENT_SCHEMA,
  FINDINGS_INSTRUCTION,
  peelAnswerFindings,
  splitFindings,
  withFindingsArgument,
} from '../../../../src/core/agent/findings/reserved.js';
import {
  BASIS_VALUES,
  EXPECT_VALUES,
  RESERVED_ANSWER_KEY,
  RESERVED_ARGUMENT,
  STANDING_VALUES,
} from '../../../../src/core/agent/findings/types.js';
import { PARK_CARD, type Surface, unprovable } from '../../../helpers/modelFacingClaims.js';

/**
 * The STRICTEST surface for each channel the two strings reach. `unprovable`
 * judges on `lifetime`, and `'persistent-history'` exempts nothing, so a
 * string that passes here passes on the ephemeral form of the same channel
 * too. The registration rows in test/modelFacingSurfaces.test.ts name each
 * string's real lifetime; this file asks the harder question.
 */
const TOOL_DESCRIPTION: Surface = { channel: 'tool-description', lifetime: 'persistent-history' };
const SYSTEM_TEXT: Surface = { channel: 'system-text', lifetime: 'persistent-history' };

// ── Toolkit ──────────────────────────────────────────────────────────────

/** A tiny deterministic PRNG so a failing shape is reproducible from its seed. */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEY_POOL = ['port', 'query', 'limit', 'nested', 'findings', '$findings', 'a', 'b', ''];

function pick<T>(rnd: () => number, from: readonly T[]): T {
  return from[Math.floor(rnd() * from.length)];
}

/** A random JSON value, depth-limited, in the spirit of `fc.jsonValue()`. */
function jsonValue(rnd: () => number, depth = 0): unknown {
  const roll = rnd();
  if (depth > 2 || roll < 0.15) return null;
  if (roll < 0.3) return rnd() < 0.5;
  if (roll < 0.45) return Math.floor(rnd() * 1000) - 500;
  if (roll < 0.65)
    return pick(rnd, ['', 'up', 'fc1/7', 'direct', 'fact', 'x'.repeat(Math.floor(rnd() * 8))]);
  if (roll < 0.82) {
    const n = Math.floor(rnd() * 4);
    return Array.from({ length: n }, () => jsonValue(rnd, depth + 1));
  }
  const out: Record<string, unknown> = {};
  const n = Math.floor(rnd() * 4);
  for (let i = 0; i < n; i += 1) out[pick(rnd, KEY_POOL)] = jsonValue(rnd, depth + 1);
  return out;
}

/** A random args dictionary WITHOUT the reserved key (`fc.dictionary(fc.string(), fc.jsonValue())`). */
function dictionary(rnd: () => number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const n = Math.floor(rnd() * 6);
  for (let i = 0; i < n; i += 1) out[pick(rnd, KEY_POOL)] = jsonValue(rnd);
  return out;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

const VALID_DECLARATION = {
  basis: 'direct',
  expect: 'high',
  previous: [
    {
      toolCallId: 'call_1',
      standing: 'fact',
      sought: true,
      assertions: [{ subject: { kind: 'port', id: 'fc1/7' }, predicate: 'state', value: 'up' }],
    },
    { toolCallId: 'call_2', standing: 'open', settles: 'a second reading' },
    { toolCallId: 'call_3', standing: 'ruled-out', line: 'not a cabling fault' },
    { toolCallId: 'call_4', standing: 'noise' },
  ],
} as const;

const schemaOf = (properties?: unknown, extra: Record<string, unknown> = {}): LLMToolSchema => ({
  name: 'lookup_port',
  description: 'Look a port up.',
  inputSchema: {
    type: 'object',
    ...(properties !== undefined && { properties }),
    ...extra,
  },
});

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

// ── Unit: the constants ──────────────────────────────────────────────────

describe('the reserved names and the schema', () => {
  it('reserves `_findings` for both the argument and the answer key', () => {
    expect(RESERVED_ARGUMENT).toBe('_findings');
    expect(RESERVED_ANSWER_KEY).toBe('_findings');
  });

  it('is deep-frozen and enumerates exactly the vocabularies', () => {
    expect(Object.isFrozen(FINDINGS_ARGUMENT_SCHEMA)).toBe(true);
    const properties = FINDINGS_ARGUMENT_SCHEMA.properties as Record<string, any>;
    expect(Object.isFrozen(properties)).toBe(true);
    expect(Object.isFrozen(properties.previous.items.properties.assertions.items)).toBe(true);
    expect(properties.basis.enum).toEqual([...BASIS_VALUES]);
    expect(properties.expect.enum).toEqual([...EXPECT_VALUES]);
    expect(properties.previous.items.properties.standing.enum).toEqual([...STANDING_VALUES]);
    expect(() => {
      (properties.basis as any).enum.push('guess');
    }).toThrow();
  });

  it('requires a basis INSIDE the object and names the stratum rule in its description', () => {
    expect(FINDINGS_ARGUMENT_SCHEMA.required).toEqual(['basis']);
    expect(FINDINGS_ARGUMENT_SCHEMA.description).toMatch(/^Findings v1/);
    expect(FINDINGS_ARGUMENT_SCHEMA.description).toContain('asserted');
    expect(FINDINGS_ARGUMENT_SCHEMA.description).toContain('quoted');
    expect(FINDINGS_ARGUMENT_SCHEMA.description).not.toContain('disposition');
  });
});

// ── Functional: withFindingsArgument ─────────────────────────────────────

describe('withFindingsArgument', () => {
  it('adds `_findings` to a rebuilt copy and leaves required/additionalProperties untouched', () => {
    const original = deepFreeze(
      schemaOf({ port: { type: 'string' } }, { required: ['port'], additionalProperties: false }),
    );
    const decorated = withFindingsArgument(original);
    expect(decorated).not.toBe(original);
    expect(decorated.inputSchema).not.toBe(original.inputSchema);
    expect((decorated.inputSchema.properties as any)._findings).toBe(FINDINGS_ARGUMENT_SCHEMA);
    expect((decorated.inputSchema.properties as any).port).toBe(
      (original.inputSchema.properties as any).port,
    );
    expect(decorated.inputSchema.required).toBe(original.inputSchema.required);
    expect(decorated.inputSchema.required).toEqual(['port']);
    expect(decorated.inputSchema.additionalProperties).toBe(false);
    expect(decorated.name).toBe(original.name);
    expect(decorated.description).toBe(original.description);
    // the input is byte-identical afterwards
    expect(Object.keys(original.inputSchema.properties as object)).toEqual(['port']);
  });

  it('returns the SAME reference when the author already declared `_findings` (author wins)', () => {
    const authored = schemaOf({ _findings: { type: 'string' } });
    expect(withFindingsArgument(authored)).toBe(authored);
    expect((authored.inputSchema.properties as any)._findings).toEqual({ type: 'string' });
  });

  it('is idempotent: decorating a decorated schema is the same reference', () => {
    const once = withFindingsArgument(schemaOf({ port: { type: 'string' } }));
    expect(withFindingsArgument(once)).toBe(once);
  });

  it('treats a missing or non-object `properties` as empty', () => {
    expect(Object.keys(withFindingsArgument(schemaOf()).inputSchema.properties as object)).toEqual([
      '_findings',
    ]);
    const odd = withFindingsArgument(schemaOf('not-an-object'));
    expect(Object.keys(odd.inputSchema.properties as object)).toEqual(['_findings']);
  });

  it('property: never mutates a deep-frozen schema and never adds `_findings` to required', () => {
    for (const seed of SEEDS) {
      const rnd = mulberry32(seed);
      const required = rnd() < 0.5 ? Object.keys(dictionary(rnd)) : undefined;
      const original = deepFreeze(
        schemaOf(dictionary(rnd), {
          ...(required !== undefined && { required }),
          ...(rnd() < 0.5 && { additionalProperties: rnd() < 0.5 }),
        }),
      );
      const decorated = withFindingsArgument(original);
      const message = `seed ${seed}`;
      expect((decorated.inputSchema.properties as any)._findings, message).toBe(
        FINDINGS_ARGUMENT_SCHEMA,
      );
      expect(decorated.inputSchema.required, message).toBe(original.inputSchema.required);
      expect(decorated.inputSchema.additionalProperties, message).toBe(
        original.inputSchema.additionalProperties,
      );
      expect(withFindingsArgument(decorated), message).toBe(decorated);
      expect(
        Object.prototype.hasOwnProperty.call(original.inputSchema.properties, '_findings'),
        message,
      ).toBe(false);
    }
  });
});

// ── Functional + property: splitFindings ─────────────────────────────────

describe('splitFindings', () => {
  it('returns the SAME args reference when the key is absent', () => {
    const args = deepFreeze({ port: 'fc1/7', nested: { findings: 1 } });
    const split = splitFindings(args);
    expect(split.args).toBe(args);
    expect(split.findings).toBeUndefined();
    expect(split.malformed).toBeUndefined();
  });

  it('returns a fresh object without the key and the validated declaration', () => {
    const args = deepFreeze({ port: 'fc1/7', _findings: VALID_DECLARATION });
    const split = splitFindings(args);
    expect(split.args).not.toBe(args);
    expect(split.args).toEqual({ port: 'fc1/7' });
    expect(Object.prototype.hasOwnProperty.call(split.args, '_findings')).toBe(false);
    expect(split.findings).toEqual(VALID_DECLARATION);
    expect(split.malformed).toBeUndefined();
    // the frozen input is untouched
    expect(Object.keys(args)).toEqual(['port', '_findings']);
  });

  it('keeps the key order of the remaining args', () => {
    const split = splitFindings({ a: 1, _findings: { basis: 'direct' }, b: 2 });
    expect(Object.keys(split.args)).toEqual(['a', 'b']);
  });

  it('property: same reference when absent, fresh object without the key when present, never a mutation', () => {
    for (const seed of SEEDS) {
      const rnd = mulberry32(seed);
      const message = `seed ${seed}`;
      const absent = deepFreeze(dictionary(rnd));
      expect(splitFindings(absent).args, message).toBe(absent);

      const carried = jsonValue(rnd);
      const present = deepFreeze({ ...dictionary(rnd), _findings: carried });
      const split = splitFindings(present);
      expect(split.args, message).not.toBe(present);
      expect(Object.prototype.hasOwnProperty.call(split.args, '_findings'), message).toBe(false);
      const { _findings: _dropped, ...rest } = present;
      expect(split.args, message).toEqual(rest);
      // a random JSON value is almost never a readable declaration; when it
      // is not, the count says so — and nothing is ever defaulted
      if (split.findings !== undefined) {
        expect(carried, message).toEqual(expect.any(Object));
        expect(
          split.findings.basis === undefined || BASIS_VALUES.includes(split.findings.basis),
          message,
        ).toBe(true);
      }
      expect(Object.prototype.hasOwnProperty.call(present, '_findings'), message).toBe(true);
    }
  });
});

// ── Edge: malformed declarations are dropped and COUNTED ─────────────────

describe('splitFindings on a malformed declaration', () => {
  it('a non-object `_findings` peels the key, files no declaration, counts one', () => {
    for (const bad of ['direct', 7, null, true, ['direct']]) {
      const split = splitFindings({ port: 'x', _findings: bad });
      expect(split.args).toEqual({ port: 'x' });
      expect(split.findings).toBeUndefined();
      expect(split.malformed).toBe(1);
    }
  });

  it('a bad enum value is dropped and counted, never coerced', () => {
    const split = splitFindings({ _findings: { basis: 'guess', expect: 'huge' } });
    expect(split.findings).toBeUndefined();
    expect(split.malformed).toBe(2);
    const partial = splitFindings({ _findings: { basis: 'Direct', expect: 'low' } });
    expect(partial.findings).toEqual({ expect: 'low' });
    expect(partial.malformed).toBe(1);
  });

  it('`previous` that is not an array is dropped and counted', () => {
    const split = splitFindings({ _findings: { basis: 'direct', previous: { toolCallId: 'x' } } });
    expect(split.findings).toEqual({ basis: 'direct' });
    expect(split.malformed).toBe(1);
  });

  it('entries missing an identity or a standing are dropped and counted; the rest survive', () => {
    const split = splitFindings({
      _findings: {
        basis: 'exploratory',
        previous: [
          { toolCallId: 'call_1', standing: 'fact' },
          { standing: 'fact' },
          { toolCallId: 'call_3', standing: 'settled' },
          { toolCallId: 4, standing: 'noise' },
          'call_5',
          { toolCallId: 'call_6', standing: 'noise' },
        ],
      },
    });
    expect(split.findings?.previous?.map((p) => p.toolCallId)).toEqual(['call_1', 'call_6']);
    expect(split.malformed).toBe(4);
  });

  it('a malformed optional field drops that field only, counted', () => {
    const split = splitFindings({
      _findings: {
        basis: 'direct',
        previous: [
          { toolCallId: 'call_1', standing: 'open', sought: 'yes', settles: 42, line: ['x'] },
        ],
      },
    });
    expect(split.findings?.previous).toEqual([{ toolCallId: 'call_1', standing: 'open' }]);
    expect(split.malformed).toBe(3);
  });

  it('a malformed assertion drops that assertion only, counted; `value` must be present', () => {
    const split = splitFindings({
      _findings: {
        basis: 'direct',
        previous: [
          {
            toolCallId: 'call_1',
            standing: 'fact',
            assertions: [
              { subject: { kind: 'port', id: 'fc1/7' }, predicate: 'state', value: null },
              { subject: { kind: 'port', id: 'fc1/7' }, predicate: 'state' },
              { subject: { kind: 'port' }, predicate: 'state', value: 'up' },
              { subject: { kind: 'port', id: 'fc1/8' }, predicate: 9, value: 'up' },
              'port fc1/7 is up',
            ],
          },
        ],
      },
    });
    expect(split.findings?.previous?.[0].assertions).toEqual([
      { subject: { kind: 'port', id: 'fc1/7' }, predicate: 'state', value: null },
    ]);
    expect(split.malformed).toBe(4);
  });

  it('`assertions` that is not an array is dropped and counted', () => {
    const split = splitFindings({
      _findings: {
        basis: 'direct',
        previous: [{ toolCallId: 'call_1', standing: 'fact', assertions: 'up' }],
      },
    });
    expect(split.findings?.previous).toEqual([{ toolCallId: 'call_1', standing: 'fact' }]);
    expect(split.malformed).toBe(1);
  });

  it('an empty object under the key peels the key and files nothing', () => {
    const split = splitFindings({ port: 'x', _findings: {} });
    expect(split.args).toEqual({ port: 'x' });
    expect(split.findings).toBeUndefined();
    expect(split.malformed).toBeUndefined();
  });

  it('unknown fields under the key are ignored, not counted', () => {
    const split = splitFindings({ _findings: { basis: 'direct', note: 'ignored' } });
    expect(split.findings).toEqual({ basis: 'direct' });
    expect(split.malformed).toBeUndefined();
  });

  it('a non-object args value comes back as the same reference (the paused-call fallback)', () => {
    expect(splitFindings(undefined as never).args).toBeUndefined();
    const list = ['a'] as never;
    expect(splitFindings(list).args).toBe(list);
  });
});

// ── Functional + property: peelAnswerFindings ────────────────────────────

describe('peelAnswerFindings', () => {
  it('is identity on prose, arrays, primitives, invalid JSON and objects without the key', () => {
    for (const raw of [
      'The port is up.',
      '',
      '  { not json',
      '[{"_findings": {"basis": "direct"}}]',
      '"_findings"',
      '42',
      '{"answer": "up", "nested": {"_findings": 1}}',
      '  \n{"answer": "up"}',
    ]) {
      const peeled = peelAnswerFindings(raw);
      expect(peeled.content).toBe(raw);
      expect(peeled.findings).toBeUndefined();
      expect(peeled.malformed).toBeUndefined();
    }
  });

  it('peels a top-level `_findings` and re-serialises the object without it', () => {
    const raw = JSON.stringify({ answer: 'up', _findings: VALID_DECLARATION, count: 2 });
    const peeled = peelAnswerFindings(raw);
    expect(peeled.content).toBe(JSON.stringify({ answer: 'up', count: 2 }));
    expect(peeled.findings).toEqual(VALID_DECLARATION);
    expect(peeled.malformed).toBeUndefined();
  });

  it('peels the key even when its value is malformed, and counts it', () => {
    const peeled = peelAnswerFindings('{"answer": "up", "_findings": "direct"}');
    expect(peeled.content).toBe('{"answer":"up"}');
    expect(peeled.findings).toBeUndefined();
    expect(peeled.malformed).toBe(1);
  });

  it('tolerates leading whitespace before the object', () => {
    const peeled = peelAnswerFindings('  \n {"answer": 1, "_findings": {"basis": "exploratory"}}');
    expect(peeled.content).toBe('{"answer":1}');
    expect(peeled.findings).toEqual({ basis: 'exploratory' });
  });

  it('property: identity on every generated JSON value without the key', () => {
    for (const seed of SEEDS) {
      const rnd = mulberry32(seed);
      const value = jsonValue(rnd);
      const raw = rnd() < 0.5 ? JSON.stringify(value) : `prose ${seed}: ${JSON.stringify(value)}`;
      const hasKey =
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.prototype.hasOwnProperty.call(value, '_findings');
      if (hasKey) continue;
      const peeled = peelAnswerFindings(raw);
      expect(peeled.content, `seed ${seed}`).toBe(raw);
      expect(peeled.findings, `seed ${seed}`).toBeUndefined();
    }
  });
});

// ── Model-facing: the two strings pass the claims gate ───────────────────

describe('the model-facing strings', () => {
  it('FINDINGS_INSTRUCTION is a short ask naming the argument, the answer key and all four standings', () => {
    const lines = FINDINGS_INSTRUCTION.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(6);
    expect(lines.length).toBeLessThanOrEqual(10);
    expect(FINDINGS_INSTRUCTION).toContain('`_findings.basis`');
    expect(FINDINGS_INSTRUCTION).toContain('`_findings.previous`');
    for (const standing of STANDING_VALUES) expect(FINDINGS_INSTRUCTION).toContain(`'${standing}'`);
    expect(FINDINGS_INSTRUCTION).not.toContain('disposition');
  });

  it('neither string makes a claim a later call could falsify', () => {
    expect(unprovable(FINDINGS_INSTRUCTION, PARK_CARD)).toEqual([]);
    expect(unprovable(FINDINGS_INSTRUCTION, SYSTEM_TEXT)).toEqual([]);
    expect(unprovable(FINDINGS_ARGUMENT_SCHEMA.description as string, TOOL_DESCRIPTION)).toEqual(
      [],
    );
    const properties = FINDINGS_ARGUMENT_SCHEMA.properties as Record<string, any>;
    const nested = [
      properties.basis.description,
      properties.expect.description,
      properties.previous.description,
      properties.previous.items.properties.assertions.description,
    ];
    for (const text of nested) expect(unprovable(text, TOOL_DESCRIPTION)).toEqual([]);
  });
});
