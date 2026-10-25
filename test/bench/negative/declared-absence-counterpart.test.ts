/** A newly authored, public synthetic counterpart—not a repaired bank record.
 * The frozen undeclared-empty control and its oracle remain unchanged. These two
 * fixtures deliberately share a known search profile and differ only in whether
 * the local source explicitly vouches for absence. No private case data is used. */
import { describe, expect, it } from 'vitest';
import {
  Agent,
  AnswerValidationError,
  absent,
  defineTool,
  fromIdentity,
  hostFilled,
  type DeliveredNegative,
  type NegativeClaimCitation,
} from '../../../src/index.js';
import { mock } from '../../../src/doors/providers.js';
import { recordRun } from '../../../src/observe.js';

const IDENTITY = {
  tenant: 'synthetic-account',
  principal: 'tester',
  conversationId: 'paired-fixture',
};
const SEARCH = {
  source: { what: 'Synthetic fixture store', said: ['synthetic fixture store'] },
  subject: { what: 'items', said: ['item', 'items'] },
  arguments: [
    { name: 'source', role: 'source' },
    { name: 'account', role: 'filter' },
    { name: 'entity', role: 'population' },
  ],
  complete: 'within-arguments',
} as const;
const SCHEMA = {
  type: 'object',
  properties: {
    negatives: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string' },
          restsOn: { type: 'array', items: { type: 'string' } },
        },
        required: ['kind', 'restsOn'],
        additionalProperties: false,
      },
    },
  },
  required: ['negatives'],
  additionalProperties: false,
};
const PARSER = {
  parse(value: unknown): { negatives: NegativeClaimCitation[] } {
    const data = value as { negatives?: NegativeClaimCitation[] } | null;
    if (
      !Array.isArray(data?.negatives) ||
      data.negatives.some(
        (c) => !['none', 'not-found', 'complete'].includes(c.kind) || !Array.isArray(c.restsOn),
      )
    )
      throw new Error('Expected evidence pointers.');
    return { negatives: data.negatives };
  },
};

async function runFixture(
  kind: 'declared-absence-counterpart' | 'profiled-raw-empty-control',
  unestablished: 'withhold' | 'state-searched' = 'withhold',
) {
  let executions = 0;
  const tool = hostFilled(
    defineTool({
      name: 'synthetic_fixture_lookup',
      description: 'Read a separately authored empty synthetic store.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          account: { type: 'string' },
          entity: { type: 'string' },
        },
        required: ['source', 'account', 'entity'],
        additionalProperties: false,
      },
      effects: 'read',
      search: SEARCH,
      execute(args: { source: string; account: string; entity: string }) {
        executions++;
        expect(args).toEqual({
          source: 'synthetic-fixture-store',
          account: IDENTITY.tenant,
          entity: 'demo-item',
        });
        return kind === 'declared-absence-counterpart'
          ? absent({ what: 'items for the requested entity', checked: 'declared' })
          : [];
      },
    }),
    { account: fromIdentity('tenant') },
  );
  const agent = Agent.create({
    model: 'mock',
    provider: mock({
      replies: [
        {
          content: '',
          toolCalls: [
            {
              id: 'fixture-call',
              name: 'synthetic_fixture_lookup',
              args: { source: 'synthetic-fixture-store', entity: 'demo-item' },
            },
          ],
        },
        { content: JSON.stringify({ negatives: [{ kind: 'none', restsOn: ['r1'] }] }) },
        // The native ordinal diagnoses raw emptiness without minting a served handle
        // or needing another model/tool call.
      ],
    }),
  })
    .tool(tool)
    .outputSchema(PARSER, { strategy: 'instruct', jsonSchema: SCHEMA })
    .negativeClaims({ field: 'negatives', tools: ['synthetic_fixture_lookup'], unestablished })
    .build();
  const recorder = recordRun(agent);
  let answer: { negatives: DeliveredNegative[] } | undefined, error: unknown;
  try {
    answer = await agent.runTyped<{ negatives: DeliveredNegative[] }>({
      message: 'Read the synthetic fixture for demo-item.',
      identity: IDENTITY,
    });
  } catch (caught) {
    error = caught;
  } finally {
    recorder.stop();
  }
  const state = recorder.toRecording().snapshot?.sharedState as {
    negativeClaimState?: {
      calls: {
        outcome: string;
        effect: string;
        emptiness: string;
        trustedContext: boolean;
        row?: { composed: string; complete: boolean; handle: string };
      }[];
    };
  };
  return {
    answer,
    error,
    executions,
    native: state.negativeClaimState?.calls[0],
    checks: agent.answerNegatives()?.checks,
  };
}

describe('separately authored declared-absence counterpart', () => {
  it('captures and establishes an explicitly declared absence', async () => {
    const result = await runFixture('declared-absence-counterpart');
    expect(result.error).toBeUndefined();
    expect(result.executions).toBe(1);
    expect(result.native).toMatchObject({
      outcome: 'ok',
      effect: 'read',
      emptiness: 'declared-absent',
      trustedContext: true,
      row: { composed: 'local', complete: true, handle: 'r1' },
    });
    expect(result.checks?.[0].code).toBe('established');
    expect(result.answer?.negatives[0]).toMatchObject({
      kind: 'none',
      delivery: 'record-composed',
      restsOn: ['r1'],
    });
    expect(result.answer?.negatives[0].statement).toContain('`demo-item`');
  });

  it('keeps a bare empty list unknown even with the identical complete search profile', async () => {
    const result = await runFixture('profiled-raw-empty-control');
    expect(result.error).toBeInstanceOf(AnswerValidationError);
    expect(result.answer).toBeUndefined();
    expect(result.executions).toBe(1);
    expect(result.native).toMatchObject({
      outcome: 'ok',
      effect: 'read',
      emptiness: 'undeclared-empty',
      trustedContext: true,
    });
    expect(result.native?.row).toBeUndefined();
    expect(result.checks?.[0].code).toBe('undeclared-empty');
  });

  it('does not upgrade the raw-empty control when its recorded search is stated', async () => {
    const result = await runFixture('profiled-raw-empty-control', 'state-searched');
    expect(result.error).toBeUndefined();
    expect(result.executions).toBe(1);
    expect(result.answer?.negatives[0].kind).toBe('none');
    expect(result.native?.row).toBeUndefined();
    expect(result.checks?.[0].code).toBe('undeclared-empty');
    expect(result.checks?.some((c) => c.code === 'established')).toBe(false);
  });
});
