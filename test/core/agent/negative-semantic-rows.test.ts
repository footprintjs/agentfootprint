/** Native mixed described data must survive capture and display admission together. */
import { describe, expect, it } from 'vitest';
import {
  Agent,
  allow,
  defineTool,
  describedResult,
  fromIdentity,
  hostFilled,
  type DeliveredNegative,
} from '../../../src/index.js';
import { mock } from '../../../src/doors/providers.js';
import { semanticsForModel } from '../../../src/semantics/envelope.js';

const mixedResult = () =>
  describedResult({
    facts: [{ entity: 'INC-8' }],
    series: [{ t: '2026-10-24T12:00:00Z', entity: 'INC-9', metric: 'count', value: 1 }],
    edges: [{ from: 'INC-8', to: 'INC-9', kind: 'related' }],
    grain: { interval: '1m' },
    provenance: { source: 'fixture', measuredAt: '2026-10-24T12:00:00Z' },
  });

async function run(display?: unknown) {
  const result = mixedResult();
  const tool = hostFilled(
    defineTool({
      name: 'read_incidents',
      description: 'Read fixture incidents.',
      effects: 'read',
      inputSchema: {
        type: 'object',
        properties: { tenant: { type: 'string' } },
        required: ['tenant'],
      },
      search: {
        source: { what: 'fixture', said: ['fixture'] },
        subject: { what: 'incidents', said: ['incidents'] },
        arguments: [{ name: 'tenant', role: 'filter' }],
        complete: 'within-arguments',
      },
      execute: () => result,
    }),
    { tenant: fromIdentity('tenant') },
  );
  const schema = {
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
        },
      },
    },
    required: ['negatives'],
  };
  const builder = Agent.create({
    model: 'mock',
    provider: mock({
      replies: [
        { content: '', toolCalls: [{ id: 'read', name: 'read_incidents', args: {} }] },
        { content: JSON.stringify({ negatives: [{ kind: 'complete', restsOn: ['r1'] }] }) },
      ],
    }),
  }).tool(tool);
  if (display !== undefined)
    builder.toolMiddleware({
      name: 'project-described-data',
      onToolResult: () => allow(display, 'Only the projected data may be displayed.'),
    });
  const agent = builder
    .outputSchema({ parse: (value: unknown) => value }, { jsonSchema: schema })
    .negativeClaims({ field: 'negatives', tools: ['read_incidents'] })
    .build();
  const output = await agent.runTyped<{ negatives: DeliveredNegative[] }>({
    message: 'Read incidents.',
    identity: { tenant: 'fixture', principal: 'tester', conversationId: 'mixed-rows' },
  });
  return { output, report: agent.answerNegatives() };
}

describe('complete statements from all described collections', () => {
  it('counts facts, series and edges together, with identities from every identifiable row', async () => {
    const { output, report } = await run();
    expect(report?.checks[0]).toMatchObject({ code: 'established', kind: 'complete' });
    expect(output.negatives[0].statement).toContain('read 3 rows');
    expect(output.negatives[0].statement).toContain('`INC-8`, `INC-9`, and 1 more');
  });

  it.each(['removed', 'replaced'] as const)(
    'keeps counts but withholds native identities when one collection is %s before display',
    async (mode) => {
      const display = semanticsForModel(mixedResult());
      if (mode === 'removed') delete display.series;
      else
        display.series = [
          { t: '2026-10-24T12:00:00Z', entity: 'PUBLIC', metric: 'count', value: 1 },
        ];
      const { output, report } = await run(display);
      expect(report?.checks[0]).toMatchObject({ code: 'established', kind: 'complete' });
      expect(output.negatives[0].statement).toContain('read 3 rows');
      expect(output.negatives[0].statement).not.toMatch(/INC-8|INC-9|PUBLIC/);
    },
  );

  it('retains values when middleware preserves every native collection', async () => {
    const { output } = await run(semanticsForModel(mixedResult()));
    expect(output.negatives[0].statement).toContain('read 3 rows');
    expect(output.negatives[0].statement).toContain('`INC-8`, `INC-9`, and 1 more');
  });
});
