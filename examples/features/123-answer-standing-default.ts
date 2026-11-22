/** Show what a person sees when a tool reports that its work is pending. */
import { Agent, defineTool } from '../../src/index.js';
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

const modelAnswer = 'The report is ready.';

function reportAgent(disableAnswerLayer: boolean) {
  const builder = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'report-1', name: 'report_status', args: {} }] },
        { content: modelAnswer },
      ],
    }),
    model: 'mock',
  }).tool(reportStatus);

  return (disableAnswerLayer ? builder.answerLayer(false) : builder).build();
}

async function readReport(message: string, disableAnswerLayer = false) {
  const agent = reportAgent(disableAnswerLayer);
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
  const byDefault = await readReport(input);
  const off = await readReport(input, true);
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
  const cutoff = await answerAtOutputLimit(input);
  if (!cutoff.includes("the answer was cut off at the model's output limit")) {
    throw new Error('Expected the delivered answer to explain the cutoff.');
  }
  return [`Default\n${byDefault.answer}`, `.answerLayer(false)\n${off.answer}`, cutoff].join(
    '\n\n',
  );
}
// #endregion answer-standing-default

// #region answer-output-limit
async function answerAtOutputLimit(message: string): Promise<string> {
  const agent = Agent.create({
    provider: mock({ reply: 'The report contains', stopReason: 'max_tokens' }),
    model: 'mock',
  }).build();
  try {
    const answer = await agent.run({ message });
    if (typeof answer !== 'string') throw new Error('Unexpected pause.');
    return answer;
  } finally {
    await agent.shutdown();
  }
}
// #endregion answer-output-limit

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
