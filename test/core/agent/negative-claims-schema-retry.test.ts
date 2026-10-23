/** The typed negative gate shares one no-tools correction across schema and evidence failures. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Agent,
  AnswerValidationError,
  absent,
  defineTool,
  fromIdentity,
  hostFilled,
  type LLMMessage,
  type LLMRequest,
  type LLMResponse,
  type OutputSchemaParser,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import {
  defineMemory,
  InMemoryStore,
  MEMORY_STRATEGIES,
  MEMORY_TYPES,
} from '../../../src/memory/index.js';

type Mode = 'classic' | 'dynamic' | 'dynamic-grouped';
const MODES: readonly Mode[] = ['classic', 'dynamic', 'dynamic-grouped'];
const IDENTITY = { tenant: 'retry-tenant', principal: 'tester', conversationId: 'retry-test' };
const INPUT = {
  message: 'Send the payment, then check open incidents for payments.',
  identity: IDENTITY,
};
const BAD = 'SCHEMA-REJECTED-DRAFT';
const GOOD = JSON.stringify({ negatives: [{ kind: 'none', about: 'payments', restsOn: ['r2'] }] });
const UNRESOLVED = JSON.stringify({
  negatives: [{ kind: 'none', about: 'payments', restsOn: ['r9999'] }],
});
const SCHEMA = {
  type: 'object',
  properties: {
    negatives: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['none', 'not-found', 'complete'] },
          about: { type: 'string' },
          restsOn: { type: 'array', items: { type: 'string' } },
        },
        required: ['kind', 'about', 'restsOn'],
        additionalProperties: false,
      },
    },
  },
  required: ['negatives'],
  additionalProperties: false,
} as const;
const parser: OutputSchemaParser<unknown> = {
  parse(value) {
    if (
      value === null ||
      typeof value !== 'object' ||
      !('negatives' in value) ||
      !Array.isArray(value.negatives)
    )
      throw new Error('Expected negatives array.');
    return value;
  },
};
const WRITE = { content: '', toolCalls: [{ id: 'write', name: 'send_payment', args: {} }] };
const READ = {
  content: '',
  toolCalls: [{ id: 'read', name: 'read_incidents', args: { service: 'payments' } }],
};

function fixture(
  mode: Mode,
  replies: (string | Partial<LLMResponse>)[],
  retries = 3,
  native = false,
) {
  const inner = mock({ replies: [WRITE, READ, ...replies] });
  const requests: LLMRequest[] = [];
  const write = vi.fn(() => 'Payment sent.');
  const read = vi.fn(() => absent({ what: 'open incidents', checked: 'declared' }));
  const store = new InMemoryStore();
  const agent = Agent.create({
    model: 'mock',
    reactMode: mode,
    maxIterations: 12,
    provider: {
      name: inner.name,
      carriesNativeOutputSchema: true,
      async complete(request) {
        requests.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
        return inner.complete(request);
      },
    },
  })
    .tool(
      defineTool({
        name: 'send_payment',
        description: 'Send one synthetic payment.',
        inputSchema: { type: 'object', properties: {} },
        execute: write,
      }),
    )
    .tool(
      hostFilled(
        defineTool({
          name: 'read_incidents',
          description: 'Read caller incidents for a service.',
          inputSchema: {
            type: 'object',
            properties: { service: { type: 'string' }, tenantId: { type: 'string' } },
            required: ['service', 'tenantId'],
          },
          effects: 'read',
          search: {
            source: { what: 'incident store', said: ['incident store'] },
            subject: { what: 'incidents', said: ['incidents'] },
            arguments: [
              { name: 'service', role: 'population' },
              { name: 'tenantId', role: 'filter' },
            ],
            complete: 'within-arguments',
          },
          execute: read,
        }),
        { tenantId: fromIdentity('tenant') },
      ),
    )
    .outputSchema(parser, {
      jsonSchema: SCHEMA,
      retries,
      ...(native && { strategy: 'native' as const }),
    })
    .negativeClaims({ field: 'negatives', tools: ['read_incidents'] })
    .memory(
      defineMemory({
        id: 'retry-history',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 8 },
        store,
      }),
    )
    .build();
  return { agent, requests, write, read, store };
}

async function assistantMemory(store: InMemoryStore) {
  return (await store.list(IDENTITY)).entries
    .map((entry) => entry.value as LLMMessage)
    .filter((message) => message.role === 'assistant');
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

for (const mode of MODES) {
  describe(`negative schema correction — ${mode}`, () => {
    it('corrects once without repeating an executed write or remembering the rejected draft', async () => {
      const f = fixture(mode, [BAD, { content: GOOD, toolCalls: WRITE.toolCalls }, GOOD]);
      const answer = await f.agent.run(INPUT);
      expect(f.requests).toHaveLength(4);
      expect(f.requests[3]?.tools ?? []).toEqual([]);
      expect(f.write).toHaveBeenCalledTimes(1);
      expect(f.read).toHaveBeenCalledTimes(1);
      expect(String(answer)).toContain('record-composed');
      expect(JSON.stringify(f.requests[3]?.messages)).not.toContain(BAD);
      expect(JSON.stringify(f.agent.checkpoint()?.history)).not.toContain(BAD);
      expect(JSON.stringify(await assistantMemory(f.store))).not.toContain(BAD);
      expect(JSON.stringify(f.requests[3])).toContain('no tool');
    });

    it('does not buy a citation correction after its schema correction', async () => {
      const f = fixture(mode, [BAD, UNRESOLVED, GOOD]);
      await expect(f.agent.run(INPUT)).rejects.toBeInstanceOf(AnswerValidationError);
      expect(f.requests).toHaveLength(4);
      expect(f.write).toHaveBeenCalledTimes(1);
      expect(await assistantMemory(f.store)).toEqual([]);
    });

    it('does not buy a schema correction after its citation correction', async () => {
      const f = fixture(mode, [UNRESOLVED, BAD, GOOD]);
      await expect(f.agent.run(INPUT)).rejects.toBeInstanceOf(AnswerValidationError);
      expect(f.requests).toHaveLength(4);
      expect(f.requests[3]?.tools ?? []).toEqual([]);
      expect(f.write).toHaveBeenCalledTimes(1);
      expect(await assistantMemory(f.store)).toEqual([]);
    });

    it('withholds repeated invalid schema after one correction even when retries is three', async () => {
      const f = fixture(mode, [BAD, BAD, GOOD]);
      await expect(f.agent.run(INPUT)).rejects.toBeInstanceOf(AnswerValidationError);
      expect(f.requests).toHaveLength(4);
      expect(f.requests[3]?.tools ?? []).toEqual([]);
      expect(f.agent.outputContractUnmet()).toMatchObject({ attempts: 2, retriesSpent: 1 });
      expect(f.write).toHaveBeenCalledTimes(1);
      expect(await assistantMemory(f.store)).toEqual([]);
      expect(JSON.stringify(f.agent.checkpoint()?.history)).not.toContain(BAD);
    });

    it('withholds terminal schema failure without application answer validation or retries', async () => {
      const f = fixture(mode, [BAD, GOOD], 0);
      await expect(f.agent.run(INPUT)).rejects.toBeInstanceOf(AnswerValidationError);
      expect(f.requests).toHaveLength(3);
      expect(f.write).toHaveBeenCalledTimes(1);
      expect(await assistantMemory(f.store)).toEqual([]);
    });

    it('native truncation gets only one no-tools shape correction', async () => {
      const f = fixture(
        mode,
        [
          { content: GOOD, stopReason: 'max_tokens' },
          { content: GOOD, toolCalls: WRITE.toolCalls },
          GOOD,
        ],
        3,
        true,
      );
      const answer = await f.agent.run(INPUT);
      expect(String(answer)).toContain('record-composed');
      expect(f.requests).toHaveLength(4);
      expect(f.requests[3]?.tools ?? []).toEqual([]);
      expect(f.write).toHaveBeenCalledTimes(1);
    });
  });
}
