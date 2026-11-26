/** Disclose a declared source that the model could have consulted during this turn. */
import { Agent, defineTool } from '../../src/index.js';
import { mockClassifier } from '../../src/doors/classify.js';
import { mock } from '../../src/doors/providers.js';
import { defineOntology } from '../../src/ontology/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/130-source-not-consulted',
  title: 'Show when the model skipped a declared source',
  group: 'features',
  description:
    'A scripted model reads switch status and skips the separately declared link monitor. The answer warning names the offered source.',
  defaultInput: 'Give me the link observation.',
  providerSlots: [],
  tags: ['features', 'observability', 'tools'],
};

// #region source-not-consulted
export async function run(message: string, selectOne = false) {
  const map = defineOntology({
    id: 'switches',
    version: '1',
    nodes: {
      link_observation: {
        meaning: 'Evidence for a switch link',
        sources: [{ source: 'monitor', via: ['read_monitor'] }],
      },
    },
    sources: { monitor: { meaning: 'The live link monitor' } },
  });
  const builder = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'status-1', name: 'read_status', args: {} }] },
        { content: 'The switch is online.' },
      ],
    }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'read_status',
        description: 'Read reachability.',
        execute: () => 'Online.',
      }),
    )
    .tool(
      defineTool({
        name: 'read_monitor',
        displayName: 'link monitor',
        description: 'Read observations from the link monitor.',
        execute: () => 'Two intermittent link failures.',
      }),
    )
    .ontology(map)
    .answerLayer({ sourceNotConsulted: true, standingLine: { when: 'not-sure-or-ask' } });
  // #region select-one-holder
  if (selectOne) {
    builder.toolChoice({
      classifier: mockClassifier(() => ({
        model: 'fixture',
        latencyMs: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
        answers: {
          tool: {
            type: 'choice',
            choice: 'read_status',
            confidence: 1,
            probabilities: { read_status: 1 },
          },
        },
      })),
      serve: { top: 1 },
    });
  }
  // #endregion select-one-holder
  const agent = builder.build();

  try {
    return { answer: await agent.run({ message }), assessment: await agent.assessment() };
  } finally {
    await agent.shutdown();
  }
}
// #endregion source-not-consulted

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
