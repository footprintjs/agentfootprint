/**
 * The standing fold reads the results layer's period rows (honesty layer 3,
 * step 7b) — over hand-built committed records.
 *
 * Test types:
 *   - UNIT      — each verdict's reason (`covered` fires none); the
 *                 `result-period` check; THIS turn's rows only (the turn
 *                 stamp); a later row under a reused call id never hides an
 *                 earlier verdict with its own confirmed result; the join — a period
 *                 reason's witnesses are its row and the inputs layer's row
 *                 for the same call's period argument; an unknown verdict
 *                 word is skipped, never guessed;
 *   - PROPERTY  — over 1,000 generated ledgers with repeated ids: a period
 *                 reason fires iff a row of this turn carries its verdict; no
 *                 period row ever supports "known"; the fold never reads an
 *                 instant.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool, describedResult } from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { assessAnswer } from '../../../../src/core/agent/assessment/assess.js';

type State = Record<string, unknown>;
const run = (state: State) => assessAnswer({ snapshot: { sharedState: state } });
const periodChecks = (a: ReturnType<typeof run>) =>
  a.checked.filter(({ check }) => check === 'result-period');

const person = { role: 'user', content: 'How far back do the backups go?' };
function callHistory(toolCallId: string, toolName = 'backup_runs', record: State = {}) {
  return [
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: toolCallId, name: toolName, args: { window: '2h' } }],
    },
    { role: 'tool', toolCallId, toolName, content: 'Backup lookup finished.', ...record },
  ];
}

const periodRow = (
  toolCallId: string,
  verdict: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  kind: 'period',
  turn: 1,
  toolCallId,
  toolName: 'backup_runs',
  iteration: 1,
  verdict,
  ...extra,
});
const argumentRow = (toolCallId: string, argument = 'window'): Record<string, unknown> => ({
  kind: 'argument',
  turn: 1,
  toolCallId,
  toolName: 'search_logs',
  iteration: 1,
  argument,
  rule: 'assume',
  period: true,
  source: 'default',
  value: '2h',
});

describe('UNIT — one reason per verdict', () => {
  const cases: ReadonlyArray<readonly [string, string | undefined]> = [
    ['not-held', 'period-not-held'],
    ['partly-held', 'period-partly-held'],
    ['unknown', 'period-unknown'],
    ['undeclared', 'period-undeclared'],
    ['covered', undefined],
  ];
  for (const [verdict, reason] of cases) {
    it(`${verdict} → ${reason ?? 'nothing fires'}`, () => {
      const a = run({
        turnNumber: 1,
        history: [person, ...callHistory('c1')],
        findingsLedger: [periodRow('c1', verdict)],
      });
      expect(a.reasons.map((r) => r.reason)).toEqual(reason === undefined ? [] : [reason]);
      if (reason !== undefined) {
        expect(a.reasons[0]).toEqual({
          reason,
          layer: 3,
          witness: [{ kind: 'state', key: 'findingsLedger', path: '/0/verdict' }],
          source: { kind: 'calls', calls: [{ toolCallId: 'c1', toolName: 'backup_runs' }] },
        });
        expect(a.standing).toBe('not-sure');
      } else {
        expect(a.standing).toBe('consistent'); // a check ran, none fired — never "known"
      }
      expect(periodChecks(a)).toEqual([
        {
          layer: 3,
          check: 'result-period',
          ran: 1,
          of: 1,
          witness: [{ kind: 'state', key: 'findingsLedger', path: '/0/verdict' }],
        },
      ]);
    });
  }
});

describe('UNIT — which rows the fold reads', () => {
  it('this turn only: a turn-1 verdict does not make a turn-2 answer not sure', () => {
    const a = run({
      turnNumber: 2,
      history: [person, ...callHistory('c1'), person],
      findingsLedger: [periodRow('c1', 'not-held')],
    });
    expect(a.reasons).toEqual([]);
    expect(a.checked).toEqual([]);
  });

  it('a record with no turnNumber reads period rows with served results regardless of stamp', () => {
    expect(
      run({
        history: [person, ...callHistory('c1'), ...callHistory('c2')],
        findingsLedger: [periodRow('c1', 'not-held'), periodRow('c2', 'unknown', { turn: 2 })],
      }).reasons.map((r) => r.reason),
    ).toEqual(['period-not-held', 'period-unknown']);
  });

  it('every row counts — a later row under the same call id never hides an earlier verdict', () => {
    // The provider reused its id across batches. The tool names distinguish
    // the two returned results and the period verdicts that go with them.
    const a = run({
      turnNumber: 1,
      history: [person, ...callHistory('c1'), ...callHistory('c1', 'archive_runs')],
      findingsLedger: [
        periodRow('c1', 'not-held'),
        periodRow('c1', 'covered', { iteration: 2, toolName: 'archive_runs' }),
      ],
    });
    expect(a.reasons).toEqual([
      {
        reason: 'period-not-held',
        layer: 3,
        witness: [{ kind: 'state', key: 'findingsLedger', path: '/0/verdict' }],
        source: { kind: 'calls', calls: [{ toolCallId: 'c1', toolName: 'backup_runs' }] },
      },
    ]);
    expect(periodChecks(a)).toEqual([
      {
        layer: 3,
        check: 'result-period',
        ran: 2,
        of: 2,
        witness: [
          { kind: 'state', key: 'findingsLedger', path: '/0/verdict' },
          { kind: 'state', key: 'findingsLedger', path: '/1/verdict' },
        ],
      },
    ]);
  });

  it('REGRESSION — two returned calls to one tool retain their period verdicts when the provider reuses an ID', async () => {
    const name = 'backup_runs';
    const call = (host: string) => ({ toolCalls: [{ id: 'reused', name, args: { host } }] });
    const queried = { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' };
    const agent = Agent.create({
      provider: mock({ replies: [call('archive'), call('live'), 'The lookup is complete.'] }),
      model: 'mock',
      reactMode: 'dynamic',
    })
      .tool(
        defineTool({
          name,
          description: 'Read backup runs from one host.',
          inputSchema: { type: 'object', properties: { host: { type: 'string' } } },
          execute: ({ host }) =>
            describedResult({
              facts: [{ entity: String(host), backups: 1 }],
              provenance: { measuredAt: queried.to, source: 'fixture' },
              period: {
                queried,
                held:
                  host === 'archive'
                    ? { from: '2026-09-25T09:00:00Z', to: '2026-09-25T10:00:00Z' }
                    : queried,
              },
            }),
        }),
      )
      .resultsLayer()
      .answerLayer({ standingLine: true })
      .build();

    const answer = await agent.run({ message: person.content });
    const snapshot = agent.getLastSnapshot();
    const state = snapshot?.sharedState;
    expect(agent.findings()?.filter(({ kind }) => kind === 'period')).toMatchObject([
      { toolCallId: 'reused', toolName: name, iteration: 1, verdict: 'not-held' },
      { toolCallId: 'reused', toolName: name, iteration: 2, verdict: 'covered' },
    ]);
    expect(state?.history.filter(({ role }) => role === 'tool')).toMatchObject([
      { toolCallId: 'reused', toolName: name, toolResultExecution: 'returned' },
      { toolCallId: 'reused', toolName: name, toolResultExecution: 'returned' },
    ]);
    const saved = assessAnswer({ snapshot });
    expect.soft(saved.reasons.map(({ reason }) => reason)).toEqual(['period-not-held']);
    expect.soft(periodChecks(saved)).toMatchObject([{ ran: 2, of: 2 }]);
    expect.soft(answer).toContain("a tool's data does not reach the time the question asked about");
  });

  it('a verdict word the fold does not know is skipped, never guessed — and still counted as filed', () => {
    const a = run({
      turnNumber: 1,
      history: [person, ...callHistory('c1')],
      findingsLedger: [periodRow('c1', 'held-ish')],
    });
    expect(a.reasons).toEqual([]);
    expect(periodChecks(a)).toHaveLength(1);
    expect(periodChecks(a)[0]).toMatchObject({ ran: 1, of: 1 });
  });

  it('two calls, two reasons, each witnessed by its own row', () => {
    const a = run({
      turnNumber: 1,
      history: [person, ...callHistory('c1'), ...callHistory('c2')],
      findingsLedger: [periodRow('c1', 'not-held'), periodRow('c2', 'unknown')],
    });
    expect(
      a.reasons.map((r) => [r.reason, r.witness.map((w) => (w as { path: string }).path)]),
    ).toEqual([
      ['period-not-held', ['/0/verdict']],
      ['period-unknown', ['/1/verdict']],
    ]);
  });

  it('a period row cannot count when the only matching call was refused before entry', () => {
    const a = run({
      turnNumber: 1,
      history: [
        person,
        ...callHistory('c1', 'backup_runs', {
          content: 'Unavailable.',
          outcome: 'refused',
          toolResultExecution: 'not-entered',
        }),
      ],
      findingsLedger: [periodRow('c1', 'not-held')],
    });
    expect(a.reasons.map(({ reason }) => reason)).toEqual(['call-not-completed']);
    expect(periodChecks(a)).toEqual([]);
  });
});

describe('UNIT — the join with the inputs layer (results.md § 3.7)', () => {
  it('a period reason names the argument row that says who chose the period', () => {
    const a = run({
      turnNumber: 1,
      history: [person, ...callHistory('c1')],
      findingsLedger: [
        { ...argumentRow('c1'), toolName: 'backup_runs' },
        periodRow('c1', 'not-held', { argument: 'window' }),
      ],
    });
    const notHeld = a.reasons.find((r) => r.reason === 'period-not-held')!;
    expect(notHeld.witness).toEqual([
      { kind: 'state', key: 'findingsLedger', path: '/1/verdict' },
      { kind: 'state', key: 'findingsLedger', path: '/0/argument' },
    ]);
    // …and the argument row fires its own layer-2 reason beside it.
    expect(a.reasons.map((r) => r.reason)).toEqual(['argument-assumed', 'period-not-held']);
  });

  it('keeps its own witness when an earlier proposal makes the input witness ambiguous', () => {
    const a = run({
      turnNumber: 1,
      history: [person, callHistory('c1')[0], ...callHistory('c1')],
      findingsLedger: [
        { ...argumentRow('c1'), toolName: 'backup_runs' },
        periodRow('c1', 'not-held', { argument: 'window', iteration: 2 }),
      ],
    });
    expect(a.reasons.find((r) => r.reason === 'period-not-held')!.witness).toEqual([
      { kind: 'state', key: 'findingsLedger', path: '/1/verdict' },
    ]);
  });

  it('no join without the argument name, or across calls', () => {
    const a = run({
      turnNumber: 1,
      history: [person, ...callHistory('c1'), ...callHistory('c2', 'search_logs')],
      findingsLedger: [argumentRow('c2'), periodRow('c1', 'not-held', { argument: 'window' })],
    });
    expect(a.reasons.find((r) => r.reason === 'period-not-held')!.witness).toHaveLength(1);
    const b = run({
      turnNumber: 1,
      history: [person, ...callHistory('c1')],
      findingsLedger: [
        { ...argumentRow('c1'), toolName: 'backup_runs' },
        periodRow('c1', 'not-held'),
      ],
    });
    expect(b.reasons.find((r) => r.reason === 'period-not-held')!.witness).toHaveLength(1);
  });
});

describe('PROPERTY — 1,000 generated ledgers', () => {
  let seed = 7_2026_09_27;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const VERDICTS = ['covered', 'partly-held', 'not-held', 'unknown', 'undeclared'];
  const REASON: Record<string, string | undefined> = {
    covered: undefined,
    'partly-held': 'period-partly-held',
    'not-held': 'period-not-held',
    unknown: 'period-unknown',
    undeclared: 'period-undeclared',
  };

  it('a period reason fires iff a row of this turn carries its verdict — ids repeat; never "known"', () => {
    for (let n = 0; n < 1000; n += 1) {
      const turn = 1 + Math.floor(rnd() * 2);
      // Three ids over up to five rows: repeated ids are the common case here.
      const rows = Array.from({ length: Math.floor(rnd() * 6) }, (_, index) =>
        periodRow(pick(['a', 'b', 'c']), pick(VERDICTS), {
          turn: 1 + Math.floor(rnd() * 2),
          toolName: `lookup_${index}`,
        }),
      );
      const history = [1, 2]
        .slice(0, turn)
        .flatMap((stamp) => [
          person,
          ...rows
            .filter((row) => row.turn === stamp)
            .flatMap((row) => callHistory(String(row.toolCallId), String(row.toolName))),
        ]);
      const expected = new Set(
        rows
          .filter((row) => row.turn === turn)
          .map((row) => REASON[String(row.verdict)])
          .filter((r) => r !== undefined),
      );
      const a = run({ turnNumber: turn, findingsLedger: rows, history });
      const fired = new Set(a.reasons.map((r) => r.reason));
      expect(fired).toEqual(expected);
      expect(a.assessment).not.toBe('known');
      expect(JSON.stringify(a)).not.toMatch(/2026-/);
    }
  });
});
