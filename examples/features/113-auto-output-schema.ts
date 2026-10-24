/**
 * Native format selection and a fenced checked fallback, entirely local.
 * Run: npm run example -- examples/features/113-auto-output-schema.ts
 */
import { Agent, type LLMProvider } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/113-auto-output-schema',
  title: 'Automatic structured output with strict local validation',
  group: 'features',
  description: 'Uses a declared native format or parses one fenced JSON answer locally.',
  defaultInput: 'Return the status.',
  providerSlots: [],
  tags: ['features'],
};

// #region auto-output
const parser = {
  parse(value: unknown): { status: string } {
    if (
      !value ||
      typeof value !== 'object' ||
      !('status' in value) ||
      typeof value.status !== 'string'
    )
      throw new Error('status must be a string');
    return { status: value.status };
  },
};
const jsonSchema = {
  type: 'object',
  properties: { status: { type: 'string' } },
  required: ['status'],
  additionalProperties: false,
};

async function demonstrate(native: boolean, message: string) {
  const provider: LLMProvider = {
    name: 'local-format-fixture',
    carriesNativeOutputSchema: native,
    supportsAutoNativeOutputSchema: (model) => native && model === 'local-fixture',
    async complete(request) {
      if (Boolean(request.outputFormat) !== native) throw new Error('Wrong format selection');
      return {
        content: native ? '{"status":"ok"}' : '```json\n{"status":"ok"}\n```',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
      };
    },
  };
  const agent = Agent.create({ provider, model: 'local-fixture' })
    .outputSchema(parser, { jsonSchema }) // default strategy: 'auto'
    .build();
  const answer = await agent.runTyped<{ status: string }>(message);
  // This describes format enforcement, not whether the status is factually true.
  const guarantee = agent.getSnapshot()?.sharedState?.answerGuarantee;
  if (guarantee !== (native ? 'native' : 'checked')) throw new Error('Wrong format guarantee');
  return { answer, guarantee };
}
// #endregion auto-output

export async function run(input: string): Promise<string> {
  return JSON.stringify({
    native: await demonstrate(true, input),
    checked: await demonstrate(false, input),
  });
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
