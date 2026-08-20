[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / Tool

# Interface: Tool\<TArgs, TResult\>

Defined in: [src/core/tools.ts:31](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/tools.ts#L31)

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

Defined in: [src/core/tools.ts:134](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/tools.ts#L134)

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

Defined in: [src/core/tools.ts:78](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/tools.ts#L78)

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

### checkInComponent?

> `readonly` `optional` **checkInComponent?**: [`AskComponent`](/agentfootprint/api/generated/interfaces/AskComponent.md)

Defined in: [src/core/tools.ts:90](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/tools.ts#L90)

Which REGISTERED screen component collects this tool's check-in decision
(9.24.0) — ids and props only, never markup. Rides the `CheckInRequest`
when the gate trips, so the answering screen renders its own registered
component instead of prose. Meaningless without `checkIn` and refused
beside its absence at `defineTool` — a component for a gate that never
fires is configuration that lies. A `propsRef` here must resolve in the
RUN's artifact scope when the gate trips (validated at raise time); a
check-in fires BEFORE `execute`, so the tool cannot mint it mid-call —
static declarations usually want inline `props`.

***

### needs?

> `readonly` `optional` **needs?**: `CredentialNeed`

Defined in: [src/core/tools.ts:36](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/tools.ts#L36)

Declare-and-push: a credential this tool needs. The framework resolves it
 BEFORE invoking and injects `ctx.credential`; it is NOT in `schema`, so the
 LLM never sees or fills it.

***

### resultCeiling?

> `readonly` `optional` **resultCeiling?**: [`ToolResultCeiling`](/agentfootprint/api/generated/interfaces/ToolResultCeiling.md)

Defined in: [src/core/tools.ts:143](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/tools.ts#L143)

The refusing ceiling on THIS tool's result (9.20.0): when the handler's
stringified return exceeds `maxChars`, the model reads a teaching refusal
naming the true size, the ceiling and how to narrow — and the oversized
payload never enters context, history or any event. See
[ToolResultCeiling](/agentfootprint/api/generated/interfaces/ToolResultCeiling.md) for why refusal, not truncation. Omitted →
byte-identical behavior (nothing measured, nothing emitted).

***

### resultClass?

> `readonly` `optional` **resultClass?**: [`ToolResultClass`](/agentfootprint/api/generated/type-aliases/ToolResultClass.md)

Defined in: [src/core/tools.ts:154](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/tools.ts#L154)

The declared CLASS of this tool's results (9.53.0) — what kind of answer
it gives (`'triage'` — a health/fault verdict; `'inventory'` — a
population listing). Declared, never inferred (the `capabilities` law),
and validated at definition against the closed set. The
`check:semantics` gate keys its per-class rules on it — a `'triage'`
tool whose sample result declares no coverage fails the build by name.
Omitted → no class rules; the semantic-envelope rules still apply to any
result that carries the `af_semantics` marker.

***

### schema

> `readonly` **schema**: [`LLMToolSchema`](/agentfootprint/api/generated/interfaces/LLMToolSchema.md)

Defined in: [src/core/tools.ts:32](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/tools.ts#L32)

***

### source?

> `readonly` `optional` **source?**: `string`

Defined in: [src/core/tools.ts:108](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/tools.ts#L108)

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

***

### wants?

> `readonly` `optional` **wants?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/core/tools.ts:63](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/tools.ts#L63)

Declared artifact ARGUMENTS (9.22.0) — argument name → the artifact
`kind` it must resolve to (e.g. `wants: { dataset: 'dataset/rows' }`).

The `needs` precedent applied to data: the MODEL passes the ~26-char
`art_…` ref as the argument (declare it `type: 'string'` in
`inputSchema`), and at dispatch — BEFORE `execute` — the framework
redeems it under the run's own scope and kind-checks the meta. The
handler receives the RESOLVED DATA in `args` (and the claim tickets on
`ctx.wanted`); a stale, unknown, or wrong-kind ref never reaches the
tool — the model reads a teaching refusal listing the live refs of the
wanted kind. Resolution rides `agentfootprint.artifacts.resolved`;
refusals ride `artifacts.refused` with `op: 'dispatch'`.

**Whether the model MAY omit it is your `inputSchema`'s to say.** Name
the argument in `required` and dispatch refuses the call by name when no
ref arrives — the handler is never entered believing the framework
resolved something it did not. Leave it out and an omitted argument is
the model choosing not to use one: the tool runs, `args` carries no such
key, and `ctx.wanted` has no entry for it.

Requires an attached store: an Agent refuses at BUILD when a statically
registered tool declares `wants` with no `artifacts` configured (config
that lies otherwise); other dispatch doors refuse at dispatch, by name.
Omitted → byte-identical behavior (nothing resolved, nothing measured).

## Methods

### execute()

> **execute**(`args`, `ctx`): `TResult` \| `Promise`\<`TResult`\>

Defined in: [src/core/tools.ts:155](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/tools.ts#L155)

#### Parameters

##### args

`TArgs`

##### ctx

[`ToolExecutionContext`](/agentfootprint/api/generated/interfaces/ToolExecutionContext.md)

#### Returns

`TResult` \| `Promise`\<`TResult`\>
