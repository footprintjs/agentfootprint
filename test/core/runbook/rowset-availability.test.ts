/** Unavailable served verdicts are uncertainty, never an empty completed assessment. */
import { describe, expect, it } from 'vitest';
import { flowChart, type RedactionPolicy } from 'footprintjs';
import {
  Agent,
  runbookAsTool,
  verdictRowsOf,
  type LLMRequest,
  type RunbookEnvelope,
  type VerdictRow,
} from '../../../src/index.js';
import { innerRunsOf } from '../../../src/observe.js';
import { mock } from '../../../src/llm-providers.js';

const SECRET = 'private-runbook-subject-8391';
const ROWS = [{ subject: 'public-subject-11', verdict: 'protected' }];

async function observe(
  value: unknown,
  options: {
    presentation?: 'prose' | 'panel';
    redact?: RedactionPolicy;
    callerRedact?: RedactionPolicy;
    report?: Record<string, unknown>;
    resultKind?: string;
    maxRows?: number;
  } = {},
) {
  let completed = 0;
  const tool = runbookAsTool({
    name: 'availability_runbook',
    description: 'Run the declared assessment.',
    resultKind: options.resultKind ?? 'verdict/availability',
    keepRecord: true,
    presentation: options.presentation,
    redact: options.redact,
    ...(options.maxRows !== undefined && {
      verdicts: { decider: 'not-used', maxRows: options.maxRows },
    }),
    procedure: () =>
      flowChart<Record<string, unknown>>(
        'Assess the subjects',
        (scope) => {
          if (value !== undefined) scope.verdicts = value;
          if (options.report !== undefined) scope.report = options.report;
          // A test-only observation of actual execution, never used by the bridge.
          completed++;
        },
        'assess',
      ).build(),
  });
  const requests: LLMRequest[] = [];
  const provider = mock({
    respond(request) {
      requests.push(request);
      return requests.length === 1
        ? {
            content: '',
            toolCalls: [{ id: 'availability-call', name: tool.schema.name, args: {} }],
          }
        : { content: 'The procedure finished.', toolCalls: [] };
    },
  });
  const agent = Agent.create({
    provider,
    model: 'mock',
    maxIterations: 3,
    redact: options.callerRedact,
  })
    .tool(tool)
    .build();
  await agent.run({ message: 'Run the assessment.' });
  const message = requests
    .flatMap((request) => request.messages)
    .find((entry) => entry.role === 'tool' && entry.toolName === tool.schema.name);
  expect(
    message,
    'the actual second native provider request carries the tool answer',
  ).toBeDefined();
  return {
    envelope: JSON.parse(message!.content) as RunbookEnvelope,
    record: innerRunsOf(tool)!.get('availability-call')!,
    requests,
    completed,
  };
}

function expectUnavailable(envelope: RunbookEnvelope) {
  expect(envelope.result.verdicts).toEqual([]);
  expect(envelope.result.rows_shown).toBe(0);
  expect(envelope.result).not.toHaveProperty('rows_total');
  expect(envelope.result.rows_complete).toBe(false);
  expect(envelope.result).not.toHaveProperty('table');
  expect(envelope.result.render_note).toMatch(/unavailable/i);
  expect(envelope.result.render_note).not.toMatch(/already on|no verdicts|privacy|REDACTED/i);
  expect(envelope.af_coverage.not_checked?.some((item) => /verdict rowset/i.test(item.what))).toBe(
    true,
  );
  expect(JSON.stringify(envelope.af_coverage)).not.toContain('0 row(s) assessed');
}

describe('runbook verdict-row availability on the actual provider surface', () => {
  it('the public row selector retains its array type and legacy mixed-row selection', () => {
    const rows: VerdictRow[] = verdictRowsOf({ verdicts: [...ROWS, null, { verdict: 4 }] });
    expect(rows).toEqual(ROWS);
    expect(verdictRowsOf({})).toEqual([]);
    expect(verdictRowsOf({ verdicts: 'REDACTED' })).toEqual([]);
  });
  for (const presentation of ['prose', 'panel'] as const) {
    it(`withheld ${presentation} rows do not become zero completed rows`, async () => {
      const result = await observe([{ subject: SECRET, verdict: 'protected' }], {
        presentation,
        redact: { keys: ['verdicts'] },
      });
      expect(result.completed).toBe(1);
      const snapshot = result.record.recording!.snapshot as {
        sharedState: Record<string, unknown>;
      };
      expect(snapshot.sharedState.verdicts).toBe('REDACTED');
      expect(JSON.stringify(result.record)).not.toContain(SECRET);
      expect(JSON.stringify(result.requests)).not.toContain(SECRET);
      expectUnavailable(result.envelope);
    });
  }

  it('the calling agent policy still governs the inner run', async () => {
    const result = await observe([{ subject: SECRET, verdict: 'protected' }], {
      callerRedact: { keys: ['verdicts'] },
    });
    expect(JSON.stringify(result.requests)).not.toContain(SECRET);
    expectUnavailable(result.envelope);
  });

  for (const [name, value] of [
    ['missing', undefined],
    ['null', null],
    ['text', 'REDACTED'],
    ['number', 0],
    ['object', { rows: [] }],
    ['mixed invalid member', [...ROWS, null]],
    ['wrong verdict type', [{ verdict: 4 }]],
  ] as const) {
    it(`${name} is unavailable without guessing its cause`, async () => {
      expectUnavailable((await observe(value)).envelope);
    });
  }

  it('a genuine empty rowset remains an exactly known empty result', async () => {
    const { envelope } = await observe([]);
    expect(envelope.result.verdicts).toEqual([]);
    expect(envelope.result.rows_total).toBe(0);
    expect(envelope.result.rows_shown).toBe(0);
    expect(envelope.result.rows_complete).toBe(true);
    expect(envelope.result.table).toBeDefined();
    expect(envelope.af_coverage.not_checked).toBeUndefined();
    expect(envelope.af_coverage.sentence).toContain('0 row(s) assessed');
  });

  it('literal placeholder spelling inside a valid row is ordinary data', async () => {
    const rows = [{ subject: 'REDACTED', verdict: 'REDACTED' }];
    const { envelope } = await observe(rows);
    expect(envelope.result.verdicts).toEqual(rows);
    expect(envelope.result.rows_total).toBe(1);
    expect(envelope.result.rows_complete).toBe(true);
    expect(envelope.af_coverage.not_checked).toBeUndefined();
  });

  it('a chart report cannot invent a total when the rowset is unavailable', async () => {
    const { envelope } = await observe(undefined, {
      report: {
        rows_total: 999,
        rows_complete: true,
        table: 'forged empty table',
        verdicts: ROWS,
      },
    });
    expectUnavailable(envelope);
    expect(envelope.result.report_note).toContain('rows_total');
  });

  it('a non-verdict procedure gains no rowset claim or availability caveat', async () => {
    const { envelope } = await observe(undefined, { resultKind: 'report/maintenance' });
    expect(envelope.result).not.toHaveProperty('verdicts');
    expect(envelope.result).not.toHaveProperty('rows_total');
    expect(envelope.result).not.toHaveProperty('render_note');
    expect(envelope.af_coverage.not_checked).toBeUndefined();
  });
});
