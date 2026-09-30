---
title: ProviderFromEnv
---

# Interface: ProviderFromEnv

Defined in: [src/adapters/llm/createProvider.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/createProvider.ts#L114)

What `providerFromEnv()` resolved: the provider + the `model` to pass to
 `Agent.create({ provider, model })`, and which `kind` was detected.

## Properties

### kind

> `readonly` **kind**: `"mock"` \| `"anthropic"` \| `"openai"` \| `"ollama"` \| `"foundry"` \| `"foundry-local"` \| `"azure-openai"`

Defined in: [src/adapters/llm/createProvider.ts:117](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/createProvider.ts#L117)

***

### model

> `readonly` **model**: `string`

Defined in: [src/adapters/llm/createProvider.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/createProvider.ts#L116)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: [src/adapters/llm/createProvider.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/createProvider.ts#L115)
