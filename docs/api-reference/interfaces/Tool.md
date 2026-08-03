[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / Tool

# Interface: Tool\<TArgs, TResult\>

Defined in: [src/core/tools.ts:24](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/core/tools.ts#L24)

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

### checkIn?

> `readonly` `optional` **checkIn?**: [`CheckInDemand`](/agentfootprint/api/generated/type-aliases/CheckInDemand.md)

Defined in: [src/core/tools.ts:44](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/core/tools.ts#L44)

Declarative demand for a human check-in BEFORE this tool runs — consent
for a consequential action, with an evidence pack riding the ask.
`'always'` trips on every call; a `(args, ctx) => boolean` predicate trips
selectively (e.g. only refunds over $1000). When it trips the tool-dispatch
loop pauses BEFORE execute and surfaces a `CheckInRequest`; the human
answers with `checkInApproved` / `checkInDeclined`. Omitted → byte-identical
behavior (no gate, no events, no pause). See `.checkIn()` on the Agent
builder to configure the evidence pack. Ordered AFTER the permission gate
and arg-validation, BEFORE credential resolution.

Non-generic here (a `Tool` widens into `Tool[]` registries); `defineTool`
exposes a predicate typed to the tool's args at the CALL site.

***

### needs?

> `readonly` `optional` **needs?**: `CredentialNeed`

Defined in: [src/core/tools.ts:29](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/core/tools.ts#L29)

Declare-and-push: a credential this tool needs. The framework resolves it
 BEFORE invoking and injects `ctx.credential`; it is NOT in `schema`, so the
 LLM never sees or fills it.

***

### schema

> `readonly` **schema**: [`LLMToolSchema`](/agentfootprint/api/generated/interfaces/LLMToolSchema.md)

Defined in: [src/core/tools.ts:25](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/core/tools.ts#L25)

## Methods

### execute()

> **execute**(`args`, `ctx`): `TResult` \| `Promise`\<`TResult`\>

Defined in: [src/core/tools.ts:45](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/core/tools.ts#L45)

#### Parameters

##### args

`TArgs`

##### ctx

[`ToolExecutionContext`](/agentfootprint/api/generated/interfaces/ToolExecutionContext.md)

#### Returns

`TResult` \| `Promise`\<`TResult`\>
