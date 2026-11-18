/** Retain an exact synthetic source across native continuation, then find/read it afresh. */
import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  isSaidByPerson,
  withSourceEvidence,
  type LLMProvider,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'artifacts/retained-source-evidence',
  title: 'Retain an exact historical source',
  group: 'artifacts',
  description:
    'Find and freshly authorize stored source evidence across native continuation without requerying.',
  defaultInput: 'Read the local fixture.',
  providerSlots: ['default'],
  tags: ['artifacts', 'continuation', 'evidence', 'admission'],
};

export async function run(input: string, suppliedProvider?: LLMProvider): Promise<string> {
  let sourceCalls = 0,
    receipt = '',
    observed: unknown,
    prepared: unknown;
  // #region declare-source
  const source = withSourceEvidence(
    defineTool({
      name: 'read_inventory',
      description: 'Read a local synthetic inventory.',
      execute: async (_args, ctx) => {
        sourceCalls++;
        const dataset = await ctx.artifacts.put({
          kind: 'dataset/applications',
          mediaType: 'application/json',
          data: [{ application: 'billing' }, { application: 'reporting' }],
          digest: 'sha-256',
        });
        return { array: 'array-001', ref: dataset.ref };
      },
    }),
    {
      datasets: [
        {
          key: 'applications',
          refPath: ['ref'],
          kind: 'dataset/applications',
          fields: { application: ['application'] },
          maxRows: 20,
          maxBytes: 65536,
        },
      ],
      describe: (served, sources) =>
        sources.applications
          ? [
              {
                subject: { kind: 'array', value: served.array },
                operation: 'applications',
                scope: { site: 'local-seed' },
                datasets: [
                  {
                    key: 'applications',
                    ref: sources.applications.ref,
                    kind: 'dataset/applications',
                    fields: { application: ['application'] },
                  },
                ],
              },
            ]
          : undefined,
    },
  );
  // #endregion declare-source
  const provider =
    suppliedProvider ??
    mock({
      respond: (request) => {
        const last = request.messages.at(-1);
        if (last?.role === 'tool') {
          const result = JSON.parse(last.content);
          if (last.toolName === 'find_source_evidence') receipt = result.candidates?.[0]?.ref ?? '';
          if (last.toolName === 'read_source_evidence') observed = result;
          return 'Historical fixture inspected.';
        }
        const question = request.messages.filter(isSaidByPerson).at(-1)?.content;
        const name =
          question === 'Find the earlier inventory.'
            ? 'find_source_evidence'
            : question === 'Open that retained inventory.'
            ? 'read_source_evidence'
            : 'read_inventory';
        const args =
          name === 'find_source_evidence'
            ? {
                subject: { kind: 'array', value: 'array-001' },
                operation: 'applications',
                scope: { site: 'local-seed' },
              }
            : name === 'read_source_evidence'
            ? { ref: receipt, dataset: 'applications' }
            : {};
        return { toolCalls: [{ id: name, name, args }] };
      },
    });
  // #region mount-and-continue
  const agent = Agent.create({ provider, model: 'mock', artifacts: inMemoryArtifacts() })
    .tool(source)
    .sourceEvidence({
      admit: (candidate, ctx) =>
        ctx.identity?.principal === 'fixture-reader' &&
        candidate.producer.name === 'read_inventory' &&
        candidate.scope.site === 'local-seed'
          ? candidate
          : undefined,
      // #region prepare-metadata
      preparation: {
        admit: (candidate, ctx) =>
          ctx.identity?.principal === 'fixture-reader' &&
          candidate.producer.name === 'read_inventory' &&
          candidate.scope.site === 'local-seed'
            ? candidate
            : undefined,
      },
    })
    .aroundTurn({
      name: 'historical-source-context',
      async around(turn, proceed) {
        if (turn.kind === 'run') prepared = await turn.sourceEvidence!.recent({ limit: 5 });
        // Metadata is historical context only; the reader expires before the run.
        await proceed();
      },
    })
    // #endregion prepare-metadata
    .build();
  const identity = {
    tenant: 'synthetic',
    principal: 'fixture-reader',
    conversationId: 'retained-demo',
  };
  await agent.run({ message: input, identity });
  await agent.run({
    message: 'Find the earlier inventory.',
    identity,
    continueFrom: agent.checkpoint()!,
  });
  await agent.run({
    message: 'Open that retained inventory.',
    identity,
    continueFrom: agent.checkpoint()!,
  });
  // #endregion mount-and-continue
  if (!observed || sourceCalls !== 1)
    throw new Error('The deterministic retained-read proof did not complete.');
  return JSON.stringify({ sourceCalls, observed, prepared }, null, 2);
}

if (isCliEntry(import.meta.url))
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
