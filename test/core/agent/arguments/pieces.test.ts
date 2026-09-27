/**
 * The inputs layer's pure pieces — each one owner, each tested alone.
 *
 * Test types (Convention 3):
 *   - UNIT — the four steps of `resolve.ts`; the served decoration and the
 *            sentences of `serve.ts`; the row builder and the checkpoint door's
 *            arm (`rows.ts`); the ledger's pure half (`appendRows`: pure, no
 *            conflict for argument rows, the turn stamp); the tool-bytes
 *            boundary and the declared-default exemption (`evidenceIndex.ts`);
 *            Route's lifted predicate (`willDispatch`); the conventions rows
 *            for `sf-inputs`;
 *   - CONTRACT — `validateCheckpoint` accepts a checkpoint carrying argument
 *            rows and refuses a malformed one.
 */

import { describe, expect, it } from 'vitest';

import { defineTool, type Tool } from '../../../../src/index.js';
import {
  declareBatch,
  resolutionsOf,
  rowsOf,
  verifyPlan,
  type BatchCall,
} from '../../../../src/core/agent/arguments/resolve.js';
import {
  ASSUMED_BLOCK_HEADING,
  assumedBlock,
  filledNote,
  printedValue,
  unmountedRulesRefusal,
  unreadableRulesRefusal,
  withArgumentRules,
} from '../../../../src/core/agent/arguments/serve.js';
import {
  argumentRowIsWellFormed,
  argumentRowOf,
  shownValue,
} from '../../../../src/core/agent/arguments/rows.js';
import { appendRows } from '../../../../src/core/agent/findings/ledger.js';
import type { FindingsRow } from '../../../../src/core/agent/findings/types.js';
import {
  evidenceFromHistory,
  exemptFromRun,
  toolBytesOf,
} from '../../../../src/core/agent/evidence/evidenceIndex.js';
import { willDispatch } from '../../../../src/core/agent/stages/route.js';
import { validateCheckpoint } from '../../../../src/core/runCheckpoint.js';
import {
  SUBFLOW_IDS,
  STAGE_IDS,
  milestoneFor,
  milestoneTagsFor,
  stageRole,
} from '../../../../src/conventions.js';
import { SHOWN_ARGS } from '../../../../src/core/toolShownArgs.js';

const SCHEMA = {
  type: 'object',
  required: ['service', 'window'],
  properties: {
    service: { type: 'string' },
    window: { type: 'string', enum: ['1h', '2h', '24h'], description: 'Look-back period.' },
    limit: { type: 'integer' },
  },
} as const;

const ruled = defineTool({
  name: 'search_logs',
  description: 'd',
  inputSchema: SCHEMA,
  askOrAssume: { window: { assume: '2h' }, limit: { assume: 50 } },
  period: { argument: 'window', spelling: 'lookback' },
  execute: () => 'ok',
});
const free = defineTool({ name: 'list_services', description: 'd', execute: () => [] });
const toolOf = (name: string): Tool | undefined =>
  name === 'search_logs' ? (ruled as Tool) : name === 'list_services' ? (free as Tool) : undefined;

const batch: BatchCall[] = [
  { id: 'c1', name: 'search_logs', args: { service: 'a' } }, // both missing
  { id: 'c2', name: 'search_logs', args: { service: 'b', window: '2h', limit: 10 } }, // echo + model
  { id: 'c3', name: 'list_services', args: {} }, // free
];

