/** Prose citations on a scripted Anthropic SDK path. No network or key. */
import { Agent, defineTool, describedResult } from '../../src/index.js';
import { anthropic } from '../../src/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/125-prose-citations',
  title: 'Check a prose citation against a scoped reading',
  group: 'features',
  description: 'Verify a stated measurement and flag a missing requested column.',
  defaultInput: 'Read column amunt in mm.',
  providerSlots: [],
  tags: ['features', 'tools', 'observability'],
};

const model = 'claude-sonnet-4-6';
const measure = defineTool({
  name: 'measure',
  description: 'Read the synthetic North measurement.',
  inputSchema: { type: 'object', properties: { unit: { type: 'string' } }, required: ['unit'] },
  execute: () =>
    describedResult({
      facts: [{ entity: 'North', amount: 12 }],
      provenance: { measuredAt: '2026-11-23T00:00:00Z', source: 'synthetic fixture' },
      coverage: { checked: ['amount'] },
    }),
});

function scriptedProvider() {
  let toolRequested = false;
  // `_client` substitutes the transport for this offline example only.
  const sdk = anthropic({
    _client: {
      messages: {
        async create(request) {
          const marker = JSON.stringify(request.system)?.match(/\[c:[A-Za-z0-9_-]+:1\]/u)?.[0];
          if (toolRequested && marker === undefined)
            throw new Error('The follow-up request should contain the citation offer.');
          toolRequested = true;
          return {
            id: marker === undefined ? 'read' : 'answer',
            model,
            role: 'assistant',
            content:
              marker === undefined
                ? [{ type: 'tool_use', id: 'm1', name: 'measure', input: { unit: 'mm' } }]
                : [{ type: 'text', text: `North recorded 12 mm ${marker}.` }],
            stop_reason: marker === undefined ? 'tool_use' : 'end_turn',
            usage: { input_tokens: 8, output_tokens: 3 },
          };
        },
        stream() {
          throw new Error('This scripted client only implements complete requests.');
        },
      },
    },
  });
  return { ...sdk, stream: undefined };
}

export async function run(input: string): Promise<unknown> {
  // #region cite-prose
  const agent = Agent.create({
    provider: scriptedProvider(),
    model,
    citations: {
      verification: {
        rules: [
          {
            id: 'measurement-amount',
            version: '1',
            toolName: 'measure',
            scopeDeclaration: {
              id: 'measurement',
              version: '1',
              dimensions: [{ name: 'unit', argumentPath: ['unit'] }],
            },
            fact: { entity: 'North', field: 'amount' },
            coverage: ({ coverage }) =>
              coverage.checked.some(({ what }) => what === 'amount') ? 'complete' : 'unknown',
          },
        ],
        // This grant applies to the local synthetic fixture. Use app policy for real data.
        authorizeEvidence: ({ dispatch }) => ({
          resultVisible: dispatch.toolName === 'measure',
          scopeVisible: dispatch.toolName === 'measure',
        }),
      },
      extractClaim(span) {
        const match = /^North recorded (\d+) (mm|cm)$/u.exec(span);
        if (match === null) return undefined;
        return {
          ruleId: 'measurement-amount',
          entity: 'North',
          field: 'amount',
          intendedScope: { unit: match[2] },
          value: Number(match[1]),
        };
      },
      requestedColumn: (message) => /^Read column ([a-z]+) in mm\.$/u.exec(message)?.[1],
      completeColumns: (tool) => (tool === 'measure' ? ['amount'] : undefined),
    },
  })
    .tool(measure)
    .build();

  const answer = await agent.run({ message: input });
  const citations = (await agent.assessment())?.citations;
  // #endregion cite-prose

  if (!citations?.findings.some((row) => row.kind === 'citation' && row.outcome === 'supported'))
    throw new Error('The scripted reading should support the claim.');
  return { answer, citations };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
