/**
 * Observe a prose overclaim beside a native search, without rewriting the answer.
 * Mock-only: no network, credentials or paid model. No answer validator is configured.
 * Run: npm run example -- examples/features/111-negative-prose-observe.ts
 */
import {
  Agent,
  absent,
  defineTool,
  fromIdentity,
  hostFilled,
  type NegativeClaimsOptions,
} from '../../src/index.js';
import type { Payloads } from '../../src/events.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/111-negative-prose-observe',
  title: 'Prose negatives — observe a warning without rewriting the answer',
  group: 'features',
  description:
    'A native search has a source gap. The model overclaims, the observer emits a finding, and the default standing line explains the doubt.',
  defaultInput: 'Check incidents for payments.',
  providerSlots: [],
  tags: ['features', 'tools', 'observability'],
};

const listIncidents = hostFilled(
  defineTool({
    name: 'list_incidents',
    description: 'Read incidents for a service in the caller tenant.',
    effects: 'read',
    inputSchema: {
      type: 'object',
      properties: { service: { type: 'string' }, tenantId: { type: 'string' } },
      required: ['service', 'tenantId'],
    },
    search: {
      source: { what: 'the incident store', said: ['the incident store'] },
      subject: { what: 'incidents', said: ['incident', 'incidents'] },
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
      if (tenantId !== 'example-tenant') throw new Error('Unknown demonstration tenant');
      return absent({
        what: `incidents for ${service}`,
        checked: 'declared',
        resolved: [{ argument: 'service', id: service, name: service }],
      });
    },
  }),
  { tenantId: fromIdentity('tenant') },
);

// #region custom-phrases
// Optional configuration: bounded literal words, never regexes or callbacks.
export const customObservation = {
  prose: true,
  phrases: { none: ['came up empty'], complete: ['the entire inventory is here'] },
} satisfies NegativeClaimsOptions;
// #endregion custom-phrases

export async function run(input: string): Promise<string> {
  const modelAnswer = 'There are no incidents for payments.';
  const provider = mock({
    replies: [
      {
        content: '',
        toolCalls: [{ id: 'provider-read', name: 'list_incidents', args: { service: 'payments' } }],
      },
      { content: modelAnswer },
    ],
  });
  const warnings: Payloads.FindingsNegativeClaimPayload[] = [];
  // #region observe
  const agent = Agent.create({ provider, model: 'mock' })
    .tool(listIncidents)
    .negativeClaims({ prose: true })
    .build();

  agent.on('agentfootprint.findings.negative_claim', ({ payload }) => {
    warnings.push(payload);
    const codes = payload.kind === 'negative-claim' ? payload.notes : [payload.code];
    console.log(`[prose warning] ${codes.join(', ')}`);
  });

  const answer = await agent.run({
    message: input,
    identity: {
      tenant: 'example-tenant',
      principal: 'example-user',
      conversationId: 'prose-example',
    },
  });
  // The observer records the gap. The answer layer appends the standing line.
  console.log(answer);
  // #endregion observe
  const expected =
    `${modelAnswer}\n\n---\n\n` +
    'Not sure — a tool said there is ground it did not check or cannot cover ' +
    '(cannot cover “incidents filed by email”); ' +
    'a tool said nothing matched; model prose was not verified for negative claims.';
  if (answer !== expected)
    throw new Error('Expected the model text followed by the standing line.');
  if (
    warnings.length !== 1 ||
    warnings[0].kind !== 'negative-claim' ||
    !warnings[0].notes.includes('coverage-gap')
  ) {
    throw new Error('The native search gap must produce one prose warning.');
  }
  return answer;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
