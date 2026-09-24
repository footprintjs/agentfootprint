[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ProviderFromEnv

# Interface: ProviderFromEnv

Defined in: [src/adapters/llm/createProvider.ts:106](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/llm/createProvider.ts#L106)

What `providerFromEnv()` resolved: the provider + the `model` to pass to
 `Agent.create({ provider, model })`, and which `kind` was detected.

## Properties

### kind

> `readonly` **kind**: `"mock"` \| `"anthropic"` \| `"openai"` \| `"ollama"` \| `"foundry"` \| `"foundry-local"` \| `"azure-openai"`

Defined in: [src/adapters/llm/createProvider.ts:109](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/llm/createProvider.ts#L109)

***

### model

> `readonly` **model**: `string`

Defined in: [src/adapters/llm/createProvider.ts:108](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/llm/createProvider.ts#L108)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [src/adapters/llm/createProvider.ts:107](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/llm/createProvider.ts#L107)
