/** Synthetic structured replies exercise the real schema and evidence gates. */
import { describe, expect, it, vi } from 'vitest';
import {
  Agent,
  AnswerValidationError,
  absent,
  defineTool,
  describedResult,
  fromIdentity,
  hostFilled,
  type LLMProvider,
  type LLMResponse,
  type OutputSchemaParser,
} from '../../src/index.js';

interface Answer {
  summary: string;
  negatives: unknown[];
}
const parser: OutputSchemaParser<Answer> = {
  parse(value) {
    const candidate = value as Partial<Answer> | null;
    if (typeof candidate?.summary !== 'string' || !Array.isArray(candidate.negatives))
      throw new Error('summary and negatives are required');
    return { summary: candidate.summary, negatives: candidate.negatives };
  },
};
const schema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
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
  required: ['summary', 'negatives'],
  additionalProperties: false,
} as const;
const fence = (body: string) => `\`\`\`json\r\n${body}\r\n\`\`\``;
const identity = { tenant: 'demo-tenant', principal: 'tester', conversationId: 'fenced-output' };

function streaming(replies: Array<string | Pick<LLMResponse, 'content' | 'toolCalls'>>) {
  const requested = vi.fn();
  const rawChunks: string[] = [];
  const provider: LLMProvider = {
    name: 'fenced-output-fixture',
    complete: async () => {
      throw new Error('Expected the real stream path');
    },
    stream: async function* (request) {
      const reply = replies[requested.mock.calls.length];
      requested(request);
      if (reply === undefined) throw new Error('Unexpected additional model call');
      const response = typeof reply === 'string' ? { content: reply, toolCalls: [] } : reply;
      const middle = Math.floor(response.content.length / 2);
      for (const [tokenIndex, content] of [
        response.content.slice(0, middle),
        response.content.slice(middle),
      ].entries()) {
        rawChunks.push(content);
        yield { tokenIndex, content, done: false };
      }
      yield {
        tokenIndex: 2,
        content: '',
        done: true,
        response: { ...response, usage: { input: 1, output: 1 }, stopReason: 'stop' },
      };
    },
  };
  return { provider, requested, rawChunks };
}

