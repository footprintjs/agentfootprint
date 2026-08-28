---
title: Tool<TArgs, TResult>
---

# Interface: Tool\<TArgs, TResult\>

Defined in: [src/core/tools.ts:31](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L31)

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

### argumentsFrom?

> `readonly` `optional` **argumentsFrom?**: readonly `string`[]

Defined in: [src/core/tools.ts:214](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L214)

WHERE THIS TOOL'S ARGUMENTS COME FROM (9.60.0) — the names of tools
whose RESULTS ground what a caller passes here (`screen_fire` fires at
ids that `whats_here` listed). Declared by the author, never inferred:
only the author knows the dependency. The dangling-reference check
reads it at composition — when a declared ground's results have left
the window (`WindowRecord.droppedObservations`) and were not
re-established, offering this tool files a finding. Omitted → this
tool is never that check's subject, byte-identical.

***

### capabilities?

> `readonly` `optional` **capabilities?**: readonly [`ToolCapability`](/docs/api/type-aliases/ToolCapability)[]

Defined in: [src/core/tools.ts:134](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L134)

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

> `readonly` `optional` **checkIn?**: [`CheckInDemand`](/docs/api/type-aliases/CheckInDemand)

Defined in: [src/core/tools.ts:78](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L78)

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

> `readonly` `optional` **checkInComponent?**: [`AskComponent`](/docs/api/interfaces/AskComponent)

Defined in: [src/core/tools.ts:90](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L90)

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

Defined in: [src/core/tools.ts:36](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L36)

Declare-and-push: a credential this tool needs. The framework resolves it
 BEFORE invoking and injects `ctx.credential`; it is NOT in `schema`, so the
 LLM never sees or fills it.

***

### owner?

> `readonly` `optional` **owner?**: `ToolOwner`

Defined in: [src/core/tools.ts:203](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L203)

