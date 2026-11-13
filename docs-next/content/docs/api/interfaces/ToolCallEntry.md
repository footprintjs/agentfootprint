---
title: ToolCallEntry
---

# Interface: ToolCallEntry

Defined in: [src/provider-contract/types.ts:793](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L793)

One entry in the in-flight tool-call sequence delivered to
`PermissionChecker.check()` since v2.12. Lets sequence-aware
policies (exfil chain detection, idempotency limits, cost guards)
inspect what has already been dispatched: the model's calls, and each
call a tool made through `ctx.tools.call` right after its outer call.

Derived from `scope.history` at check time — single source of truth,
survives `agent.resumeOnError(checkpoint)` correctly.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\> \| `undefined`

Defined in: [src/provider-contract/types.ts:797](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L797)

Tool args passed to `tool.execute(args, ctx)`; an inner call's shown through the tool's argument view.

***

### inner?

> `readonly` `optional` **inner?**: `true`

Defined in: [src/provider-contract/types.ts:803](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L803)

`true` on a call a tool made through `ctx.tools.call` (`provider-contract/innerCalls.ts`); absent on the model's own.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/provider-contract/types.ts:799](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L799)

ReAct iteration the call was dispatched on.

***

### name

> `readonly` **name**: `string`

Defined in: [src/provider-contract/types.ts:795](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L795)

Tool name dispatched.

***

### providerId?

> `readonly` `optional` **providerId?**: `string`

Defined in: [src/provider-contract/types.ts:801](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L801)

`'local'` (`.tool(...)` / `staticTools(...)`) or the resolving `ToolProvider.id` — lets exfil rules match on origin.