describe('resolve.ts — the four steps, pure', () => {
  const plan = declareBatch(batch, toolOf);
  const checked = verifyPlan(plan, batch, toolOf);

  it('DECLARE plans only ruled calls, marking what is missing — identities and a flag, no value', () => {
    expect(plan).toEqual([
      {
        toolCallId: 'c1',
        toolName: 'search_logs',
        ruled: [
          { argument: 'window', rule: 'assume', period: true, missing: true },
          { argument: 'limit', rule: 'assume', missing: true },
        ],
      },
      {
        toolCallId: 'c2',
        toolName: 'search_logs',
        ruled: [
          { argument: 'window', rule: 'assume', period: true, missing: false },
          { argument: 'limit', rule: 'assume', missing: false },
        ],
      },
    ]);
  });

  it('VERIFY — missing is a fill, the default is `default`, anything else is `model`', () => {
    expect(checked.map((c) => [c.toolCallId, c.argument, c.source, c.filled ?? false])).toEqual([
      ['c1', 'window', 'default', true],
      ['c1', 'limit', 'default', true],
      ['c2', 'window', 'default', false],
      ['c2', 'limit', 'model', false],
    ]);
  });

  it('RECORD — the rows, stamped; `proposed` only on a default the model sent', () => {
    const rows = rowsOf(checked, batch, toolOf, { turn: 3, iteration: 2 });
    expect(rows.map((r) => [r.toolCallId, r.argument, r.source, r.value, r.proposed])).toEqual([
      ['c1', 'window', 'default', '2h', undefined],
      ['c1', 'limit', 'default', '50', undefined],
      ['c2', 'window', 'default', '2h', '2h'],
      ['c2', 'limit', 'model', '10', undefined],
    ]);
    expect(rows.every((r) => r.turn === 3 && r.iteration === 2)).toBe(true);
    expect(rows.every(argumentRowIsWellFormed)).toBe(true);
  });

  it('RESOLVE — the raw fills per call, stamped with the iteration; nothing for a call that runs as sent', () => {
    expect(resolutionsOf(plan, checked, toolOf, 2)).toEqual([
      {
        toolCallId: 'c1',
        iteration: 2,
        fills: [
          { argument: 'window', value: '2h', source: 'default' },
          { argument: 'limit', value: 50, source: 'default' },
        ],
      },
    ]);
  });

  it('a hand-built rule the re-read refuses plans a refusal — and resolves to its sentence', () => {
    const broken = { ...ruled, askOrAssume: { window: { assume: '9h' } } } as unknown as Tool;
    const refusedPlan = declareBatch([batch[0]!], () => broken);
    expect(refusedPlan[0]!.refused).toMatch(/askOrAssume\.window\.assume/);
    expect(verifyPlan(refusedPlan, [batch[0]!], () => broken)).toEqual([]);
    const [entry] = resolutionsOf(refusedPlan, [], () => broken, 1);
    expect(entry!.refused).toMatch(
      /^search_logs was not run on that call: its argument rules could not be read \(askOrAssume\.window\.assume/,
    );
  });

  it('is deterministic — the same inputs give the same outputs', () => {
    const again = rowsOf(verifyPlan(declareBatch(batch, toolOf), batch, toolOf), batch, toolOf, {
      turn: 3,
      iteration: 2,
    });
    expect(again).toEqual(rowsOf(checked, batch, toolOf, { turn: 3, iteration: 2 }));
  });
});

describe('serve.ts — what the layer says', () => {
  it('the decoration drops assumed arguments from `required` and says the rule; the registry schema is untouched', () => {
    const served = withArgumentRules(ruled.schema, ruled as Tool);
    expect(served.inputSchema.required).toEqual(['service']);
    const props = served.inputSchema.properties as Record<string, { description?: string }>;
    expect(props.window!.description).toBe(
      'Look-back period. If left out, the tool\'s rule fills "2h", recorded as assumed.',
    );
    expect(props.limit!.description).toBe(
      "If left out, the tool's rule fills 50, recorded as assumed.",
    );
    expect(props.service).toBe(SCHEMA.properties.service);
    expect(ruled.schema.inputSchema.required).toEqual(['service', 'window']);
  });

  it('the SAME reference back for no tool, a tool with no rules, or rules that cannot be read', () => {
    expect(withArgumentRules(free.schema, free as Tool)).toBe(free.schema);
    expect(withArgumentRules(ruled.schema, undefined)).toBe(ruled.schema);
    const broken = { ...ruled, askOrAssume: { window: { assume: '9h' } } } as unknown as Tool;
    expect(withArgumentRules(ruled.schema, broken)).toBe(ruled.schema);
  });

  it('drops `required` entirely when every required argument is ruled', () => {
    const allRuled = defineTool({
      name: 't',
      description: 'd',
      inputSchema: { type: 'object', required: ['w'], properties: { w: { type: 'string' } } },
      askOrAssume: { w: { assume: 'x' } },
      execute: () => 1,
    });
    expect(withArgumentRules(allRuled.schema, allRuled as Tool).inputSchema).not.toHaveProperty(
      'required',
    );
  });

  it('never prints a value the tool’s own view hides', () => {
    const hiding = {
      ...ruled,
      [SHOWN_ARGS]: (args: Record<string, unknown>) =>
        'window' in args ? { ...args, window: 'REDACTED' } : args,
    } as unknown as Tool;
    const props = withArgumentRules(ruled.schema, hiding).inputSchema.properties as Record<
      string,
      { description?: string }
    >;
    expect(props.window!.description).toContain("hidden by the tool's view");
    expect(props.window!.description).not.toContain('2h');
    expect(
      filledNote('search_logs', [{ argument: 'window', value: '2h', hidden: true }]),
    ).not.toContain('2h');
  });

  it('the note is past tense and names the call it answers', () => {
    expect(filledNote('search_logs', [{ argument: 'window', value: '2h', hidden: false }])).toBe(
      '\n\n[window was not in the search_logs call this result answers; the call ran with "2h", ' +
        "the value the tool's rule assumes — recorded as assumed, not as the person's.]",
    );
    expect(printedValue(5)).toBe('5');
    expect(printedValue(true)).toBe('true');
  });

  it('the refusals', () => {
    expect(unmountedRulesRefusal('search_logs')).toBe(
      'search_logs was not run on that call: it declares argument rules this agent was not built to apply.',
    );
    expect(
      unreadableRulesRefusal('search_logs', "defineTool('search_logs'): askOrAssume.window — bad"),
    ).toBe(
      'search_logs was not run on that call: its argument rules could not be read (askOrAssume.window — bad).',
    );
  });

  it('the "Assumed" block: one line per distinct value; empty when nothing was assumed', () => {
    expect(assumedBlock([])).toBe('');
    expect(
      assumedBlock([
        { toolName: 'search_logs', argument: 'window', value: '2h', hidden: false },
        { toolName: 'search_logs', argument: 'window', value: '2h', hidden: false },
        { toolName: 'io_profile', argument: 'time_range', value: 'REDACTED', hidden: true },
      ]),
    ).toBe(
      `${ASSUMED_BLOCK_HEADING}\n- window = "2h" (search_logs)\n` +
        "- time_range (its value is hidden by the tool's view) (io_profile)",
    );
  });
});

describe('rows.ts — the row and its door', () => {
  it('clips a long value, prints numbers and booleans bare', () => {
    expect(shownValue('x'.repeat(200)).length).toBe(80);
    expect(shownValue(7)).toBe('7');
    expect(shownValue(false)).toBe('false');
  });

  it('the door accepts what the writer files, and refuses what it never could', () => {
    const row = argumentRowOf(
      {
        toolCallId: 'c1',
        toolName: 't',
        argument: 'w',
        rule: 'assume',
        source: 'default',
        shownValue: '2h',
      },
      { turn: 1, iteration: 1 },
    );
    expect(argumentRowIsWellFormed(row)).toBe(true);
    expect(argumentRowIsWellFormed({ ...row, turn: undefined })).toBe(false);
    expect(argumentRowIsWellFormed({ ...row, source: 'guessed' })).toBe(false);
    expect(argumentRowIsWellFormed({ ...row, source: undefined })).toBe(false);
    expect(argumentRowIsWellFormed({ ...row, source: undefined, asked: 'missing' })).toBe(true);
    expect(argumentRowIsWellFormed({ ...row, failed: 'made-up' })).toBe(false);
  });

  it('validateCheckpoint accepts argument rows, and refuses a malformed one', () => {
    const row = argumentRowOf(
      {
        toolCallId: 'c1',
        toolName: 't',
        argument: 'w',
        rule: 'assume',
        source: 'default',
        shownValue: '2h',
      },
      { turn: 1, iteration: 1 },
    );
    const cp = {
      version: 1,
      runId: 'r',
      history: [{ role: 'user', content: 'hi' }],
      lastCompletedIteration: 1,
      failurePoint: { phase: 'unknown', iteration: 1 },
      originalInput: { message: 'hi' },
      findingsLedger: [row],
    };
    expect(() => validateCheckpoint(cp)).not.toThrow();
    expect(() => validateCheckpoint({ ...cp, findingsLedger: [{ ...row, turn: 'one' }] })).toThrow(
      /'argument'/,
    );
  });
});

describe('findings/ledger.ts · appendRows — the pure half of the one writer', () => {
  const row = argumentRowOf(
    {
      toolCallId: 'c1',
      toolName: 't',
      argument: 'w',
      rule: 'assume',
      source: 'default',
      shownValue: '2h',
    },
    { turn: 1, iteration: 1 },
  );

  it('is pure: the inputs are not mutated, and argument rows file no conflict', () => {
    const prev: FindingsRow[] = [];
    const out = appendRows(prev, [row]);
    expect(prev).toEqual([]);
    expect(out.ledger).toEqual([row]);
    expect(out.newConflicts).toEqual([]);
  });

  it('stamps the turn on every row that carries none — and leaves a stamped row alone', () => {
    const basis: FindingsRow = {
      kind: 'basis',
      toolCallId: 'c2',
      toolName: 't',
      iteration: 1,
      basis: 'direct',
    };
    const out = appendRows([], [basis, { ...row, turn: 7 }], { turn: 2 });
    expect(out.ledger.map((r) => r.turn)).toEqual([2, 7]);
  });

  it('1,000 argument rows merge in one call (numbers recorded in the performance test)', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ ...row, toolCallId: `c${i}` }));
    expect(appendRows([], rows).ledger).toHaveLength(1000);
  });
});