WHO OWNS THIS TOOL (9.60.0) — the identity edge, stamped at the one
moment the code demonstrably knows both ends: registration. Before
this field, ownership was only DERIVABLE (from the per-pass
InjectionRecord, or the maps kernel's MountedMap) — a checker asking
"who owns get_zones" between registration and the first tools-slot
pass had no answer, and a static `.tool()` registration's sourceId
was just the tool's own name. The Context Integrity checks read this
stamp and never infer identity; a tool without one is `unreachable`
to subject-joined checks, which the disposition ledger counts.
Omitted → exactly today's bytes (`source: 'registry'`).

***

### repeatedWhen?

> `readonly` `optional` **repeatedWhen?**: `"arguments"`

Defined in: [src/core/tools.ts:263](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L263)

FINGERPRINT THE REPEATED-CALL LEDGER ON ARGUMENTS ALONE (9.62.0) —
`'arguments'` tells `core/agent/repeatedCall.ts` that this tool's own
RESULT is not evidence of repetition and must not be folded into the
match key.

The repeated-call nudge exists to catch a model calling the same tool
with the same arguments and getting nowhere. By default it proves "got
nowhere" by also requiring the RESULT to match — a `check status` call
returning a different status is progress, not a loop, and the default
rule (correctly) says nothing about it. That default quietly breaks for
a tool whose result is not a function of its arguments on purpose: a
screen/UI tool that stamps a fresh version number, timestamp, or cursor
into every answer so a human or a downstream cache can tell which
render is current. Call a tool like that twice with byte-identical
arguments and the default fingerprint never matches — the detector is
silently inert for it, forever. This was found in a real recorded
failure: an agent re-fired a completed navigation sequence and nothing
noticed, because each fire's fresh stamp made it look like new
information.

Declared, never inferred — the `capabilities` / `resultClass` law. Only
the tool's author knows whether its result is signal or a stamp;
guessing from a name or a response shape would rest a detector on a
heuristic the framework cannot verify. The note's wording changes to
match when this fires (it stops claiming the result matched, because it
did not) — see `repeatedCall.ts` for both sentences.

**This never suppresses execution.** The ledger only ever appends a
teaching sentence to a result the tool already returned, strictly AFTER
`execute` ran — the same anti-guarantee `runCheckpoint.ts` and
`Agent.ts` document for tool calls generally (durability replay,
resumed runs, and every retry of this kind still execute the tool; there
is no dedup here or anywhere else in this library).

Omitted → byte-identical behavior: the ledger keeps folding the result
into the key exactly as it always has, for every tool that does not
declare this.

#### Example

```ts
a screen tool whose result always carries a fresh version stamp
  defineTool({
    name: 'render_screen',
    description: 'Render the named screen',
    repeatedWhen: 'arguments',
    inputSchema: { … },
    execute: async ({ view }) => `rendered ${view} @v${Date.now()}`,
  });
```

***

### resultCeiling?

> `readonly` `optional` **resultCeiling?**: [`ToolResultCeiling`](/docs/api/interfaces/ToolResultCeiling)

Defined in: [src/core/tools.ts:143](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L143)

The refusing ceiling on THIS tool's result (9.20.0): when the handler's
stringified return exceeds `maxChars`, the model reads a teaching refusal
naming the true size, the ceiling and how to narrow — and the oversized
payload never enters context, history or any event. See
[ToolResultCeiling](/docs/api/interfaces/ToolResultCeiling) for why refusal, not truncation. Omitted →
byte-identical behavior (nothing measured, nothing emitted).

***

### resultClass?

> `readonly` `optional` **resultClass?**: [`ToolResultClass`](/docs/api/type-aliases/ToolResultClass)

Defined in: [src/core/tools.ts:154](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L154)

The declared CLASS of this tool's results (9.53.0) — what kind of answer
it gives (`'triage'` — a health/fault verdict; `'inventory'` — a
population listing). Declared, never inferred (the `capabilities` law),
and validated at definition against the closed set. The
`check:semantics` gate keys its per-class rules on it — a `'triage'`
tool whose sample result declares no coverage fails the build by name.
Omitted → no class rules; the semantic-envelope rules still apply to any
result that carries the `af_semantics` marker.

***

### resultKind?

> `readonly` `optional` **resultKind?**: `string`

Defined in: [src/core/tools.ts:190](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L190)

THE ARTIFACT KIND A PLACED RESULT IS MINTED UNDER (9.70.0) — this tool's
result in the CONSUMER's vocabulary (`'dataset/rows'`), not the
framework's.

Artifact PLACEMENT (`artifacts: { store, placement }`) checks an oversized
result into the store and hands the model a claim ticket. Absent this
field it mints under `tool-result/<toolName>` — honest, and unspendable:
`wants` is exact-match on kind BY LAW (no wildcards, no hierarchy), so a
downstream `wants: { dataset: 'dataset/rows' }` refuses the very ticket
the framework just minted, as a kind mismatch. Field-verified: the
consumer had to re-mint by hand at the seam, which is the framework
declining to carry its own ref.

The fix is DECLARED, never inferred (the `capabilities` / `resultClass`
law) and never a loosening of the matcher: only the author knows what
their tool actually produces, and `wants` staying exact is what makes a
ticket a promise. Declaring `resultKind` makes the MINT speak the
consumer's vocabulary instead.

A non-empty string; an empty or blank one is refused at `defineTool`,
because a kind is what a ticket is redeemed against and a blank kind
redeems against nothing. Omitted → exactly today's bytes
(`tool-result/<toolName>`, and no measurement at all without placement).

#### Example

```ts
a tool whose placed result a `wants` consumer can spend
  defineTool({
    name: 'get_rows',
    description: 'Fetch the rows of a dataset',
    resultKind: 'dataset/rows',
    inputSchema: { … },
    execute: async () => …,
  });
  // elsewhere: defineTool({ name: 'chart', wants: { dataset: 'dataset/rows' }, … })
```

***

### schema

> `readonly` **schema**: [`LLMToolSchema`](/docs/api/interfaces/LLMToolSchema)

Defined in: [src/core/tools.ts:32](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L32)

***

### source?

> `readonly` `optional` **source?**: `string`

Defined in: [src/core/tools.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L108)

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

Defined in: [src/core/tools.ts:63](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L63)

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

Defined in: [src/core/tools.ts:264](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L264)

#### Parameters

##### args

`TArgs`

##### ctx

[`ToolExecutionContext`](/docs/api/interfaces/ToolExecutionContext)

#### Returns

`TResult` \| `Promise`\<`TResult`\>
