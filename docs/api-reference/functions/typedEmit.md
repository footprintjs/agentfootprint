[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / typedEmit

# Function: typedEmit()

> **typedEmit**\<`K`\>(`scope`, `type`, `payload`): `void`

Defined in: [src/recorders/core/typedEmit.ts:36](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/core/typedEmit.ts#L36)

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
    model: 'claude-opus-4-8',
    systemPromptChars: 800,
    messagesCount: 2,
    toolsCount: 0,
  });
```
