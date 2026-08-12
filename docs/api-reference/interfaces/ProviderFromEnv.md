[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ProviderFromEnv

# Interface: ProviderFromEnv

Defined in: [src/adapters/llm/createProvider.ts:96](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/adapters/llm/createProvider.ts#L96)

What `providerFromEnv()` resolved: the provider + the `model` to pass to
 `Agent.create({ provider, model })`, and which `kind` was detected.

## Properties

### kind

> `readonly` **kind**: `"mock"` \| `"anthropic"` \| `"openai"` \| `"ollama"` \| `"azure-openai"`

Defined in: [src/adapters/llm/createProvider.ts:99](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/adapters/llm/createProvider.ts#L99)

***

### model

> `readonly` **model**: `string`

Defined in: [src/adapters/llm/createProvider.ts:98](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/adapters/llm/createProvider.ts#L98)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [src/adapters/llm/createProvider.ts:97](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/adapters/llm/createProvider.ts#L97)
