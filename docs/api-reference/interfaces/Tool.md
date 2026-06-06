[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / Tool

# Interface: Tool\<TArgs, TResult\>

Defined in: [src/core/tools.ts:20](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/tools.ts#L20)

One executable tool the Agent can call.

- `schema` is what the LLM sees (name, description, JSON schema).
- `execute` runs when the LLM requests this tool with the given args.
  Returns anything JSON-serializable; the framework forwards it back
  to the LLM as the tool result.

## Type Parameters

### TArgs

`TArgs` = `Record`\<`string`, `unknown`\>

### TResult

`TResult` = `unknown`

## Properties

### schema

> `readonly` **schema**: [`LLMToolSchema`](/agentfootprint/api/generated/interfaces/LLMToolSchema.md)

Defined in: [src/core/tools.ts:21](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/tools.ts#L21)

## Methods

### execute()

> **execute**(`args`, `ctx`): `TResult` \| `Promise`\<`TResult`\>

Defined in: [src/core/tools.ts:22](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/tools.ts#L22)

#### Parameters

##### args

`TArgs`

##### ctx

[`ToolExecutionContext`](/agentfootprint/api/generated/interfaces/ToolExecutionContext.md)

#### Returns

`TResult` \| `Promise`\<`TResult`\>
