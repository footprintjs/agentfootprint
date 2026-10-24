/**
 * A mock-only typed negative: the model cites a read, and the library writes
 * the statement with that read's limits. No network or paid model is used.
 * Run: npm run example -- examples/features/110-negative-claims.ts
 */
import {
  Agent,
  absent,
  defineTool,
  fromIdentity,
  hostFilled,
  type DeliveredNegative,
  type NegativeClaimCitation,
  type OutputSchemaParser,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/110-negative-claims',
  title: 'Typed negatives — the library states what the search covered',
  group: 'features',
  description:
    'A local search returns nothing; the model cites its handle and the delivered statement preserves the source gap.',
  defaultInput: 'Check open incidents for payments.',
  providerSlots: [],
  tags: ['features', 'tools', 'observability'],
};

// #region search
const listIncidents = hostFilled(
  defineTool({
    name: 'list_incidents',
    description: 'Read open incidents for one service in the caller tenant.',
    inputSchema: {
      type: 'object',
      properties: { service: { type: 'string' }, tenantId: { type: 'string' } },
      required: ['service', 'tenantId'],
    },
    effects: 'read',
    search: {
      source: { what: 'the incident store', said: ['the incident store'] },
      subject: { what: 'incidents', said: ['incidents'] },
      fixed: [{ name: 'status', value: 'open', said: ['open'] }],
      arguments: [
        { name: 'service', role: 'population' },
        { name: 'tenantId', role: 'filter' },
      ],
      complete: 'within-arguments',
      gaps: [
        {
          what: 'incidents filed by email',
          why: 'email reports never enter this store',
          bears: 'source',
        },
      ],
    },
    execute: ({ service, tenantId }: { service: string; tenantId: string }) => {
      // A real implementation queries its store with BOTH of these filters.
      // This synthetic store has no rows for the demonstration tenant.
      if (tenantId !== 'example-tenant') throw new Error('Unknown demonstration tenant');
      return absent({ what: `open incidents for ${service}`, checked: 'declared' });
    },
  }),
  { tenantId: fromIdentity('tenant') },
);
// #endregion search

interface ModelAnswer {
  summary: string;
  negatives: NegativeClaimCitation[];
}
const parser: OutputSchemaParser<ModelAnswer> = {
  parse(raw) {
    const value = raw as Partial<ModelAnswer> | null;
    if (typeof value?.summary !== 'string' || !Array.isArray(value.negatives))
      throw new Error('summary and negatives are required');
    const negatives = value.negatives.map((claim) => {
      if (
        !Array.isArray(claim.restsOn) ||
        claim.restsOn.some((handle) => typeof handle !== 'string')
      )
        throw new Error('Invalid citation');
      return { restsOn: [...claim.restsOn] };
    });
    return { summary: value.summary, negatives };
  },
};

// #region schema
const jsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    negatives: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          restsOn: { type: 'array', items: { type: 'string' } },
        },
        required: ['restsOn'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'negatives'],
  additionalProperties: false,
};
// #endregion schema

export async function run(input: string): Promise<string> {
  // The fixture sends only a handle: kind and searched subject are runtime-owned.
  // Real models receive this
  // handle beside the tool result; a provider call id is never a citation.
  const provider = mock({
    replies: [
      {
        content: '',
        toolCalls: [{ id: 'provider-call', name: 'list_incidents', args: { service: 'payments' } }],
      },
      {
        content: JSON.stringify({
          summary: 'The recorded search result follows.',
          negatives: [{ restsOn: ['r1'] }],
        }),
      },
    ],
  });
  // #region configure
  const agent = Agent.create({ provider, model: 'mock' })
    .tool(listIncidents)
    .outputSchema(parser, { jsonSchema })
    .negativeClaims({ field: 'negatives', tools: ['list_incidents'] })
    .build();

  // The host supplies identity after authenticating the caller; the model
  // cannot set the tenantId tool argument that hostFilled owns.
  const answer = await agent.runTyped<{ summary: string; negatives: DeliveredNegative[] }>({
    message: input,
    identity: {
      tenant: 'example-tenant',
      principal: 'example-user',
      conversationId: 'negative-example',
    },
  });
  for (const claim of answer.negatives) {
    console.log(`[${claim.delivery}] ${claim.statement}`);
  }
  // #endregion configure
  const claim = answer.negatives[0];
  if (
    claim?.delivery !== 'record-composed' ||
    !claim.statement.includes('incidents filed by email')
  ) {
    throw new Error('The library statement must preserve the source gap.');
  }
  return claim.statement;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
