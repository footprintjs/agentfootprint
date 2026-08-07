[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ProviderFromEnv

# Interface: ProviderFromEnv

Defined in: [src/adapters/llm/createProvider.ts:91](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/adapters/llm/createProvider.ts#L91)

What `providerFromEnv()` resolved: the provider + the `model` to pass to
 `Agent.create({ provider, model })`, and which `kind` was detected.

## Properties

### kind

> `readonly` **kind**: `"mock"` \| `"anthropic"` \| `"openai"` \| `"ollama"` \| `"azure-openai"`

Defined in: [src/adapters/llm/createProvider.ts:94](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/adapters/llm/createProvider.ts#L94)

***

### model

> `readonly` **model**: `string`

Defined in: [src/adapters/llm/createProvider.ts:93](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/adapters/llm/createProvider.ts#L93)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [src/adapters/llm/createProvider.ts:92](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/adapters/llm/createProvider.ts#L92)
