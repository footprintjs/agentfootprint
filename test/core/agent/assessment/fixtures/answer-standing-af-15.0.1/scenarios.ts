import type { Agent, AgentOptions, askHuman, defineTool } from '../../../../../../src/index.js';
import type { mock } from '../../../../../../src/llm-providers.js';

/** The same public builder and mock provider are used on both releases. */
export interface Library {
  Agent: typeof Agent;
  askHuman: typeof askHuman;
  defineTool: typeof defineTool;
  mock: typeof mock;
}

export function controlBuilder(
  { Agent, defineTool, mock }: Library,
  options: Pick<AgentOptions, 'answerLayer'> = {},
) {
  return Agent.create({
    name: 'published-answer-control',
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'lookup', args: {} }] },
        { content: 'No entries found.\n  ' },
      ],
    }),
    model: 'mock',
    ...options,
  }).tool(
    defineTool({
      name: 'lookup',
      description: 'Look up the entries.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => [],
    }),
  );
}

export async function captureControl(agent: Agent) {
  const events: unknown[] = [];
  agent.on('*', (event) => events.push(event));
  const chart = agent.getSpec();
  const answer = await agent.run({ message: 'Which entries are there?' });
  const commitLog = agent.getLastSnapshot()!.commitLog;
  return { chart, commitLog, events, answer };
}

export const QUESTION = 'Which group should I check?';
export const RESUMED_ANSWER = 'Group A is clear.';

export function askingBuilder({ Agent, askHuman, defineTool, mock }: Library, afterPause = false) {
  return Agent.create({
    name: 'published-question-control',
    provider: mock({
      replies: [
        ...(afterPause ? [] : [{ toolCalls: [{ id: 'ask1', name: 'ask_group', args: {} }] }]),
        { content: RESUMED_ANSWER },
      ],
    }),
    model: 'mock',
  }).tool(
    defineTool({
      name: 'ask_group',
      description: 'Ask which group to check.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => askHuman({ question: QUESTION }),
    }),
  );
}

const configurations = (['classic', 'dynamic', 'dynamic-grouped'] as const).flatMap((reactMode) =>
  [false, true].flatMap((tools) =>
    [false, true].flatMap((schema) =>
      [false, true].map((validated) => ({ reactMode, tools, schema, validated })),
    ),
  ),
);

/** Capture the same generated build cases against the released and candidate builders. */
export function buildAdmission({ Agent, defineTool, mock }: Library) {
  const tool = defineTool({
    name: 'lookup',
    description: 'Look up the entries.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => [],
  });
  return configurations.map((configuration) => {
    const { reactMode, tools, schema, validated } = configuration;
    const setup = Agent.create({
      provider: mock({ reply: '{"ok":true}' }),
      model: 'mock',
      reactMode,
    });
    if (tools) setup.tool(tool);
    if (schema) setup.outputSchema({ parse: (value: unknown) => value as { ok: boolean } });
    if (validated) {
      setup.answerValidation({
        id: 'fixture-check',
        version: '1',
        validate: () => ({ checks: [{ id: 'ok', disposition: 'checked-pass' }] }),
      });
    }
    try {
      setup.build();
      return { ...configuration, refusal: null };
    } catch (error) {
      return { ...configuration, refusal: error instanceof Error ? error.message : String(error) };
    }
  });
}
