[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CreateProviderOptions

# Type Alias: CreateProviderOptions

> **CreateProviderOptions** = `object` & `MockProviderOptions` \| `object` & `AnthropicProviderOptions` \| `object` & `OpenAIProviderOptions` \| `object` & `OllamaProviderOptions` \| `object` & `BedrockProviderOptions` \| `object` & `GeminiProviderOptions` \| `object` & `BrowserAnthropicProviderOptions` \| `object` & `BrowserOpenAIProviderOptions`

Defined in: [src/adapters/llm/createProvider.ts:53](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/adapters/llm/createProvider.ts#L53)

Common subset of options accepted across all built-in providers.
Provider-specific keys (region for Bedrock, host for Ollama,
organization for OpenAI, apiUrl for browser) are passed through
verbatim — TypeScript narrows by `kind`.
