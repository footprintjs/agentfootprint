[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CreateProviderOptions

# Type Alias: CreateProviderOptions

> **CreateProviderOptions** = `object` & `MockProviderOptions` \| `object` & `AnthropicProviderOptions` \| `object` & `OpenAIProviderOptions` \| `object` & `OllamaProviderOptions` \| `object` & `BedrockProviderOptions` \| `object` & `BrowserAnthropicProviderOptions` \| `object` & `BrowserOpenAIProviderOptions`

Defined in: [src/adapters/llm/createProvider.ts:51](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/adapters/llm/createProvider.ts#L51)

Common subset of options accepted across all built-in providers.
Provider-specific keys (region for Bedrock, host for Ollama,
organization for OpenAI, apiUrl for browser) are passed through
verbatim — TypeScript narrows by `kind`.
