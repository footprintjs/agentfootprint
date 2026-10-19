/** Bedrock cache wiring with a scripted SDK client: no AWS account or calls.
 * Run: npm run example -- examples/features/102-bedrock-prompt-cache.ts
 */
import { Agent } from '../../src/index.js';
import { bedrock } from '../../src/doors/providers.js';
import { cacheRecorder, cacheStrategyFor, isKnown } from '../../src/cache/index.js';
import type { LLMProvider } from '../../src/provider-contract/types.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/102-bedrock-prompt-cache',
  title: 'Bedrock prompt cache — measured, model-aware',
  group: 'features',
  description:
    'Scripted Converse responses prove cache writes and reads reach the meter; no live AWS calls.',
  defaultInput: 'Explain the next step.',
  providerSlots: [],
  tags: ['feature', 'bedrock', 'cache'],
};

class Command {
  constructor(readonly input: unknown) {}
}
class StreamCommand {
  constructor(readonly input: unknown) {}
}
function scriptedBedrock(): LLMProvider {
  let calls = 0;
  return bedrock({
    _commands: { Converse: Command, ConverseStream: StreamCommand },
    _client: {
      send: async (command) => {
        const first = calls++ === 0;
        const usage = {
          inputTokens: 20,
          outputTokens: 4,
          cacheReadInputTokens: first ? 0 : 1200,
          cacheWriteInputTokens: first ? 1200 : 0,
        };
        if (command instanceof StreamCommand)
          return {
            stream: (async function* () {
              yield { contentBlockDelta: { delta: { text: 'Recorded the step.' } } };
              yield { metadata: { usage } };
            })(),
          };
        return {
          output: { message: { content: [{ text: 'Recorded the step.' }] } },
          stopReason: 'end_turn',
          usage,
        };
      },
    },
  });
}

export async function run(
  input: string = meta.defaultInput ?? 'Explain the next step.',
): Promise<unknown> {
  // #region cache
  // In an application: bedrock({ region: 'us-east-1' }); the example's
  // injected SDK client below is entirely local and returns fixture counts.
  const provider = scriptedBedrock();
  const model = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
  const meter = cacheRecorder({ strategy: cacheStrategyFor(provider, model), model });
  const agent = Agent.create({ provider, model })
    .system('Stable instructions. '.repeat(100), { cache: 'always' })
    .watch(meter)
    .build();
  await agent.run({ message: input });
  await agent.run({ message: 'A second question with the same prefix.' });
  const report = meter.report();
  const reads = isKnown(report.cacheReadTokensTotal)
    ? report.cacheReadTokensTotal.value
    : 'unknown';
  // #endregion cache
  if (reads !== 1200 || report.measuredIterations !== 2)
    throw new Error('Cache fixture was not measured.');
  return { mode: 'scripted-sdk', calls: report.totalIterations, reads, liveAwsCalls: 0 };
}

if (isCliEntry(import.meta.url)) run().then(printResult);
