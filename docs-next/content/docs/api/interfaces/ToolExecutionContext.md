---
title: ToolExecutionContext
---

# Interface: ToolExecutionContext

Defined in: [src/core/tools.ts:49](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L49)

Runtime context passed to tool.execute().

## Properties

### credential?

> `readonly` `optional` **credential?**: `Credential`

Defined in: [src/core/tools.ts:68](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L68)

The credential resolved for this tool's declared `needs` (declare-and-push).
 Present only when the tool declared a need and it resolved successfully.

***

### credentials

> `readonly` **credentials**: `CredentialProvider`

Defined in: [src/core/tools.ts:62](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L62)

The bound credential provider — the PULL escape hatch for dynamic needs.
Always present: when none is attached it's a fail-closed provider that
THROWS, so it never silently no-ops via optional chaining. Prefer the
declarative `needs` + `ctx.credential` for the common case.

***

### hasCredentials

> `readonly` **hasCredentials**: `boolean`

Defined in: [src/core/tools.ts:65](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L65)

True when a real provider is attached. Branch on this for intentional
 degraded (no-credential) mode instead of relying on `undefined`.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/tools.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L53)

Current iteration number of the ReAct loop.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/tools.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L55)

Abort signal propagated from run({ env: { signal } }).

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/tools.ts:51](https://github.com/footprintjs/agentfootprint/blob/main/src/core/tools.ts#L51)

Unique id of THIS tool invocation (matches stream.tool_start.toolCallId).
