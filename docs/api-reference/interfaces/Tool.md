[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / Tool

# Interface: Tool\<TArgs, TResult\>

Defined in: [src/core/tools.ts:26](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/tools.ts#L26)

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

### capabilities?

> `readonly` `optional` **capabilities?**: readonly [`ToolCapability`](/agentfootprint/api/generated/type-aliases/ToolCapability.md)[]

Defined in: [src/core/tools.ts:90](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/tools.ts#L90)

What this tool touches, DECLARED by whoever wrote it (9.11.0).

The framework never infers this. A tool's capabilities are not knowable
from its name, its schema or its description, and classifying them by guess
would rest a policy decision on a heuristic — so a tool that says nothing
gets nothing asked about it, exactly as before.

**Enforced when both sides speak.** When a tool declares a capability AND
the configured `PermissionChecker` declares it `governs` that capability,
the dispatch loop asks once per declared capability, right after the
`'tool_call'` check allows — `check({ capability: 'external_net', target:
'<tool name>' })`. Either side silent → not asked, not refused. A denial
lands like every other refusal in the loop: the tool does not run and the
model reads a result it can adapt to.

#### Example

```ts
a tool the operator wants governed as a network egress
  defineTool({
    name: 'fetch_invoice',
    description: 'Fetch an invoice PDF from the billing service',
    capabilities: ['external_net', 'user_data'],
    inputSchema: { … },
    execute: async ({ id }) => …,
  });
```

***

### checkIn?

> `readonly` `optional` **checkIn?**: [`CheckInDemand`](/agentfootprint/api/generated/type-aliases/CheckInDemand.md)

Defined in: [src/core/tools.ts:46](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/tools.ts#L46)

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

Defined in: [src/core/tools.ts:31](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/tools.ts#L31)

Declare-and-push: a credential this tool needs. The framework resolves it
 BEFORE invoking and injects `ctx.credential`; it is NOT in `schema`, so the
 LLM never sees or fills it.

***

### schema

> `readonly` **schema**: [`LLMToolSchema`](/agentfootprint/api/generated/interfaces/LLMToolSchema.md)

Defined in: [src/core/tools.ts:27](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/tools.ts#L27)

***

### source?

> `readonly` `optional` **source?**: `string`

Defined in: [src/core/tools.ts:64](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/tools.ts#L64)

Where this tool came from — the name of the MCP server that served it.

**Absent means "this agent's own".** A tool you wrote with `defineTool`
carries nothing here, and that absence is the fact: nobody else supplied
it. A tool that arrived over MCP carries the client's `name`
(`mcpClient({ name: 'aws-mcp' })`), because the same tool NAME can come
from two servers and a policy that cannot tell them apart governs both.

It travels to the decision point as `ToolMiddlewareContext.toolSource` —
the tool-dispatch chain and `mcpServe`'s serving-side chain read the same
field.

Set by `mcpClient` / `mockMcpClient`. `defineTool` never sets it, so it
cannot be spoofed by accident; a hand-built `Tool` may set it deliberately
when it is genuinely relaying another source's tool.

## Methods

### execute()

> **execute**(`args`, `ctx`): `TResult` \| `Promise`\<`TResult`\>

Defined in: [src/core/tools.ts:91](https://github.com/footprintjs/agentfootprint/blob/ab9c1736d633ec17bc3f32da618fe0e46deae0c2/src/core/tools.ts#L91)

#### Parameters

##### args

`TArgs`

##### ctx

[`ToolExecutionContext`](/agentfootprint/api/generated/interfaces/ToolExecutionContext.md)

#### Returns

`TResult` \| `Promise`\<`TResult`\>
