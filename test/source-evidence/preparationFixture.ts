import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  isSaidByPerson,
  withSourceEvidence,
} from '../../src/index.js';
import { mock } from '../../src/providers.js';
export const identity = { principal: 'alice', conversationId: 'source-preparation' };

export function fixture(
  settings: {
    store?: ReturnType<typeof inMemoryArtifacts>;
    admit?: (candidate: any, context: any) => any;
    checker?: any;
    provider?: any;
    timeoutMs?: number;
    maxReceipts?: number;
    mounted?: boolean;
    inspect?: (reader: any) => Promise<any>;
  } = {},
) {
  const store = settings.store ?? inMemoryArtifacts();
  let executions = 0;
  const pages: any[] = [],
    contexts: any[] = [];
  let retained: any;
  const tool = withSourceEvidence(
    defineTool({
      name: 'read_inventory',
      description: 'Read an exact array.',
      inputSchema: {
        type: 'object',
        properties: { array: { type: 'string' } },
        required: ['array'],
      },
      execute: async ({ array }: { array: string }) => {
        executions++;
        return { array, secret: 'PRIVATE-SCALAR' };
      },
    }),
    {
      describe: (result) => [
        {
          subject: { kind: 'array', value: result.array },
          operation: 'inventory',
          scope: { group: 'application' },
          scalars: { secret: result.secret },
        },
      ],
    },
  );
  const provider = mock({
    respond(request) {
      const question = request.messages.filter(isSaidByPerson).at(-1)?.content ?? '';
      return question.startsWith('Collect ') && request.messages.at(-1)?.role !== 'tool'
        ? {
            toolCalls: [
              { id: 'collect', name: tool.schema.name, args: { array: question.slice(8) } },
            ],
          }
        : 'Done.';
    },
  });
  let builder = Agent.create({
    provider,
    model: 'mock',
    artifacts: store,
    ...(settings.checker && { permissionChecker: settings.checker }),
  })
    .tool(tool)
    .sourceEvidence({
      admit: (candidate) => candidate,
      ...(settings.mounted !== false && {
        preparation: {
          admit: async (candidate: any, context: any) => {
            contexts.push(context);
            return settings.admit ? settings.admit(candidate, context) : candidate;
          },
        },
      }),
      ...((settings.timeoutMs || settings.maxReceipts) && {
        limits: {
          ...(settings.timeoutMs && { timeoutMs: settings.timeoutMs }),
          ...(settings.maxReceipts && { maxReceipts: settings.maxReceipts }),
        },
      }),
    })
    .aroundTurn({
      name: 'retained-metadata',
      async around(turn, proceed) {
        if (turn.kind === 'run') {
          retained = turn.sourceEvidence;
          if (retained)
            pages.push(
              await (settings.inspect
                ? settings.inspect(retained)
                : retained.recent({ limit: 20 })),
            );
        }
        await proceed();
      },
    });
  if (settings.provider) builder = builder.toolProvider(settings.provider);
  const agent = builder.build();
  return {
    agent,
    store,
    tool,
    pages,
    contexts,
    reader: () => retained,
    executions: () => executions,
  };
}
