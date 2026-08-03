[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CreateProviderOptions

# Type Alias: CreateProviderOptions

> **CreateProviderOptions** = `object` & `MockProviderOptions` \| `object` & `AnthropicProviderOptions` \| `object` & `OpenAIProviderOptions` \| `object` & `OpenAIProviderOptions` & `object` \| `object` & `BedrockProviderOptions` \| `object` & `BrowserAnthropicProviderOptions` \| `object` & `BrowserOpenAIProviderOptions`

Defined in: [src/adapters/llm/createProvider.ts:50](https://github.com/footprintjs/agentfootprint/blob/5e50b8a4c2f3ab01f1019c813d5c48641d801965/src/adapters/llm/createProvider.ts#L50)

Common subset of options accepted across all built-in providers.
Provider-specific keys (region for Bedrock, host for Ollama,
organization for OpenAI, apiUrl for browser) are passed through
verbatim — TypeScript narrows by `kind`.
