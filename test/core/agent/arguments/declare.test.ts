/**
 * The inputs layer's declaration — `askOrAssume` and `period`, judged by the ONE
 * assert at every door (definition, dispatch, MCP ingest).
 *
 * Test types (Convention 3):
 *   - UNIT      — every refusal of `assertAskOrAssume` names the tool and the
 *                 argument; `isMissing` on every missing shape; the spellings;
 *                 the same-value rule; `rulesOf` on a hand-built tool;
 *   - CONTRACT  — the `assume` value is judged against the property's OWN
 *                 schema, so the design's example (a root `required` naming a
 *                 second argument) is accepted.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { disableDevMode, enableDevMode } from 'footprintjs';

import { defineTool, type Tool } from '../../../../src/index.js';
import {
  assertAskOrAssume,
  isMissing,
  isRefused,
  parsesUnderSpelling,
  rulesOf,
  sameArgumentValue,
  _resetDeclareWarnings,
} from '../../../../src/core/agent/arguments/declare.js';

const SCHEMA = {
  type: 'object',
  required: ['service', 'window'],
  properties: {
    service: { type: 'string', description: 'Service name.' },
    window: { type: 'string', enum: ['1h', '2h', '24h', '7d'], description: 'Look-back period.' },
    limit: { type: 'integer' },
    verbose: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' } },
    either: { type: ['string', 'null'] },
    ref: { type: 'string' },
  },
} as const;

const refusal = (rules: unknown, period?: unknown, wants?: Record<string, string>): string => {
  try {
    assertAskOrAssume('search_logs', rules, period, SCHEMA, wants);
  } catch (error) {
    return (error as Error).message;
  }
  return '';
};

afterEach(() => {
  _resetDeclareWarnings();
  vi.restoreAllMocks();
});

describe('assertAskOrAssume — accepted', () => {
  it('an assume rule judged against the PROPERTY schema, not the root `required`', () => {
    // The root `required` names `service`, which the declaration does not
    // carry — judging `{ window: '2h' }` against the whole schema would refuse
    // the design's own example.
    expect(refusal({ window: { assume: '2h' } })).toBe('');
    expect(refusal({ limit: { assume: 50 }, verbose: { assume: false } })).toBe('');
  });

  it('a period on a ruled argument, its value parsing under the declared spelling', () => {
    expect(
      refusal({ window: { assume: '24h' } }, { argument: 'window', spelling: 'lookback' }),
    ).toBe('');
    expect(refusal({ window: { assume: '24h' } }, { argument: 'window' })).toBe('');
  });

  it('nothing declared is a no-op', () => {
    expect(refusal(undefined)).toBe('');
  });
});

describe('assertAskOrAssume — every refusal names the tool and the argument', () => {
  const cases: readonly [string, unknown, unknown?, Record<string, string>?][] = [
    ['an argument the schema does not offer', { nope: { assume: 'x' } }],
    ['an array property', { tags: { assume: 'x' } }],
    ['a type union', { either: { assume: 'x' } }],
    ['a wants argument', { ref: { assume: 'x' } }, undefined, { ref: 'dataset/rows' }],
    ['both forms', { window: { assume: '2h', ask: 'Which?' } }],
    ['neither form', { window: {} }],
    ['an unknown key', { window: { assume: '2h', fallback: '1h' } }],
    ['an assume value outside the enum', { window: { assume: '9h' } }],
    ['an assume value of the wrong type', { limit: { assume: 'fifty' } }],
    ['an assume value that is not a primitive', { service: { assume: { name: 'x' } } }],
    ['a blank question', { window: { ask: '   ' } }],
    ['an empty choice list', { window: { ask: 'Which?', choices: [] } }],
    ['a repeated choice', { window: { ask: 'Which?', choices: ['1h', '1h'] } }],
    ['a choice outside the enum', { window: { ask: 'Which?', choices: ['9h'] } }],
    [
      'a phrase with no token',
      { window: { ask: 'Which?', choices: [{ value: '24h', said: ['—'] }] } },
    ],
    [
      'one phrase on two choices',
      {
        window: {
          ask: 'Which?',
          choices: [
            { value: '24h', said: ['past day'] },
            { value: '7d', said: ['past day'] },
          ],
        },
      },
    ],
    [
      'a period on an argument with no rule',
      { service: { assume: 'checkout' } },
      { argument: 'window' },
    ],
    ['an unknown spelling', { window: { assume: '2h' } }, { argument: 'window', spelling: 'days' }],
    [
      'a value not spelled as declared',
      { window: { assume: '2h' } },
      { argument: 'window', spelling: 'signed-lookback' },
    ],
    ['an empty declaration', {}],
  ];
  for (const [what, rules, period, wants] of cases) {
    it(`refuses ${what}`, () => {
      const message = refusal(rules, period, wants);
      expect(message).toMatch(/^defineTool\('search_logs'\): /);
      expect(message.length).toBeGreaterThan(40);
    });
  }

  it('accepts an ask rule whose shape passes (step 4 applies it: the batch ask)', () => {
    expect(() =>
      assertAskOrAssume(
        'search_logs',
        { window: { ask: 'Which period?', choices: ['1h', { value: '24h', said: ['last day'] }] } },
        undefined,
        SCHEMA,
      ),
    ).not.toThrow();
  });

  it('names the argument in the refusal', () => {
    expect(refusal({ window: { assume: '9h' } })).toContain('askOrAssume.window.assume');
    expect(refusal({ tags: { assume: 'x' } })).toContain('askOrAssume.tags');
  });

  it('refuses more than 32 ask arguments', () => {
    const properties: Record<string, unknown> = {};
    const rules: Record<string, unknown> = {};
    for (let i = 0; i < 33; i++) {
      properties[`a${i}`] = { type: 'string' };
      rules[`a${i}`] = { ask: `Question ${i}?` };
    }
    expect(() =>
      assertAskOrAssume('wide', rules, undefined, { type: 'object', properties }),
    ).toThrow(/33 arguments carry `ask`; at most 32/);
  });
});

describe('defineTool — the door at definition', () => {
  it('copies both declarations onto the Tool, verbatim', () => {
    const tool = defineTool({
      name: 'search_logs',
      description: 'd',
      inputSchema: SCHEMA,
      askOrAssume: { window: { assume: '2h' } },
      period: { argument: 'window', spelling: 'lookback' },
      execute: () => 'ok',
    });
    expect(tool.askOrAssume).toEqual({ window: { assume: '2h' } });
    expect(tool.period).toEqual({ argument: 'window', spelling: 'lookback' });
    // The author's schema is never edited: `required` is intact.
    expect(tool.schema.inputSchema.required).toEqual(['service', 'window']);
  });

  it('refuses a malformed rule at definition, naming the tool', () => {
    expect(() =>
      defineTool({
        name: 'search_logs',
        description: 'd',
        inputSchema: SCHEMA,
        askOrAssume: { window: { assume: '9h' } },
        execute: () => 'ok',
      }),
    ).toThrow(/defineTool\('search_logs'\): askOrAssume\.window\.assume/);
  });

  it('a tool that declares nothing is the Tool it always was', () => {
    const tool = defineTool({ name: 'plain', description: 'd', execute: () => 'ok' });
    expect('askOrAssume' in tool).toBe(false);
    expect('period' in tool).toBe(false);
  });

  it('warns once (dev mode) when a ruled property still says "default"', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const schema = {
      type: 'object',
      properties: { window: { type: 'string', description: 'Look-back (default 2h).' } },
    };
    enableDevMode();
    try {
      assertAskOrAssume('t', { window: { assume: '2h' } }, undefined, schema);
      assertAskOrAssume('t', { window: { assume: '2h' } }, undefined, schema);
    } finally {
      disableDevMode();
    }
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("'window'"))).toHaveLength(1);
  });

  it('says nothing outside dev mode — a style note, not a refusal', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    assertAskOrAssume('t2', { window: { assume: '2h' } }, undefined, {
      type: 'object',
      properties: { window: { type: 'string', description: 'default 2h' } },
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('isMissing — the one owner of "missing"', () => {
  it.each([
    [{}, true],
    [{ window: undefined }, true],
    [{ window: null }, true],
    [{ window: '' }, true],
    [{ window: '   ' }, true],
    [{ window: '2h' }, false],
    [{ window: 0 }, false],
    [{ window: false }, false],
  ])('%j → %s', (args, missing) => {
    expect(isMissing(args as Record<string, unknown>, 'window')).toBe(missing);
  });

  it('an inherited key is not the call’s own', () => {
    const args = Object.create({ window: '2h' }) as Record<string, unknown>;
    expect(isMissing(args, 'window')).toBe(true);
  });
});

describe('the spellings — declared formats, never phrases', () => {
  it.each([
    ['lookback', '30m', true],
    ['lookback', '24h', true],
    ['lookback', '7d', true],
    ['lookback', '2w', true],
    ['lookback', '0h', false],
    ['lookback', '-24h', false],
    ['lookback', 'last week', false],
    ['signed-lookback', '-24h', true],
    ['signed-lookback', '24h', false],
    ['iso-range', '2026-09-01T00:00:00Z..2026-09-02T00:00:00Z', true],
    ['iso-range', '2026-09-01T00:00:00+02:00..2026-09-02T00:00:00+02:00', true],
    ['iso-range', '2026-09-01..2026-09-02', false],
    ['iso-range', '2026-09-01T00:00:00Z', false],
  ] as const)('%s: %s → %s', (spelling, value, ok) => {
    expect(parsesUnderSpelling(value, spelling)).toBe(ok);
  });
});

describe('sameArgumentValue — the evidence module’s same-value rule', () => {
  it('equal under the normaliser, same type', () => {
    expect(sameArgumentValue('2h', '2h')).toBe(true);
    expect(sameArgumentValue('2H', '2h')).toBe(true);
    expect(sameArgumentValue('41,200', '41200')).toBe(true);
    expect(sameArgumentValue(5, 5)).toBe(true);
    expect(sameArgumentValue(true, true)).toBe(true);
  });

  it('not equal across types, across tokens, or with nothing to compare', () => {
    expect(sameArgumentValue('5', 5)).toBe(false);
    expect(sameArgumentValue('-24h', '24h')).toBe(false);
    expect(sameArgumentValue('2h', '24h')).toBe(false);
    expect(sameArgumentValue('—', '—')).toBe(false);
    expect(sameArgumentValue(undefined, '2h')).toBe(false);
  });
});

describe('rulesOf — the dispatch re-read', () => {
  it('reads a defined tool’s rules, the period flag on its argument', () => {
    const tool = defineTool({
      name: 'search_logs',
      description: 'd',
      inputSchema: SCHEMA,
      askOrAssume: { window: { assume: '2h' }, limit: { assume: 50 } },
      period: { argument: 'window', spelling: 'lookback' },
      execute: () => 'ok',
    });
    const rules = rulesOf(tool);
    expect(isRefused(rules)).toBe(false);
    expect(rules).toEqual({
      ruled: [
        { argument: 'window', rule: 'assume', assume: '2h', type: 'string', period: true },
        { argument: 'limit', rule: 'assume', assume: 50, type: 'integer' },
      ],
      period: { argument: 'window', spelling: 'lookback' },
    });
  });

  it('reads an ask rule: the question, the choices’ values in declared order, the type', () => {
    const tool = defineTool({
      name: 'search_logs',
      description: 'd',
      inputSchema: SCHEMA,
      askOrAssume: {
        window: { ask: 'Which period?', choices: [{ value: '24h', said: ['last day'] }, '1h'] },
        service: { ask: 'Which service?' },
      },
      period: { argument: 'window', spelling: 'lookback' },
      execute: () => 'ok',
    });
    expect(rulesOf(tool)).toEqual({
      ruled: [
        {
          argument: 'window',
          rule: 'ask',
          ask: { question: 'Which period?', choices: ['24h', '1h'] },
          type: 'string',
          period: true,
        },
        { argument: 'service', rule: 'ask', ask: { question: 'Which service?' }, type: 'string' },
      ],
      period: { argument: 'window', spelling: 'lookback' },
    });
  });

  it('refuses a hand-built rule that never passed defineTool — never repaired', () => {
    const handBuilt = {
      schema: { name: 'hand', description: 'd', inputSchema: SCHEMA },
      askOrAssume: { window: { assume: '9h' } },
      execute: () => 'ok',
    } as unknown as Tool;
    const rules = rulesOf(handBuilt);
    expect(isRefused(rules)).toBe(true);
    expect((rules as { refused: string }).refused).toMatch(/defineTool\('hand'\)/);
  });

  it('a tool with no declaration has no rules', () => {
    expect(rulesOf(defineTool({ name: 'p', description: 'd', execute: () => 1 }))).toBeUndefined();
    expect(rulesOf(undefined)).toBeUndefined();
  });
});
