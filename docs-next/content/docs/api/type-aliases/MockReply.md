---
title: MockReply
---

# Type Alias: MockReply

> **MockReply** = `string` \| `Partial`\<[`LLMResponse`](/docs/api/interfaces/LLMResponse)\>

Defined in: [src/adapters/llm/MockProvider.ts:34](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/MockProvider.ts#L34)

One scripted reply consumed in order from `MockProviderOptions.replies`.
String → plain text content; Partial<LLMResponse> → can include
`toolCalls`, `usage`, `stopReason` for tool-using ReAct loops.
