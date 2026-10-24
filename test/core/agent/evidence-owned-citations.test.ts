/** Real agent boundary: only pointers are authoritative; model labels never scope a check. */
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

const identity = { tenant: 'tenant-fixture', principal: 'tester', conversationId: 'pointer-only' };
const schema = (legacy = false) => ({
  type: 'object',
  properties: {
    negatives: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ...(legacy && {
            kind: { type: 'string', enum: ['none', 'not-found', 'complete'] },
            about: { type: 'string' },
          }),
          restsOn: { type: 'array', items: { type: 'string' } },
        },
        required: legacy ? ['kind', 'about', 'restsOn'] : ['restsOn'],
        additionalProperties: false,
      },
    },
  },
  required: ['negatives'],
  additionalProperties: false,
});
const parser = (legacy = false) => ({
  parse(input: unknown): { negatives: NegativeClaimCitation[] } {
    const value = input as { negatives?: NegativeClaimCitation[] } | null;
    if (!value || !Array.isArray(value.negatives)) throw new Error('missing citations');
    for (const entry of value.negatives) {
      if (
        !Array.isArray(entry.restsOn) ||
        entry.restsOn.some((handle) => typeof handle !== 'string')
      )
        throw new Error('invalid handles');
      if (legacy && (!entry.kind || typeof entry.about !== 'string'))
        throw new Error('legacy parser still requires its authored fields');
    }
    return { negatives: value.negatives };
  },
});
function read(name: string, rows = false) {
  return hostFilled(
    defineTool({
      name,
      description: 'Read incidents for the service in the authenticated tenant.',
      inputSchema: {
        type: 'object',
        properties: { service: { type: 'string' }, tenant: { type: 'string' } },
        required: ['service', 'tenant'],
      },
      effects: 'read',
      search: {
        source: { what: 'the incident store', said: ['incident store'] },
        subject: { what: 'incidents', said: ['incidents'] },
        arguments: [
          { name: 'service', role: 'population' },
          { name: 'tenant', role: 'filter' },
        ],
        complete: 'within-arguments',
      },
      execute: (args: { service: string; tenant: string }) => {
        if (args.tenant !== identity.tenant) throw new Error('Wrong caller');
        return rows
          ? [{ id: 'incident-visible', service: args.service }]
          : absent({ what: 'incidents', checked: 'declared' });
      },
    }),
    { tenant: fromIdentity('tenant') },
  );
}

for (const reactMode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
  describe(`evidence-owned citations (${reactMode})`, () => {
    it('accepts only handles and derives the scoped library statement', async () => {
      const agent = Agent.create({
        reactMode,
        model: 'mock',
        provider: mock({
          replies: [
            {
              content: '',
              toolCalls: [{ id: 'a', name: 'read_incidents', args: { service: 'payments' } }],
            },
            { content: JSON.stringify({ negatives: [{ restsOn: ['r1'] }] }) },
          ],
        }),
      })
        .tool(read('read_incidents'))
        .outputSchema(parser(), { jsonSchema: schema() })
        .negativeClaims({ field: 'negatives', tools: ['read_incidents'] })
        .build();
      const result = await agent.runTyped<{ negatives: DeliveredNegative[] }>({
        message: 'Check payments.',
        identity,
      });
      expect(result.negatives[0]).toMatchObject({
        kind: 'none',
        restsOn: ['r1'],
        delivery: 'record-composed',
      });
      expect(result.negatives[0].about).toBeUndefined();
      expect(result.negatives[0].statement).toContain('`payments`');
      expect(result.negatives[0].statement).not.toContain(identity.tenant);
      expect(agent.answerNegatives()?.delivery).toBe('as-checked');
      expect(agent.answerNegatives()?.checks[0].code).toBe('established');
    });

    it('retains legacy parser requirements but ignores wrong kind and negated subject text', async () => {
      const agent = Agent.create({
        reactMode,
        model: 'mock',
        provider: mock({
          replies: [
            {
              content: '',
              toolCalls: [{ id: 'a', name: 'read_incidents', args: { service: 'payments' } }],
            },
            {
              content: JSON.stringify({
                negatives: [{ kind: 'not-found', about: 'not payments', restsOn: ['r1'] }],
              }),
            },
          ],
        }),
      })
        .tool(read('read_incidents'))
        .outputSchema(parser(true), { jsonSchema: schema(true) })
        .negativeClaims({ field: 'negatives', tools: ['read_incidents'] })
        .build();
      const result = await agent.runTyped<{ negatives: DeliveredNegative[] }>({
        message: 'Check payments.',
        identity,
      });
      expect(result.negatives[0]).toMatchObject({ kind: 'none', about: 'not payments' });
      expect(result.negatives[0].statement).toContain('`payments`');
      expect(result.negatives[0].statement).not.toContain('not payments');
      expect(agent.answerNegatives()?.checks[0].code).toBe('established');
      expect(agent.answerNegatives()?.delivery).toBe('recorded');
    });

    it('cannot hide a contradicting read behind a model-written label', async () => {
      const agent = Agent.create({
        reactMode,
        model: 'mock',
        provider: mock({
          replies: [
            {
              content: '',
              toolCalls: [{ id: 'a', name: 'read_incidents', args: { service: 'payments' } }],
            },
            {
              content: '',
              toolCalls: [{ id: 'b', name: 'other_incidents', args: { service: 'payments' } }],
            },
            {
              content: JSON.stringify({
                negatives: [{ kind: 'not-found', about: 'billing', restsOn: ['r1'] }],
              }),
            },
          ],
        }),
      })
        .tool(read('read_incidents'))
        .tool(read('other_incidents', true))
        .outputSchema(parser(true), { jsonSchema: schema(true) })
        .negativeClaims({ field: 'negatives', tools: ['read_incidents', 'other_incidents'] })
        .build();
      await expect(agent.runTyped({ message: 'Check payments.', identity })).rejects.toBeInstanceOf(
        AnswerValidationError,
      );
      expect(agent.answerNegatives()?.checks[0].code).toBe('other-read-has-rows');
      expect(agent.answerNegatives()?.delivery).toBe('fallback');
    });
  });
}
