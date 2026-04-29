[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / typedEmit

# Function: typedEmit()

> **typedEmit**\<`K`\>(`scope`, `type`, `payload`): `void`

Defined in: [agentfootprint/src/recorders/core/typedEmit.ts:36](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/typedEmit.ts#L36)

Emit a typed event from inside stage code.

## Type Parameters

### K

`K` *extends* keyof [`AgentfootprintEventMap`](/agentfootprint/api/generated/interfaces/AgentfootprintEventMap.md)

## Parameters

### scope

`EmitableScope`

### type

`K`

### payload

[`AgentfootprintEventMap`](/agentfootprint/api/generated/interfaces/AgentfootprintEventMap.md)\[`K`\]\[`"payload"`\]

## Returns

`void`

## Example

```ts
typedEmit(scope, 'agentfootprint.stream.llm_start', {
    iteration: 1,
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    systemPromptChars: 800,
    messagesCount: 2,
    toolsCount: 0,
  });
```
