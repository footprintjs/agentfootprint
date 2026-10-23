/** Independent end-to-end tests for the final two PR 4 review corrections.
 * Native tool observations supply contrary IDs; about remains application data. */
import { describe, expect, it, vi } from 'vitest';
import {
  Agent,
  absent,
  allow,
  defineTool,
  deny,
  describedResult,
  fromIdentity,
  hostFilled,
  type LLMResponse,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';

type About = string | number;
interface Reply {
  negatives: {
    kind: string;
    about: About;
    restsOn: string[];
    statement: string;
  }[];
}
const IDENTITY = {
  tenant: 'final-review-tenant',
  principal: 'reviewer',
  conversationId: 'final-review',
};
const INPUT = { message: 'Check incidents for the requested service.', identity: IDENTITY };
const schema = {
  type: 'object',
  properties: {
    negatives: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['none', 'not-found', 'complete'] },
          about: { type: ['string', 'number'] },
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

function fixture(
  options: {
    about?: About;
    later?: unknown;
    peer?: 'untrusted' | 'not-citable';
    denyLater?: boolean;
    laterDisplay?: unknown;
    maxToolResultChars?: number;
    mode?: 'classic' | 'dynamic' | 'dynamic-grouped';
  } = {},
) {
  const about = options.about ?? 'payments';
  const hasLater = Object.hasOwn(options, 'later');
  const toolName = options.peer === undefined ? 'read_incidents' : 'peer_incidents';
  const replies: Partial<LLMResponse>[] = [
    { toolCalls: [{ id: 'provider-first', name: 'read_incidents', args: { service: about } }] },
    ...(hasLater
      ? [{ toolCalls: [{ id: 'provider-later', name: toolName, args: { service: about } }] }]
      : []),
    { content: JSON.stringify({ negatives: [{ kind: 'none', about, restsOn: ['r1'] }] }) },
  ];
  const first = vi.fn(() => absent({ what: 'incidents', checked: 'declared' }));
  const later = vi.fn(() => options.later);
  let reads = 0;
  const read = (name: string, execute: () => unknown, bound: boolean) => {
    const tool = defineTool({
      name,
      description: 'Read incidents for a service in the current caller tenant.',
      effects: 'read',
      inputSchema: {
        type: 'object',
        properties: { service: { type: ['string', 'number'] }, tenantId: { type: 'string' } },
        required: bound ? ['service', 'tenantId'] : ['service'],
      },
      search: {
        source: { what: 'the incident store', said: ['incident store'] },
        subject: { what: 'incidents', said: ['incident', 'incidents'] },
        arguments: [
          { name: 'service', role: 'population' },
          { name: 'tenantId', role: 'filter' },
        ],
        complete: 'within-arguments',
      },
      execute,
    });
    return bound ? hostFilled(tool, { tenantId: fromIdentity('tenant') }) : tool;
  };
  const builder = Agent.create({
    provider: mock({ replies, chunkDelayMs: 0 }),
    model: 'mock',
    reactMode: options.mode ?? 'dynamic',
    ...(options.maxToolResultChars !== undefined && {
      maxToolResultChars: options.maxToolResultChars,
    }),
  }).tool(
    read(
      'read_incidents',
      () => (++reads === 1 || options.peer !== undefined ? first() : later()),
      true,
    ),
  );
  if (options.peer !== undefined)
    builder.tool(read('peer_incidents', later, options.peer !== 'untrusted'));
  if (options.denyLater)
    builder.toolMiddleware({
      name: 'do-not-disclose-later-read',
      onToolResult: (context) =>
        context.toolCallId === 'provider-later'
          ? deny('The later result must remain private.')
          : allow(),
    });
  if (Object.hasOwn(options, 'laterDisplay'))
    builder.toolMiddleware({
      name: 'project-later-result',
      onToolResult: (context) =>
        context.toolCallId === 'provider-later'
          ? allow(options.laterDisplay, 'Only the public status may be shown.')
          : allow(),
    });
  const agent = builder
    .outputSchema({ parse: (value) => value as Reply }, { jsonSchema: schema })
    .negativeClaims({
      field: 'negatives',
      tools:
        options.peer === 'untrusted' ? ['read_incidents', 'peer_incidents'] : ['read_incidents'],
      unestablished: 'state-searched',
    })
    .build();
  const tokens: string[] = [];
  const ends: { finalContent: string }[] = [];
  agent.on('agentfootprint.stream.token', (event) => tokens.push(event.payload.content));
  agent.on('agentfootprint.agent.turn_end', (event) => ends.push(event.payload));
  return { agent, first, later, tokens, ends };
}

const quotedParts = (text: string): string[] =>
  [...text.matchAll(/`([^`\n]*)`/g)].map((match) => match[1]);
function expectQuotedId(text: string, id: string): void {
  expect(
    quotedParts(text).some(
      (part) => part === id || part.includes(`"entity":"${id}"`) || part.includes(`"id":"${id}"`),
    ),
  ).toBe(true);
}

describe('raw about is stable application data', () => {
  for (const mode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
    for (const about of ['payments', 42, 0] as const) {
      it(`${mode}: preserves ${typeof about} ${about} in runTyped and recorded metadata`, async () => {
        const f = fixture({ mode, about });
        const output = await f.agent.runTyped<Reply>(INPUT);
        expect(output.negatives[0]?.about).toBe(about);
        expect(typeof output.negatives[0]?.about).toBe(typeof about);
        expect(f.agent.answerNegatives()?.claims[0]?.about).toBe(about);
        expect(output.negatives[0]?.statement).toContain(`\`${about}\``);
        expect(f.agent.answerNegatives()?.checks[0]?.code).toBe('established');
        expect(f.tokens).toEqual([JSON.stringify(output)]);
        expect(f.ends.map((event) => event.finalContent)).toEqual([JSON.stringify(output)]);
        expect(f.agent.checkpoint()?.history.at(-1)?.content).toBe(JSON.stringify(output));
      });
    }
  }

  it('quotes hostile labels only in the sentence, preserving raw data for application comparisons', async () => {
    const about = 'pay`ments\n\u202eprod';
    const f = fixture({ about });
    const output = await f.agent.runTyped<Reply>(INPUT);
    expect(output.negatives[0]?.about).toBe(about);
    expect(f.agent.answerNegatives()?.claims[0]?.about).toBe(about);
    expect(output.negatives[0]?.statement).toContain("`pay'ments prod`");
    expect(output.negatives[0]?.statement).not.toContain(about);
    expect(output.negatives[0]?.statement).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/u);
  });
});

