---
title: ProviderFromEnv
---

# Interface: ProviderFromEnv

Defined in: [src/adapters/llm/createProvider.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/createProvider.ts#L91)

What `providerFromEnv()` resolved: the provider + the `model` to pass to
 `Agent.create({ provider, model })`, and which `kind` was detected.

## Properties

### kind

> `readonly` **kind**: `"mock"` \| `"anthropic"` \| `"openai"` \| `"ollama"` \| `"azure-openai"`

Defined in: [src/adapters/llm/createProvider.ts:94](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/createProvider.ts#L94)

***

### model

> `readonly` **model**: `string`

Defined in: [src/adapters/llm/createProvider.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/createProvider.ts#L93)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: [src/adapters/llm/createProvider.ts:92](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/createProvider.ts#L92)
