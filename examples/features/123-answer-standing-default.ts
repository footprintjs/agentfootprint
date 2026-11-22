/** Show the answer warning for pending work, timeouts, coverage gaps, and cut results. */
import { AttemptTimeoutError } from 'footprintjs';
import { Agent, coverage, defineTool, type Tool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import type { Payloads } from '../../src/events.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/123-answer-standing-default',
  title: 'The default answer warning for unfinished work',
  group: 'features',
  description:
    'A tool reports pending work. The default answer carries a warning and the turn records its standing. ' +
    'The same agent with .answerLayer(false) returns the model’s answer as written.',
  defaultInput: 'Is the report ready?',
  providerSlots: [],
  tags: ['features', 'observability', 'tools'],
};

// #region answer-standing-default
const reportStatus = defineTool({
  name: 'report_status',
  description: 'Read the report job status.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => ({ content: 'The report is queued.', effects: [], status: 'pending' }),
});

const collectorCheck = defineTool({
  name: 'collector_check',
  displayName: 'Collector check',
  description: 'Check the live collector.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => {
    throw new AttemptTimeoutError(1, 30_000);
  },
});

const archivedReport = defineTool({
  name: 'archived_report',
  displayName: 'Archive lookup',
  description: 'Read a report from the archive.',
  inputSchema: { type: 'object', properties: {} },
  execute: () =>
    coverage(
      { archivedReports: 1 },
      {
        checked: ['Yesterday’s saved report'],
        notChecked: [
          { what: 'The live report generated for the current request', short: 'Live report' },
        ],
      },
    ),
});

const modelAnswer = 'The report is ready.';

function reportAgent(tools: readonly Tool[], disableAnswerLayer: boolean) {
  const builder = Agent.create({
    provider: mock({
      replies: [
        {
          toolCalls: tools.map(({ schema }, index) => ({
            id: `report-${index + 1}`,
            name: schema.name,
            args: {},
          })),
        },
        { content: modelAnswer },
      ],
    }),
    model: 'mock',
  }).tools(tools);

  return (disableAnswerLayer ? builder.answerLayer(false) : builder).build();
}

async function readReport(message: string, tools: readonly Tool[], disableAnswerLayer = false) {
  const agent = reportAgent(tools, disableAnswerLayer);
  let assessment: Payloads.AgentTurnEndPayload['answerAssessment'];
  agent.on('agentfootprint.agent.turn_end', (event) => {
    assessment = event.payload.answerAssessment;
  });
  try {
    const answer = await agent.run({ message });
    return { answer, assessment };
  } finally {
    await agent.shutdown();
  }
}

export async function run(input: string): Promise<string> {
  const byDefault = await readReport(input, [reportStatus]);
  const off = await readReport(input, [reportStatus], true);
  const warning = 'Not sure — a tool reported unfinished work.';
  if (byDefault.answer !== `${modelAnswer}\n\n---\n\n${warning}`) {
    throw new Error('Expected the delivered answer to carry the unfinished-work warning.');
  }
  if (byDefault.assessment?.standing !== 'not-sure' || off.assessment !== undefined) {
    throw new Error('Expected standing data only with the answer layer enabled.');
  }
  if (off.answer !== modelAnswer) {
    throw new Error('Expected the model’s exact answer with the answer layer off.');
  }
  const detailed = await readReport(input, [collectorCheck, archivedReport]);
  if (
    typeof detailed.answer !== 'string' ||
    !detailed.answer.includes('Collector check timed out') ||
    !detailed.answer.includes('Archive lookup') ||
    !detailed.answer.includes('Live report')
  ) {
    throw new Error('Expected the default warning to explain the timeout and the coverage gap.');
  }
  const cut = await cutLogAnswer(input);
  if (typeof cut !== 'string' || !cut.includes('Not sure') || !cut.includes('event log')) {
    throw new Error('Expected a warning naming the cut log.');
  }
  return [
    `Pending work\n${byDefault.answer}`,
    `.answerLayer(false)\n${off.answer}`,
    `Timeout and coverage gap\n${detailed.answer}`,
    `Result cut\n${cut}`,
  ].join('\n\n');
}
// #endregion answer-standing-default

// #region recorded-result-cut
async function cutLogAnswer(message: string) {
  const agent = Agent.create({
    model: 'mock',
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'log-1', name: 'array_events', args: {} }] },
        'Every event was healthy.',
      ],
    }),
    maxToolResultChars: 2_000,
  })
    .tool(
      defineTool({
        name: 'array_events',
        displayName: 'array event log',
        description: 'Read the array event log.',
        execute: () => 'OK\n'.repeat(1_000) + 'PORT DOWN',
      }),
    )
    .build();
  try {
    return await agent.run({ message });
  } finally {
    await agent.shutdown();
  }
}
// #endregion recorded-result-cut

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
