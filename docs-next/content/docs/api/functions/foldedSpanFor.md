---
title: foldedSpanFor
---

# Function: foldedSpanFor()

> **foldedSpanFor**(`conversation`, `message`): [`FoldedSpan`](/docs/api/interfaces/FoldedSpan) \| `undefined`

Defined in: [src/core/agent/window/folded.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/folded.ts#L106)

What one summary message in a conversation stands for.

Hand it the conversation you stored and a message out of its `history`; get
back the fold that produced that message, with the original messages when
the policy retained them.

## Parameters

### conversation

[`FoldedConversation`](/docs/api/interfaces/FoldedConversation)

### message

[`LLMMessage`](/docs/api/interfaces/LLMMessage)

## Returns

[`FoldedSpan`](/docs/api/interfaces/FoldedSpan) \| `undefined`

the span, or `undefined` when this conversation recorded no fold
  for this message — see "Absent is an answer" above.

## Example

**Show a user what the agent actually saw last week**

```ts
import { foldedSpanFor, isCompactedSummary } from 'agentfootprint';

const conversation = readEnvelope(await sessions.hydrate(sessionId));
for (const message of conversation.history) {
  if (!isCompactedSummary(message)) continue;
  const span = foldedSpanFor(conversation, message);
  console.log(`summary of ${span?.messageCount ?? '?'} messages`);
  for (const original of span?.messages ?? []) {
    console.log(`  ${original.role}: ${original.content}`);
  }
}
```
