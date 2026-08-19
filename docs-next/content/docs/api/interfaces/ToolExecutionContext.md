---
title: ToolExecutionContext
---

# Interface: ToolExecutionContext

Defined in: [src/core/tools.ts:211](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L211)

Runtime context passed to tool.execute().

## Properties

### artifacts

> `readonly` **artifacts**: [`ToolArtifacts`](/docs/api/interfaces/ToolArtifacts)

Defined in: [src/core/tools.ts:238](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L238)

The claim-check store, bound to THIS run's scope (9.21.0) — shaped
exactly like `credentials`. Always present: with no store attached every
method throws a teaching refusal naming how to attach one
(`Agent.create({ ..., artifacts })`), so a missing store can never read
as an empty one. The scope (tenant/principal/conversation) is composed by
the framework from the run's identity/session and closed over — a tool
cannot name, widen, or replace it. `put` stamps `origin`
(`{ runId, toolCallId }`) from the run's own facts.

***

### credential?

> `readonly` `optional` **credential?**: `Credential`

Defined in: [src/core/tools.ts:252](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L252)

The credential resolved for this tool's declared `needs` (declare-and-push).
 Present only when the tool declared a need and it resolved successfully.

***

### credentials

> `readonly` **credentials**: `CredentialProvider`

Defined in: [src/core/tools.ts:224](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L224)

The bound credential provider — the PULL escape hatch for dynamic needs.
Always present: when none is attached it's a fail-closed provider that
THROWS, so it never silently no-ops via optional chaining. Prefer the
declarative `needs` + `ctx.credential` for the common case.

***

### hasArtifacts

> `readonly` **hasArtifacts**: `boolean`

Defined in: [src/core/tools.ts:241](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L241)

True when a real artifact store is attached. Branch on this for an
 intentional no-store (degraded) mode instead of catching the refusal.

***

### hasCredentials

> `readonly` **hasCredentials**: `boolean`

Defined in: [src/core/tools.ts:227](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L227)

True when a real provider is attached. Branch on this for intentional
 degraded (no-credential) mode instead of relying on `undefined`.

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/tools.ts:293](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L293)

The identity the CALLER supplied — `run({ identity })`, the same tuple
memory and the permission gate scope on.

**Absent when the caller passed none.** Deliberately NOT the run's internal
`runIdentity`, which is always populated (it defaults to
`{ conversationId: '<runId>' }`, or to `{ conversationId: sessionId }` on a
session-bound run since 9.10.0): handing either of those to a tool would
publish a SYNTHESIZED conversation as if somebody had named one. A tool
that wants the session has `ctx.sessionId` for it, which is the fact the
transport actually delivered.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/tools.ts:215](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L215)

Current iteration number of the ReAct loop.

***

### runId?

> `readonly` `optional` **runId?**: `string`

Defined in: [src/core/tools.ts:267](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L267)

The run this call belongs to.

**Absent when there is no run.** A call served over `mcpServe` is one call,
not a turn in a conversation, and minting a synthetic run id there would
fabricate a run that never existed. Branch on the absence.

***

### sessionId?

> `readonly` `optional` **sessionId?**: `string`

Defined in: [src/core/tools.ts:279](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L279)

The hosting conversation this run is bound to, when it is bound to one —
`HostRequest.sessionId`, threaded through `agent.run({ sessionId })`.

Never derived, never defaulted to `runId`, never the anonymous latch.

**It is caller data, not identity.** Anyone who can reach the host can put
any string here, including someone else's. Never key a live session on it
alone — compose it with tenant and principal via [toolSessionKey](/docs/api/functions/toolSessionKey).

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/tools.ts:217](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L217)

Abort signal propagated from run({ env: { signal } }).

***

### teardownScopes?

> `readonly` `optional` **teardownScopes?**: readonly [`TeardownScope`](/docs/api/type-aliases/TeardownScope)[]

Defined in: [src/core/tools.ts:324](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L324)

Which teardown scopes this door can actually honour — `[]` means none ever
fires here.

A FACT to branch on, exactly like `hasCredentials`, rather than an
`undefined` to optional-chain past: a tool that wants a run-scoped session
needs to know it is talking to a door that has no runs BEFORE it opens one.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/tools.ts:213](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L213)

Unique id of THIS tool invocation (matches stream.tool_start.toolCallId).

***

### wanted?

> `readonly` `optional` **wanted?**: `Readonly`\<`Record`\<`string`, [`ArtifactMeta`](/docs/api/interfaces/ArtifactMeta)\>\>

Defined in: [src/core/tools.ts:249](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L249)

The claim tickets behind this call's resolved `wants` arguments (9.22.0)
— argument name → the `ArtifactMeta` whose data replaced the ref in
`args`. Present ONLY when the tool declared `wants` and at least one
declared argument resolved; absent otherwise (absent and empty are
different facts). The data itself is already in `args`.

## Methods

### onTeardown()?

> `optional` **onTeardown**(`cleanup`, `options?`): `void`

Defined in: [src/core/tools.ts:314](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L314)

Register cleanup for work THIS call started — a code-interpreter session, a
browser context, a lease.

The tool learns its isolation key at execute time and registers cleanup for
exactly that key in the same breath; there is no other seam where both are
in hand. Registering twice under one `(tool, scope, key)` is a no-op that
keeps the FIRST cleanup (it holds the live handle) and refreshes liveness,
so calling this on every execute is the intended shape for a reused
session.

Throws, naming the door, when `scope` is not in [teardownScopes](/docs/api/interfaces/ToolExecutionContext#teardownscopes) — a
capability nobody implements is a promise the library cannot keep.

#### Parameters

##### cleanup

() => `void` \| `Promise`\<`void`\>

##### options?

[`TeardownOptions`](/docs/api/interfaces/TeardownOptions)

#### Returns

`void`

#### Example

```ts
a session that lives as long as the run
  const key = toolSessionKey(ctx, 'run');
  const session = await runner.start({ key });
  ctx.onTeardown?.(() => session.stop(), { scope: 'run', key });
```
