/**
 * The library's OWN refusal sentences carry no absence and no non-existence
 * claim — pinned at the mint and at every dispatch door.
 *
 * The study behind this: a refusal that said more than its check ("No array
 * matches 'X' … a wrong identifier, not missing data") made models tell users
 * "X is not in your estate". A refused call read nothing, so whatever the
 * library says in place of a result must say what was refused and why, and
 * nothing about what exists.
 *
 * What is pinned, by the overclaim rule pack (`semantics/overclaim.ts`, the
 * packs `check:semantics` judges a consumer's refusals by):
 *   • no refusal carries an absence (`af_absent`) or `known_names`;
 *   • no refusal calls the input wrong (the wrongness pack, anywhere);
 *   • no sentence that names the value asked for says it does not exist
 *     (the non-existence pack, on every sentence carrying the sentinel);
 *   • the dispatch refusals — arguments, unknown tool, permission, the
 *     ceiling — and every `among` refusal carry no non-existence phrase at
 *     all. (A mint refusal about a declaration field — "`checked[0]` has no
 *     `why`" — is about the declaration, not the world, and names no value
 *     asked for.)
 *
 * Sections (Convention 3): Unit (the mints) · Unit (the dispatch sentences) ·
 * Integration (what the model reads in a real run).
 */

import { describe, expect, it } from 'vitest';

import {
  absent,
  Agent,
  coverage,
  defineTool,
  describedResult,
  type PermissionChecker,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { applyResultCeiling } from '../../src/core/agent/resultCeiling.js';
import { notServedResult, unknownToolResult } from '../../src/core/agent/stages/toolCalls.js';
import { formatToolArgIssues } from '../../src/tools/toolArgsValidation.js';
import { nonExistencePhrase, wrongnessPhrase } from '../../src/semantics/overclaim.js';
import type { LLMRequest, LLMResponse } from '../../src/provider-contract/types.js';

/** The value a caller asked for — it must never sit beside "does not exist". */
const SENTINEL = 'PS-ARRAY-77';

const AMONG = {
  argument: 'array_id',
  source: 'the PowerStore inventory export',
  measuredAt: '2026-10-22T09:14:00Z',
  count: 2,
  names: ['PS-ARRAY-01', 'PS-ARRAY-02'],
};

const messageOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected a refusal');
};

const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?])\s+/);

/** The pins every refusal sentence meets. */
function expectNoOverclaim(text: string): void {
  expect(text).not.toContain('af_absent');
  expect(text).not.toContain('known_names');
  expect(wrongnessPhrase(text), text).toBeUndefined();
  for (const sentence of sentencesOf(text).filter((s) => s.includes(SENTINEL))) {
    expect(nonExistencePhrase(sentence), sentence).toBeUndefined();
  }
}

// ── Unit — the mints' refusals ───────────────────────────────────────────

const AMONG_REFUSALS: readonly [string, () => unknown][] = [
  ['among not an object', () => absent({ what: SENTINEL, among: 'x' } as never)],
  [
    'an unknown among key',
    () => absent({ what: SENTINEL, among: { ...AMONG, nmes: [] } } as never),
  ],
  ['no argument', () => absent({ what: SENTINEL, among: { ...AMONG, argument: '' } })],
  ['no source', () => absent({ what: SENTINEL, among: { ...AMONG, source: '' } })],
  ['no measuredAt', () => absent({ what: SENTINEL, among: { ...AMONG, measuredAt: '' } })],
  ['a bad count', () => absent({ what: SENTINEL, among: { ...AMONG, count: -1 } })],
  ['names-count-mismatch', () => absent({ what: SENTINEL, among: { ...AMONG, count: 5 } })],
  ['names not a list', () => absent({ what: SENTINEL, among: { ...AMONG, names: 'x' } } as never)],
  [
    'a visible other than caller',
    () => absent({ what: SENTINEL, among: { ...AMONG, visible: 'all' } } as never),
  ],
  [
    'visible with no names',
    () => absent({ what: SENTINEL, among: { ...AMONG, names: undefined, visible: 'caller' } }),
  ],
  [
    'authoritative with no why',
    () => absent({ what: SENTINEL, among: { ...AMONG, authoritative: {} } } as never),
  ],
  [
    'provenance beside among',
    () =>
      absent({
        what: SENTINEL,
        among: AMONG,
        provenance: { measuredAt: 't', source: 's' },
      } as never),
  ],
];

const MINT_REFUSALS: readonly [string, () => unknown][] = [
  ['absent: no checked', () => absent({ what: SENTINEL, checked: [] })],
  [
    'absent: a snake_case key',
    () => absent({ what: SENTINEL, checked: ['x'], not_checked: ['y'] } as never),
  ],
  [
    'absent: cannotCover with no why',
    () => absent({ what: SENTINEL, checked: ['x'], cannotCover: ['y'] }),
  ],
  [
    'absent: a typed tool in the sentence slot',
    () => absent({ what: SENTINEL, checked: ['x'], tryInstead: { tool: 't' } } as never),
  ],
  [
    'absent: a list of tools',
    () => absent({ what: SENTINEL, checked: ['x'], tryInsteadTool: [{ tool: 't' }] } as never),
  ],
  [
    'absent: a provenance with no source',
    () => absent({ what: SENTINEL, checked: ['x'], provenance: { measuredAt: 't' } } as never),
  ],
  [
    'absent: a period with no zone',
    () =>
      absent({
        what: SENTINEL,
        checked: ['x'],
        period: { queried: { from: '2026-10-22T09:00', to: '2026-10-22T10:00' }, held: 'unknown' },
      } as never),
  ],
  [
    'coverage: a snake_case key',
    () => coverage({}, { checked: ['x'], not_checked: ['y'] } as never),
  ],
  [
    'describedResult: facts with no provenance',
    () => describedResult({ facts: [{ entity: SENTINEL }] } as never),
  ],
  [
    'describedResult: an empty list',
    () => describedResult({ facts: [], provenance: { measuredAt: 't', source: 's' } }),
  ],
  ...AMONG_REFUSALS,
];

