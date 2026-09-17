---
title: ProviderFromEnv
---

# Interface: ProviderFromEnv

Defined in: [src/adapters/llm/createProvider.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/createProvider.ts#L106)

What `providerFromEnv()` resolved: the provider + the `model` to pass to
 `Agent.create({ provider, model })`, and which `kind` was detected.

## Properties

### kind

> `readonly` **kind**: `"mock"` \| `"anthropic"` \| `"openai"` \| `"ollama"` \| `"foundry"` \| `"foundry-local"` \| `"azure-openai"`

Defined in: [src/adapters/llm/createProvider.ts:109](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/createProvider.ts#L109)

***

### model

> `readonly` **model**: `string`

Defined in: [src/adapters/llm/createProvider.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/createProvider.ts#L108)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: [src/adapters/llm/createProvider.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/createProvider.ts#L107)
