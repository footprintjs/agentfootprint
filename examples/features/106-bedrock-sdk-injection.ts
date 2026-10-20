/** Public SDK injection, using a local fixture rather than an AWS account. */
import {
  bedrock,
  type BedrockClient,
  type BedrockConverseSdkModule,
} from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/106-bedrock-sdk-injection',
  title: 'Bedrock public SDK and client injection',
  group: 'features',
  description: 'A host-owned module and client behind the normal provider interface; no AWS call.',
  defaultInput: 'Explain the next step.',
  providerSlots: [],
  tags: ['feature', 'bedrock', 'sdk'],
};
export async function run(input: string = meta.defaultInput ?? 'Explain the next step.') {
  let calls = 0;
  // #region injection
  // Real bundled apps import these constructors from @aws-sdk/client-bedrock-runtime.
  const sdk: BedrockConverseSdkModule = {
    ConverseCommand: class {
      constructor(readonly input: unknown) {}
    },
    ConverseStreamCommand: class {
      constructor(readonly input: unknown) {}
    },
  };
  // The host owns this client's configuration, credentials and lifecycle.
  const client: BedrockClient = {
    async send() {
      calls++;
      return {
        output: { message: { content: [{ text: 'Local SDK fixture.' }] } },
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
  const provider = bedrock({ sdk, client });
  const result = await provider.complete({
    model: 'bedrock',
    messages: [{ role: 'user', content: input }],
  });
  // #endregion injection
  if (result.content !== 'Local SDK fixture.' || calls !== 1)
    throw new Error('Unexpected fixture.');
  return { mode: 'scripted-sdk', content: result.content, calls, liveAwsCalls: 0 };
}
if (isCliEntry(import.meta.url)) run().then(printResult);
