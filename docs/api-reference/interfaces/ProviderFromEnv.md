[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ProviderFromEnv

# Interface: ProviderFromEnv

Defined in: [src/adapters/llm/createProvider.ts:106](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/adapters/llm/createProvider.ts#L106)

What `providerFromEnv()` resolved: the provider + the `model` to pass to
 `Agent.create({ provider, model })`, and which `kind` was detected.

## Properties

### kind

> `readonly` **kind**: `"mock"` \| `"anthropic"` \| `"openai"` \| `"ollama"` \| `"foundry"` \| `"foundry-local"` \| `"azure-openai"`

Defined in: [src/adapters/llm/createProvider.ts:109](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/adapters/llm/createProvider.ts#L109)

***

### model

> `readonly` **model**: `string`

Defined in: [src/adapters/llm/createProvider.ts:108](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/adapters/llm/createProvider.ts#L108)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [src/adapters/llm/createProvider.ts:107](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/adapters/llm/createProvider.ts#L107)