describe('evidenceIndex.ts — the tool-bytes boundary and the declared defaults', () => {
  const annotated = {
    role: 'tool' as const,
    content: '{"errors":0}\n\n[window was not in the call; the call ran with "2h", assumed.]',
    toolCallId: 'c1',
    toolChars: '{"errors":0}'.length,
  };

  it('toolBytesOf cuts at the boundary, and reads a message without one whole', () => {
    expect(toolBytesOf(annotated)).toBe('{"errors":0}');
    const { toolChars: _cut, ...plain } = annotated;
    void _cut;
    expect(toolBytesOf(plain)).toBe(plain.content);
  });

  it('a value only the library’s note carries is NOT evidence — the laundering the boundary stops', () => {
    const cut = evidenceFromHistory([{ role: 'user', content: 'go' }, annotated]);
    expect(cut.values.has('2h')).toBe(false);
    expect(cut.values.has('0')).toBe(true);
    const { toolChars: _cut, ...plain } = annotated;
    void _cut;
    const whole = evidenceFromHistory([{ role: 'user', content: 'go' }, plain]);
    expect(whole.values.has('2h')).toBe(true);
  });

  it('declared defaults join the exempt corpus — the app’s own declaration', () => {
    const exempt = exemptFromRun({ history: [], declaredDefaults: ['2h', 'last 7 days'] });
    expect(exempt.has('2h')).toBe(true);
    expect(exempt.has('7')).toBe(true);
    expect(exemptFromRun({ history: [] }).has('2h')).toBe(false);
  });
});

