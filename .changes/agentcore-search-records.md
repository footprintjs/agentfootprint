---
type: fixed
---
**`AgentCoreStore.search()` records now reach the model.** Each record AgentCore
extracted came back with its text as a bare string value. Both memory formatters
read the text off `.content`, so a read-only memory over the store rendered every
record as an empty `<memory>` (or `<source>`) block. The search found the facts
and the model never saw them. Each value is now `{ content }`, the store's
record shape, and carries no `role`: AgentCore derived the fact, nobody said it.
If you read `entry.value` from `search()` directly, read `entry.value.content`.
