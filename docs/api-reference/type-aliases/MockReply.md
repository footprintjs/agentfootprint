[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MockReply

# Type Alias: MockReply

> **MockReply** = `string` \| `Partial`\<[`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)\>

Defined in: [src/adapters/llm/MockProvider.ts:34](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/adapters/llm/MockProvider.ts#L34)

One scripted reply consumed in order from `MockProviderOptions.replies`.
String → plain text content; Partial<LLMResponse> → can include
`toolCalls`, `usage`, `stopReason` for tool-using ReAct loops.
