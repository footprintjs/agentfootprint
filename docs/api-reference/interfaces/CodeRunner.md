[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CodeRunner

# Interface: CodeRunner

Defined in: [src/adapters/types.ts:660](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/adapters/types.ts#L660)

A service that runs code in an isolated session — a managed code
interpreter, a container pool, a subprocess.

**The shape is Start → Execute ×N → Stop**, because that is what every real
one is, and the middle is the part a framework has to make possible. Paying
session start-up on every call is the honest cheap version; holding the
session in a module-level map is the fast version that hands one live sandbox
to whoever calls next. `ctx.onTeardown` + [ToolExecutionContext.runId](/agentfootprint/api/generated/interfaces/ToolExecutionContext.md#runid)
are what let a tool do neither.

── Why this port exists at all: "summarize prose, compute data" ────────────
A tool that returns 40MB of rows does not need a bigger context window; it
needs to not put the rows in one. The motivating failure is a real production
request of 879,073 tokens — a tool result pasted straight into the prompt.
With a code runner, the model writes the aggregation, the RUNNER holds the
data, and what comes back is the answer. Prose gets summarized; data gets
computed. `CodeResult.truncated` exists so the second half of that promise
cannot quietly break.

Implement it for your own backend; ship it to `codeRunnerTool({ runner })`.

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/adapters/types.ts:663](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/adapters/types.ts#L663)

Stable id — reported on every `agentfootprint.tools.session_*` event so a
 row names its backend, not just its tool.

## Methods

### start()

> **start**(`req`): `Promise`\<[`CodeSession`](/agentfootprint/api/generated/interfaces/CodeSession.md)\>

Defined in: [src/adapters/types.ts:670](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/adapters/types.ts#L670)

Open a session.

`key` is the ISOLATION key the caller derived (see `toolSessionKey`). An
adapter may use it to name the remote session; it must never widen it.

#### Parameters

##### req

###### key

`string`

###### language?

`string`

###### signal?

`AbortSignal`

#### Returns

`Promise`\<[`CodeSession`](/agentfootprint/api/generated/interfaces/CodeSession.md)\>
