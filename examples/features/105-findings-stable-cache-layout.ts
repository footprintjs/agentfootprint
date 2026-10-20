/** No network, credentials or model cost: verify request layout with a scripted provider. */
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import type { LLMRequest } from '../../src/provider-contract/types.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/105-findings-stable-cache-layout',
  title: 'Stable findings cache layout, offline',
  group: 'features',
  description:
    'Verify stable tool/system bytes and uncached late DATA; no cache savings are inferred.',
  defaultInput: 'Read the synthetic fixture.',
  providerSlots: [],
  tags: ['feature', 'findings', 'cache'],
};
export async function run(input = meta.defaultInput!): Promise<unknown> {
  const requests: LLMRequest[] = [];
  const inner = mock({
    respond(request) {
      requests.push(JSON.parse(JSON.stringify(request)) as LLMRequest);
      const step = requests.length;
      return step < 3
        ? {
            content: '',
            toolCalls: [
              {
                id: `result-${step}`,
                name: 'read_fixture',
                args:
                  step === 2
                    ? {
                        _findings: {
                          basis: 'direct',
                          previous: [
                            {
                              toolCallId: 'result-1',
                              standing: 'fact',
                              assertions: [
                                {
                                  subject: { kind: 'fixture', id: 'one' },
                                  predicate: 'status',
                                  value: 'ready',
                                },
                              ],
                            },
                          ],
                        },
                      }
                    : {},
              },
            ],
          }
        : 'The synthetic fixture is ready.';
    },
  });
  // #region layout
  // The example advertises breakpoint support to test placement. In an app,
  // use the chosen adapter's own model-aware capability declaration.
  const provider = {
    name: inner.name,
    complete: inner.complete.bind(inner),
    promptCaching: { mode: 'breakpoints' as const, maxBreakpoints: 4, reportsUsage: true },
  };
  const agent = Agent.create({ provider, model: 'mock', maxIterations: 5 })
    .system('Use the synthetic fixture to answer.')
    .tool(
      defineTool({
        name: 'read_fixture',
        description: 'Read a local fixture.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => ({ status: 'ready' }),
      }),
    )
    .findings({ maxContextBytes: 4096 })
    .build();
  await agent.run({ message: input });
  // Mutable findings DATA is request-only, after the committed history and
  // its cache markers. Citation admission still checks actual served results.
  // #endregion layout
  const stableTools = requests.every(
    (request) => JSON.stringify(request.tools) === JSON.stringify(requests[0]!.tools),
  );
  const stableSystem = requests.every(
    (request) => request.systemPrompt === requests[0]!.systemPrompt,
  );
  const request = requests[1]!;
  const tail = request.messages.findIndex((message) =>
    message.content.startsWith('[AgentFootprint findings DATA v1]'),
  );
  const markers = request.cacheMarkers?.filter((marker) => marker.field === 'messages') ?? [];
  const beforeData =
    tail > 0 && markers.length > 0 && markers.every((marker) => marker.boundaryIndex! < tail);
  if (!stableTools || !stableSystem || !beforeData) throw new Error('The cache layout changed.');
  return {
    calls: requests.length,
    stableTools,
    stableSystem,
    beforeData,
    liveCalls: 0,
    cacheSavings: 'not measured',
  };
}
if (isCliEntry(import.meta.url)) run().then(printResult);
