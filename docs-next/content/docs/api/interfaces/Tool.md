---
title: Tool<TArgs, TResult>
---

# Interface: Tool\<TArgs, TResult\>

Defined in: [src/core/tools.ts:23](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L23)

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

### needs?

> `readonly` `optional` **needs?**: `CredentialNeed`

Defined in: [src/core/tools.ts:28](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L28)

Declare-and-push: a credential this tool needs. The framework resolves it
 BEFORE invoking and injects `ctx.credential`; it is NOT in `schema`, so the
 LLM never sees or fills it.

***

### schema

> `readonly` **schema**: [`LLMToolSchema`](/docs/api/interfaces/LLMToolSchema)

Defined in: [src/core/tools.ts:24](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L24)

## Methods

### execute()

> **execute**(`args`, `ctx`): `TResult` \| `Promise`\<`TResult`\>

Defined in: [src/core/tools.ts:29](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L29)

#### Parameters

##### args

`TArgs`

##### ctx

[`ToolExecutionContext`](/docs/api/interfaces/ToolExecutionContext)

#### Returns

`TResult` \| `Promise`\<`TResult`\>