describe('route.ts · willDispatch — the one dispatch test', () => {
  it.each([
    [{ callCount: 1, iteration: 1, maxIterations: 10 }, true],
    [{ callCount: 0, iteration: 1, maxIterations: 10 }, false],
    [{ callCount: 2, iteration: 10, maxIterations: 10 }, false],
    [{ callCount: 2, iteration: 3, maxIterations: 10, costBudgetHit: true }, true],
    [
      {
        callCount: 2,
        iteration: 3,
        maxIterations: 10,
        costBudgetHit: true,
        costBudgetOnExceed: 'warn',
      },
      true,
    ],
    [
      {
        callCount: 2,
        iteration: 3,
        maxIterations: 10,
        costBudgetHit: true,
        costBudgetOnExceed: 'halt',
      },
      false,
    ],
  ] as const)('%j → %s', (values, dispatches) => {
    expect(willDispatch(values)).toBe(dispatches);
  });
});

describe('conventions — sf-inputs is named', () => {
  it('plumbing for the renderer, a decision milestone for the scrubber', () => {
    expect(SUBFLOW_IDS.INPUTS).toBe('sf-inputs');
    expect(stageRole(SUBFLOW_IDS.INPUTS)).toBe('plumbing');
    expect(stageRole(`${SUBFLOW_IDS.INPUTS}/${STAGE_IDS.DECLARE_ARGUMENTS}`)).toBe('plumbing');
    expect(milestoneFor(`${SUBFLOW_IDS.INPUTS}#19`)).toEqual({ kind: 'decision', label: 'Inputs' });
    expect(milestoneTagsFor(SUBFLOW_IDS.INPUTS)).toEqual([
      'milestone:decision',
      'milestone-label:Inputs',
    ]);
  });
});
