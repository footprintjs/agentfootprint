/** The public providers door types a statically imported SDK and prebuilt client. */
import { expect, it } from 'vitest';
import {
  bedrock,
  BedrockProvider,
  type BedrockProviderOptions,
  type BedrockClient,
  type BedrockConverseSdkModule,
} from '../../src/doors/providers.js';
const client: BedrockClient = {
  async send() {
    return { output: { message: { content: [{ text: 'fixture' }] } } };
  },
};
const sdk: BedrockConverseSdkModule = {
  ConverseCommand: class {
    constructor(readonly input: unknown) {}
  },
  ConverseStreamCommand: class {
    constructor(readonly input: unknown) {}
  },
};
// Vendor constructors own narrower input schemas. Hosts must not cast their
// imported module to the adapter's private, peer-independent wire vocabulary.
const vendorModule: BedrockConverseSdkModule = {
  ConverseCommand: class {
    constructor(
      readonly input: { modelId: string; sdkUnion: { text: string } | { unknown: never } },
    ) {}
  },
  ConverseStreamCommand: class {
    constructor(
      readonly input: { modelId: string; sdkUnion: { text: string } | { unknown: never } },
    ) {}
  },
};
void vendorModule;
const options: BedrockProviderOptions = { sdk, client };
const noInternalKeys: Extract<
  keyof BedrockProviderOptions,
  '_sdk' | '_client' | '_commands'
> extends never
  ? true
  : false = true;
void noInternalKeys;
const oldSdk: BedrockProviderOptions = {
  // @ts-expect-error Removed internal option, no alias.
  _sdk: sdk,
};
const oldClient: BedrockProviderOptions = {
  // @ts-expect-error Removed internal option, no alias.
  _client: client,
};
const oldCommands: BedrockProviderOptions = {
  // @ts-expect-error Commands come from the public SDK module, no separate map.
  _commands: {},
};
void [oldSdk, oldClient, oldCommands];
it('public factory and class accept the same structural module/client', () => {
  expect(bedrock(options).name).toBe('bedrock');
  expect(new BedrockProvider(options).name).toBe('bedrock');
});
