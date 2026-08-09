---
title: foldedMessages
---

# Function: foldedMessages()

> **foldedMessages**(`conversation`): readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/agent/window/folded.ts:124](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/folded.ts#L124)

Every message this conversation ever folded, oldest fold first, flattened.

The transcript-shaped answer to `foldedSpanFor`'s message-shaped one: what
a support view prints when somebody asks what the agent was told before the
summaries. Spans that were discarded contribute nothing — they have nothing
to contribute, and `foldedSpanFor` is where you find out that they existed.

## Parameters

### conversation

[`FoldedConversation`](/docs/api/interfaces/FoldedConversation)

## Returns

readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]
