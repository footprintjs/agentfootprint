[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MockReply

# Type Alias: MockReply

> **MockReply** = `string` \| `Partial`\<[`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)\>

Defined in: [agentfootprint/src/adapters/llm/MockProvider.ts:34](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/MockProvider.ts#L34)

One scripted reply consumed in order from `MockProviderOptions.replies`.
String → plain text content; Partial<LLMResponse> → can include
`toolCalls`, `usage`, `stopReason` for tool-using ReAct loops.
