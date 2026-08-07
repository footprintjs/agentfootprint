[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / foldedMessages

# Function: foldedMessages()

> **foldedMessages**(`conversation`): readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/core/agent/window/folded.ts:124](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/core/agent/window/folded.ts#L124)

Every message this conversation ever folded, oldest fold first, flattened.

The transcript-shaped answer to `foldedSpanFor`'s message-shaped one: what
a support view prints when somebody asks what the agent was told before the
summaries. Spans that were discarded contribute nothing — they have nothing
to contribute, and `foldedSpanFor` is where you find out that they existed.

## Parameters

### conversation

[`FoldedConversation`](/agentfootprint/api/generated/interfaces/FoldedConversation.md)

## Returns

readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]
