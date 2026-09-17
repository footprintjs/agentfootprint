---
title: CreateProviderOptions
---

# Type Alias: CreateProviderOptions

> **CreateProviderOptions** = `object` & `MockProviderOptions` \| `object` & `AnthropicProviderOptions` \| `object` & `OpenAIProviderOptions` \| `object` & `OllamaProviderOptions` \| `object` & `FoundryProviderOptions` \| `object` & `FoundryLocalProviderOptions` \| `object` & `BedrockProviderOptions` \| `object` & `GeminiProviderOptions` \| `object` & `BrowserAnthropicProviderOptions` \| `object` & `BrowserOpenAIProviderOptions`

Defined in: [src/adapters/llm/createProvider.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/createProvider.ts#L57)

Common subset of options accepted across all built-in providers.
Provider-specific keys (region for Bedrock, host for Ollama,
organization for OpenAI, apiUrl for browser) are passed through
verbatim — TypeScript narrows by `kind`.
