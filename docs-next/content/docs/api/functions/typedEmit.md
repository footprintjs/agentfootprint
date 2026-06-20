---
title: typedEmit
---

# Function: typedEmit()

> **typedEmit**\<`K`\>(`scope`, `type`, `payload`): `void`

Defined in: [src/recorders/core/typedEmit.ts:63](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/typedEmit.ts#L63)

Emit a typed event from inside stage code.

## Type Parameters

### K

`K` *extends* keyof [`AgentfootprintEventMap`](/docs/api/interfaces/AgentfootprintEventMap)

## Parameters

### scope

`EmitableScope`

### type

`K`

### payload

[`AgentfootprintEventMap`](/docs/api/interfaces/AgentfootprintEventMap)\[`K`\]\[`"payload"`\]

## Returns

`void`

## Example

```ts
typedEmit(scope, 'agentfootprint.stream.llm_start', {
    iteration: 1,
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    systemPromptChars: 800,
    messagesCount: 2,
    toolsCount: 0,
  });
```
