import { describe, expect, it, vi } from 'vitest';
import {
  Agent,
  absent,
  defineTool,
  hostFilled,
  fromIdentity,
  type LLMProvider,
  type LLMResponse,
  type Tool,
} from '../../../src/index.js';

const identity = {
  tenant: 'tenant-test',
  principal: 'principal-test',
  conversationId: 'conversation-test',
};
const answer = () =>
  JSON.stringify({
    summary: 'Search record.',
    negatives: [{ kind: 'none', about: 'payments', restsOn: ['r1'] }],
  });
const schema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    negatives: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string' },
          about: { type: 'string' },
          restsOn: { type: 'array', items: { type: 'string' } },
        },
        required: ['kind', 'about', 'restsOn'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'negatives'],
  additionalProperties: false,
};
function fixture(
  bound: boolean,
  options: {
    extra?: Tool;
    noRead?: boolean;
    reactMode?: 'classic' | 'dynamic' | 'dynamic-grouped';
  } = {},
) {
  let at = 0;
  const execute = vi.fn(() => absent({ what: 'incidents', checked: 'declared' }));
  const tool = defineTool({
    name: 'read_incidents',
    description: 'Synthetic incident lookup.',
    inputSchema: {
      type: 'object',
      properties: { service: { type: 'string' }, tenant: { type: 'string' } },
      required: ['service'],
    },
    effects: 'read',
    search: {
      source: { what: 'incident store', said: ['incident store'] },
      subject: { what: 'incidents', said: ['incidents'] },
      arguments: [
        { name: 'service', role: 'population' },
        { name: 'tenant', role: 'filter' },
      ],
      complete: 'within-arguments',
    },
    execute,
  });
  const provider: LLMProvider = {
    name: 'negative-continuation',
    complete: async (): Promise<LLMResponse> => {
      const current = at++;
      const call =
        !options.noRead && current === 0
          ? { id: 'provider-call', name: 'read_incidents', args: { service: 'payments' } }
          : options.extra !== undefined && current === 1
          ? { id: 'later-call', name: options.extra.schema.name, args: { item: 'missing-item' } }
          : undefined;
      return call === undefined
        ? { content: answer(), toolCalls: [], usage: { input: 1, output: 1 }, stopReason: 'stop' }
        : {
            content: '',
            toolCalls: [call],
            usage: { input: 1, output: 1 },
            stopReason: 'tool_use',
          };
    },
  };
  const builder = Agent.create({
    provider,
    model: 'mock',
    ...(options.reactMode && { reactMode: options.reactMode }),
  })
    .tool(bound ? hostFilled(tool, { tenant: fromIdentity('tenant') }) : tool)
    .outputSchema({ parse: (value) => value }, { jsonSchema: schema })
    .negativeClaims({
      field: 'negatives',
      tools: ['read_incidents'],
      unestablished: 'state-searched',
    });
  if (options.extra !== undefined) builder.tool(options.extra);
  return { agent: builder.build(), execute };
}

