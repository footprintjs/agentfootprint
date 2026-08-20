---
title: ToolExecutionContext
---

# Interface: ToolExecutionContext

Defined in: [src/core/tools.ts:246](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L246)

Runtime context passed to tool.execute().

## Properties

### artifacts

> `readonly` **artifacts**: [`ToolArtifacts`](/docs/api/interfaces/ToolArtifacts)

Defined in: [src/core/tools.ts:273](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L273)

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

Defined in: [src/core/tools.ts:287](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L287)

The credential resolved for this tool's declared `needs` (declare-and-push).
 Present only when the tool declared a need and it resolved successfully.

***

### credentials

> `readonly` **credentials**: `CredentialProvider`

Defined in: [src/core/tools.ts:259](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L259)

The bound credential provider — the PULL escape hatch for dynamic needs.
Always present: when none is attached it's a fail-closed provider that
THROWS, so it never silently no-ops via optional chaining. Prefer the
declarative `needs` + `ctx.credential` for the common case.

***

### hasArtifacts

> `readonly` **hasArtifacts**: `boolean`

Defined in: [src/core/tools.ts:276](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L276)

True when a real artifact store is attached. Branch on this for an
 intentional no-store (degraded) mode instead of catching the refusal.

***

### hasCredentials

> `readonly` **hasCredentials**: `boolean`

Defined in: [src/core/tools.ts:262](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L262)

True when a real provider is attached. Branch on this for intentional
 degraded (no-credential) mode instead of relying on `undefined`.

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/tools.ts:401](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L401)

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

Defined in: [src/core/tools.ts:250](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L250)

Current iteration number of the ReAct loop.

***

### runId?

> `readonly` `optional` **runId?**: `string`

Defined in: [src/core/tools.ts:375](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L375)

The run this call belongs to.

**Absent when there is no run.** A call served over `mcpServe` is one call,
not a turn in a conversation, and minting a synthetic run id there would
fabricate a run that never existed. Branch on the absence.

***

### sessionId?

> `readonly` `optional` **sessionId?**: `string`

Defined in: [src/core/tools.ts:387](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L387)

The hosting conversation this run is bound to, when it is bound to one —
`HostRequest.sessionId`, threaded through `agent.run({ sessionId })`.

Never derived, never defaulted to `runId`, never the anonymous latch.

**It is caller data, not identity.** Anyone who can reach the host can put
any string here, including someone else's. Never key a live session on it
alone — compose it with tenant and principal via [toolSessionKey](/docs/api/functions/toolSessionKey).

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/tools.ts:252](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L252)

Abort signal propagated from run({ env: { signal } }).

***

### teardownScopes?

> `readonly` `optional` **teardownScopes?**: readonly [`TeardownScope`](/docs/api/type-aliases/TeardownScope)[]

Defined in: [src/core/tools.ts:432](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L432)

Which teardown scopes this door can actually honour — `[]` means none ever
fires here.

A FACT to branch on, exactly like `hasCredentials`, rather than an
`undefined` to optional-chain past: a tool that wants a run-scoped session
needs to know it is talking to a door that has no runs BEFORE it opens one.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/tools.ts:248](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L248)

Unique id of THIS tool invocation (matches stream.tool_start.toolCallId).

***

### wanted?

> `readonly` `optional` **wanted?**: `Readonly`\<`Record`\<`string`, [`ArtifactMeta`](/docs/api/interfaces/ArtifactMeta)\>\>

Defined in: [src/core/tools.ts:284](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L284)

The claim tickets behind this call's resolved `wants` arguments (9.22.0)
— argument name → the `ArtifactMeta` whose data replaced the ref in
`args`. Present ONLY when the tool declared `wants` and at least one
declared argument resolved; absent otherwise (absent and empty are
different facts). The data itself is already in `args`.

## Methods

### onTeardown()?

> `optional` **onTeardown**(`cleanup`, `options?`): `void`

Defined in: [src/core/tools.ts:422](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L422)

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

***

### progress()

> **progress**(`payload`): `void`

Defined in: [src/core/tools.ts:360](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L360)

Report progress from INSIDE a long-running tool — "hop 3 of 12 done", said
mid-`execute`, while the call is still running.

A tool call is otherwise ATOMIC on the record: `stream.tool_start` fires,
the handler runs for as long as it runs, and `stream.tool_end` carries the
result. For a forty-second twelve-hop walk that is one long silence — the
person watching cannot tell working from hung, and neither can an operator
reading the archive afterwards.

Each call files one `agentfootprint.stream.tool_progress` event, in call
order, BEFORE this call's `tool_end`. The framework stamps `toolCallId`,
`toolName` and `iteration`: identity facts are never the tool's to state,
so a report cannot claim to be from another call. `payload` is the tool
author's own data, forwarded untouched.

**Always present, never fatal.** With nothing listening it is a no-op that
drops the report; it never throws, never blocks (nothing is awaited), and
never changes what `execute` returns or what the model reads. A tool that
calls it zero times behaves exactly as it did before this existed.

**`payload` must survive `structuredClone`** — it rides the ordinary emit
channel into every event sink and every recording, so plain data only (no
class instances, no live handles, no functions). Progress is TELEMETRY: it
never enters the tool result, the history, or the model's view.

**What a PERSON sees (9.54.0).** One call, two faces. The structured
payload rides to the record untouched, exactly as above — and the live
status surfaces (`agent.enable.liveStatus(...)`, `attachStatus`) now show
the report too, so a long call is no longer silent in the browser. Because
`payload` is yours and typed `unknown`, the display contract is narrow and
literal:

  - A top-level **string field named `message`** is shown to the person
    VERBATIM, trimmed, cut at **120 characters** with the cut stated
    (`… (+N more)`). `message` is the field MCP's own progress
    notification uses; nothing else in the payload is read.
  - **Anything else** — no `message`, a non-string one, an empty one, a
    bare string payload — shows the generic line instead:
    `` `<toolName>` reported progress (N so far)… ``. Your payload is
    never pretty-printed into that sentence. A status line is prose, and
    a tool's JSON is not a sentence anyone wrote.

So `ctx.progress({ done: 3, total: 12 })` keeps its numbers on the record
and says "reported progress (3 so far)" on screen; adding
`message: 'Hop 3 of 12'` puts your own words there instead — and keeps the
numbers. Consumers override the wording by template key
(`tool.progress`, `tool.progress.generic`, or per tool).

Doors with no event stream to file on — `mcpServe`, the offline
`callTraceTool` context — supply the no-op. A tool must not have to know
which door it is behind to be safe to call this from.

#### Parameters

##### payload

`unknown`

#### Returns

`void`

#### Example

```ts
a twelve-hop walk that says where it is
  execute: async (args, ctx) => {
    for (const [i, hop] of hops.entries()) {
      await walk(hop);
      // `message` is what the person reads; the rest is what the record
      // keeps. Drop `message` and the screen still says a report landed.
      ctx.progress({
        message: `Hop ${i + 1} of ${hops.length} — ${hop.id}`,
        done: i + 1,
        total: hops.length,
        hop: hop.id,
      });
    }
    return summary;
  }
```