for (const reactMode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
  describe(`fenced structured answer — ${reactMode}`, () => {
    it('validates and delivers one canonical value without reparsing the app schema after validation', async () => {
      const expected = { summary: 'Ready.', negatives: [] };
      const raw = fence(JSON.stringify(expected, null, 2));
      const source = streaming([raw]);
      let validated = false;
      const agent = Agent.create({ provider: source.provider, model: 'synthetic', reactMode })
        .outputSchema(
          {
            parse(value) {
              expect(validated).toBe(false);
              return parser.parse(value);
            },
          },
          { strategy: 'instruct', retries: 1 },
        )
        .answerValidation<Answer>({
          id: 'fenced-shape',
          version: '1',
          validate(candidate) {
            expect(candidate).toEqual(expected);
            expect(Object.isFrozen(candidate)).toBe(true);
            validated = true;
            return { checks: [{ id: 'checked-shape', disposition: 'checked-pass' }] };
          },
        })
        .build();
      const delivered: string[] = [];
      agent.on('agentfootprint.stream.token', (event) => delivered.push(event.payload.content));

      expect(await agent.runTyped({ message: 'Return the structured status.', identity })).toEqual(
        expected,
      );
      expect(source.requested).toHaveBeenCalledTimes(1);
      expect(source.rawChunks.join('')).toBe(raw);
      expect(delivered).toEqual([JSON.stringify(expected)]);
      expect(agent.checkpoint()?.history.at(-1)?.content).toBe(JSON.stringify(expected));
      expect(agent.outputContractUnmet()).toBeUndefined();
      expect(agent.answerValidation()).toMatchObject({ schemaAccepted: true, status: 'passed' });
    });

    it('passes a fenced typed negative to the native evidence checker without a schema retry', async () => {
      const answer = {
        summary: 'Lookup completed.',
        negatives: [{ kind: 'none', about: 'demo-unit', restsOn: ['r1'] }],
      };
      const raw = fence(JSON.stringify(answer));
      const source = streaming([
        {
          content: '',
          toolCalls: [{ id: 'read', name: 'read_tasks', args: { unit: 'demo-unit' } }],
        },
        raw,
      ]);
      const read = vi.fn(() => absent({ what: 'tasks', checked: 'declared' }));
      const agent = Agent.create({ provider: source.provider, model: 'synthetic', reactMode })
        .tool(
          hostFilled(
            defineTool({
              name: 'read_tasks',
              description: 'Read tasks in the caller account.',
              inputSchema: {
                type: 'object',
                properties: { unit: { type: 'string' }, tenantId: { type: 'string' } },
                required: ['unit', 'tenantId'],
              },
              search: {
                source: { what: 'demo task index', said: ['demo task index'] },
                subject: { what: 'tasks', said: ['task', 'tasks'] },
                arguments: [
                  { name: 'unit', role: 'population' },
                  { name: 'tenantId', role: 'filter' },
                ],
                complete: 'within-arguments',
              },
              execute: read,
            }),
            { tenantId: fromIdentity('tenant') },
          ),
        )
        .outputSchema(parser, { strategy: 'instruct', retries: 1, jsonSchema: schema })
        .negativeClaims({ field: 'negatives', tools: ['read_tasks'] })
        .build();

      const delivered = await agent.run({ message: 'Check tasks for demo-unit.', identity });
      expect(source.requested).toHaveBeenCalledTimes(2);
      expect(read).toHaveBeenCalledTimes(1);
      expect(source.rawChunks.join('')).toBe(raw);
      expect(agent.outputContractUnmet()).toBeUndefined();
      expect(agent.answerNegatives()?.checks).toEqual([
        expect.objectContaining({ code: 'established' }),
      ]);
      expect(JSON.parse(String(delivered))).toMatchObject({ summary: answer.summary });
      expect(String(delivered)).not.toContain('```');
    });

    it('continues withholding malformed fenced JSON rather than repairing it', async () => {
      const source = streaming([fence('{"summary":"broken", "negatives":[],}')]);
      const validate = vi.fn(() => ({
        checks: [{ id: 'shape', disposition: 'checked-pass' as const }],
      }));
      const agent = Agent.create({ provider: source.provider, model: 'synthetic', reactMode })
        .outputSchema(parser, { strategy: 'instruct', retries: 0 })
        .answerValidation({ id: 'strict-fenced-json', version: '1', validate })
        .build();
      await expect(
        agent.run({ message: 'Return the structured status.', identity }),
      ).rejects.toBeInstanceOf(AnswerValidationError);
      expect(source.requested).toHaveBeenCalledTimes(1);
      expect(validate).not.toHaveBeenCalled();
      expect(agent.outputContractUnmet()).toMatchObject({ stage: 'json-parse', attempts: 1 });
    });

    it('observes a contradictory typed claim through the same accepted wrapper', async () => {
      const raw = fence('{"count":7}');
      const source = streaming([
        { content: '', toolCalls: [{ id: 'count', name: 'read_count', args: {} }] },
        raw,
      ]);
      const agent = Agent.create({ provider: source.provider, model: 'synthetic', reactMode })
        .tool(
          defineTool({
            name: 'read_count',
            description: 'Read a synthetic count.',
            inputSchema: { type: 'object', properties: {} },
            execute: () =>
              describedResult({
                facts: [{ entity: 'demo-unit', count: 3 }],
                provenance: { source: 'demo counter', measuredAt: '2030-01-01T00:00:00Z' },
              }),
          }),
        )
        .outputSchema({ parse: (value: unknown) => value }, { strategy: 'instruct' })
        .claims({ count: { entity: 'demo-unit', field: 'count' } })
        .build();
      const findings: string[] = [];
      agent.on('agentfootprint.integrity.context_error', (event) =>
        findings.push(event.payload.kind),
      );
      expect(await agent.run('Read the count.')).toBe(raw);
      expect(findings).toContain('unsupported-claim');
      expect(source.requested).toHaveBeenCalledTimes(2);
    });
  });
}