describe('negative runtime identity and continuation', () => {
  it.each(['classic', 'dynamic', 'dynamic-grouped'] as const)(
    'starts without an identity but never establishes caller-scoped absence (%s)',
    async (reactMode) => {
      const { agent, execute } = fixture(false, { reactMode });
      const value = await agent.run({ message: 'Check payments.' });
      expect(typeof value).toBe('string');
      expect(agent.answerNegatives()?.checks[0]?.code).toBe('outside-trusted-context');
      expect(execute).toHaveBeenCalledTimes(1);
    },
  );

  it('followUp keeps the earlier private observation dated and stale', async () => {
    const { agent, execute } = fixture(true);
    await agent.run({ message: 'Check payments.', identity });
    expect(agent.answerNegatives()?.checks[0]?.code).toBe('established');
    const original = agent.checkpoint()!.negativeClaimState!.calls[0];
    await agent.followUp('Is it still true?');
    expect(agent.answerNegatives()?.checks[0]?.code).toBe('stale-turn');
    expect(agent.answerNegatives()?.checks[0]?.staleSince).toEqual({
      turn: 1,
      readAt: original.readAt,
    });
    expect(agent.checkpoint()?.negativeClaimState?.calls).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('a stored named conversation keeps stale read metadata on a fresh agent without restating identity', async () => {
    const original = fixture(true);
    await original.agent.run({ message: 'Check payments.', identity });
    const checkpoint = JSON.parse(JSON.stringify(original.agent.checkpoint()));
    const continued = fixture(true, { noRead: true });
    await continued.agent.run({ message: 'Is it still true?', continueFrom: checkpoint });
    expect(continued.agent.answerNegatives()?.checks[0]?.code).toBe('stale-turn');
    expect(continued.agent.answerNegatives()?.checks[0]?.staleSince?.readAt).toBe(
      checkpoint.negativeClaimState.calls[0].readAt,
    );
    expect(continued.execute).not.toHaveBeenCalled();
  });

  it('anonymous follow-ups retain only stale addresses and dates, never earlier evidence', async () => {
    const { agent, execute } = fixture(false);
    await agent.run({ message: 'Check payments.' });
    const first = agent.checkpoint()!.negativeClaimState!.calls[0];
    for (const message of ['Is it still true?', 'And now?']) {
      await agent.followUp(message);
      expect(agent.answerNegatives()?.checks[0]?.code).toBe('stale-turn');
      expect(agent.answerNegatives()?.checks[0]?.staleSince).toEqual({
        turn: 1,
        readAt: first.readAt,
      });
      const carried = agent.checkpoint()!.negativeClaimState!;
      expect(carried.anonymousOwner).toBe(true);
      expect(carried.calls).toHaveLength(1);
      expect(carried.calls[0]).toMatchObject({
        arguments: {},
        trustedContext: false,
        keptOut: true,
      });
      expect(carried.calls[0].scope).toBeUndefined();
      expect(carried.calls[0].rowsRead).toBeUndefined();
      expect(carried.calls[0].row?.checked).toEqual([]);
      expect(carried.tools).toEqual({});
      expect(JSON.stringify(carried)).not.toContain('payments');
      expect(JSON.stringify(carried)).not.toContain('incident store');
    }
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each(['named-to-anonymous', 'anonymous-to-named'] as const)(
    'does not transfer an owner’s private evidence (%s)',
    async (transition) => {
      const startsNamed = transition === 'named-to-anonymous';
      const original = fixture(startsNamed);
      await original.agent.run({ message: 'Check payments.', ...(startsNamed && { identity }) });
      const checkpoint = JSON.parse(JSON.stringify(original.agent.checkpoint()));
      // Model the host continuing stored history under an explicitly different ownership mode.
      if (startsNamed) delete checkpoint.identity;
      const next = fixture(false, { noRead: true });
      await next.agent.run({
        message: 'Is it still true?',
        continueFrom: checkpoint,
        ...(!startsNamed && { identity }),
      });
      expect(next.agent.answerNegatives()?.checks[0]?.code).toBe('citation-unresolved');
      expect(next.agent.checkpoint()?.negativeClaimState?.calls).toEqual([]);
      expect(next.agent.checkpoint()?.negativeClaimState?.tools).toEqual({});
    },
  );

  it('returning an among miss cannot turn a writing call into a read', async () => {
    const wrote = vi.fn();
    const mutation = defineTool({
      name: 'record_request',
      description: 'Record a request and report a missing inventory name.',
      inputSchema: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] },
      execute: ({ item }: { item: string }) => {
        wrote();
        return absent({
          what: item,
          among: {
            argument: 'item',
            source: 'synthetic inventory',
            measuredAt: '2026-01-01T00:00:00Z',
            count: 0,
          },
        });
      },
    });
    const { agent } = fixture(true, { extra: mutation });
    await agent.run({ message: 'Check payments.', identity });
    expect(wrote).toHaveBeenCalledTimes(1);
    expect(agent.answerNegatives()?.checks[0]?.code).toBe('superseded-by-write');
    const call = agent.checkpoint()?.negativeClaimState?.calls[1];
    expect(call?.effect).toBe('not-read');
    expect(call?.row?.kind).toBe('absence');
  });
});
