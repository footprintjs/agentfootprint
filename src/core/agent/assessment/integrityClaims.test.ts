/**
 * A `.claims()` contract the run could not compare at all: no value was read
 * from the answer, so no field was judged. That must not read "consistent".
 *
 * Test types (Convention 3): SCENARIO through real runs, under the equality law;
 * BOUNDARY — nothing is filed while the answer layer is not armed.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../../index.js';
import { mock } from '../../../llm-providers.js';
import { assessAnswer, recordRun } from '../../../observe.js';
import { assessmentDataOf } from './compose.js';

const lookup = () =>
  defineTool({
    name: 'lookup',
    description: 'reads rows',
    inputSchema: { type: 'object', properties: {} },
    execute: () => [{ a: 1 }],
  });
const replies = (final: string) => [
  {
    content: '',
    toolCalls: [{ id: 'c1', name: 'lookup', args: {} }],
    stopReason: 'tool_use' as const,
  },
  { content: final, toolCalls: [], stopReason: 'stop' as const },
];
const CONTRACT = {
  nav_count: { entity: 'screen2', field: 'nav' },
  'report.total': { entity: 'screen2', field: 'total' },
};

async function run(final: string, parser: { parse: (v: unknown) => unknown }, armed: boolean) {
  let builder = Agent.create({ provider: mock({ replies: replies(final) }), model: 'mock' })
    .tool(lookup())
    .outputSchema(parser)
    .claims(CONTRACT);
  if (armed) builder = builder.answerLayer();
  const agent = builder.build();
  const assessed: unknown[] = [];
  agent.on('agentfootprint.answer.assessed', (e) => {
    const { turn: _t, iteration: _i, ...data } = e.payload as unknown as Record<string, unknown>;
    void _t;
    void _i;
    assessed.push(data);
  });
  const recorder = recordRun(agent);
  await agent.run({ message: 'go' }).catch(() => undefined);
  const text = JSON.stringify(recorder.toRecording());
  recorder.stop();
  const saved = assessAnswer(JSON.parse(text));
  const state = agent.getLastSnapshot()?.sharedState as Record<string, unknown>;
  const ledger = (state.findingsLedger ?? []) as Record<string, unknown>[];
  return { saved, assessed, ledger, text };
}

const identity = { parse: (v: unknown) => v };
const rejecting = {
  parse: () => {
    throw new Error('never satisfied');
  },
};

describe('SCENARIO — no value could be compared', () => {
  it.each([
    ['a parser that yields a number', '42', identity],
    ['a parser that yields a string', '"just words"', identity],
    ['a schema the model never satisfied', '{"nav_count":2}', rejecting],
  ])('%s: every declared field reads not sure', async (_label, final, parser) => {
    const r = await run(final, parser, true);
    expect(r.saved.standing).toBe('not-sure');
    expect(r.saved.reasons.map((x) => x.reason)).toContain('claim-unsettled');
    expect(r.ledger.filter((row) => row.kind === 'claim-unsettled')).toEqual([
      { kind: 'claim-unsettled', turn: 1, iteration: 2, field: 'nav_count' },
      { kind: 'claim-unsettled', turn: 1, iteration: 2, field: 'report.total' },
    ]);
    expect(r.assessed).toHaveLength(1);
    expect(assessmentDataOf(r.saved)).toEqual(r.assessed[0]);
  });

  it('a list is read, and states none of the fields: nothing is claimed, nothing is filed', async () => {
    const r = await run('[1,2]', identity, true);
    expect(r.saved.reasons.map((x) => x.reason)).not.toContain('claim-unsettled');
    expect(r.ledger.filter((row) => row.kind === 'claim-unsettled')).toEqual([]);
  });

  it('the row holds the declared field, never the answer', async () => {
    const r = await run('"SECRET-ANSWER-9"', identity, true);
    expect(JSON.stringify(r.ledger)).not.toContain('SECRET-ANSWER-9');
  });
});

describe('BOUNDARY — not armed', () => {
  it.each([
    ['unreadable', '42', identity],
    ['never satisfied', '{"nav_count":2}', rejecting],
  ])('%s: no row', async (_label, final, parser) => {
    const r = await run(final, parser, false);
    expect(r.ledger).toEqual([]);
    expect(r.text).not.toContain('claim-unsettled');
  });
});
