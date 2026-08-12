---
title: ProviderFromEnv
---

# Interface: ProviderFromEnv

Defined in: [src/adapters/llm/createProvider.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/createProvider.ts#L96)

What `providerFromEnv()` resolved: the provider + the `model` to pass to
 `Agent.create({ provider, model })`, and which `kind` was detected.

## Properties

### kind

> `readonly` **kind**: `"mock"` \| `"anthropic"` \| `"openai"` \| `"ollama"` \| `"azure-openai"`

Defined in: [src/adapters/llm/createProvider.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/createProvider.ts#L99)

***

### model

> `readonly` **model**: `string`

Defined in: [src/adapters/llm/createProvider.ts:98](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/createProvider.ts#L98)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: [src/adapters/llm/createProvider.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/createProvider.ts#L97)