describe('contradiction statements name the native contrary observation', () => {
  for (const representation of ['array', 'object-envelope', 'semantic-facts'] as const) {
    it(`names INC-9 from a later ${representation} result and attributes it to the read`, async () => {
      const rows = [{ entity: 'INC-9', service: 'payments' }];
      const f = fixture({
        later:
          representation === 'array'
            ? rows
            : representation === 'semantic-facts'
            ? describedResult({
                facts: rows,
                provenance: {
                  source: 'Synthetic incident store',
                  measuredAt: '2026-10-23T12:00:00.000Z',
                },
              })
            : { content: rows, effects: [], status: 'success' },
      });
      const output = await f.agent.runTyped<Reply>(INPUT);
      expect(f.agent.answerNegatives()?.checks[0]?.code).toBe('contradicted-by-rows');
      expectQuotedId(output.negatives[0]?.statement ?? '', 'INC-9');
      expect(output.negatives[0]?.statement).toContain('`read_incidents`');
      expect(output.negatives[0]?.statement).toContain("as the tool's result says");
      expect(output.negatives[0]?.restsOn).toEqual(['r1', 'r2']);
      expect(output.negatives[0]?.about).toBe('payments');
      expect(f.agent.answerNegatives()?.delivery).toBe('recorded');
      expect(f.first).toHaveBeenCalledTimes(1);
      expect(f.later).toHaveBeenCalledTimes(1);
    });
  }

  it('caps the identities listed without concealing that more rows were returned', async () => {
    const f = fixture({
      later: Array.from({ length: 15 }, (_, index) => ({ entity: `INC-${index + 1}` })),
    });
    const output = await f.agent.runTyped<Reply>(INPUT);
    const text = output.negatives[0]?.statement ?? '';
    expectQuotedId(text, 'INC-1');
    expectQuotedId(text, 'INC-12');
    expect(text).not.toContain('INC-13');
    expect(text).not.toContain('INC-15');
    expect(text).toContain('3 more');
    expect(text).toContain('15 rows');
  });

  it('quotes, flattens and caps a hostile contrary identity', async () => {
    const id = 'INC-9`\n\u202e' + 'X'.repeat(100);
    const f = fixture({ later: [{ entity: id }] });
    const output = await f.agent.runTyped<Reply>(INPUT);
    const text = output.negatives[0]?.statement ?? '';
    const shown = quotedParts(text).find((part) => part.includes("INC-9' "));
    expect(shown).toBeDefined();
    expect(shown).toContain('…');
    expect(shown!.length).toBeLessThanOrEqual(65);
    expect(text).not.toContain(id);
    expect(text).not.toContain('X'.repeat(100));
    expect(text).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/u);
  });

  it('names the returned plain id field as quoted row data without inventing identity semantics', async () => {
    const f = fixture({ later: [{ id: 'INC-9' }] });
    const output = await f.agent.runTyped<Reply>(INPUT);
    const text = output.negatives[0]?.statement ?? '';
    expect(f.agent.answerNegatives()?.checks[0]?.code).toBe('contradicted-by-rows');
    expectQuotedId(text, 'INC-9');
    expect(text).toMatch(/(?:read|returned) 1 row\b/u);
  });

  for (const door of ['after-tool-projection', 'agent-cap'] as const) {
    it(`${door} cannot restore a hidden native ID through the contradiction sentence`, async () => {
      const secret = 'HIDDEN-NATIVE-INC-90';
      const f = fixture({
        later: [{ padding: 'x'.repeat(2_000), entity: secret }],
        ...(door === 'after-tool-projection'
          ? { laterDisplay: [{ status: 'open' }] }
          : { maxToolResultChars: 200 }),
      });
      const output = await f.agent.runTyped<Reply>(INPUT);
      const text = output.negatives[0]?.statement ?? '';
      expect(f.agent.answerNegatives()?.checks[0]?.code).toBe('contradicted-by-rows');
      expect(text).toMatch(/(?:read|returned) 1 row\b/u);
      expect(JSON.stringify(output)).not.toContain(secret);
      expect(JSON.stringify(f.agent.answerNegatives())).not.toContain(secret);
      expect(f.later).toHaveBeenCalledTimes(1);
    });
  }

  for (const reason of ['denied', 'redacted', 'untrusted', 'not-citable'] as const) {
    it(`does not disclose a ${reason} contrary result in the composed answer`, async () => {
      const secret = 'PRIVATE-CONTRARY-INC-88';
      const f = fixture({
        later: [{ entity: secret, confidentialMarker: 'private' }],
        ...(reason === 'untrusted' || reason === 'not-citable' ? { peer: reason } : {}),
        ...(reason === 'denied' && { denyLater: true }),
      });
      const output = await f.agent.runTyped<Reply>(
        INPUT,
        reason === 'redacted' ? { redact: { keys: ['confidentialMarker'] } } : undefined,
      );
      expect(JSON.stringify(output)).not.toContain(secret);
      expect(JSON.stringify(f.agent.answerNegatives())).not.toContain(secret);
      expect(output.negatives[0]?.restsOn).not.toContain('r2');
      expect(f.later).toHaveBeenCalledTimes(1);
    });
  }
});
