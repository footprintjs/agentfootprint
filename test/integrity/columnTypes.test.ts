/**
 * column-types (9.78.0) — the tool declared what its rows contain, and the
 * rows say otherwise.
 *
 * THE FIELD FAILURES this is built from. Three, and they are one shape — a
 * number became something else, and nothing noticed at the seam:
 *
 *  1. A mapping report wrote `str(m.get("logical_unit_number") or "")`. LUN 0
 *     is FALSY, so LUN 0 was stored as an EMPTY STRING on 2,094 mappings, and
 *     a host group missing the LUN an initiator probes first was
 *     indistinguishable from one that had it.
 *  2. A capacity view rendered `round(mib / 1024, 1)`, so an 8 MiB disk came
 *     out as `0.0 GB` — which reads as NO DISK during a live incident.
 *  3. A whole family of tools returned their numbers as quoted strings
 *     (`"1240"`), which silently blanked every chart, because nothing
 *     downstream could tell a measure from a label.
 *
 * The laws under test:
 *  (a) THE TYPE COMPARISON — a declared column whose rows hold something else
 *      files `column-type-mismatch`, naming the column, the offending value,
 *      the row count and the tool. Cases 1 and 3;
 *  (b) THE MISSING BRANCH — a declared column present in NO row files
 *      `missing-column` instead, and never both. This is the distinction the
 *      LUN failure actually turned on;
 *  (c) THE CEILING — case 2 PASSES, because `0.0` is a good number; the
 *      ceiling sentence rides every finding verbatim and says so;
 *  (d) OPEN, NEVER CLOSED — an unlisted column is never judged;
 *  (e) DEFAULT OFF — without the dial the run is byte-identical, save the
 *      registered not-applicable rows the family's law demands;
 *  (f) ENFORCE — a real refusal in the library's own refusal idiom: the model
 *      reads a teaching sentence instead of the rows;
 *  (g) MCP TRAVEL — the declaration crosses `_meta` in both directions.
 *
 * NEUTRALIZE-PROOFS, the core two, stated so a future edit that guts one goes
 * red here (both are exercised by `describe('neutralize-proofs')` below):
 *   • THE TYPE COMPARISON — make `matchesType` answer `true` for everything
 *     (drop the comparison) and the numbers-as-strings case passes silently;
 *   • THE MISSING-COLUMN BRANCH — delete the `rows.every(row => !(name in
 *     row))` branch and the declared-but-never-delivered case passes as a
 *     clean rowset, because a column no row has is a column no row disagrees
 *     with.
 *
 * Test types (Convention 3): unit (the pure judgement + the readings) /
 * functional (the three field cases through the real loop) / contract (the
 * disposition rows, the ceiling on the record, the two kinds) / negative
 * (bespoke shapes, unlisted columns, malformed declarations) / zero-delta
 * (the dial absent) / integration (MCP round-trip).
 */

import { describe, expect, it } from 'vitest';
import {
  COLUMN_TYPE_CEILING,
  columnTypesOf,
  readRowset,
  type ColumnTypesCall,
} from '../../src/integrity/column-types/check.js';
import { assertResultColumns, normalizeColumns } from '../../src/integrity/column-types/types.js';
import { beginIntegrityRun } from '../../src/integrity/disposition/lifecycle.js';
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { readToolExtras, toolExtrasOf } from '../../src/lib/mcp/toolExtras.js';
import type { CheckReport } from '../../src/integrity/disposition/types.js';
import type { ContextError } from '../../src/integrity/finding/types.js';

// The anonymized field case, as fixture vocabulary. A storage agent asks for
// the LUN mappings of a host group; the report that produced them lost every
// LUN 0 to a falsy check.
const TOOL = 'host_group_mappings';

const judge = (
  columns: ColumnTypesCall['columns'],
  rows: unknown,
  mode: ColumnTypesCall['mode'] = 'warn',
) =>
  columnTypesOf(
    { toolName: TOOL, toolCallId: 'call-2', columns, reading: readRowset(rows), mode },
    0,
  );

// ---------------------------------------------------------------------------
// The readings, on their own
// ---------------------------------------------------------------------------

