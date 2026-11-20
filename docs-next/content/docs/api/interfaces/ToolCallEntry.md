---
title: ToolCallEntry
---

# Interface: ToolCallEntry

Defined in: [src/provider-contract/innerCalls.ts:49](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/innerCalls.ts#L49)

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

Defined in: [src/provider-contract/innerCalls.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/innerCalls.ts#L53)

Bound tool arguments in permission questions. Public halt reports use the inner tool's shown view.

***

### inner?

> `readonly` `optional` **inner?**: `true`

Defined in: [src/provider-contract/innerCalls.ts:59](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/innerCalls.ts#L59)

`true` on a call a tool made through `ctx.tools.call` (`provider-contract/innerCalls.ts`); absent on the model's own.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/provider-contract/innerCalls.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/innerCalls.ts#L55)

ReAct iteration the call was dispatched on.

***

### name

> `readonly` **name**: `string`

Defined in: [src/provider-contract/innerCalls.ts:51](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/innerCalls.ts#L51)

Tool name dispatched.

***

### providerId?

> `readonly` `optional` **providerId?**: `string`

Defined in: [src/provider-contract/innerCalls.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/innerCalls.ts#L57)

`'local'` (`.tool(...)` / `staticTools(...)`) or the resolving `ToolProvider.id` — lets exfil rules match on origin.
