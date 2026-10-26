/** Real agent boundary: model intent is checked; delivered subjects are recorded values. */
import { describe, expect, it } from 'vitest';
import {
  Agent,
  AnswerValidationError,
  absent,
  defineTool,
  describedResult,
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
          kind: { type: 'string', enum: ['none', 'not-found', 'complete'] },
          ...(legacy && {
            about: { type: 'string' },
          }),
          restsOn: { type: 'array', items: { type: 'string' } },
        },
        required: legacy ? ['kind', 'about', 'restsOn'] : ['kind', 'restsOn'],
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
        !['none', 'not-found', 'complete'].includes(entry.kind) ||
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
function read(name: string, rows = false, complete = true) {
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
        ...(complete ? { complete: 'within-arguments' as const } : {}),
      },
      execute: (args: { service: string; tenant: string }) => {
        if (args.tenant !== identity.tenant) throw new Error('Wrong caller');
        return rows
          ? describedResult({
              facts: [
                { entity: 'incident-visible', service: args.service },
                { entity: 'another-incident', service: args.service },
              ],
              provenance: { source: 'fixture', measuredAt: '2026-10-25T12:00:00Z' },
            })
          : absent({
              what: 'incidents',
              checked: 'declared',
              ...(!complete && {
                notChecked: [{ what: 'the secondary partition', bears: 'completeness' as const }],
              }),
            });
      },
    }),
    { tenant: fromIdentity('tenant') },
  );
}

for (const reactMode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
  describe(`evidence-owned citations (${reactMode})`, () => {
    for (const kind of ['none', 'not-found'] as const) {
      it(`withholds ${kind} when its own read returned two rows, without delivering the draft`, async () => {
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
                  negatives: [{ kind, about: 'no incidents for payments', restsOn: ['r1'] }],
                }),
              },
            ],
          }),
        })
          .tool(read('read_incidents', true))
          .outputSchema(parser(true), { jsonSchema: schema(true) })
          .negativeClaims({ field: 'negatives', tools: ['read_incidents'] })
          .build();
        await expect(
          agent.runTyped({ message: 'Check payments.', identity }),
        ).rejects.toBeInstanceOf(AnswerValidationError);
        expect(agent.answerNegatives()?.checks[0]).toMatchObject({
          kind,
          code: 'contradicted-by-rows',
        });
        expect(agent.answerNegatives()?.delivery).toBe('fallback');
        expect(JSON.stringify(agent.checkpoint()?.history)).not.toContain(
          'no incidents for payments',
        );
        expect(agent.answerNegatives()?.claims[0].about).toBe('payments');
      });
    }

    it('blocks a payments label on a billing read and renders only the recorded label in fallback', async () => {
      const agent = Agent.create({
        reactMode,
        model: 'mock',
        provider: mock({
          replies: [
            {
              content: '',
              toolCalls: [{ id: 'a', name: 'read_incidents', args: { service: 'billing' } }],
            },
            {
              content: JSON.stringify({
                negatives: [{ kind: 'none', about: 'payments', restsOn: ['r1'] }],
              }),
            },
          ],
        }),
      })
        .tool(read('read_incidents'))
        .outputSchema(parser(true), { jsonSchema: schema(true) })
        .negativeClaims({
          field: 'negatives',
          tools: ['read_incidents'],
          unestablished: 'state-searched',
        })
        .build();
      const answer = await agent.runTyped<{ negatives: DeliveredNegative[] }>({
        message: 'Check a service.',
        identity,
      });
      expect(agent.answerNegatives()?.checks[0].code).toBe('about-mismatch');
      expect(agent.answerNegatives()?.delivery).toBe('recorded');
      expect(answer.negatives[0].about).toBe('billing');
      expect(JSON.stringify(answer)).not.toContain('payments');
      expect(agent.checkpoint()?.history.at(-1)?.content).toBe(JSON.stringify(answer));
    });

    it('states the narrower absence without confirming an unsupported complete-list request', async () => {
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
                negatives: [{ kind: 'complete', about: 'payments', restsOn: ['r1'] }],
              }),
            },
          ],
        }),
      })
        .tool(read('read_incidents', false, false))
        .outputSchema(parser(true), { jsonSchema: schema(true) })
        .negativeClaims({
          field: 'negatives',
          tools: ['read_incidents'],
          unestablished: 'state-searched',
        })
        .build();
      const answer = await agent.runTyped<{ negatives: DeliveredNegative[] }>({
        message: 'Give the complete list.',
        identity,
      });
      expect(agent.answerNegatives()?.checks[0]).toMatchObject({
        kind: 'complete',
        code: 'search-incomplete',
      });
      expect(agent.answerNegatives()?.delivery).toBe('recorded');
      expect(answer.negatives[0].statement).toContain(
        'The requested complete-list claim is not established; only this absence is.',
      );
      expect(answer.negatives[0].statement).toContain('found none');
      expect(answer.negatives[0].statement).toContain('the secondary partition');
      expect(agent.checkpoint()?.history.at(-1)?.content).toBe(JSON.stringify(answer));
    });

    it('checks the requested kind and derives the scoped library statement', async () => {
      const agent = Agent.create({
        reactMode,
        model: 'mock',
        provider: mock({
          replies: [
            {
              content: '',
              toolCalls: [{ id: 'a', name: 'read_incidents', args: { service: 'payments' } }],
            },
            { content: JSON.stringify({ negatives: [{ kind: 'none', restsOn: ['r1'] }] }) },
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
      expect(result.negatives[0].about).toBe('payments');
      expect(result.negatives[0].statement).toContain('`payments`');
      expect(result.negatives[0].statement).not.toContain(identity.tenant);
      expect(agent.answerNegatives()?.delivery).toBe('as-checked');
      expect(agent.answerNegatives()?.checks[0].code).toBe('established');
      expect(agent.answerNegatives()?.checks[0].notes).toBeUndefined();
    });

    it('normalizes only absence kind and delivers the recorded subject instead of its phrase', async () => {
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
                negatives: [
                  { kind: 'not-found', about: 'open incidents for payments', restsOn: ['r1'] },
                ],
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
      expect(result.negatives[0]).toMatchObject({ kind: 'none', about: 'payments' });
      expect(result.negatives[0].statement).toContain('`payments`');
      expect(JSON.stringify(result)).not.toContain('open incidents for payments');
      expect(agent.answerNegatives()?.checks[0].code).toBe('established');
      expect(agent.answerNegatives()?.checks[0].notes).toEqual(['absence-kind-normalized']);
      expect(agent.answerNegatives()?.delivery).toBe('as-checked');
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
                negatives: [
                  { kind: 'not-found', about: 'open incidents for payments', restsOn: ['r1'] },
                ],
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
