# memory/

Conversation message management — pure functions for immutable message arrays.

## Functions

| Function | What |
|----------|------|
| `appendMessage(messages, msg)` | Append a message. Returns new array (never mutates). |
| `lastMessage(messages)` | Get the most recent message. |
| `lastAssistantMessage(messages)` | Get the most recent assistant message (skips tool results, user messages). |
| `lastMessageHasToolCalls(messages)` | Check if the last assistant message has tool calls (loop detection). |
| `createToolResults(results)` | Create ToolResultMessage array from tool call ID → result pairs. |

These are internal helpers used by the agent loop stages. For conversation management strategies (sliding window, char budget, persistent history), see `providers/README.md`.

## Memory Stores

For persistent conversation storage across sessions, use the `ConversationStore` adapters:

```typescript
import { Agent } from 'agentfootprint';
import { redisStore } from 'agentfootprint';

const agent = Agent.create({ provider })
  .memory({
    store: redisStore({ client: redis }),
    conversationId: 'user-123',
    strategy: slidingWindow({ maxMessages: 50 }),
  })
  .build();
```

See `adapters/README.md` for store options (InMemory, Redis, Postgres, DynamoDB).

## Context Mapping

Memory strategies give flexibility in HOW conversation history is managed:

- **What to keep**: `slidingWindow()`, `charBudget()` — truncation strategies
- **How to compress**: `summaryStrategy()` — old messages → summary
- **Where to store**: `ConversationStore` adapters — Redis, Postgres, DynamoDB
- **How to compose**: `compositeMessages()` — chain strategies

The consumer decides the memory policy. The library provides the primitives.
