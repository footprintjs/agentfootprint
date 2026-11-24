/** Bedrock guardrail outcomes with local scripted SDK responses. No AWS requests.
 * Run: npm run example -- examples/features/131-bedrock-guardrails.ts
 */
import { Agent, type LLMProvider, type LLMResponse } from '../../src/index.js';
import {
  bedrock,
  BedrockProvider,
  ProviderBlockedError,
  ProviderInterventionUnknownError,
  type BedrockGuardrailOptions,
} from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/131-bedrock-guardrails',
  title: 'Keep masked, blocked and unknown Bedrock outcomes distinct',
  group: 'features',
  description:
    'Scripted Converse and ConverseStream replies exercise safe intervention admission without an AWS account.',
  defaultInput: 'How do I contact support?',
  providerSlots: [],
  tags: ['feature', 'bedrock', 'guardrails'],
};

// #region guardrail
const guardrail: BedrockGuardrailOptions = {
  id: 'abc123', // A real application supplies its deployed guardrail ID or ARN.
  version: '1',
  trace: 'enabled', // Private assessment processing; raw trace is never returned.
  maxBufferedBytes: 1_048_576,
  cleanMessage: ({ outcome }) =>
    outcome === 'blocked'
      ? 'The provider blocked this response.'
      : 'The provider could not establish a usable screened response.',
};
// #endregion guardrail

class Converse {
  constructor(readonly input: unknown) {}
}
class ConverseStream {
  constructor(readonly input: unknown) {}
}

type Action = 'ANONYMIZED' | 'BLOCKED' | undefined;
const returnedText = 'Contact [EMAIL] for support.';

/** The SDK injection below is local example data, not a live Bedrock client. */
function scripted(action: Action, classDoor: boolean) {
  let sends = 0;
  const trace =
    action === undefined
      ? undefined
      : {
          guardrail: {
            outputAssessments: {
              abc123: [
                { sensitiveInformationPolicy: { piiEntities: [{ type: 'EMAIL', action }] } },
              ],
            },
          },
        };
  const usage = { inputTokens: 12, outputTokens: 7 };
  const options = {
    guardrail,
    _commands: { Converse, ConverseStream },
    _client: {
      send: async (command: unknown) => {
        sends++;
        if (command instanceof ConverseStream)
          return {
            stream: (async function* () {
              yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: returnedText } } };
              yield { messageStop: { stopReason: 'guardrail_intervened' } };
              yield { metadata: { usage, ...(trace === undefined ? {} : { trace }) } };
            })(),
          };
        return {
          output: { message: { role: 'assistant', content: [{ text: returnedText }] } },
          stopReason: 'guardrail_intervened',
          usage,
          ...(trace === undefined ? {} : { trace }),
        };
      },
    },
  };
  return {
    provider: classDoor ? new BedrockProvider(options) : bedrock(options),
    sends: () => sends,
  };
}

async function streamResult(provider: LLMProvider, message: string): Promise<LLMResponse> {
  let terminal: LLMResponse | undefined;
  const stream = provider.stream;
  if (stream === undefined) throw new Error('The scripted provider has no stream method.');
  for await (const chunk of stream.call(provider, {
    model: 'bedrock',
    messages: [{ role: 'user', content: message }],
  })) {
    if (chunk.done) terminal = chunk.response;
  }
  if (terminal === undefined) throw new Error('The scripted stream had no terminal response.');
  return terminal;
}

export async function run(message = meta.defaultInput ?? '') {
  const rows: {
    door: string;
    outcome: string;
    transports: string;
    native: string;
    sends: number;
  }[] = [];
  for (const classDoor of [false, true]) {
    for (const action of ['ANONYMIZED', 'BLOCKED', undefined] as const) {
      const { provider, sends } = scripted(action, classDoor);
      const expected =
        action === 'ANONYMIZED' ? 'masked' : action === 'BLOCKED' ? 'blocked' : 'unknown';
      // #region outcomes
      const complete = await provider.complete({
        model: 'bedrock',
        messages: [{ role: 'user', content: message }],
      });
      const streamed = await streamResult(provider, message);
      for (const response of [complete, streamed]) {
        if (response.intervention?.outcome !== expected)
          throw new Error('The scripted intervention was not preserved.');
        const usable = response.intervention.outcome === 'masked';
        if (response.content !== (usable ? returnedText : '') || response.toolCalls.length !== 0)
          throw new Error('The adapter released unusable content or changed the masked text.');
      }
      const agent = Agent.create({ provider, model: 'bedrock' }).build();
      let native = 'masked answer';
      try {
        const answer = await agent.run({ message });
        if (expected !== 'masked' || answer !== returnedText)
          throw new Error('A terminal intervention became an answer.');
      } catch (error) {
        if (error instanceof ProviderBlockedError && expected === 'blocked') native = error.code;
        else if (error instanceof ProviderInterventionUnknownError && expected === 'unknown')
          native = error.code;
        else throw error;
      }
      // #endregion outcomes
      rows.push({
        door: classDoor ? 'class' : 'factory',
        outcome: expected,
        transports: 'Converse + ConverseStream',
        native,
        sends: sends(),
      });
    }
  }
  return { mode: 'scripted-sdk', liveAwsCalls: 0, rows };
}

if (isCliEntry(import.meta.url))
  run()
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
