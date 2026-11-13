/**
 * The two moments of the contingent check exempt the same values.
 *
 * The defect: the dispatch moment (`stages/toolCalls/evidence/towers.ts` ·
 * `towersFor`) built its exempt set from the person's message and the app's
 * text only, while the answer moment (`stages/route.ts` · `judgeEvidence`)
 * also exempted the values the person gave the library's batch ask and the
 * declared defaults this turn assumed. So a value the person had answered,
 * repeated in the next call and carried only by a result the model set
 * aside, filed a contingent row at dispatch and nothing at the answer. Both
 * now ask `stages/turnExempt.ts` · `exemptForTurn`, handed the one arm
 * `runtime/routing/exemptArm.ts` builds.
 *
 * Test type (Convention 3): regression.
 */

import { describe, expect, it } from 'vitest';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../src/core/agent/types.js';
import { towersFor } from '../../../../src/core/agent/stages/toolCalls/evidence/towers.js';
import { answeredValuesOf, declaredDefaultsFrom } from '../../../../src/core/agent/stages/route.js';
import {
  contingentRowsOf,
  groundedArgumentValues,
} from '../../../../src/core/agent/findings/contingent.js';
import { resolveEvidenceGate } from '../../../../src/core/agent/evidence/gate.js';
import {
  Agent,
  defineTool,
  type ContingentRow,
  type FindingsRow,
  type Tool,
} from '../../../../src/index.js';
import type { LLMResponse } from '../../../../src/provider-contract/types.js';

const gate = resolveEvidenceGate({});

/** One turn: a lookup result the model set aside, and one argument row of `source`. */
function scopeWith(source: 'answered' | 'default'): TypedScope<AgentState> {
  return {
    turnNumber: 1,
    userMessage: 'check the account',
    history: [
      { role: 'user', content: 'check the account' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc-1', name: 'lookup', args: {} }] },
      { role: 'tool', toolCallId: 'tc-1', toolName: 'lookup', content: 'account ARR-2291' },
    ],
    findingsLedger: [
      {
        kind: 'standing',
        toolCallId: 'tc-1',
        standing: 'open',
        assertions: [],
        declaredOn: 'answer',
        iteration: 1,
      },
      {
        kind: 'argument',
        toolCallId: 'tc-0',
        toolName: 'lookup',
        argument: 'account',
        iteration: 1,
        turn: 1,
        source,
        ...(source === 'answered' && { value: 'ARR-2291' }),
      },
    ],
  } as unknown as TypedScope<AgentState>;
}

/** The rows the dispatch moment files for a call carrying `account: 'ARR-2291'`. */
function rowsAtDispatch(
  scope: TypedScope<AgentState>,
  arm?: Parameters<typeof towersFor>[3],
  timeLineage?: Parameters<typeof towersFor>[4],
) {
  const towers = towersFor(scope, true, gate, arm, timeLineage);
  if (towers === undefined) throw new Error('expected towers');
  const values = groundedArgumentValues(
    { account: 'ARR-2291' },
    gate,
    towers.corpus,
    towers.exempt,
  );
  return contingentRowsOf(values, towers.corpus, towers.standingOf, { toolCallId: 'tc-2' }, 2);
}

describe('regression: the dispatch moment exempts what the answer moment exempts', () => {
  it('a value the person gave the batch ask files no contingent row at the next call', () => {
    const scope = scopeWith('answered');
    // The defect's shape: without the arm, the value is a tower.
    expect(rowsAtDispatch(scope)).toHaveLength(1);
    expect(rowsAtDispatch(scope, { answeredValues: answeredValuesOf })).toEqual([]);
  });

  it('a declared default this turn assumed files none either', () => {
    const scope = scopeWith('default');
    const declaredDefaults = declaredDefaultsFrom((tool, argument) =>
      tool === 'lookup' && argument === 'account' ? 'ARR-2291' : undefined,
    );
    expect(rowsAtDispatch(scope)).toHaveLength(1);
    expect(rowsAtDispatch(scope, { declaredDefaults })).toEqual([]);
  });

  it('a time the person said files none either', () => {
    // `.time()` hands the dispatch moment the same lineage reader the answer
    // moment reads (`turnExempt.ts` · `loadTimeLineage`); its `said` half is exempt.
    const scope = scopeWith('answered');
    const said = () => ({ said: ['ARR-2291'], derived: [] });
    expect(rowsAtDispatch(scope, {}, () => ({ said: [], derived: [] }))).toHaveLength(1);
    expect(rowsAtDispatch(scope, {}, said)).toEqual([]);
  });
});

// ─── end to end: the route decider's arm reaches the dispatch moment ─────

describe('integration: a declared default this turn assumed is no tower at the next call', () => {
  type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };
  const call = (id: string, name: string, args: object = {}): Reply => ({
    content: '',
    toolCalls: [{ id, name, args }],
  });
  const probe = defineTool({
    name: 'probe',
    description: 'the probe tool',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    execute: (args: Record<string, unknown>) =>
      args.q === 'p1' ? 'fc1/7 state=down sw-01' : `nothing for ${String(args.q)}`,
  } as never) as Tool;
  const portStatus = (ruled: boolean) =>
    defineTool({
      name: 'port_status',
      description: 'status of one port',
      inputSchema: {
        type: 'object',
        required: ['port'],
        properties: { port: { type: 'string' } },
      },
      ...(ruled && { askOrAssume: { port: { assume: 'fc1/7' } } }),
      execute: () => 'ok',
    } as never) as Tool;

  async function contingentRows(ruled: boolean): Promise<readonly ContingentRow[]> {
    const script: Reply[] = [
      call('c1', 'probe', { q: 'p1', _findings: { basis: 'exploratory' } }),
      // c1 set aside; the port left out, so the rule assumes it (a `default` row) —
      // or, with no rule, the model passes it itself.
      call('c2', 'port_status', {
        ...(!ruled && { port: 'fc1/7' }),
        _findings: { basis: 'direct', previous: [{ toolCallId: 'c1', standing: 'ruled-out' }] },
      }),
      // The value again, in a later call of the same turn.
      call('c3', 'probe', { q: 'fc1/7', _findings: { basis: 'direct' } }),
      { content: 'done' },
    ];
    let i = 0;
    const agent = Agent.create({
      provider: {
        name: 'exempt-mock',
        complete: async (): Promise<LLMResponse> => {
          const reply = script[Math.min(i++, script.length - 1)]!;
          return {
            content: reply.content,
            toolCalls: reply.toolCalls ?? [],
            usage: { input: 0, output: 0 },
          };
        },
      } as never,
      model: 'mock',
      maxIterations: 8,
    })
      .system('bot')
      .tool(probe)
      .tool(portStatus(ruled))
      .findings()
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .build();
    await agent.run({ message: 'which port is down?' });
    return ((agent.findings() ?? []) as readonly FindingsRow[]).filter(
      (r): r is ContingentRow => r.kind === 'contingent',
    );
  }

  it('the assumed value files nothing at c3; the control, where the model chose it, files a row', async () => {
    const at = (rows: readonly ContingentRow[]) =>
      rows.filter((r) => r.declaredOn !== 'answer' && r.declaredOn.toolCallId === 'c3');
    expect(at(await contingentRows(false)).map((r) => r.value)).toEqual(['fc1/7']);
    expect(at(await contingentRows(true))).toEqual([]);
  });
});