describe('unit: readRowset — what the library will and will not read', () => {
  it('an array of plain objects with rows IS a rowset', () => {
    expect(readRowset([{ a: 1 }, { a: 2 }])).toEqual({ rows: [{ a: 1 }, { a: 2 }] });
  });

  it('a ZERO-ROW array is declined — an empty answer has no columns to be wrong about', () => {
    // Deliberately the neighbour's subject (`empty-lookup`), not this one's.
    // Filing `missing-column` for every declared column of an empty result
    // would turn one honest emptiness into a pile of false accusations.
    expect(readRowset([])).toBeUndefined();
  });

  it('a non-array is declined — prose, null, a wrapper, a ticket', () => {
    expect(readRowset('the host group has three mappings')).toBeUndefined();
    expect(readRowset(null)).toBeUndefined();
    expect(readRowset({ rows: [{ a: 1 }] })).toBeUndefined();
  });

  it('an array of non-objects is declined — a list of strings has no columns', () => {
    expect(readRowset(['a', 'b'])).toBeUndefined();
    expect(readRowset([{ a: 1 }, 'b'])).toBeUndefined();
    expect(readRowset([[1, 2]])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The pure judgement
// ---------------------------------------------------------------------------

describe('unit: the type comparison — field case 1, the falsy LUN 0', () => {
  it('a number column holding an EMPTY STRING is a mismatch naming column, value, count and tool', () => {
    const out = judge({ logical_unit_number: 'number', host_group: 'string' }, [
      { logical_unit_number: '', host_group: 'vdi-a' },
      { logical_unit_number: 3, host_group: 'vdi-a' },
      { logical_unit_number: '', host_group: 'vdi-b' },
    ]);
    expect(out.disposition).toBe('checked-fail');
    const mine = out.findings.filter((f) => f.kind === 'column-type-mismatch');
    expect(mine).toHaveLength(1);
    const f = mine[0]!;
    expect(f.seam).toBe('write');
    expect(f.predicate).toBe('logical_unit_number');
    expect(f.subjects).toEqual([{ kind: 'tool', id: TOOL }]);
    // The column, the offending value QUOTED, the row count affected, the tool.
    expect(f.message).toContain("'logical_unit_number'");
    expect(f.message).toContain('""');
    expect(f.message).toContain('2 of 3 rows');
    expect(f.message).toContain(TOOL);
    // Never an advisory: a column declared `number` that holds a string is a
    // broken promise, not a place to look.
    expect(f.advisory).toBeUndefined();
  });

  it('THE CEILING rides the message verbatim', () => {
    const out = judge({ lun: 'number' }, [{ lun: '' }]);
    expect(out.findings[0]!.message).toContain(COLUMN_TYPE_CEILING);
  });

  it('field case 2 — the 0.0 GB disk — PASSES, and that is the ceiling made concrete', () => {
    // `round(8 / 1024, 1)` is 0.0. It reads as NO DISK to a person, and this
    // check cannot see that: 0.0 is a perfectly good number. The check says
    // so rather than letting a green row imply it looked at meaning.
    const out = judge({ capacity_gb: 'number' }, [{ capacity_gb: 0.0 }, { capacity_gb: 931.5 }]);
    expect(out.findings).toEqual([]);
    expect(out.disposition).toBe('checked-pass');
  });
});

describe('unit: the type comparison — field case 3, numbers as quoted strings', () => {
  it('every value of a number column arriving as a string is ONE finding with the full count', () => {
    const out = judge({ used_gb: 'number', pool: 'string' }, [
      { used_gb: '1240', pool: 'p1' },
      { used_gb: '890', pool: 'p2' },
      { used_gb: '77', pool: 'p3' },
    ]);
    const mine = out.findings.filter((f) => f.kind === 'column-type-mismatch');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.message).toContain('3 of 3 rows');
    expect(mine[0]!.message).toContain('"1240"');
    expect(mine[0]!.message).toContain('(string)');
    // The clean column beside it files nothing — one finding per column.
    expect(mine[0]!.predicate).toBe('used_gb');
  });

  it('two broken columns are TWO findings — the column name is the discriminator', () => {
    const out = judge({ used_gb: 'number', free_gb: 'number' }, [
      { used_gb: '1240', free_gb: '10' },
    ]);
    expect(out.findings.map((f) => f.predicate).sort()).toEqual(['free_gb', 'used_gb']);
  });
});

describe('unit: the missing branch — declared, and in no row at all', () => {
  it('a declared column present in NO row is `missing-column`, and never also a mismatch', () => {
    const out = judge({ logical_unit_number: 'number', host_group: 'string' }, [
      { host_group: 'vdi-a' },
      { host_group: 'vdi-b' },
    ]);
    const kinds = out.findings.map((f) => f.kind);
    expect(kinds).toEqual(['missing-column']);
    const f = out.findings[0]!;
    expect(f.predicate).toBe('logical_unit_number');
    expect(f.message).toContain('NONE of the 2 rows');
    expect(f.message).toContain('not a mistyped value');
    expect(f.message).toContain(COLUMN_TYPE_CEILING);
    expect(out.disposition).toBe('checked-fail');
  });

  it('present in SOME rows is a mismatch, not a missing column — the two are different states', () => {
    // This is the distinction the LUN failure turned on. A column that is
    // there but wrong sends a person to the mapping code; a column that was
    // never delivered sends them to the query.
    const out = judge({ lun: 'number' }, [{ lun: 0 }, { host_group: 'vdi-b' }]);
    expect(out.findings.map((f) => f.kind)).toEqual(['column-type-mismatch']);
    expect(out.findings[0]!.message).toContain('1 of 2 rows');
  });

  it('a missing column and a mistyped column in one result are two DIFFERENT findings', () => {
    const out = judge({ lun: 'number', comment: 'string' }, [{ lun: '' }]);
    expect(out.findings.map((f) => f.kind).sort()).toEqual([
      'column-type-mismatch',
      'missing-column',
    ]);
  });
});

describe('unit: nullable, and what "no value" means', () => {
  it('null, undefined and an ABSENT KEY are one idea, and by default all three are violations', () => {
    const out = judge({ lun: 'number' }, [
      { lun: 1 },
      { lun: null },
      { lun: undefined },
      { other: true },
    ]);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.kind).toBe('column-type-mismatch');
    expect(out.findings[0]!.message).toContain('3 of 4 rows');
  });

  it('a finding about an absence NAMES the one-word fix', () => {
    const out = judge({ lun: 'number' }, [{ lun: null }]);
    expect(out.findings[0]!.message).toContain('nullable: true');
  });

  it('`nullable: true` makes every spelling of nothing legitimate', () => {
    const out = judge({ lun: { type: 'number', nullable: true } }, [
      { lun: 1 },
      { lun: null },
      { other: true },
    ]);
    expect(out.findings).toEqual([]);
    expect(out.disposition).toBe('checked-pass');
  });

  it('`nullable` does NOT excuse a column absent from EVERY row — two different promises', () => {
    // `nullable` is a promise about VALUES; the declaration is a promise
    // about the COLUMN. The valve for "this column may not be there" is to
    // not declare it, because unlisted columns are never judged.
    const out = judge({ lun: { type: 'number', nullable: true } }, [{ other: 1 }]);
    expect(out.findings.map((f) => f.kind)).toEqual(['missing-column']);
  });

  it('`nullable` does not excuse a WRONG type', () => {
    const out = judge({ lun: { type: 'number', nullable: true } }, [{ lun: '' }]);
    expect(out.findings.map((f) => f.kind)).toEqual(['column-type-mismatch']);
  });
});

describe('unit: the vocabulary, member by member', () => {
  it('number requires a FINITE number — NaN is a number that means no number', () => {
    expect(judge({ n: 'number' }, [{ n: 0 }, { n: -1.5 }]).findings).toEqual([]);
    const out = judge({ n: 'number' }, [{ n: Number.NaN }]);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.message).toContain('NaN');
  });

  it('string accepts the EMPTY string — emptiness is meaning, and meaning is above the ceiling', () => {
    expect(judge({ s: 'string' }, [{ s: '' }]).findings).toEqual([]);
  });

  it('boolean is true or false, never a string and never 0/1', () => {
    expect(judge({ b: 'boolean' }, [{ b: true }, { b: false }]).findings).toEqual([]);
    expect(judge({ b: 'boolean' }, [{ b: 'true' }]).findings).toHaveLength(1);
    expect(judge({ b: 'boolean' }, [{ b: 1 }]).findings).toHaveLength(1);
  });

  it('date takes a valid Date or a parseable string; an EPOCH NUMBER is a number, and says so', () => {
    expect(judge({ d: 'date' }, [{ d: new Date('2026-08-30') }]).findings).toEqual([]);
    expect(judge({ d: 'date' }, [{ d: '2026-08-30T10:00:00Z' }]).findings).toEqual([]);
    expect(judge({ d: 'date' }, [{ d: new Date('nonsense') }]).findings).toHaveLength(1);
    // An axis picker TOLD `date` and handed 1756540800000 renders 1970-to-now.
    expect(judge({ d: 'date' }, [{ d: 1756540800000 }]).findings).toHaveLength(1);
  });
});

describe('unit: open, never closed', () => {
  it('an UNLISTED column is allowed and never judged', () => {
    const out = judge({ lun: 'number' }, [
      { lun: 0, whatever: { deeply: 'nested' }, added_by_the_backend_last_tuesday: null },
    ]);
    expect(out.findings).toEqual([]);
    expect(out.disposition).toBe('checked-pass');
  });
});

describe('unit: the shapes the check declines to read', () => {
  it('a bespoke result is `not-applicable` with NO finding — the row is the point', () => {
    for (const bespoke of ['three mappings', null, { rows: [] }, [], ['a']]) {
      const out = judge({ lun: 'number' }, bespoke);
      expect(out.findings).toEqual([]);
      expect(out.disposition).toBe('not-applicable');
    }
  });
});

// ---------------------------------------------------------------------------
// The declaration's own rules
// ---------------------------------------------------------------------------

describe('unit: normalizeColumns — two spellings, one meaning', () => {
  it('a bare type and the object form normalize to the same shape, in declaration order', () => {
    expect(
      normalizeColumns({ a: 'number', b: { type: 'string' }, c: { type: 'date', nullable: true } }),
    ).toEqual([
      { name: 'a', type: 'number', nullable: false },
      { name: 'b', type: 'string', nullable: false },
      { name: 'c', type: 'date', nullable: true },
    ]);
  });
});

describe('negative: a declaration this library cannot honour fails at defineTool', () => {
  const define = (resultColumns: unknown) =>
    defineTool({
      name: TOOL,
      description: 'd',
      inputSchema: { type: 'object', properties: {} },
      resultColumns: resultColumns as never,
      execute: () => [],
    });

  it('an unknown type is refused, naming the whole vocabulary and the missing `unknown`', () => {
    expect(() => define({ lun: 'integer' })).toThrow(/not a column type this library has/);
    expect(() => define({ lun: 'integer' })).toThrow(/number, string, boolean, date/);
    expect(() => define({ lun: 'unknown' })).toThrow(/deliberately no 'unknown'/);
  });

  it('an EMPTY map is refused — omitting the field is how "nothing promised" is said', () => {
    expect(() => define({})).toThrow(/promises nothing/);
  });

  it('a non-map is refused, naming the shape it wanted', () => {
    expect(() => define(['lun'])).toThrow(/not a map of column name to type/);
    expect(() => define('number')).toThrow(/not a map of column name to type/);
  });

  it('a non-boolean `nullable` is refused', () => {
    expect(() => define({ lun: { type: 'number', nullable: 'yes' } })).toThrow(
      /nullable = "yes", which is not a boolean/,
    );
  });

  it('a blank column name is refused — a finding must have something to point at', () => {
    expect(() => define({ '  ': 'number' })).toThrow(/blank column name/);
  });

  it('an absent declaration is silence, not an error', () => {
    expect(() => assertResultColumns(TOOL, undefined)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Through the real loop
// ---------------------------------------------------------------------------

const mappings = (rows: unknown, columns?: Record<string, unknown>) =>
  defineTool({
    name: TOOL,
    description: 'The LUN mappings of a host group.',
    inputSchema: {
      type: 'object',
      properties: { host_group: { type: 'string' } },
      required: ['host_group'],
    },
    ...(columns !== undefined && { resultColumns: columns as never }),
    execute: () => rows,
  });

const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use' as const,
});
const answered = {
  content: 'Host group vdi-a has three mappings.',
  toolCalls: [],
  stopReason: 'stop' as const,
};
const script = () => [call('c1', TOOL, { host_group: 'vdi-a' }), answered];

interface RunOut {
  readonly findings: ContextError[];
  readonly rows: CheckReport[];
  readonly answer: string;
  readonly served: string[];
}

async function runWith(
  tool: ReturnType<typeof mappings>,
  options: { mode?: 'off' | 'warn' | 'enforce'; posture?: 'observe' | 'dev' } = {},
): Promise<RunOut> {
  const findings: ContextError[] = [];
  const served: string[] = [];
  let rows: CheckReport[] = [];
  const agent = Agent.create({
    provider: mock({ replies: script() }),
    model: 'mock',
    maxIterations: 6,
    ...(options.mode !== undefined && { checkColumnTypes: options.mode }),
    ...(options.posture !== undefined && { integrityPosture: options.posture }),
  })
    .system('You are a storage triage assistant.')
    .tool(tool)
    .build();
  agent.on('agentfootprint.integrity.context_error', (e) => {
    findings.push(e.payload as unknown as ContextError);
  });
  agent.on('agentfootprint.integrity.disposition', (e) => {
    rows = e.payload.rows as CheckReport[];
  });
  agent.on('agentfootprint.stream.tool_end', (e) => {
    const result = (e.payload as { result?: unknown }).result;
    served.push(typeof result === 'string' ? result : JSON.stringify(result));
  });
  const answer = await agent.run('what are vdi-a mappings?');
  return { findings, rows, answer: String(answer), served };
}

const rowFor = (rows: CheckReport[], check: string): CheckReport =>
  rows.find((r) => r.check === check && r.seam === 'write')!;

const LUN_COLUMNS = { logical_unit_number: 'number', host_group: 'string' };

describe('functional: the three field cases, through the real loop', () => {
  it('FIELD CASE 1 — the falsy LUN 0 stored as "" files a mismatch and changes nothing', async () => {
    const out = await runWith(
      mappings(
        [
          { logical_unit_number: '', host_group: 'vdi-a' },
          { logical_unit_number: 3, host_group: 'vdi-a' },
        ],
        LUN_COLUMNS,
      ),
      { mode: 'warn' },
    );
    const mine = out.findings.filter((f) => f.kind === 'column-type-mismatch');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.message).toContain('logical_unit_number');
    expect(mine[0]!.message).toContain('1 of 2 rows');
    expect(mine[0]!.message).toContain(COLUMN_TYPE_CEILING);
    // `warn` NOTICES. The model read the rows exactly as the tool returned
    // them, and the answer is untouched.
    expect(out.answer).toContain('three mappings');
    expect(out.served.some((s) => s.includes('vdi-a'))).toBe(true);
    expect(rowFor(out.rows, 'column-type-mismatch')).toMatchObject({
      checked: 1,
      findings: 1,
    });
    // The sibling check ran on the same encounter and passed — every column
    // WAS present, which is a different fact from every column being right.
    expect(rowFor(out.rows, 'missing-column')).toMatchObject({ checked: 1, findings: 0 });
  });

  it('FIELD CASE 3 — a numeric column arriving as quoted strings', async () => {
    const out = await runWith(
      mappings([{ used_gb: '1240' }, { used_gb: '890' }], { used_gb: 'number' }),
      { mode: 'warn' },
    );
    const mine = out.findings.filter((f) => f.kind === 'column-type-mismatch');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.message).toContain('2 of 2 rows');
    expect(mine[0]!.message).toContain('"1240"');
  });

  it('THE MISSING COLUMN — declared and delivered by no row', async () => {
    const out = await runWith(
      mappings([{ host_group: 'vdi-a' }, { host_group: 'vdi-b' }], LUN_COLUMNS),
      { mode: 'warn' },
    );
    expect(out.findings.map((f) => f.kind)).toEqual(['missing-column']);
    expect(out.findings[0]!.predicate).toBe('logical_unit_number');
    expect(rowFor(out.rows, 'missing-column')).toMatchObject({ checked: 1, findings: 1 });
    // And its sibling passed: nothing that WAS there held the wrong type.
    expect(rowFor(out.rows, 'column-type-mismatch')).toMatchObject({ checked: 1, findings: 0 });
  });

  it('A CLEAN RESULT files nothing, and files a checked-pass rather than silence', async () => {
    const out = await runWith(
      mappings(
        [
          { logical_unit_number: 0, host_group: 'vdi-a' },
          { logical_unit_number: 3, host_group: 'vdi-a' },
        ],
        LUN_COLUMNS,
      ),
      { mode: 'warn' },
    );
    expect(out.findings).toEqual([]);
    expect(rowFor(out.rows, 'column-type-mismatch')).toMatchObject({ checked: 1, findings: 0 });
    expect(rowFor(out.rows, 'missing-column')).toMatchObject({ checked: 1, findings: 0 });
  });

  it('A TOOL WITH NO DECLARATION is not-applicable, WITH a ledger row', async () => {
    // The check is not armed — nothing in this agent promised anything about
    // columns. The row is what says so; a silent absence would look exactly
    // like a check that ran and agreed.
    const out = await runWith(mappings([{ logical_unit_number: '' }]), { mode: 'warn' });
    expect(out.findings).toEqual([]);
    for (const check of ['column-type-mismatch', 'missing-column']) {
      expect(rowFor(out.rows, check)).toMatchObject({
        check,
        seam: 'write',
        checked: 0,
        findings: 0,
        notApplicable: 1,
        unreachable: 0,
      });
    }
  });

  it('A BESPOKE RESULT SHAPE files not-applicable rows and no finding', async () => {
    const out = await runWith(
      mappings({ rows: [{ logical_unit_number: '' }], note: 'wrapped' }, LUN_COLUMNS),
      { mode: 'warn' },
    );
    expect(out.findings).toEqual([]);
    expect(rowFor(out.rows, 'column-type-mismatch').notApplicable).toBeGreaterThanOrEqual(1);
    expect(rowFor(out.rows, 'column-type-mismatch').checked).toBe(0);
  });

  it('AN EMPTY ROWSET is not this check’s business — no finding, no accusation', async () => {
    const out = await runWith(mappings([], LUN_COLUMNS), { mode: 'warn' });
    expect(out.findings).toEqual([]);
    expect(rowFor(out.rows, 'missing-column').findings).toBe(0);
  });
});

describe('functional: enforce — a real refusal in the library’s own idiom', () => {
  it('the model reads a TEACHING SENTENCE instead of the rows, never a stack trace', async () => {
    const out = await runWith(
      mappings(
        [
          { logical_unit_number: '', host_group: 'vdi-a' },
          { logical_unit_number: '', host_group: 'vdi-b' },
        ],
        LUN_COLUMNS,
      ),
      { mode: 'enforce' },
    );
    // The `resultCeiling` refusal shape: what was wrong, how to fix it, and
    // "No data was returned" — never a truncated result that reads complete.
    const refused = out.served.find((s) => s.startsWith('Result rejected:'));
    expect(refused).toBeDefined();
    expect(refused).toContain(TOOL);
    expect(refused).toContain("'logical_unit_number' is declared number");
    expect(refused).toContain('2 of 2 rows');
    expect(refused).toContain('No data was returned.');
    // The rows themselves never reached any channel.
    expect(out.served.some((s) => s.includes('vdi-a') && !s.startsWith('Result rejected'))).toBe(
      false,
    );
    // And the record says what happened, in the finding's own words.
    const mine = out.findings.filter((f) => f.kind === 'column-type-mismatch');
    expect(mine[0]!.message).toContain('The result was REFUSED');
  });

  it('a MISSING column is refused too — the promise was broken one level up', async () => {
    const out = await runWith(mappings([{ host_group: 'vdi-a' }], LUN_COLUMNS), {
      mode: 'enforce',
    });
    const refused = out.served.find((s) => s.startsWith('Result rejected:'));
    expect(refused).toContain("'logical_unit_number' is declared but present in no row");
  });

  it('enforce does NOT refuse a clean result', async () => {
    const out = await runWith(
      mappings([{ logical_unit_number: 0, host_group: 'vdi-a' }], LUN_COLUMNS),
      { mode: 'enforce' },
    );
    expect(out.served.some((s) => s.startsWith('Result rejected:'))).toBe(false);
    expect(out.findings).toEqual([]);
  });
});

describe('zero-delta: the dial absent', () => {
  it('the SAME declared tool without the dial is BYTE-IDENTICAL to one with no declaration', async () => {
    const rows = [
      { logical_unit_number: '', host_group: 'vdi-a' },
      { logical_unit_number: 3, host_group: 'vdi-a' },
    ];
    // Three runs: armed, declared-but-dial-off, and not declared at all.
    const armed = await runWith(mappings(rows, LUN_COLUMNS), { mode: 'warn' });
    const dialOff = await runWith(mappings(rows, LUN_COLUMNS));
    const undeclared = await runWith(mappings(rows));
    expect(armed.findings).toHaveLength(1);
    expect(dialOff.findings).toEqual([]);
    // Everything the model saw and produced is identical between the two
    // unarmed runs — the declaration alone changes not one byte.
    expect(dialOff.answer).toBe(undeclared.answer);
    expect(dialOff.served).toEqual(undeclared.served);
    expect(dialOff.answer).toBe(armed.answer);
    // And the ledger rows agree too: registered, and honestly not-applicable.
    for (const check of ['column-type-mismatch', 'missing-column']) {
      expect(rowFor(dialOff.rows, check)).toEqual(rowFor(undeclared.rows, check));
      expect(rowFor(dialOff.rows, check)).toMatchObject({ notApplicable: 1, checked: 0 });
    }
  });

  it('the dial ON with NO tool declaring resultColumns stays unarmed — two halves, both required', async () => {
    const out = await runWith(mappings([{ a: 1 }]), { mode: 'warn' });
    expect(rowFor(out.rows, 'column-type-mismatch')).toMatchObject({
      checked: 0,
      findings: 0,
      notApplicable: 1,
    });
  });

  it('a run that calls NO declaring tool still files rows — an armed check never sits untouched', async () => {
    // `assertAlive` reads an untouched armed row as wiring rot, so dev
    // posture completing this run at all is half the assertion.
    let rows: CheckReport[] = [];
    const agent = Agent.create({
      provider: mock({ replies: [answered] }),
      model: 'mock',
      maxIterations: 4,
      checkColumnTypes: 'warn',
      integrityPosture: 'dev',
    })
      .system('s')
      .tool(mappings([{ logical_unit_number: 0 }], LUN_COLUMNS))
      .build();
    agent.on('agentfootprint.integrity.disposition', (e) => {
      rows = e.payload.rows as CheckReport[];
    });
    await agent.run('go');
    for (const check of ['column-type-mismatch', 'missing-column']) {
      expect(rowFor(rows, check).notApplicable).toBeGreaterThanOrEqual(1);
      // The dev canary proved the pure function can still fire.
      expect(rowFor(rows, check).synthetic).toBe(1);
    }
  });
});

describe('contract: the canary, and the ledger vocabulary', () => {
  it('dev posture proves BOTH halves of the check can still catch their own defect', () => {
    const ledger = beginIntegrityRun(
      { wire: true, composeInvariant: false, dangling: false, columnTypes: true },
      'dev',
    );
    const report = ledger.report();
    for (const check of ['column-type-mismatch', 'missing-column']) {
      // `synthetic` counts the canary findings this check CAUGHT — one each,
      // out of the one shared fixture that carries both defects at once.
      const row = report.find((r) => r.check === check)!;
      expect(row.synthetic).toBe(1);
    }
  });

  it('unarmed registers a row rather than a silence', () => {
    const ledger = beginIntegrityRun(
      { wire: true, composeInvariant: false, dangling: false },
      'observe',
    );
    const report = ledger.report();
    expect(report.find((r) => r.check === 'column-type-mismatch')).toMatchObject({
      notApplicable: 1,
    });
    expect(report.find((r) => r.check === 'missing-column')).toMatchObject({ notApplicable: 1 });
  });
});

describe('negative: the dial refuses what it cannot honour', () => {
  it('a word outside the trio is refused where it is configured, naming all three', () => {
    expect(() =>
      Agent.create({
        provider: mock({ replies: [answered] }),
        model: 'mock',
        checkColumnTypes: 'strict' as never,
      }).build(),
    ).toThrow(/must be 'off', 'warn' or 'enforce'/);
  });
});

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

describe('integration: the declaration travels MCP _meta, both directions', () => {
  it('serve puts resultColumns in the bag; ingest reads it back identical', () => {
    const tool = defineTool({
      name: TOOL,
      description: 'd',
      inputSchema: { type: 'object', properties: {} },
      resultKind: 'dataset/rows',
      resultColumns: { logical_unit_number: 'number', comment: { type: 'string', nullable: true } },
      execute: () => [],
    });
    const extras = toolExtrasOf(tool)!;
    expect(extras.resultColumns).toEqual(tool.resultColumns);
    const back = readToolExtras({ agentfootprint: extras }, { server: 'remote-array', tool: TOOL });
    expect(back.resultColumns).toEqual(tool.resultColumns);
    // And it still arms the real check on the far side — both halves of it:
    // the numeric column that arrived as text, and the nullable column that
    // this rowset never delivered at all.
    const far = judge(back.resultColumns!, [{ logical_unit_number: '' }]);
    expect(far.findings.map((f) => f.kind).sort()).toEqual([
      'column-type-mismatch',
      'missing-column',
    ]);
  });

  it('a tool declaring nothing sends no bag — absent means absent', () => {
    const bare = defineTool({
      name: 'bare',
      description: 'd',
      inputSchema: { type: 'object', properties: {} },
      execute: () => [],
    });
    expect(toolExtrasOf(bare)).toBeUndefined();
  });

  it('a MALFORMED resultColumns from a remote server is dropped, never thrown', () => {
    // Somebody else's data. One server's typo must not take down a bulk
    // register of forty tools — the field is warned about and dropped, and
    // the rest of the bag still lands.
    const back = readToolExtras(
      { agentfootprint: { resultKind: 'dataset/rows', resultColumns: { lun: 'integer' } } },
      { server: 'remote-array', tool: TOOL },
    );
    expect(back.resultColumns).toBeUndefined();
    expect(back.resultKind).toBe('dataset/rows');
  });
});

// ---------------------------------------------------------------------------
// Neutralize-proofs
// ---------------------------------------------------------------------------

describe('neutralize-proofs: what each half is load-bearing for', () => {
  it('THE TYPE COMPARISON — without it, the numbers-as-strings case is a clean rowset', () => {
    // The whole difference between a caught bug and a silent one is the
    // comparison in `matchesType`. Model the neutralized check by declaring
    // the column as what it actually holds: the rowset is byte-identical and
    // nothing fires. Restore the declaration and the finding returns.
    const rows = [{ used_gb: '1240' }, { used_gb: '890' }];
    expect(judge({ used_gb: 'string' }, rows).findings).toEqual([]);
    expect(judge({ used_gb: 'number' }, rows).findings).toHaveLength(1);
  });

  it('THE MISSING-COLUMN BRANCH — without it, a column no row has is a column no row disagrees with', () => {
    // Every row lacks `logical_unit_number`, so the per-value comparison has
    // nothing to compare: drop the branch and this passes clean. The branch is
    // the ONLY thing that makes declared-but-never-delivered visible.
    const rows = [{ host_group: 'vdi-a' }, { host_group: 'vdi-b' }];
    const out = judge({ logical_unit_number: { type: 'number', nullable: true } }, rows);
    expect(out.findings.map((f) => f.kind)).toEqual(['missing-column']);
    // `nullable` neutralizes the VALUE comparison for these same rows and the
    // finding survives — proving it comes from the branch, not the comparison.
    expect(out.findings[0]!.message).toContain('NONE of the 2 rows');
  });
});