describe('unit — every mint refusal reads as a refusal, never as an absence', () => {
  it.each(MINT_REFUSALS)('%s', (_label, fn) => {
    const text = messageOf(fn);
    expect(text).toMatch(/^refused: /);
    expectNoOverclaim(text);
  });

  it.each(AMONG_REFUSALS)('among, %s: no non-existence phrase anywhere', (_label, fn) => {
    expect(nonExistencePhrase(messageOf(fn))).toBeUndefined();
  });
});

// ── Unit — the dispatch doors' sentences ────────────────────────────────

const DISPATCH: readonly [string, string][] = [
  [
    'arguments that break the schema',
    formatToolArgIssues('array_detail', [
      { path: '', expected: 'required', got: 'array_id' },
      { path: 'array_id', expected: 'string', got: 'number' },
      { path: 'array_id', expected: 'one of "PS-ARRAY-01", "PS-ARRAY-02"', got: 'string' },
      {
        path: 'array_id',
        expected: 'string matching /^PS-ARRAY-0/',
        got: 'string',
        value: SENTINEL,
        hint: 'an array name from the inventory export',
      },
    ]),
  ],
  ['an unknown tool, names held', unknownToolResult(SENTINEL, { named: ['a'], held: true })],
  ['an unknown tool, nothing served', unknownToolResult(SENTINEL, { named: [], held: false })],
  ['a tool not served on that call', notServedResult(SENTINEL)],
  [
    'the result ceiling',
    applyResultCeiling('x'.repeat(50), {
      toolName: SENTINEL,
      ceiling: { maxChars: 10, narrowBy: ['array_id'] },
    })?.refusal ?? '',
  ],
];

describe('unit — the dispatch refusals say what was refused, never what exists', () => {
  it.each(DISPATCH)('%s', (_label, text) => {
    expect(text.length).toBeGreaterThan(0);
    expectNoOverclaim(text);
    expect(nonExistencePhrase(text), text).toBeUndefined();
  });
});

// ── Integration — what the model reads in a real run ────────────────────

describe('integration — the refusals a model reads in one run', () => {
  it('invalid arguments, an unknown tool, a denial, a ceiling and a mint refusal', async () => {
    const requests: LLMRequest[] = [];
    const inner = mock({
      replies: [
        {
          toolCalls: [
            { id: 'c1', name: 'array_detail', args: { array_id: 42 } },
            { id: 'c2', name: 'no_such_tool', args: { array_id: SENTINEL } },
            { id: 'c3', name: 'guarded_lookup', args: { array_id: SENTINEL } },
            { id: 'c4', name: 'array_dump', args: { array_id: SENTINEL } },
            { id: 'c5', name: 'array_detail', args: { array_id: SENTINEL } },
          ],
        },
        { content: 'done' },
      ],
    });
    const provider = {
      name: inner.name,
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        requests.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
        return inner.complete(req);
      },
    };
    const schema = {
      type: 'object',
      properties: { array_id: { type: 'string' } },
      required: ['array_id'],
    } as const;
    const checker: PermissionChecker = {
      name: 'deny-guarded',
      check: async ({ target }) =>
        target === 'guarded_lookup' ? { result: 'deny' } : { result: 'allow' },
    };
    const agent = Agent.create({ provider, model: 'mock', permissionChecker: checker })
      .tools([
        defineTool({
          name: 'array_detail',
          description: 'one array by name',
          inputSchema: schema,
          // A mint refusal thrown inside execute becomes the call's error result.
          execute: ({ array_id }: { array_id: string }) =>
            absent({ what: array_id, among: { ...AMONG, count: 9 } }),
        }),
        defineTool({
          name: 'guarded_lookup',
          description: 'a lookup a policy denies',
          inputSchema: schema,
          execute: () => 'never',
        }),
        defineTool({
          name: 'array_dump',
          description: 'every array, verbatim',
          inputSchema: schema,
          resultCeiling: { maxChars: 20 },
          execute: () => 'y'.repeat(200),
        }),
      ])
      .build();
    await agent.run({ message: `details of ${SENTINEL}?` });
    const read = (requests[requests.length - 1]?.messages ?? [])
      .filter((m) => m.role === 'tool')
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));
    expect(read).toHaveLength(5);
    for (const text of read) expectNoOverclaim(text);
    // The mint refusal the model read names the mismatch, and nothing more.
    expect(read[4]).toContain('names-count-mismatch');
  });
});
